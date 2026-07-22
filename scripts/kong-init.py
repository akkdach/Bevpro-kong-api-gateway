#!/usr/bin/env python3
"""
kong-init.py — ตั้งค่า Kong ทั้งหมดตอน stack start (แทน kong-init.sh เดิม)

รันโดย service "kong-setup" ในตัว stack — รันซ้ำได้ (idempotent)

ทำอะไรบ้าง:
  1. รอ Kong Admin API พร้อม
  2. สร้าง/อัปเดต service onelake-middleware (ชี้ Azure App Service)
  3. global plugins: rate-limiting / http-log / cors / prometheus
  4. service plugin: request-size-limiting
  5. consumer + jwt credential (จาก JWT_SECRET ใน env)
  6. เรียก sync-routes-from-swagger.py สร้าง route ทั้งหมดจาก Swagger

ทำไมเลิกใช้ .sh: route มี ~68 เส้นและเปลี่ยนตาม Swagger ตลอด
การ hardcode รายชื่อในสคริปต์ทำให้ตกหล่นทุกครั้งที่ dev เพิ่ม endpoint
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ADMIN = os.environ.get("KONG_ADMIN", "http://kong-gateway:8001")
SERVICE = os.environ.get("KONG_SERVICE", "onelake-middleware")
ISSUER = os.environ.get("JWT_ISSUER") or "onelake-app"
JWT_SECRET = os.environ.get("JWT_SECRET", "")

# BEVProAPI (service.bevproasia.com) ออก token ให้ frontend ผ่าน /api/v1/Authen/dispatchtoken
# โดยใส่ค่า Jwt:Issuer จาก appsettings เป็น claim iss — ไม่ใช่ "onelake-app"
# Kong jwt plugin จับคู่ consumer จาก iss จึงต้องมี credential ของค่านี้ด้วย
# ไม่งั้น token ที่แอปใช้อยู่จริงจะโดน 401 ทุกเส้น
# secret ตัวเดียวกับ JWT_SECRET — middleware ตรวจ token ของ BEVProAPI ผ่านด้วย secret นี้อยู่แล้ว
# (authMiddleware.js ทำแค่ jwt.verify(token, JWT_SECRET) ไม่เช็ค issuer)
BEVPRO_ISSUER = os.environ.get("BEVPRO_JWT_ISSUER", "http://www.xxx.com")
# ชื่อ consumer = ชื่อแอปที่เรียกเข้ามา (เปลี่ยนเป็น pro-iot-board เมื่อ 21 ก.ค. 2026)
# ชื่อนี้คือค่าที่โผล่ในคอลัมน์ consumer ของ Grafana — ตั้งให้ตรงกับแอปจริงจะอ่านง่าย
BEVPRO_CONSUMER = os.environ.get("BEVPRO_CONSUMER", "pro-iot-board")
UPSTREAM = os.environ.get(
    "ONELAKE_UPSTREAM_URL",
    "https://onelake-middleware-hth2cxh5hfhwdxhs.southeastasia-01.azurewebsites.net",
)


def req(method, url, data=None):
    body = urllib.parse.urlencode(data, doseq=True).encode() if data else None
    r = urllib.request.Request(url, data=body, method=method)
    if body:
        r.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:300]}
    except Exception as e:
        return 0, {"error": str(e)}


def wait_for_kong():
    for _ in range(40):
        code, _ = req("GET", f"{ADMIN}/status")
        if code == 200:
            print("kong-setup: Kong ready")
            return True
        time.sleep(2)
    print("kong-setup: Kong not reachable, abort")
    return False


def ensure_global_plugin(name, config):
    _, existing = req("GET", f"{ADMIN}/plugins?size=200")
    for p in existing.get("data", []):
        if p["name"] == name and not p.get("route") and not p.get("service"):
            print(f"  {name} (global) exists")
            return
    code, _ = req("POST", f"{ADMIN}/plugins", [("name", name)] + config)
    print(f"  {name} (global) -> HTTP {code}")


def main():
    if not wait_for_kong():
        sys.exit(1)

    print("[Service]")
    code, _ = req("PUT", f"{ADMIN}/services/{SERVICE}", [
        ("url", UPSTREAM),
        ("connect_timeout", "10000"),
        ("read_timeout", "120000"),
        ("write_timeout", "120000"),
    ])
    print(f"  {SERVICE} -> HTTP {code}")

    print("[Global plugins]")
    ensure_global_plugin("rate-limiting", [
        ("config.minute", "200"), ("config.hour", "5000"),
        ("config.policy", "local"), ("config.fault_tolerant", "true"),
        ("config.hide_client_headers", "false"),
    ])
    ensure_global_plugin("http-log", [
        ("config.http_endpoint", "http://log-receiver:3001/logs"),
        ("config.method", "POST"), ("config.timeout", "10000"),
        ("config.keepalive", "60000"),
    ])
    ensure_global_plugin("cors", [
        ("config.origins[]", "*"),
        ("config.methods[]", "GET"), ("config.methods[]", "POST"),
        ("config.methods[]", "PUT"), ("config.methods[]", "DELETE"),
        ("config.methods[]", "PATCH"), ("config.methods[]", "OPTIONS"),
        ("config.headers[]", "Accept"), ("config.headers[]", "Authorization"),
        ("config.headers[]", "Content-Type"),
        ("config.credentials", "true"), ("config.max_age", "3600"),
    ])
    ensure_global_plugin("prometheus", [
        ("config.per_consumer", "true"),
        ("config.status_code_metrics", "true"),
        ("config.latency_metrics", "true"),
        ("config.bandwidth_metrics", "true"),
        ("config.upstream_health_metrics", "true"),
    ])

    print("[Service plugins]")
    _, sp = req("GET", f"{ADMIN}/services/{SERVICE}/plugins")
    if any(p["name"] == "request-size-limiting" for p in sp.get("data", [])):
        print("  request-size-limiting exists")
    else:
        code, _ = req("POST", f"{ADMIN}/services/{SERVICE}/plugins", [
            ("name", "request-size-limiting"),
            ("config.allowed_payload_size", "100"),
            ("config.size_unit", "megabytes"),
        ])
        print(f"  request-size-limiting -> HTTP {code}")

    print("[Consumer]")
    code, _ = req("PUT", f"{ADMIN}/consumers/{ISSUER}", [
        ("custom_id", ISSUER), ("tags[]", "app"),
    ])
    print(f"  consumer {ISSUER} -> HTTP {code}")
    _, creds = req("GET", f"{ADMIN}/consumers/{ISSUER}/jwt")
    if any(c.get("key") == ISSUER for c in creds.get("data", [])):
        print("  jwt credential exists")
    elif not JWT_SECRET:
        print("  WARN: JWT_SECRET empty — skip credential")
    else:
        code, _ = req("POST", f"{ADMIN}/consumers/{ISSUER}/jwt", [
            ("key", ISSUER), ("algorithm", "HS256"), ("secret", JWT_SECRET),
        ])
        print(f"  jwt credential -> HTTP {code}")

    # consumer ที่สองสำหรับ token จาก BEVProAPI (ดูคอมเมนต์ที่ BEVPRO_ISSUER)
    code, _ = req("PUT", f"{ADMIN}/consumers/{BEVPRO_CONSUMER}", [
        ("custom_id", BEVPRO_CONSUMER), ("tags[]", "bevpro"),
    ])
    print(f"  consumer {BEVPRO_CONSUMER} -> HTTP {code}")
    _, bcreds = req("GET", f"{ADMIN}/consumers/{BEVPRO_CONSUMER}/jwt")
    if any(c.get("key") == BEVPRO_ISSUER for c in bcreds.get("data", [])):
        print(f"  jwt credential ({BEVPRO_ISSUER}) exists")
    elif not JWT_SECRET:
        print("  WARN: JWT_SECRET empty — skip bevpro credential")
    else:
        code, _ = req("POST", f"{ADMIN}/consumers/{BEVPRO_CONSUMER}/jwt", [
            ("key", BEVPRO_ISSUER), ("algorithm", "HS256"), ("secret", JWT_SECRET),
        ])
        print(f"  jwt credential ({BEVPRO_ISSUER}) -> HTTP {code}")

    print("[Routes from Swagger]")
    here = os.path.dirname(os.path.abspath(__file__))
    env = dict(os.environ)
    env.setdefault("KONG_ADMIN", ADMIN)
    env.setdefault("KONG_PROXY", ADMIN.replace(":8001", ":8000"))
    rc = subprocess.call(
        [sys.executable, os.path.join(here, "sync-routes-from-swagger.py")], env=env
    )
    if rc != 0:
        print(f"  WARN: sync-routes exit {rc} — route อาจไม่ครบ")

    print("kong-setup: done")


if __name__ == "__main__":
    main()

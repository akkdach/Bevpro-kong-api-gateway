#!/usr/bin/env python3
"""
add-proiot-backends.py — เพิ่ม backend ที่เหลือของ pro-iot-board เข้า Kong

pro-iot-board เรียก 5 backend:
  1. ONE_LEKE  -> onelake-middleware   (ทำแล้ว 68 routes ผ่าน sync-routes-from-swagger.py)
  2. API_BASE  -> service.bevproasia.com/api/v1        <- สคริปต์นี้
  3. IOT       -> iotservice.bevproasia.com/api/v1     <- สคริปต์นี้
  4. REVENUE   -> servicemanagement-...azurewebsites.net/api/v1  <- สคริปต์นี้
  5. IMAGE     -> service.bevproasia.com/api/DisplayImage/Show   <- สคริปต์นี้

ปัญหา path ชนกัน: ทั้ง 3 backend ใช้ prefix /api/v1 เหมือนกันหมด
แก้โดยให้ gateway ใช้ prefix ต่างกัน แล้ว strip ทิ้งก่อนส่งต่อ:
  /api/v1/*    -> service.bevproasia.com/api/v1/*      (ไม่ strip)
  /iot/v1/*    -> iotservice.bevproasia.com/api/v1/*   (strip /iot/v1)
  /revenue/v1/* -> servicemanagement.../api/v1/*       (strip /revenue/v1)

route ที่สร้างจากสคริปต์นี้ติด tag "proiot-backend" — sync-routes-from-swagger.py
ลบเฉพาะ tag "swagger-sync" ใต้ service onelake-middleware จึงไม่แตะกัน

ใช้: python3 add-proiot-backends.py [--dry-run]
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ADMIN = os.environ.get("KONG_ADMIN", "http://localhost:8001")
DRY = "--dry-run" in sys.argv
TAG = "proiot-backend"

BEVPRO_URL = os.environ.get("BEVPRO_UPSTREAM_URL", "https://service.bevproasia.com")
IOT_URL = os.environ.get("IOT_UPSTREAM_URL", "https://iotservice.bevproasia.com/api/v1")
REVENUE_URL = os.environ.get(
    "REVENUE_UPSTREAM_URL",
    "https://servicemanagement-eqg3bkfec8f5asg3.southeastasia-01.azurewebsites.net/api/v1",
)

# (ชื่อ route, path, methods, ต้อง jwt, strip_path)
# path จัดกลุ่มตาม segment แรกหลัง /api/v1 — Kong จับ prefix จึงครอบ endpoint ลูกให้หมด
# หมายเหตุ: Kong แยกตัวพิมพ์เล็ก/ใหญ่ — โค้ดเรียกทั้ง /Mobile และ /mobile จึงต้องมีทั้งคู่
BEVPRO_ROUTES = [
    # ── public: ต้องเรียกได้ก่อนมี token ──
    ("bp-authen",          "/api/v1/Authen",              ["POST", "OPTIONS"],        False),
    # รูปภาพ: แท็ก <img> แนบ header Authorization ไม่ได้ จึงต้อง public
    ("bp-display-image",   "/api/DisplayImage",           ["GET", "OPTIONS"],         False),

    # ── ต้อง login ──
    ("bp-equipment-trans", "/api/v1/EquipmentTransaction", ["GET", "POST", "OPTIONS"], True),
    ("bp-interface-logger","/api/v1/Interface_looger",    ["GET", "OPTIONS"],         True),
    ("bp-inventory",       "/api/v1/Inventory",           ["GET", "POST", "OPTIONS"], True),
    ("bp-iot",             "/api/v1/Iot",                 ["GET", "OPTIONS"],         True),
    ("bp-mobile-upper",    "/api/v1/Mobile",              ["GET", "POST", "OPTIONS"], True),
    ("bp-mobile-lower",    "/api/v1/mobile",              ["GET", "POST", "OPTIONS"], True),
    ("bp-onelake-employee","/api/v1/OneLake",             ["GET", "OPTIONS"],         True),
    ("bp-checklist",       "/api/v1/checklist",           ["GET", "OPTIONS"],         True),
    ("bp-order-type",      "/api/v1/order_type",          ["GET", "OPTIONS"],         True),
    ("bp-sparepart",       "/api/v1/sparepart_request",   ["GET", "POST", "OPTIONS"], True),
    ("bp-work-center",     "/api/v1/work_center",         ["GET", "OPTIONS"],         True),
    ("bp-work-order",      "/api/v1/work_order",          ["GET", "OPTIONS"],         True),
    ("bp-dashboard1",      "/api/v1/Dashboard1",          ["POST", "OPTIONS"],        True),
    ("bp-dashboard-equip", "/api/v1/DashboardEquipment",  ["POST", "OPTIONS"],        True),
    ("bp-transfer-route",  "/api/v1/TransferRoute",       ["POST", "OPTIONS"],        True),
]


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
        return e.code, {"error": e.read().decode()[:200]}
    except Exception as e:
        return 0, {"error": str(e)}


def ensure_service(name, url):
    if DRY:
        print(f"  [dry] service {name} -> {url}")
        return
    code, body = req("PUT", f"{ADMIN}/services/{name}", [
        ("url", url),
        ("connect_timeout", "10000"),
        ("read_timeout", "120000"),
        ("write_timeout", "120000"),
    ])
    print(f"  service {name:16} -> HTTP {code}")
    if code >= 400:
        print("   ", body.get("error", "")[:150])


def ensure_route(service, name, path, methods, jwt, strip=False):
    if DRY:
        print(f"  [dry] {path:32} {','.join(methods):22} jwt={jwt} strip={strip}")
        return
    data = [("paths[]", path), ("strip_path", "true" if strip else "false"),
            ("tags[]", TAG)] + [("methods[]", m) for m in methods]
    code, body = req("PUT", f"{ADMIN}/services/{service}/routes/{name}", data)
    status = f"HTTP {code}"
    if code >= 400:
        status += " " + body.get("error", "")[:120]

    plug = ""
    if jwt and code < 400:
        _, existing = req("GET", f"{ADMIN}/routes/{name}/plugins")
        if any(p["name"] == "jwt" for p in existing.get("data", [])):
            plug = "| jwt มีอยู่แล้ว"
        else:
            pc, _ = req("POST", f"{ADMIN}/routes/{name}/plugins", [
                ("name", "jwt"),
                ("config.key_claim_name", "iss"),
                ("config.claims_to_verify[]", "exp"),
            ])
            plug = f"| jwt {pc}"
    print(f"  {path:32} {','.join(methods):22} {status} {plug}")


def main():
    print("=== 1) bevpro-service (service.bevproasia.com) ===")
    ensure_service("bevpro-service", BEVPRO_URL)
    for name, path, methods, jwt in BEVPRO_ROUTES:
        ensure_route("bevpro-service", name, path, methods, jwt)

    print("\n=== 2) iot-service (iotservice.bevproasia.com) ===")
    ensure_service("iot-service", IOT_URL)
    # strip /iot/v1 ทิ้ง แล้วต่อท้าย path ของ service (ที่มี /api/v1 อยู่แล้ว)
    ensure_route("iot-service", "iot-v1", "/iot/v1",
                 ["GET", "POST", "OPTIONS"], True, strip=True)

    print("\n=== 3) revenue-service ===")
    ensure_service("revenue-service", REVENUE_URL)
    ensure_route("revenue-service", "revenue-v1", "/revenue/v1",
                 ["GET", "OPTIONS"], True, strip=True)

    if not DRY:
        print("\n=== สรุป ===")
        _, svcs = req("GET", f"{ADMIN}/services")
        print("  services:", ", ".join(s["name"] for s in svcs.get("data", [])))
        _, rts = req("GET", f"{ADMIN}/routes?size=300")
        mine = [r for r in rts.get("data", []) if TAG in (r.get("tags") or [])]
        print(f"  routes ของสคริปต์นี้: {len(mine)} | routes ทั้งหมด: {len(rts.get('data', []))}")


if __name__ == "__main__":
    main()

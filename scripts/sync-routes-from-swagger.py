#!/usr/bin/env python3
"""
sync-routes-from-swagger.py — สร้าง Kong route ให้ตรงกับ Swagger อัตโนมัติ

ทำไมต้องมี: ตอนนี้ Kong ใช้ allowlist (1 route ต่อ 1 endpoint) เวลา dev เพิ่ม
endpoint ใหม่ ถ้าไม่เพิ่ม route ให้ด้วยจะโดน 404 — สคริปต์นี้อ่าน Swagger ของ
middleware แล้ว sync ให้ทั้งหมดในคำสั่งเดียว

การทำงาน:
  1. ดึง Swagger spec ผ่าน Kong (/api-docs)
  2. รวม path ที่มี {param} เข้ากับ base path เดียวกัน แล้ว union method
     เช่น /api/worker (GET,POST) + /api/worker/{no} (DELETE,PUT)
     -> route เดียว /api/worker รับ GET,POST,DELETE,PUT
     (Kong จับ prefix อยู่แล้ว จึงครอบ /api/worker/123 ให้ด้วย)
  3. ใส่ OPTIONS ทุกเส้น — ไม่งั้น CORS preflight โดน 404 ก่อน cors plugin ทำงาน
  4. แปะ jwt plugin เฉพาะเส้นที่ Swagger ระบุ security
  5. แปะ rate-limiting 10/นาที ให้ /api/sync/* (งานหนัก ยิงถี่ไม่ได้)
  6. ลบ route ที่ไม่มีใน Swagger แล้ว (ยกเว้น route พิเศษด้านล่าง)

ใช้: python3 sync-routes-from-swagger.py [--dry-run]
"""
import json
import re
import sys
import urllib.parse
import urllib.request

# รันได้ทั้งบน host (ค่า default) และในคอนเทนเนอร์ kong-setup
# ในคอนเทนเนอร์ตั้ง KONG_ADMIN=http://kong-gateway:8001 KONG_PROXY=http://kong-gateway:8000
import os

ADMIN = os.environ.get("KONG_ADMIN", "http://localhost:8001")
PROXY = os.environ.get("KONG_PROXY", "http://localhost")
SERVICE = os.environ.get("KONG_SERVICE", "onelake-middleware")
DRY = "--dry-run" in sys.argv

# route ที่ดูแลเอง ไม่ผ่าน Swagger และห้ามลบ
# name -> (path, methods|None = ทุก method, ต้อง jwt ไหม)
SPECIAL = {
    "middleware-health-route": ("/health", None, False),
    "middleware-docs-route": ("/api-docs", None, False),
    "middleware-auth-login-route": ("/api/auth/login", ["POST", "OPTIONS"], False),
}
# path ใน Swagger ที่ SPECIAL ดูแลอยู่แล้ว ข้ามไม่ต้องสร้างซ้ำ
# "/" ต้องข้ามเสมอ — Kong จับ path แบบ prefix ถ้าสร้าง route "/" ขึ้นมา
# มันจะ match ทุก path ที่ไม่ตรงเส้นไหนเลย แล้วส่งต่อไป backend
# = ทำลาย allowlist ทั้งหมด (/health ครอบ root ให้อยู่แล้วผ่าน strip_path)
SKIP_PATHS = {"/api/auth/login", "/"}


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


def fetch_swagger():
    with urllib.request.urlopen(f"{PROXY}/api-docs/swagger-ui-init.js", timeout=30) as r:
        raw = r.read().decode("utf-8", "replace")
    m = re.search(r'"swaggerDoc":\s*(\{.*?\}),\s*"customOptions"', raw, re.S)
    if not m:
        m = re.search(r"let options = (\{.*?\});", raw, re.S)
    doc = json.loads(m.group(1))
    return doc.get("swaggerDoc", doc).get("paths", {})


def base_path(p):
    """ตัดตั้งแต่ segment ที่เป็น {param} ทิ้ง — Kong จับ prefix ครอบให้เอง"""
    parts = []
    for seg in p.split("/"):
        if seg.startswith("{"):
            break
        parts.append(seg)
    return "/".join(parts).rstrip("/") or "/"


def slug(path):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", path.strip("/")).strip("-").lower()
    return f"mw-{s}"


def main():
    paths = fetch_swagger()
    print(f"Swagger: {len(paths)} paths")

    # รวมเป็น route ตาม base path
    routes = {}
    for p, ops in paths.items():
        if p in SKIP_PATHS:
            continue
        bp = base_path(p)
        # กันซ้ำอีกชั้น: ห้ามได้ route ที่ path เป็น "/" เด็ดขาด (ดู SKIP_PATHS)
        if not bp.startswith("/") or bp == "/":
            continue
        entry = routes.setdefault(bp, {"methods": set(), "jwt": False})
        for verb, spec in ops.items():
            if verb.lower() not in ("get", "post", "put", "patch", "delete"):
                continue
            entry["methods"].add(verb.upper())
            if isinstance(spec, dict) and spec.get("security"):
                entry["jwt"] = True

    desired = {}
    for name, (path, methods, jwt) in SPECIAL.items():
        desired[name] = {"path": path, "methods": methods, "jwt": jwt}
    for bp, info in routes.items():
        desired[slug(bp)] = {
            "path": bp,
            "methods": sorted(info["methods"] | {"OPTIONS"}),
            "jwt": info["jwt"],
        }

    print(f"ต้องมี {len(desired)} routes ({sum(1 for d in desired.values() if d['jwt'])} เส้นบังคับ JWT)")
    if DRY:
        for n, d in sorted(desired.items(), key=lambda x: x[1]["path"]):
            print(f"  {d['path']:42} {','.join(d['methods'] or ['ALL']):28} jwt={d['jwt']}")
        return

    # ─── สร้าง/อัปเดต ───
    created = updated = 0
    for name, d in desired.items():
        data = [("paths[]", d["path"]),
                ("strip_path", "true" if d["path"] == "/health" else "false")]
        if d["methods"]:
            data += [("methods[]", m) for m in d["methods"]]
        code, _ = req("PUT", f"{ADMIN}/services/{SERVICE}/routes/{name}", data)
        if code in (200, 201):
            created += 1
        else:
            print(f"  !! {name} -> HTTP {code}")
    print(f"routes สร้าง/อัปเดต: {created}/{len(desired)}")

    # ─── ลบ route ที่ไม่อยู่ในรายการแล้ว ───
    _, allr = req("GET", f"{ADMIN}/routes?size=200")
    removed = []
    for r in allr.get("data", []):
        if r["name"] not in desired:
            req("DELETE", f"{ADMIN}/routes/{r['name']}")
            removed.append(r["name"])
    print(f"routes ที่ลบทิ้ง: {len(removed)}")
    for r in removed[:10]:
        print(f"  - {r}")

    # ─── plugins รายเส้น ───
    jwt_added = rl_added = 0
    for name, d in desired.items():
        _, plugins = req("GET", f"{ADMIN}/routes/{name}/plugins")
        have = {p["name"] for p in plugins.get("data", [])}

        if d["jwt"] and "jwt" not in have:
            code, _ = req("POST", f"{ADMIN}/routes/{name}/plugins", [
                ("name", "jwt"),
                ("config.key_claim_name", "iss"),
                ("config.claims_to_verify[]", "exp"),
            ])
            if code in (200, 201):
                jwt_added += 1

        # sync endpoint = งานหนัก จำกัด 10/นาที (เดิม /api/sync มี limit นี้)
        if d["path"].startswith("/api/sync") and "rate-limiting" not in have:
            code, _ = req("POST", f"{ADMIN}/routes/{name}/plugins", [
                ("name", "rate-limiting"),
                ("config.minute", "10"),
                ("config.policy", "local"),
                ("config.fault_tolerant", "true"),
            ])
            if code in (200, 201):
                rl_added += 1

    print(f"jwt plugin เพิ่ม: {jwt_added} | rate-limit(sync) เพิ่ม: {rl_added}")
    print("done")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
sync-bevpro-routes.py — สร้าง Kong route ให้ครบทุก controller ของ BevProFSServiceAPI

ที่มาของข้อมูล: สแกน [Route(...)] จาก source C# (113 controllers / 475 paths)
แล้วยุบเป็น prefix ระดับ controller -> 116 กลุ่ม
(ไม่ใช้ Swagger เพราะ BEVProAPI ไม่ประกาศ security ใน spec เลย เชื่อไม่ได้)

นโยบาย auth = deny by default:
  - ทุก prefix ได้ jwt plugin
  - ยกเว้น PUBLIC_PREFIXES (login / รูปภาพ)
  - endpoint ที่มี [AllowAnonymous] จริง -> สร้าง route เฉพาะเส้นนั้นแบบไม่มี jwt
    Kong เลือก route ที่ path ยาวกว่าก่อน route เฉพาะจึงชนะ prefix เสมอ

ใช้: python3 sync-bevpro-routes.py routes.json [--dry-run]
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ADMIN = os.environ.get("KONG_ADMIN", "http://localhost:8001")
SERVICE = os.environ.get("BEVPRO_SERVICE", "bevpro-service")
TAG = "bevpro-api"
DRY = "--dry-run" in sys.argv

# prefix ที่ต้องเรียกได้ก่อนมี token
PUBLIC_PREFIXES = {
    "/api/v1/Authen",      # login ทั้ง 3 เส้น
    "/api/DisplayImage",   # แท็ก <img> แนบ Authorization ไม่ได้
}

# endpoint ที่ [AllowAnonymous] ใน source — เปิดเฉพาะเส้นนี้ ไม่เปิดทั้ง controller
PUBLIC_PATHS = [
    ("/api/v1/refurbish/login",             ["POST", "OPTIONS"]),
    ("/api/v1/inspector",                   ["GET", "POST", "PUT", "DELETE", "OPTIONS"]),
    ("/api/v1/Mobile/check_all_problem",    ["GET", "POST", "OPTIONS"]),
    ("/api/v1/Mobile/create_problem",       ["GET", "POST", "OPTIONS"]),
    ("/api/v1/Mobile/GetCheckOutCloseType", ["GET", "OPTIONS"]),
    ("/api/v1/Mobile/getModel",             ["GET", "OPTIONS"]),
    ("/api/v1/WorkOrderRoadMap",            ["GET", "OPTIONS"]),
    ("/api/v1/Inventory/List_counting2",    ["GET", "POST", "OPTIONS"]),
    ("/api/v1/ChecklistMaster",             ["GET", "OPTIONS"]),
    ("/api/v1/master/close-types",          ["GET", "OPTIONS"]),
    ("/api/v1/close-type-update",           ["GET", "POST", "OPTIONS"]),
    ("/api/v1/master/part-set",             ["GET", "OPTIONS"]),
    ("/api/v1/sse",                         ["GET", "OPTIONS"]),
]

# ASP.NET routing ไม่สนตัวพิมพ์เล็กใหญ่ แต่ Kong สน
# frontend เรียกคนละเคสกับที่ประกาศใน C# อยู่ 2 จุด ต้องสร้าง alias ให้
#   source /api/v1/inventory (เล็ก) แต่ frontend เรียก /api/v1/Inventory/ListAll (ใหญ่)
#   source /api/v1/Mobile (ใหญ่)   แต่ frontend เรียก /api/v1/mobile/GetQualityIndex (เล็ก)
CASE_ALIASES = {
    "/api/v1/inventory": "/api/v1/Inventory",
    "/api/v1/Mobile": "/api/v1/mobile",
}


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


def slug(path):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", path.strip("/")).strip("-").lower()
    return f"bp-{s}"[:60]


def put_route(name, path, methods, jwt):
    if DRY:
        print(f"  [dry] {path:46} {','.join(methods):34} jwt={jwt}")
        return True
    data = [("paths[]", path), ("strip_path", "false"), ("tags[]", TAG)] + \
           [("methods[]", m) for m in methods]
    code, body = req("PUT", f"{ADMIN}/services/{SERVICE}/routes/{name}", data)
    if code >= 400:
        print(f"  !! {path} -> HTTP {code} {body.get('error','')[:120]}")
        return False
    if jwt:
        _, pl = req("GET", f"{ADMIN}/routes/{name}/plugins")
        if not any(p["name"] == "jwt" for p in pl.get("data", [])):
            req("POST", f"{ADMIN}/routes/{name}/plugins", [
                ("name", "jwt"),
                ("config.key_claim_name", "iss"),
                ("config.claims_to_verify[]", "exp"),
            ])
    return True


def main():
    src = sys.argv[1]
    groups = json.load(open(src, encoding="utf-8"))
    if isinstance(groups, dict):
        groups = [groups]

    print(f"อ่านจาก {src}: {len(groups)} prefix groups")

    # ── ลบ route ชุดเก่าของ bevpro (tag proiot-backend) ที่จะถูกแทนที่ ──
    if not DRY:
        _, rts = req("GET", f"{ADMIN}/services/{SERVICE}/routes?size=400")
        old = [r for r in rts.get("data", []) if "proiot-backend" in (r.get("tags") or [])]
        for r in old:
            req("DELETE", f"{ADMIN}/routes/{r['name']}")
        print(f"ลบ route ชุดเก่า (tag proiot-backend): {len(old)}")

    # path ของ endpoint anonymous ที่บังเอิญตรงกับ prefix พอดี (เช่น /api/v1/sse)
    # ถ้าสร้างทั้งสองแบบจะได้ route 2 ตัว path เดียวกัน แล้ว Kong เลือกมั่ว
    # -> ให้ prefix ตัวนั้นเป็น public ไปเลย ไม่ต้องสร้าง route ซ้ำ
    public_exact = {p for p, _ in PUBLIC_PATHS}

    ok = 0
    print("\n=== prefix routes ===")
    for g in groups:
        path = g["path"]
        methods = sorted(set(g["methods"]) | {"OPTIONS"})
        jwt = path not in PUBLIC_PREFIXES and path not in public_exact
        if put_route(slug(path), path, methods, jwt):
            ok += 1

    print("\n=== case alias (Kong แยกตัวพิมพ์ ASP.NET ไม่แยก) ===")
    by_path = {g["path"]: g for g in groups}
    for src_path, alias in CASE_ALIASES.items():
        g = by_path.get(src_path)
        if not g:
            print(f"  ข้าม {src_path} — ไม่มีใน source")
            continue
        methods = sorted(set(g["methods"]) | {"OPTIONS"})
        if put_route(slug(alias) + "-alias", alias, methods, alias not in PUBLIC_PREFIXES):
            ok += 1

    print("\n=== public endpoints (AllowAnonymous — ไม่มี jwt) ===")
    for path, methods in PUBLIC_PATHS:
        if path in {g["path"] for g in groups}:
            print(f"  ข้าม {path} — เป็น prefix อยู่แล้ว ตั้งเป็น public ไปแล้ว")
            continue
        if put_route(slug(path) + "-pub", path, methods, False):
            ok += 1

    print(f"\nสร้าง/อัปเดตสำเร็จ: {ok}")

    if not DRY:
        _, rts = req("GET", f"{ADMIN}/routes?size=500")
        d = rts.get("data", [])
        mine = [r for r in d if TAG in (r.get("tags") or [])]
        print(f"routes tag={TAG}: {len(mine)} | routes ทั้งระบบ: {len(d)}")


if __name__ == "__main__":
    main()

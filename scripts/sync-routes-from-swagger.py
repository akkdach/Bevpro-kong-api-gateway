#!/usr/bin/env python3
"""
sync-routes-from-swagger.py — สร้าง Kong route ให้ตรงกับ Swagger อัตโนมัติ (รองรับหลาย service)

ทำไมต้องมี: Kong ใช้ allowlist (route ต้องมีก่อนถึงจะเรียกได้) เวลา dev เพิ่ม
endpoint ใหม่ ถ้าไม่เพิ่ม route ให้ด้วยจะโดน 404 — สคริปต์นี้อ่าน Swagger ของ
แต่ละ backend แล้ว sync ให้ทั้งหมดในคำสั่งเดียว

service ที่ดูแล (ดู SERVICES ด้านล่าง):
  1. onelake-middleware  — Azure App Service, Swagger ผ่าน Kong, jwt ตามที่ Swagger ระบุ
  2. bevpro-service      — service.bevproasia.com (BEVProAPI), Swagger ตรงจาก origin,
                           Swagger ไม่ประกาศ security เลย จึงบังคับ jwt ทุกเส้น
                           ยกเว้น endpoint ขอ token (ไม่งั้น login ไม่ได้)

การทำงานต่อ 1 service:
  1. ensure service (PUT — idempotent)
  2. ดึง Swagger แล้วยุบ path เป็น route ตาม group mode
  3. ใส่ OPTIONS ทุกเส้น — ไม่งั้น CORS preflight โดน 404 ก่อน cors plugin ทำงาน
  4. แปะ jwt plugin ตาม auth policy ของ service นั้น
  5. แปะ rate-limiting 10/นาที ให้ /api/sync/* (งานหนัก ยิงถี่ไม่ได้)
  6. ลบ route ส่วนเกิน — เฉพาะ route ที่อยู่ใต้ service นั้น (ไม่ยุ่ง service อื่น)

ใช้: python3 sync-routes-from-swagger.py [--dry-run] [--only <service-name>]
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

# รันได้ทั้งบน host (ค่า default) และในคอนเทนเนอร์ kong-setup
# ในคอนเทนเนอร์ตั้ง KONG_ADMIN=http://kong-gateway:8001 KONG_PROXY=http://kong-gateway:8000
ADMIN = os.environ.get("KONG_ADMIN", "http://localhost:8001")
PROXY = os.environ.get("KONG_PROXY", "http://localhost")
DRY = "--dry-run" in sys.argv
ONLY = None
if "--only" in sys.argv:
    ONLY = sys.argv[sys.argv.index("--only") + 1]

ONELAKE_UPSTREAM = os.environ.get(
    "ONELAKE_UPSTREAM_URL",
    "https://onelake-middleware-hth2cxh5hfhwdxhs.southeastasia-01.azurewebsites.net",
)
BEVPRO_UPSTREAM = os.environ.get("BEVPRO_UPSTREAM_URL", "https://service.bevproasia.com")

SERVICES = [
    {
        "name": os.environ.get("KONG_SERVICE", "onelake-middleware"),
        "upstream": ONELAKE_UPSTREAM,
        "prefix": "mw-",
        "swagger": ("swagger-ui-init", f"{PROXY}/api-docs/swagger-ui-init.js"),
        # jwt เฉพาะเส้นที่ Swagger ระบุ security (middleware ประกาศไว้ถูกต้อง)
        "auth": "swagger",
        "group": "param",          # ตัดตั้งแต่ segment ที่เป็น {param}
        # route ที่ดูแลเอง ไม่ผ่าน Swagger และห้ามลบ
        # name -> (path, methods|None = ทุก method, ต้อง jwt ไหม)
        "special": {
            "middleware-health-route": ("/health", None, False),
            "middleware-docs-route": ("/api-docs", None, False),
            "middleware-auth-login-route": ("/api/auth/login", ["POST", "OPTIONS"], False),
        },
        # path ใน Swagger ที่ special ดูแลอยู่แล้ว ข้ามไม่ต้องสร้างซ้ำ
        # "/" ต้องข้ามเสมอ — Kong จับ path แบบ prefix ถ้าสร้าง route "/" ขึ้นมา
        # มันจะ match ทุก path ที่ไม่ตรงเส้นไหนเลย แล้วส่งต่อไป backend
        # = ทำลาย allowlist ทั้งหมด (/health ครอบ root ให้อยู่แล้วผ่าน strip_path)
        "skip": {"/api/auth/login", "/"},
        "strip_path": {"/health"},
    },
    {
        "name": "bevpro-service",
        "upstream": BEVPRO_UPSTREAM,
        "prefix": "bp-",
        "swagger": ("openapi-json", f"{BEVPRO_UPSTREAM}/swagger/v1/swagger.json"),
        # BEVProAPI ไม่ประกาศ security ใน Swagger สักเส้น — ถ้าเชื่อ Swagger จะเปิดโล่งทั้ง API
        # จึงบังคับ jwt ทุกเส้น แล้วยกเว้นเฉพาะเส้นที่ต้องเรียกก่อนมี token
        "auth": "deny-by-default",
        "public": {
            "/api/v1/Authen/token",
            "/api/v1/Authen/dispatchtoken",
            "/api/v1/refurbish/login",
        },
        # ยุบถึงระดับ controller — Swagger มี 538 path ถ้าแตกทุกเส้นได้ ~517 route
        # ทำให้ router ของ Kong (VM 2 core / limit 1GB) หนักเกินจำเป็น
        "group": "controller",
        "skip": {"/"},
        "strip_path": set(),
    },
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


def fetch_paths(kind, url):
    """คืน dict ของ Swagger paths — รองรับทั้ง swagger-ui bundle และ openapi json ตรง ๆ"""
    with urllib.request.urlopen(url, timeout=60) as r:
        raw = r.read().decode("utf-8", "replace")
    if kind == "openapi-json":
        return json.loads(raw).get("paths", {})
    m = re.search(r'"swaggerDoc":\s*(\{.*?\}),\s*"customOptions"', raw, re.S)
    if not m:
        m = re.search(r"let options = (\{.*?\});", raw, re.S)
    doc = json.loads(m.group(1))
    return doc.get("swaggerDoc", doc).get("paths", {})


def group_path(p, mode):
    """ยุบ path ให้เป็น route เดียว — Kong จับ prefix ครอบลูกให้เองอยู่แล้ว"""
    if mode == "controller":
        # /api/v1/Attendance/Get_checkin -> /api/v1/Attendance
        # /api/FileManager/upload        -> /api/FileManager
        segs = [s for s in p.split("/") if s]
        if not segs:
            return "/"
        depth = 3 if len(segs) > 1 and re.fullmatch(r"v\d+", segs[1]) else 2
        segs = segs[:depth]
        if any(s.startswith("{") for s in segs):
            segs = segs[: next(i for i, s in enumerate(segs) if s.startswith("{"))]
        return "/" + "/".join(segs) if segs else "/"
    # mode == "param": ตัดตั้งแต่ segment ที่เป็น {param} ทิ้ง
    parts = []
    for seg in p.split("/"):
        if seg.startswith("{"):
            break
        parts.append(seg)
    return "/".join(parts).rstrip("/") or "/"


def slug(prefix, path):
    s = re.sub(r"[^a-zA-Z0-9]+", "-", path.strip("/")).strip("-").lower()
    return f"{prefix}{s}"


def verbs_of(ops):
    return {v.upper() for v in ops if v.lower() in ("get", "post", "put", "patch", "delete")}


def build_desired(cfg):
    paths = fetch_paths(*cfg["swagger"])
    routes = {}
    for p, ops in paths.items():
        if p in cfg.get("skip", set()):
            continue
        bp = group_path(p, cfg["group"])
        if not bp.startswith("/") or bp == "/":
            continue
        entry = routes.setdefault(bp, {"methods": set(), "jwt": False})
        entry["methods"] |= verbs_of(ops)
        for verb, spec in ops.items():
            if verb.lower() in ("get", "post", "put", "patch", "delete") \
                    and isinstance(spec, dict) and spec.get("security"):
                entry["jwt"] = True

    desired = {}
    for name, (path, methods, jwt) in cfg.get("special", {}).items():
        desired[name] = {"path": path, "methods": methods, "jwt": jwt}

    deny_default = cfg["auth"] == "deny-by-default"
    for bp, info in routes.items():
        desired[slug(cfg["prefix"], bp)] = {
            "path": bp,
            "methods": sorted(info["methods"] | {"OPTIONS"}),
            "jwt": True if deny_default else info["jwt"],
        }

    # เส้นที่ต้องเรียกได้ก่อนมี token — แตกเป็น route เฉพาะ path นั้น ไม่ปล่อยทั้ง controller
    # (เช่น /api/v1/refurbish มี 20 endpoint แต่เปิดโล่งได้แค่ /login เส้นเดียว)
    # Kong จับ prefix ที่ยาวกว่าก่อน route เฉพาะจึงชนะ route ระดับ controller เสมอ
    for p in sorted(cfg.get("public", set())):
        ops = paths.get(p)
        if ops is None:
            print(f"  WARN: public path {p} ไม่มีใน Swagger — ข้าม")
            continue
        desired[slug(cfg["prefix"], p) + "-public"] = {
            "path": p,
            "methods": sorted(verbs_of(ops) | {"OPTIONS"}),
            "jwt": False,
        }
    return len(paths), desired


def sync_service(cfg):
    svc = cfg["name"]
    print(f"\n=== {svc} ({cfg['upstream']}) ===")
    total_paths, desired = build_desired(cfg)
    n_jwt = sum(1 for d in desired.values() if d["jwt"])
    print(f"Swagger: {total_paths} paths -> ต้องมี {len(desired)} routes ({n_jwt} เส้นบังคับ JWT)")

    if DRY:
        for n, d in sorted(desired.items(), key=lambda x: x[1]["path"]):
            print(f"  {d['path']:42} {','.join(d['methods'] or ['ALL']):28} jwt={d['jwt']}")
        return

    # ─── service (idempotent) ───
    code, _ = req("PUT", f"{ADMIN}/services/{svc}", [
        ("url", cfg["upstream"]),
        ("connect_timeout", "10000"),
        ("read_timeout", "120000"),
        ("write_timeout", "120000"),
    ])
    print(f"  service -> HTTP {code}")

    # ─── สร้าง/อัปเดต route ───
    ok = 0
    for name, d in desired.items():
        data = [("paths[]", d["path"]),
                ("strip_path", "true" if d["path"] in cfg.get("strip_path", set()) else "false")]
        if d["methods"]:
            data += [("methods[]", m) for m in d["methods"]]
        code, _ = req("PUT", f"{ADMIN}/services/{svc}/routes/{name}", data)
        if code in (200, 201):
            ok += 1
        else:
            print(f"  !! {name} -> HTTP {code}")
    print(f"  routes สร้าง/อัปเดต: {ok}/{len(desired)}")

    # ─── ลบ route ส่วนเกิน — เฉพาะของ service นี้ ───
    # (เดิมดึง /routes ทั้งระบบแล้วลบ ทำให้ route ของ service อื่นหายไปด้วย)
    _, allr = req("GET", f"{ADMIN}/services/{svc}/routes?size=1000")
    removed = [r["name"] for r in allr.get("data", []) if r["name"] not in desired]
    for name in removed:
        req("DELETE", f"{ADMIN}/routes/{name}")
    print(f"  routes ที่ลบทิ้ง: {len(removed)}")
    for r in removed[:10]:
        print(f"    - {r}")

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

        # sync endpoint = งานหนัก จำกัด 10/นาที
        if d["path"].startswith("/api/sync") and "rate-limiting" not in have:
            code, _ = req("POST", f"{ADMIN}/routes/{name}/plugins", [
                ("name", "rate-limiting"),
                ("config.minute", "10"),
                ("config.policy", "local"),
                ("config.fault_tolerant", "true"),
            ])
            if code in (200, 201):
                rl_added += 1

    print(f"  jwt plugin เพิ่ม: {jwt_added} | rate-limit(sync) เพิ่ม: {rl_added}")


def main():
    targets = [c for c in SERVICES if not ONLY or c["name"] == ONLY]
    if not targets:
        print(f"ไม่พบ service ชื่อ {ONLY}")
        sys.exit(1)
    for cfg in targets:
        sync_service(cfg)
    print("\ndone")


if __name__ == "__main__":
    main()

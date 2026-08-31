#!/usr/bin/env python3
"""
add-mobile-public-route.py — เพิ่ม route public (ไม่ต้องมี JWT) ให้แอปมือถือ ทีละเส้น ทั้ง uat+prod

ทำไมต้องมี: add-mobile-catchall.py รันเต็มจะลบ route tag mobile-env ทั้งชุดแล้วสร้างใหม่
(plugin ที่ผูกมือเช่น rate-limiting หาย + ดับสั้นๆ) — เวลา backend เพิ่ม endpoint public ใหม่
(เช่นเส้น login แบบใหม่) ใช้ตัวนี้เพิ่มเฉพาะเส้นนั้นแทน  PUT ซ้ำได้ (idempotent)

กติกาเดียวกับสคริปต์หลัก:
  - regex  ~/<env>(?:/api)?(?:/v1)?<path>(?<rest>/.*)?$   (ลืม api/v1 ก็ผ่าน)
  - regex_priority 100 (ชนะ catch-all ที่ 0)  · tag mobile-env · ไม่มี jwt plugin
  - request-transformer replace.uri = /api/v1<path>$rest
  - ใส่ OPTIONS ให้เสมอ (CORS preflight)

⚠️ อย่าลืมเพิ่มเส้นเดียวกันใน PUBLIC ของ add-mobile-catchall.py ด้วย
   ไม่งั้นวันหน้ารันสคริปต์หลักเต็ม route นี้จะหาย

ใช้: python3 add-mobile-public-route.py <path> <METHOD[,METHOD]> [--dry-run] [--env uat|prod]
เช่น: python3 add-mobile-public-route.py /auth/azure-login POST --dry-run
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ADMIN = os.environ.get("KONG_ADMIN", "http://localhost:8001")
TAG = "mobile-env"
UP = "/api/v1"
OPT = "(?:/api)?(?:/v1)?"
SERVICES = {"uat": "bevpro-uat", "prod": "bevpro-prod"}


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
        return e.code, {"error": e.read().decode()[:250]}
    except Exception as e:  # noqa: BLE001
        return 0, {"error": str(e)}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    ep, methods = args[0], sorted(set(args[1].upper().split(",")) | {"OPTIONS"})
    if not ep.startswith("/"):
        ep = "/" + ep
    dry = "--dry-run" in sys.argv
    envs = list(SERVICES)
    if "--env" in sys.argv:
        envs = [sys.argv[sys.argv.index("--env") + 1]]

    for env in envs:
        svc = SERVICES[env]
        name = ("mb-" + env + "-pub-" + re.sub(r"[^a-zA-Z0-9]+", "-", ep.strip("/")).lower())[:60]
        path = f"~/{env}{OPT}{ep}(?<rest>/.*)?$"
        uri = f'{UP}{ep}$(uri_captures["rest"] or "")'
        print(f"{'DRY ' if dry else ''}{env}: route {name}")
        print(f"      paths    {path}")
        print(f"      methods  {','.join(methods)}   priority 100   jwt=False")
        print(f"      rewrite  -> {uri}")
        if dry:
            continue
        code, body = req("PUT", f"{ADMIN}/services/{svc}/routes/{name}", [
            ("paths[]", path), ("strip_path", "false"),
            ("regex_priority", "100"), ("tags[]", TAG),
        ] + [("methods[]", m) for m in methods])
        if code >= 400:
            print(f"  !! route -> {code} {body.get('error', '')}")
            continue
        _, pl = req("GET", f"{ADMIN}/routes/{name}/plugins")
        existing = [p for p in pl.get("data", []) if p["name"] == "request-transformer"]
        if existing:
            pcode, _ = req("PATCH", f"{ADMIN}/plugins/{existing[0]['id']}", [("config.replace.uri", uri)])
        else:
            pcode, _ = req("POST", f"{ADMIN}/routes/{name}/plugins",
                           [("name", "request-transformer"), ("config.replace.uri", uri)])
        print(f"      route HTTP {code} · request-transformer HTTP {pcode}")


if __name__ == "__main__":
    main()

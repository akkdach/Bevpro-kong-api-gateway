#!/usr/bin/env python3
"""
add-mobile-catchall.py — route แบบ ANY ต่อ environment (แทนการไล่ทีละ endpoint)

  https://<gateway>/uat/<อะไรก็ได้>   -> https://service.bevproasia.com:5001/api/v1/<อะไรก็ได้>
  https://<gateway>/prod/<อะไรก็ได้>  -> https://service.bevproasia.com/api/v1/<อะไรก็ได้>

รับ base ได้ทุกแบบ — /prod/api/v1/X, /prod/api/X, /prod/v1/X, /prod/X (ลืม api หรือ v1 ก็ผ่าน)
→ (?:/api)?(?:/v1)? ในตัว regex แล้ว request-transformer ต่อ /api/v1 ให้เอง

แลกกับความง่าย: ไม่มี allowlist แล้ว path ที่ backend ไม่รู้จักจะทะลุไปถึง backend
(backend ตอบ 404 เอง) — ยังมี JWT + rate limit + log ครบเหมือนเดิม

สิ่งที่ต้องระวัง: route public ต้องมี regex_priority สูงกว่า catch-all
ไม่งั้น Kong เลือก catch-all (ซึ่งมี jwt) แล้ว login ไม่ได้ทั้งระบบ

ใช้: python3 add-mobile-catchall.py [--dry-run]
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

ADMIN = os.environ.get("KONG_ADMIN", "http://localhost:8001")
DRY = "--dry-run" in sys.argv
TAG = "mobile-env"
UP = "/api/v1"
OPT = "(?:/api)?(?:/v1)?"   # ส่วน optional ของ path ขาเข้า (client ลืมใส่ได้)

ENVS = {
    "uat":  ("bevpro-uat",  "https://service.bevproasia.com:5001"),
    "prod": ("bevpro-prod", "https://service.bevproasia.com"),
}

# endpoint ที่ backend ประกาศ [AllowAnonymous] — ต้องเรียกได้ก่อนมี token
# priority สูงกว่า catch-all เพื่อให้ Kong เลือกเส้นนี้ก่อน
PUBLIC = [
    ("/Authen/token",        ["POST"]),          # login — ขาดไม่ได้
    ("/Authen/dispatchtoken", ["POST"]),         # login ของ service-management web (เพิ่ม 2026-08-26)
    ("/auth/azure-login",    ["POST"]),          # login ผ่าน Azure AD (เพิ่ม 2026-08-21)
    ("/WorkOrderRoadMap",    ["GET"]),
    ("/close-type-update",   ["POST"]),
    ("/master/close-types",  ["GET"]),
    ("/master/part-set",     ["GET"]),
    ("/ChecklistMaster",     ["GET", "POST"]),
]
ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]


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
    except Exception as e:
        return 0, {"error": str(e)}


def add_plugin(route, name, cfg):
    _, pl = req("GET", f"{ADMIN}/routes/{route}/plugins")
    if any(p["name"] == name for p in pl.get("data", [])):
        return
    req("POST", f"{ADMIN}/routes/{route}/plugins", [("name", name)] + cfg)


def main():
    if DRY:
        for env in ENVS:
            print(f"  catch-all  ~/{env}{OPT}(?<rest>/.*)  -> {UP}$rest   jwt=True")
            for ep, m in PUBLIC:
                print(f"  public     /{env}{ep:24} [{','.join(m)}]  jwt=False")
        return

    # ── ลบ route รายเส้นชุดเดิม ──
    _, rts = req("GET", f"{ADMIN}/routes?size=600")
    old = [r for r in rts.get("data", [])
           if TAG in (r.get("tags") or []) and not r["name"].startswith("mb-api-")]
    for r in old:
        req("DELETE", f"{ADMIN}/routes/{r['name']}")
    print(f"ลบ route รายเส้นชุดเดิม: {len(old)} (เก็บ mb-api-* ที่เพิ่มมือไว้)")

    for env, (svc, url) in ENVS.items():
        code, _ = req("PUT", f"{ADMIN}/services/{svc}", [
            ("url", url), ("connect_timeout", "10000"),
            ("read_timeout", "120000"), ("write_timeout", "120000"),
        ])
        print(f"\nservice {svc:12} {url} -> HTTP {code}")

        # ── public ก่อน (priority สูง) ──
        for ep, methods in PUBLIC:
            name = ("mb-" + env + "-pub-" +
                    re.sub(r"[^a-zA-Z0-9]+", "-", ep.strip("/")).lower())[:60]
            data = [
                ("paths[]", f"~/{env}{OPT}{ep}(?<rest>/.*)?$"),
                ("strip_path", "false"),
                ("regex_priority", "100"),      # ต้องชนะ catch-all
                ("tags[]", TAG),
            ] + [("methods[]", m) for m in sorted(set(methods) | {"OPTIONS"})]
            code, body = req("PUT", f"{ADMIN}/services/{svc}/routes/{name}", data)
            if code >= 400:
                print(f"  !! public {ep} -> {code} {body.get('error','')[:110]}")
                continue
            add_plugin(name, "request-transformer",
                       [("config.replace.uri",
                         f'{UP}{ep}$(uri_captures["rest"] or "")')])
            print(f"  public  {ep:24} -> HTTP {code}")

        # ── catch-all (priority ต่ำ) ──
        name = f"mb-{env}-any"
        data = [
            ("paths[]", f"~/{env}{OPT}(?<rest>/.*)"),
            ("strip_path", "false"),
            ("regex_priority", "0"),
            ("tags[]", TAG),
        ] + [("methods[]", m) for m in ALL_METHODS]
        code, body = req("PUT", f"{ADMIN}/services/{svc}/routes/{name}", data)
        if code >= 400:
            print(f"  !! catch-all -> {code} {body.get('error','')[:150]}")
            continue
        add_plugin(name, "request-transformer",
                   [("config.replace.uri", f'{UP}$(uri_captures["rest"])')])
        add_plugin(name, "jwt", [("config.key_claim_name", "iss"),
                                 ("config.claims_to_verify[]", "exp")])
        if env == "prod":   # กันแอปยิงถล่ม prod — ถ้ามีอยู่แล้ว add_plugin จะข้าม
            add_plugin(name, "rate-limiting", [
                ("config.minute", "2000"), ("config.hour", "50000"),
                ("config.limit_by", "consumer"), ("config.policy", "local")])
        print(f"  catch-all (ANY)          -> HTTP {code}  [jwt]")

    _, rts = req("GET", f"{ADMIN}/routes?size=600")
    d = rts.get("data", [])
    print(f"\nroutes tag={TAG}: {sum(1 for r in d if TAG in (r.get('tags') or []))} "
          f"| ทั้งระบบ: {len(d)}")


if __name__ == "__main__":
    main()

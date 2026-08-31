#!/usr/bin/env python3
"""
patch-mobile-regex.py — อัปเดต regex ของ route tag mobile-env แบบ in-place (ไม่ลบ/สร้างใหม่)

ทำไมต้องมี: add-mobile-catchall.py รันเต็มจะลบ route ทั้งชุดแล้วสร้างใหม่ → plugin ที่ผูกมือ
(เช่น rate-limiting บน mb-prod-any) หาย + มีช่วงดับสั้นๆ  สคริปต์นี้ PATCH เฉพาะ field paths
ของ route ที่ยังใช้ regex เก่า  plugin/priority/methods คงเดิมทั้งหมด

เปลี่ยน (?:/api/v1)?  ->  (?:/api)?(?:/v1)?   ให้ client ลืม api หรือ v1 ก็ยังผ่าน

ใช้: python3 patch-mobile-regex.py [--dry-run]
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ADMIN = os.environ.get("KONG_ADMIN", "http://localhost:8001")
DRY = "--dry-run" in sys.argv
TAG = "mobile-env"
OLD = "(?:/api/v1)?"
NEW = "(?:/api)?(?:/v1)?"


def main():
    routes = json.load(urllib.request.urlopen(
        f"{ADMIN}/routes?size=1000&tags={TAG}"))["data"]
    n = 0
    for r in routes:
        paths = r.get("paths") or []
        if not any(OLD in p for p in paths):
            continue
        new_paths = [p.replace(OLD, NEW) for p in paths]
        n += 1
        if DRY:
            print(f"DRY  {r['name']:32} {new_paths[0]}")
            continue
        body = urllib.parse.urlencode([("paths[]", p) for p in new_paths]).encode()
        req = urllib.request.Request(f"{ADMIN}/routes/{r['id']}", data=body, method="PATCH")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                code = resp.status
        except urllib.error.HTTPError as e:
            code = e.code
            print("  !!", e.read().decode()[:200])
        print(f"{code}  {r['name']:32} {new_paths[0]}")
    print(f"{'would patch' if DRY else 'patched'}: {n} / {len(routes)} routes (tag={TAG})")


if __name__ == "__main__":
    main()

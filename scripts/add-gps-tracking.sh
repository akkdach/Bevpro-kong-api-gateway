#!/bin/sh
# =====================================================
# add-gps-tracking.sh — เพิ่ม GPS vehicle-tracking backend เข้า Kong
#
# backend: BPA-GPS-Location-Tracking (Azure App Service)
# base:    /api/v1/vehicle-tracking  (18 endpoints — ดู trip-report api_specification.md)
#
# auth: PUBLIC (ไม่ใส่ jwt plugin) เพราะ GPS ใช้ Azure AD token / "Bearer test"
#       ซึ่งคนละระบบกับ BEVProAPI (HS256 iss=http://www.xxx.com) ที่ jwt plugin ตั้งไว้
#       -> Kong verify ไม่ได้ ปล่อยผ่านให้ backend เช็ค auth เอง (MOCK_AUTH_ENABLED)
#       pre-function ยังถอด sub จาก token ได้ (ถ้าเป็น JWT จริงเช่น Azure AD) -> แยก user
#
# FE base URL: https://bevprogateway.southeastasia.cloudapp.azure.com/api/v1/vehicle-tracking
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"
UPSTREAM="${GPS_UPSTREAM_URL:-https://bpa-gps-tracking-bng7csh2h8fbd3ep.southeastasia-01.azurewebsites.net}"

echo "[service]"
curl -s -o /dev/null -w "  gps-tracking -> %{http_code}\n" -X PUT "$ADMIN/services/gps-tracking" \
  --data "url=$UPSTREAM" --data "connect_timeout=10000" \
  --data "read_timeout=120000" --data "write_timeout=120000"

echo "[route] /api/v1/vehicle-tracking (prefix ครอบทุก endpoint, ส่ง path ตรง)"
curl -s -o /dev/null -w "  gps-vehicle-tracking -> %{http_code}\n" \
  -X PUT "$ADMIN/services/gps-tracking/routes/gps-vehicle-tracking" \
  --data "paths[]=/api/v1/vehicle-tracking" --data "strip_path=false" \
  --data "tags[]=gps-tracking" \
  --data "methods[]=GET" --data "methods[]=POST" \
  --data "methods[]=OPTIONS" --data "methods[]=HEAD"

# ไม่ใส่ jwt plugin — public (ดูคอมเมนต์ด้านบน)
# ถ้าวันหลัง GPS เปลี่ยนมาใช้ token แบบเดียวกับ BEVProAPI ค่อยเพิ่ม:
#   curl -X POST "$ADMIN/routes/gps-vehicle-tracking/plugins" \
#     --data "name=jwt" --data "config.key_claim_name=iss" --data "config.claims_to_verify[]=exp"

echo "done"

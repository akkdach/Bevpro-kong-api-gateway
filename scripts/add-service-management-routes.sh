#!/bin/sh
# =====================================================
# add-service-management-routes.sh — เพิ่ม service-management backend เข้า Kong
#
# backend: servicemanagement (Azure App Service, Express)
# ที่มา:   endpoint_inventory_base_url.md หัวข้อ 14 — กลุ่ม EXPO_PUBLIC_SERVICE_URL
#          ที่แอปมือถือเรียก: notifications / user-device-tokens / email
#          vehicle-rentals / inspection-results / health-check-results / gps-checkins
#
# ไม่รวม: api/v1/checklist-setup-master — deprecated แล้ว (แทนด้วย /ChecklistMaster
#         ซึ่งวิ่งผ่าน route mb-prod-pub-checklistmaster อยู่แล้ว)
#
# auth: PUBLIC ที่ Kong (แบบเดียวกับ gps-tracking) — backend เช็ค auth เอง (ตอบ 401)
#       pre-function global ยังถอด sub จาก JWT ได้ -> นับ user ใน dashboard ได้
#
# FE base URL: https://bevprogateway.southeastasia.cloudapp.azure.com/api/v1/...
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"
UPSTREAM="${SVC_MGMT_UPSTREAM_URL:-https://servicemanagement-eqg3bkfec8f5asg3.southeastasia-01.azurewebsites.net}"

echo "[service]"
curl -s -o /dev/null -w "  svc-management -> %{http_code}\n" -X PUT "$ADMIN/services/svc-management" \
  --data "url=$UPSTREAM" --data "connect_timeout=10000" \
  --data "read_timeout=120000" --data "write_timeout=120000"

echo "[route] 7 prefix ครอบทุกเส้น SERVICE_URL (strip_path=false ส่ง path ตรง)"
curl -s -o /dev/null -w "  svc-management-mobile -> %{http_code}\n" \
  -X PUT "$ADMIN/services/svc-management/routes/svc-management-mobile" \
  --data "paths[]=/api/v1/notifications" \
  --data "paths[]=/api/v1/user-device-tokens" \
  --data "paths[]=/api/v1/email" \
  --data "paths[]=/api/v1/vehicle-rentals" \
  --data "paths[]=/api/v1/inspection-results" \
  --data "paths[]=/api/v1/health-check-results" \
  --data "paths[]=/api/v1/gps-checkins" \
  --data "strip_path=false" \
  --data "tags[]=svc-management" \
  --data "methods[]=GET" --data "methods[]=POST" --data "methods[]=PUT" \
  --data "methods[]=PATCH" --data "methods[]=DELETE" \
  --data "methods[]=OPTIONS" --data "methods[]=HEAD"

echo "done"

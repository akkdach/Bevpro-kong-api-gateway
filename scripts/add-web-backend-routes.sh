#!/bin/sh
# =====================================================
# add-web-backend-routes.sh — route catch-all ให้ backend ของเว็บทีม ผ่าน gateway
#
#   /svc/<path> -> servicemanagement-...azurewebsites.net/<path>   (service svc-management เดิม)
#   /pm/<path>  -> webappbevpro-...azurewebsites.net/<path>        (ProjectManagement API)
#
# ทำไม: หลายแอป (bevpro-safety, coffee, agentic-app, pro-iot-mobile ฯลฯ) เรียก 2 backend นี้
# ตรงด้วย URL azurewebsites — ย้ายมาผ่าน gateway เพื่อ log/แยกรายแอปด้วย X-App-Name
# ไม่ใส่ jwt ของ Kong: path ใต้พวกนี้มี endpoint auth (blocked-check, login) และ backend
# ตรวจ token ของตัวเองอยู่แล้ว — ระดับความปลอดภัยเท่าการเรียกตรงแบบเดิม
#
# idempotent: PUT ซ้ำได้ · ใช้: sh add-web-backend-routes.sh
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"

echo "=== route /svc -> svc-management ==="
curl -s -o /dev/null -w "  PUT route svc-all -> %{http_code}\n" -X PUT "$ADMIN/services/svc-management/routes/svc-all" \
  --data "paths[]=/svc" --data "strip_path=true" --data "tags[]=sm-web"

echo "=== service+route /pm -> webappbevpro (ProjectManagement) ==="
curl -s -o /dev/null -w "  PUT service pm-backend -> %{http_code}\n" -X PUT "$ADMIN/services/pm-backend" \
  --data "url=https://webappbevpro-cqhngkafcadugucw.southeastasia-01.azurewebsites.net" \
  --data "connect_timeout=10000" --data "read_timeout=60000" --data "write_timeout=60000"
curl -s -o /dev/null -w "  PUT route pm-all -> %{http_code}\n" -X PUT "$ADMIN/services/pm-backend/routes/pm-all" \
  --data "paths[]=/pm" --data "strip_path=true" --data "tags[]=sm-web"

sleep 6
echo "=== tests ==="
printf '/svc/api/v1/auth/blocked-check (POST) : '
curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST 'http://localhost/svc/api/v1/auth/blocked-check' -H 'Content-Type: application/json' -d '{}'
printf '  (direct: '
curl -sk -o /dev/null -w '%{http_code}' --max-time 10 -X POST 'https://servicemanagement-eqg3bkfec8f5asg3.southeastasia-01.azurewebsites.net/api/v1/auth/blocked-check' -H 'Content-Type: application/json' -d '{}'
echo ')'
printf '/pm/api/v1/health : '
curl -s -o /dev/null -w '%{http_code}' --max-time 10 'http://localhost/pm/api/v1/health'
printf '  (direct: '
curl -sk -o /dev/null -w '%{http_code}' --max-time 10 'https://webappbevpro-cqhngkafcadugucw.southeastasia-01.azurewebsites.net/api/v1/health'
echo ')'

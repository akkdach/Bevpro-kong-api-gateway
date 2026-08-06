#!/bin/sh
# =====================================================
# add-grafana-https.sh — เสิร์ฟ Grafana ผ่าน Kong ที่ /grafana (HTTPS)
#
# เดิม: เข้า Grafana ผ่าน http://20.6.32.81:3000 — รหัสผ่านวิ่งเปลือย
# ใหม่: https://bevprogateway.southeastasia.cloudapp.azure.com/grafana
#       ใช้ใบรับรอง Let's Encrypt ของ gateway ที่มีอยู่แล้ว
#
# ความปลอดภัย: route นี้รับเฉพาะ HTTPS + จำกัด IP แอดมิน (ip-restriction)
# คู่กับ: docker-compose.override.vm.yml ตั้ง GF_SERVER_ROOT_URL + SERVE_FROM_SUB_PATH
# พอร์ต 3000 เดิมยังเปิดไว้เป็นทางสำรอง (ปิดทีหลังได้ที่ NSG เมื่อมั่นใจ)
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"

echo "[service]"
curl -s -o /dev/null -w "  grafana-internal -> %{http_code}\n" \
  -X PUT "$ADMIN/services/grafana-internal" \
  --data "url=http://grafana:3000"

echo "[route] /grafana (HTTPS เท่านั้น)"
curl -s -o /dev/null -w "  grafana-admin -> %{http_code}\n" \
  -X PUT "$ADMIN/services/grafana-internal/routes/grafana-admin" \
  --data "paths[]=/grafana" --data "strip_path=false" \
  --data "protocols[]=https" \
  --data "preserve_host=true" \
  --data "tags[]=admin-ui"
# preserve_host=true จำเป็น! ไม่งั้น Grafana เห็น Host เป็น grafana:3000
# -> CSRF check ("origin not allowed") ปฏิเสธทุก POST -> กราฟขึ้น No data ทั้ง dashboard

echo "[plugin] ip-restriction — เฉพาะ IP แอดมิน"
EXISTING=$(curl -s "$ADMIN/routes/grafana-admin/plugins" | python3 -c "
import sys, json
for p in json.load(sys.stdin)['data']:
    if p['name'] == 'ip-restriction':
        print(p['id']); break
")
if [ -n "$EXISTING" ]; then
  curl -s -o /dev/null -w "  อัปเดตตัวเดิม -> %{http_code}\n" -X PATCH "$ADMIN/plugins/$EXISTING" \
    --data "config.allow[]=171.103.89.247" --data "config.allow[]=87.124.104.34"
else
  curl -s -o /dev/null -w "  สร้างใหม่ -> %{http_code}\n" -X POST "$ADMIN/routes/grafana-admin/plugins" \
    --data "name=ip-restriction" \
    --data "config.allow[]=171.103.89.247" --data "config.allow[]=87.124.104.34"
fi

echo "done — เปิด https://bevprogateway.southeastasia.cloudapp.azure.com/grafana"

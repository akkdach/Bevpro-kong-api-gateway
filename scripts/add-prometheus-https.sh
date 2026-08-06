#!/bin/sh
# =====================================================
# add-prometheus-https.sh — เสิร์ฟ Prometheus ผ่าน Kong ที่ /prometheus (HTTPS)
#
# เดิม: http://20.6.32.81:9090 — ไม่เข้ารหัส
# ใหม่: https://bevprogateway.southeastasia.cloudapp.azure.com/prometheus
#
# strip_path=true เพราะ Prometheus ตั้ง route-prefix=/ (เสิร์ฟที่ root)
# ip-restriction จำกัด IP แอดมิน เหมือน route grafana-admin
# คู่กับ: docker-compose.override.vm.yml (--web.external-url + --web.route-prefix)
# =====================================================
ADMIN="${KONG_ADMIN:-http://localhost:8001}"

echo "[service]"
curl -s -o /dev/null -w "  prometheus-internal -> %{http_code}\n" \
  -X PUT "$ADMIN/services/prometheus-internal" \
  --data "url=http://prometheus:9090"

echo "[route] /prometheus (HTTPS เท่านั้น, strip path)"
curl -s -o /dev/null -w "  prometheus-admin -> %{http_code}\n" \
  -X PUT "$ADMIN/services/prometheus-internal/routes/prometheus-admin" \
  --data "paths[]=/prometheus" --data "strip_path=true" \
  --data "protocols[]=https" \
  --data "tags[]=admin-ui"

echo "[plugin] ip-restriction — เฉพาะ IP แอดมิน"
EXISTING=$(curl -s "$ADMIN/routes/prometheus-admin/plugins" | python3 -c "
import sys, json
for p in json.load(sys.stdin)['data']:
    if p['name'] == 'ip-restriction':
        print(p['id']); break
")
if [ -n "$EXISTING" ]; then
  curl -s -o /dev/null -w "  อัปเดตตัวเดิม -> %{http_code}\n" -X PATCH "$ADMIN/plugins/$EXISTING" \
    --data "config.allow[]=171.103.89.247" --data "config.allow[]=87.124.104.34"
else
  curl -s -o /dev/null -w "  สร้างใหม่ -> %{http_code}\n" -X POST "$ADMIN/routes/prometheus-admin/plugins" \
    --data "name=ip-restriction" \
    --data "config.allow[]=171.103.89.247" --data "config.allow[]=87.124.104.34"
fi

echo "done — เปิด https://bevprogateway.southeastasia.cloudapp.azure.com/prometheus"

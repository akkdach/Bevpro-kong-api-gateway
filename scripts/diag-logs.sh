#!/bin/sh
# diag-logs.sh — ตรวจสายพาน log: Kong -> log-receiver -> Postgres -> Grafana
# อ่านอย่างเดียว ไม่แก้อะไร
echo "== 1. สถานะ containers =="
sudo -n docker ps --format '{{.Names}} -> {{.Status}}'

echo ""
echo "== 2. log ใน DB (1 ชม.ล่าสุด: จำนวน, เวลาล่าสุด) =="
sudo -n docker exec kong-database psql -U kong -t -c "SELECT count(*), max(request_time) FROM kong_api_logs WHERE request_time > now() - interval '1 hour'"

echo ""
echo "== 3. log-receiver พูดว่าอะไร (15 บรรทัดล่าสุด) =="
sudo -n docker logs --tail 15 log-receiver 2>&1

echo ""
echo "== 4. Grafana ฟ้อง error อะไร =="
sudo -n docker logs --tail 60 grafana 2>&1 | grep -iE "error|fail" | tail -8
echo "(ว่าง = ไม่มี error)"

echo ""
echo "== 5. http-log plugin ของ Kong ยังเปิดไหม =="
curl -s "http://localhost:8001/plugins?size=300" | python3 -c "
import sys, json
for p in json.load(sys.stdin)['data']:
    if p['name'] == 'http-log':
        print(f\"  http-log enabled={p['enabled']} -> {p['config'].get('http_endpoint')}\")
"
echo "done"

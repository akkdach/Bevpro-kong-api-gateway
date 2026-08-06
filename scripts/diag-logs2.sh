#!/bin/sh
# diag-logs2.sh — เจาะต่อ: DB มีข้อมูลจริงไหม + Grafana ต่อ datasource ได้ไหม
echo "== A. log 1 ชม.ล่าสุด (จำนวน | เวลาล่าสุด | เวลาปัจจุบันของ DB) =="
sudo -n docker exec kong-database psql -U kong -t -c "SELECT count(*), max(request_time), now() FROM kong_api_logs WHERE request_time > now() - interval '1 hour'"

echo ""
echo "== B. datasource ที่ Grafana มองเห็น =="
sudo -n docker exec grafana ls /etc/grafana/provisioning/datasources/ 2>&1
sudo -n docker exec grafana sh -c 'grep -vE "password|Password" /etc/grafana/provisioning/datasources/*.yml' 2>&1

echo ""
echo "== C. grafana log เจาะเฉพาะเรื่อง datasource/query (300 บรรทัดล่าสุด) =="
sudo -n docker logs --tail 300 grafana 2>&1 | grep -iE "tsdb|datasource|postgres|query error|dial|refused" | tail -12
echo "(ว่าง = Grafana ไม่เคยบ่นเรื่อง datasource เลย)"
echo "done"

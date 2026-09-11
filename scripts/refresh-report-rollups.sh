#!/bin/bash
# refresh-report-rollups.sh — refresh ตารางสรุปรายวันของ dashboard Monthly Report
# ติดตั้งเป็น cron (root) ทุก 6 ชม.:  20 */6 * * * /home/adminwebapp/kong/scripts/refresh-report-rollups.sh >> /var/log/kong-rollups.log 2>&1
# CONCURRENTLY = refresh โดยไม่ล็อกการอ่านของ Grafana (ต้องมี unique index — สร้างแล้วใน create-report-rollups.sql)
set -e
for mv in mv_kong_day mv_kong_day_app mv_kong_day_path mv_kong_hour; do
  docker exec kong-database psql -U kong -d kong -c "REFRESH MATERIALIZED VIEW CONCURRENTLY $mv;"
done
echo "$(date -Is) refreshed all rollups"

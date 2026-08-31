#!/bin/sh
# =====================================================
# purge-log-bodies.sh — ล้าง request_body ใน kong_api_logs ที่เก่ากว่า N วัน
#
# ทำไมต้องมี: ตั้งแต่ 2026-08-21 pre-function ของ Kong เก็บ request body (JSON/form ≤ 4 KB)
#   ลงคอลัมน์ request_body ~1.3 GB/เดือน — body มี PII (ข้อมูลลูกค้า/GPS/รหัสพนักงาน)
#   จึงเก็บไว้แค่ 30 วันพอสำหรับ debug แล้วล้าง  แถว log ยังอยู่ครบ (สถิติ/กราฟไม่กระทบ)
#   แค่คอลัมน์ request_body กลายเป็น NULL
#
# ติดตั้ง cron (รันเป็น root บน VM — เหมือน renew-ssl.sh):
#   sudo -n crontab -l | { cat; echo "30 2 * * * /home/adminwebapp/kong/scripts/purge-log-bodies.sh >> /var/log/purge-log-bodies.log 2>&1"; } | sudo -n crontab -
#
# ใช้มือ: sh scripts/purge-log-bodies.sh [วัน]   (default 30)
# =====================================================
DAYS="${1:-30}"
DB_CONTAINER="${DB_CONTAINER:-kong-database}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] purge request_body older than ${DAYS} days"
docker exec "$DB_CONTAINER" psql -U kong -d kong -At -c \
  "UPDATE kong_api_logs SET request_body = NULL
   WHERE request_time < now() - interval '${DAYS} days' AND request_body IS NOT NULL" \
  && echo "  done"

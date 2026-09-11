#!/bin/bash
# =====================================================================
# install-lock-sampler.sh — ติดตั้งตัวเก็บตัวอย่าง lock ของ SQL Server
#
# ทำอะไรบ้าง
#   1. สร้างตาราง sql_*_samples ใน Postgres ของ Kong (idempotent รันซ้ำได้)
#   2. ดึง image ของ sqlcmd มาไว้ล่วงหน้า
#   3. ทดสอบว่าต่อ SQL Server ได้จริงด้วย login ที่ตั้งไว้ใน .env
#   4. ใส่ cron ให้ root รันทุก 1 นาที (ถ้ายังไม่มี)
#
# ใช้:  sudo bash /home/adminwebapp/kong/scripts/install-lock-sampler.sh
#
# ก่อนรัน ต้องทำสองอย่างนี้ก่อน
#   - รัน scripts/create-grafana-sql-login.sql บน SQL Server ผ่าน SSMS
#   - ใส่ MSSQL_GRAFANA_PASSWORD ลงใน /home/adminwebapp/kong/.env
# =====================================================================
set -uo pipefail

KONG_DIR="${KONG_DIR:-/home/adminwebapp/kong}"
ENV_FILE="$KONG_DIR/.env"
PG_CONTAINER="${PG_CONTAINER:-kong-database}"
IMAGE="${MSSQL_TOOLS_IMAGE:-mcr.microsoft.com/mssql-tools}"
CRON_LINE="* * * * * $KONG_DIR/scripts/sample-sqlserver-locks.sh >> /var/log/kong-lock-sampler.log 2>&1"

echo "== 1/4 สร้างตารางเก็บตัวอย่างใน Postgres"
if ! docker exec -i "$PG_CONTAINER" psql -U kong -d kong -q -v ON_ERROR_STOP=1 \
       < "$KONG_DIR/init-db/002-create-lock-sample-tables.sql"; then
  echo "   ล้มเหลว: สร้างตารางไม่ได้ ตรวจว่า container $PG_CONTAINER รันอยู่"
  exit 1
fi
docker exec -i "$PG_CONTAINER" psql -U kong -d kong -c "\dt sql_*_samples"

echo
echo "== 2/4 ดึง image ของ sqlcmd"
docker pull "$IMAGE" >/dev/null 2>&1 && echo "   พร้อมแล้ว: $IMAGE" || { echo "   ดึง image ไม่สำเร็จ"; exit 1; }

echo
echo "== 3/4 ทดสอบการเชื่อมต่อ SQL Server"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
if [ -z "${MSSQL_GRAFANA_PASSWORD:-}" ]; then
  echo "   ยังไม่ได้ตั้ง MSSQL_GRAFANA_PASSWORD ใน $ENV_FILE"
  echo "   ข้ามการทดสอบ แต่จะติดตั้ง cron ให้ก่อน (สคริปต์จะข้ามตัวเองจนกว่าจะมีรหัส)"
else
  HOSTPORT="${MSSQL_GRAFANA_HOST:-10.0.0.4:1433}"
  SQLHOST="${HOSTPORT%%:*}"; SQLPORT="${HOSTPORT##*:}"
  [ "$SQLPORT" = "$SQLHOST" ] && SQLPORT=1433
  RESULT=$(docker run --rm -e SQLCMDPASSWORD="$MSSQL_GRAFANA_PASSWORD" "$IMAGE" \
    /opt/mssql-tools/bin/sqlcmd -S "tcp:${SQLHOST},${SQLPORT}" \
      -U "${MSSQL_GRAFANA_USER:-grafana_reader}" -d "${MSSQL_GRAFANA_DB:-BevproFsProd}" \
      -N -C -l 10 -h -1 -W -Q "SET NOCOUNT ON; SELECT 'ok=' + CAST(COUNT(*) AS varchar(10)) FROM sys.dm_os_wait_stats;" 2>&1)
  if echo "$RESULT" | grep -q '^ok='; then
    echo "   ต่อได้ และอ่าน DMV ได้ ($RESULT)"
  else
    echo "   ต่อไม่ได้หรือสิทธิ์ไม่พอ:"
    echo "$RESULT" | head -5 | sed 's/^/     /'
    echo "   ตรวจว่ารัน scripts/create-grafana-sql-login.sql แล้ว และรหัสใน .env ถูกต้อง"
  fi
fi

echo
echo "== 4/4 ติดตั้ง cron"
if crontab -l 2>/dev/null | grep -qF "sample-sqlserver-locks.sh"; then
  echo "   มี cron อยู่แล้ว ข้าม"
else
  ( crontab -l 2>/dev/null; echo "$CRON_LINE" ) | crontab -
  echo "   เพิ่มแล้ว: $CRON_LINE"
fi
touch /var/log/kong-lock-sampler.log

echo
echo "เสร็จ. ดู log ได้ที่ /var/log/kong-lock-sampler.log"
echo "ตรวจว่าข้อมูลเข้าจริงหลังผ่านไป 2 นาที:"
echo "  docker exec kong-database psql -U kong -d kong -c \"SELECT max(sampled_at) FROM sql_index_usage_samples;\""

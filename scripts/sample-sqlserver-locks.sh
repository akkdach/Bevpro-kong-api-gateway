#!/bin/bash
# =====================================================================
# sample-sqlserver-locks.sh — เก็บตัวอย่างสถานะ lock ของ SQL Server ที่ backend
#
# ทำไมต้องมี : DMV ของ SQL Server เก็บแต่สถานะปัจจุบัน พอ lock convoy จบแล้ว
#              ย้อนดูไม่ได้ว่าใครถือ lock สคริปต์นี้จึงเก็บภาพนิ่งเป็นระยะ
#              ลงตาราง sql_*_samples ใน Postgres ตัวเดียวกับ kong_api_logs
#
# ติดตั้ง    : bash scripts/install-lock-sampler.sh  (สร้างตาราง + ใส่ cron ให้)
# cron       : * * * * * /home/adminwebapp/kong/scripts/sample-sqlserver-locks.sh >> /var/log/kong-lock-sampler.log 2>&1
#              รันทุก 1 นาที ภายในแต่ละรอบเก็บ 2 ตัวอย่างห่างกัน 30 วินาที
#
# ต้องมีใน .env : MSSQL_GRAFANA_HOST / _DB / _USER / _PASSWORD
#                 (login read-only สร้างด้วย scripts/create-grafana-sql-login.sql)
#
# ไม่ทำอะไรกับ SQL Server นอกจากอ่าน DMV — ไม่มีคำสั่งเขียนใด ๆ
# =====================================================================
set -uo pipefail

ENV_FILE="${ENV_FILE:-/home/adminwebapp/kong/.env}"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi

HOSTPORT="${MSSQL_GRAFANA_HOST:-10.0.0.4:1433}"
SQLHOST="${HOSTPORT%%:*}"
SQLPORT="${HOSTPORT##*:}"
[ "$SQLPORT" = "$SQLHOST" ] && SQLPORT=1433
SQLDB="${MSSQL_GRAFANA_DB:-BevproFsProd}"
SQLUSER="${MSSQL_GRAFANA_USER:-grafana_reader}"
IMAGE="${MSSQL_TOOLS_IMAGE:-mcr.microsoft.com/mssql-tools}"
PG_CONTAINER="${PG_CONTAINER:-kong-database}"
SAMPLES="${SAMPLES:-2}"
INTERVAL="${INTERVAL:-30}"
RETENTION_DAYS="${LOCK_SAMPLE_RETENTION_DAYS:-30}"

if [ -z "${MSSQL_GRAFANA_PASSWORD:-}" ]; then
  echo "$(date -Is) ข้าม: ยังไม่ได้ตั้ง MSSQL_GRAFANA_PASSWORD ใน $ENV_FILE"
  exit 0
fi

# ── รัน query บน SQL Server แล้วคืนผลคั่นด้วย | ─────────────────────
# รหัสส่งผ่าน env SQLCMDPASSWORD ไม่ใช่ argument จึงไม่โผล่ใน ps
sqlq() {
  docker run --rm \
    -e SQLCMDPASSWORD="$MSSQL_GRAFANA_PASSWORD" \
    "$IMAGE" /opt/mssql-tools/bin/sqlcmd \
      -S "tcp:${SQLHOST},${SQLPORT}" -U "$SQLUSER" -d "$SQLDB" \
      -N -C -l 10 -t 45 -h -1 -W -s '|' -Q "SET NOCOUNT ON; $1" 2>/dev/null \
    | grep -v '^$' | grep -v 'rows affected'
}

# ── โหลดเข้า Postgres ผ่าน COPY (รูปแบบ text คั่นด้วย |) ────────────
# ทุก query ล้าง CR, LF, | และ \ ออกจาก free text แล้ว จึงใช้ text format ได้ปลอดภัย
copy_into() {
  local table="$1" cols="$2"
  docker exec -i "$PG_CONTAINER" psql -U kong -d kong -q -v ON_ERROR_STOP=1 \
    -c "COPY ${table} (${cols}) FROM STDIN WITH (FORMAT text, DELIMITER '|', NULL '')"
}

SQL_BLOCKING="
SELECT
    CONVERT(varchar(33), SYSDATETIMEOFFSET(), 126),
    r.session_id,
    r.blocking_session_id,
    ISNULL(r.wait_type, ''),
    r.wait_time,
    ISNULL(DB_NAME(r.database_id), ''),
    ISNULL(s.login_name, ''),
    ISNULL(s.host_name, ''),
    ISNULL(s.program_name, ''),
    LEFT(REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(t.text,''), CHAR(13), ' '), CHAR(10), ' '), '|', '/'), CHAR(92), '/'), 400)
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.blocking_session_id <> 0
   OR r.session_id IN (SELECT blocking_session_id FROM sys.dm_exec_requests WHERE blocking_session_id <> 0);
"

SQL_WAITS="
SELECT
    CONVERT(varchar(33), SYSDATETIMEOFFSET(), 126),
    wait_type, waiting_tasks_count, wait_time_ms, max_wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_type LIKE 'LCK[_]%' AND waiting_tasks_count > 0;
"

SQL_INDEX="
SELECT
    CONVERT(varchar(33), SYSDATETIMEOFFSET(), 126),
    'Manpower_Operations',
    i.name,
    i.type_desc,
    ISNULL(s.user_seeks, 0), ISNULL(s.user_scans, 0),
    ISNULL(s.user_lookups, 0), ISNULL(s.user_updates, 0)
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats s
       ON s.object_id = i.object_id AND s.index_id = i.index_id AND s.database_id = DB_ID()
WHERE i.object_id = OBJECT_ID('dbo.Manpower_Operations') AND i.type_desc <> 'HEAP';
"

take_sample() {
  local n=0

  out=$(sqlq "$SQL_BLOCKING")
  if [ -n "$out" ]; then
    n=$(printf '%s\n' "$out" | wc -l)
    printf '%s\n' "$out" | copy_into sql_blocking_samples \
      "sampled_at,session_id,blocking_session_id,wait_type,wait_ms,db_name,login_name,host_name,program_name,sql_text" \
      || echo "$(date -Is) เขียน sql_blocking_samples ไม่สำเร็จ"
  fi

  out=$(sqlq "$SQL_WAITS")
  if [ -n "$out" ]; then
    printf '%s\n' "$out" | copy_into sql_lock_wait_samples \
      "sampled_at,wait_type,waiting_tasks_count,wait_time_ms,max_wait_time_ms" \
      || echo "$(date -Is) เขียน sql_lock_wait_samples ไม่สำเร็จ"
  fi

  out=$(sqlq "$SQL_INDEX")
  if [ -n "$out" ]; then
    printf '%s\n' "$out" | copy_into sql_index_usage_samples \
      "sampled_at,table_name,index_name,index_type,user_seeks,user_scans,user_lookups,user_updates" \
      || echo "$(date -Is) เขียน sql_index_usage_samples ไม่สำเร็จ"
  fi

  # รายงานเฉพาะตอนเจอ blocking จริง จะได้ไม่ท่วม log
  if [ "$n" -gt 0 ]; then
    echo "$(date -Is) พบ blocking $n แถว"
  fi
}

for i in $(seq 1 "$SAMPLES"); do
  take_sample
  [ "$i" -lt "$SAMPLES" ] && sleep "$INTERVAL"
done

# ── ล้างของเก่า ทำนาทีที่ 7 ของทุกชั่วโมงพอ ไม่ต้องทำทุกนาที ──────────
if [ "$(date +%M)" = "07" ]; then
  docker exec -i "$PG_CONTAINER" psql -U kong -d kong -q -c "
    DELETE FROM sql_blocking_samples   WHERE sampled_at < now() - interval '${RETENTION_DAYS} days';
    DELETE FROM sql_lock_wait_samples  WHERE sampled_at < now() - interval '${RETENTION_DAYS} days';
    DELETE FROM sql_index_usage_samples WHERE sampled_at < now() - interval '${RETENTION_DAYS} days';" \
    && echo "$(date -Is) ล้างตัวอย่างที่เก่ากว่า ${RETENTION_DAYS} วันแล้ว"
fi

exit 0

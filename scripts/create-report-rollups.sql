-- create-report-rollups.sql — ตารางสรุปรายวัน (materialized view) สำหรับ dashboard "Kong — Monthly Report"
-- เหตุผล: kong_api_logs โต ~2.5 ล้านแถว/เดือน query สรุปรายเดือนตรงๆ ใช้ 3-30 วิ/panel
--         หลาย panel พร้อมกันบน VM 2 core ทำให้ timeout — จึงรวมยอดรายวันไว้ล่วงหน้า
-- รันครั้งแรก: docker cp ไฟล์นี้เข้า kong-database แล้ว psql -f (idempotent — รันซ้ำได้)
-- refresh: cron เรียก scripts/refresh-report-rollups.sh ทุก 6 ชม. (ข้อมูลใน dashboard สดถึงรอบ refresh ล่าสุด)

-- IP ขาออกของบริการ Azure ของเราเอง (App Services + VM) — client พวกนี้เรียกกันใน Azure region เดียวกัน = ไม่เสียค่า egress
-- ที่มา: az webapp list --query "[].possibleOutboundIpAddresses" (2026-09-02) + public IP ของ Kong VM / IIS VM
-- ถ้าเพิ่ม App Service ใหม่ ให้ insert IP เพิ่มแล้วรอ refresh รอบถัดไป (MV กรองผ่านตารางนี้ตอน refresh)
CREATE TABLE IF NOT EXISTS azure_internal_ips (ip VARCHAR(45) PRIMARY KEY);
INSERT INTO azure_internal_ips (ip) VALUES
 ('104.43.19.189'),('13.67.70.243'),('13.67.9.5'),('13.76.100.162'),('13.76.138.204'),
 ('13.76.208.109'),('13.76.231.65'),('20.195.51.160'),('20.24.128.212'),('20.24.128.51'),
 ('20.24.132.226'),('20.24.132.6'),('20.24.133.233'),('20.24.133.45'),('20.247.138.108'),
 ('4.144.150.30'),('4.144.150.42'),('4.144.150.51'),('4.144.150.52'),('4.144.150.54'),
 ('4.144.150.57'),('4.145.26.61'),('52.148.114.120'),('52.187.130.238'),('52.187.131.4'),
 ('52.187.14.194'),('57.155.182.67'),('57.155.219.152'),('20.6.32.81'),('20.33.118.76')
ON CONFLICT (ip) DO NOTHING;

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_kong_day AS
SELECT (request_time AT TIME ZONE 'Asia/Bangkok')::date AS day,
       count(DISTINCT jwt_user)  FILTER (WHERE jwt_user IS NOT NULL)  AS users,
       count(DISTINCT device_id) FILTER (WHERE device_id IS NOT NULL) AS devices,
       count(*) FILTER (WHERE route_name IS NULL)     AS bot_hits,
       count(*) FILTER (WHERE route_name IS NOT NULL) AS calls
FROM kong_api_logs
GROUP BY 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_kong_day ON mv_kong_day(day);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_kong_day_app AS
SELECT (request_time AT TIME ZONE 'Asia/Bangkok')::date AS day,
       coalesce(app_name, consumer_username, 'anonymous') AS app,
       count(*) AS calls,
       count(*) FILTER (WHERE status_code < 400)  AS ok_calls,
       count(*) FILTER (WHERE status_code >= 500) AS err5xx,
       count(DISTINCT jwt_user) FILTER (WHERE jwt_user IS NOT NULL) AS users,
       sum(coalesce(request_size,0))  AS upload,
       sum(coalesce(response_size,0)) AS download
FROM kong_api_logs
WHERE route_name IS NOT NULL AND path NOT LIKE '/grafana/%'
GROUP BY 1,2;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_kong_day_app ON mv_kong_day_app(day, app);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_kong_day_path AS
SELECT (request_time AT TIME ZONE 'Asia/Bangkok')::date AS day,
       coalesce(app_name, consumer_username, 'anonymous') AS app,
       method || ' ' || regexp_replace(split_part(path,'?',1), '/[0-9]+(/|$)', '/{id}\1', 'g') AS mpath,
       count(*) AS calls,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95_ms,
       sum(coalesce(request_size,0))  AS upload,
       sum(coalesce(response_size,0)) AS download,
       -- เฉพาะ response ที่ออกจาก Azure จริง (ตัด client ภายใน VNet/docker + บริการ Azure ของเราเองใน azure_internal_ips) ใช้ประเมินค่า egress
       sum(coalesce(response_size,0)) FILTER (WHERE client_ip NOT LIKE '10.%' AND client_ip NOT LIKE '192.168.%'
             AND client_ip !~ '^172\.(1[6-9]|2[0-9]|3[01])\.'
             AND client_ip NOT IN (SELECT ip FROM azure_internal_ips)) AS download_inet
FROM kong_api_logs
WHERE route_name IS NOT NULL AND path NOT LIKE '/grafana/%'
GROUP BY 1,2,3;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_kong_day_path ON mv_kong_day_path(day, app, mpath);

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_kong_hour AS
SELECT (request_time AT TIME ZONE 'Asia/Bangkok')::date AS day,
       extract(hour FROM request_time AT TIME ZONE 'Asia/Bangkok')::int AS hh,
       count(*) AS calls
FROM kong_api_logs
WHERE route_name IS NOT NULL AND path NOT LIKE '/grafana/%'
GROUP BY 1,2;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_kong_hour ON mv_kong_hour(day, hh);

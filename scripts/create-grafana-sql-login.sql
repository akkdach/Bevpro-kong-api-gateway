/* =====================================================================
   create-grafana-sql-login.sql
   สร้าง login read-only ให้ Grafana อ่าน DMV ของ SQL Server ที่ backend

   รันที่ไหน : SSMS ต่อไปที่ instance  WebApplication\MSSQLQAS  ด้วยบัญชีที่เป็น sysadmin
   รันเมื่อไร: ครั้งเดียว ก่อนเปิดใช้ datasource SqlServerBevPro ใน Grafana

   ทำไมต้องมี : dashboard sqlserver-lock-live / sqlserver-lock-history ต้องอ่าน
                sys.dm_exec_requests, sys.dm_os_wait_stats, sys.dm_db_index_usage_stats
                ซึ่งต้องใช้สิทธิ์ VIEW SERVER STATE

   ⚠️ ห้ามใช้ sa กับ Grafana — Grafana เก็บรหัสไว้ในตัวเอง และแอดมินหลายคนเข้าถึงได้
   ⚠️ บัญชีนี้ไม่มีสิทธิ์ SELECT ตารางข้อมูลใด ๆ ทั้งสิ้น อ่านได้แค่ DMV กับ metadata

   หลังรันเสร็จ ให้เอารหัสไปใส่ใน /home/adminwebapp/kong/.env บน Kong VM
   เป็น key ชื่อ MSSQL_GRAFANA_PASSWORD แล้ว docker compose up -d grafana
   ===================================================================== */

/* ---------------------------------------------------------------------
   ขั้นที่ 1 — สร้าง login ที่ระดับ instance

   แทนที่ <PUT_A_STRONG_PASSWORD_HERE> ด้วยรหัสสุ่มยาวอย่างน้อย 24 ตัวอักษร
   สร้างรหัสได้จาก PowerShell:
     -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 28 | % {[char]$_})
   --------------------------------------------------------------------- */
USE master;
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'grafana_reader')
BEGIN
    CREATE LOGIN [grafana_reader]
        WITH PASSWORD = N'<PUT_A_STRONG_PASSWORD_HERE>',
             CHECK_POLICY = ON,
             CHECK_EXPIRATION = OFF,
             DEFAULT_DATABASE = [BevproFsProd];
    PRINT 'สร้าง login grafana_reader แล้ว';
END
ELSE
    PRINT 'มี login grafana_reader อยู่แล้ว ข้ามขั้นนี้';
GO

/* ---------------------------------------------------------------------
   ขั้นที่ 2 — สิทธิ์ระดับ instance

   VIEW SERVER STATE   : อ่าน DMV ทั้งหมด (dm_exec_requests, dm_os_wait_stats ฯลฯ)
   VIEW ANY DEFINITION : ให้ OBJECT_NAME() กับ sys.indexes คืนชื่อจริงแทน NULL
                         เป็นสิทธิ์อ่าน metadata ไม่ใช่สิทธิ์อ่านข้อมูลในตาราง
   --------------------------------------------------------------------- */
GRANT VIEW SERVER STATE   TO [grafana_reader];
GRANT VIEW ANY DEFINITION TO [grafana_reader];
GO

/* ---------------------------------------------------------------------
   ขั้นที่ 3 — ผูก user เข้ากับ database ที่ต้องดู
   --------------------------------------------------------------------- */
USE [BevproFsProd];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'grafana_reader')
BEGIN
    CREATE USER [grafana_reader] FOR LOGIN [grafana_reader];
    PRINT 'สร้าง user grafana_reader ใน BevproFsProd แล้ว';
END
GO

GRANT VIEW DATABASE STATE TO [grafana_reader];
GO

/* ---------------------------------------------------------------------
   ขั้นที่ 4 — ตรวจว่าใช้ได้จริง
   เปิด session ใหม่ใน SSMS โดย login ด้วย grafana_reader แล้วรันสามคำสั่งนี้
   ต้องได้ผลลัพธ์ทั้งสามอัน ไม่ใช่ error เรื่องสิทธิ์
   --------------------------------------------------------------------- */
-- SELECT TOP 5 wait_type, wait_time_ms FROM sys.dm_os_wait_stats ORDER BY wait_time_ms DESC;
-- SELECT session_id, blocking_session_id FROM sys.dm_exec_requests WHERE session_id > 50;
-- SELECT i.name, s.user_seeks, s.user_scans
--   FROM sys.dm_db_index_usage_stats s
--   JOIN sys.indexes i ON i.object_id = s.object_id AND i.index_id = s.index_id
--  WHERE s.database_id = DB_ID() AND s.object_id = OBJECT_ID('dbo.Manpower_Operations');

/* ---------------------------------------------------------------------
   ถ้าต้องยกเลิกภายหลัง
   --------------------------------------------------------------------- */
-- USE [BevproFsProd];  DROP USER  [grafana_reader];
-- USE [master];        DROP LOGIN [grafana_reader];

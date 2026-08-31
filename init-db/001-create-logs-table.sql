-- =====================================================
-- Kong API Logs Table — Auto-created on first DB start
-- =====================================================

CREATE TABLE IF NOT EXISTS kong_api_logs (
    id                  SERIAL PRIMARY KEY,
    request_id          VARCHAR(50) UNIQUE,
    client_ip           VARCHAR(45),
    method              VARCHAR(10),
    path                TEXT,
    status_code         INT,
    latency_ms          INT,
    consumer_username   VARCHAR(100),
    user_agent          TEXT,
    -- Device_ID header จากแอป Mobile — แยกได้ถึงระดับเครื่อง (user_agent บอกได้แค่รุ่น)
    device_id           VARCHAR(100),
    -- ชื่อผู้ใช้จาก claim sub ใน JWT (เก็บเฉพาะ sub ห้ามเก็บทั้ง token)
    jwt_user            VARCHAR(100),
    -- header X-App-Name จาก api client ของแต่ละ frontend — แยกว่าแอปไหนยิง
    -- (consumer แยกไม่ได้ ทุกแอปใช้ token ชุดเดียวกัน) · แอปที่ยังไม่ใส่ header = NULL
    -- ตารางเดิมบน VM เพิ่มด้วย: ALTER TABLE kong_api_logs ADD COLUMN IF NOT EXISTS app_name VARCHAR(100);
    app_name            VARCHAR(100),
    request_body        TEXT,
    -- ปริมาณข้อมูลเข้า/ออก ใช้คิดโควตาอินเทอร์เน็ตรายเครื่อง (PROPOSAL ข้อ 4.2)
    request_size        INT,
    response_size       INT,
    service_name        VARCHAR(100),
    route_name          VARCHAR(100),
    request_time        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_kong_logs_request_time ON kong_api_logs(request_time);
CREATE INDEX IF NOT EXISTS idx_kong_logs_status_code  ON kong_api_logs(status_code);
CREATE INDEX IF NOT EXISTS idx_kong_logs_consumer      ON kong_api_logs(consumer_username);
CREATE INDEX IF NOT EXISTS idx_kong_logs_path          ON kong_api_logs(path);

-- =====================================================
-- Auto-cleanup: Partition-like cleanup for old logs
-- (Optional: run as cron or scheduled task)
-- =====================================================
-- DELETE FROM kong_api_logs WHERE request_time < NOW() - INTERVAL '90 days';

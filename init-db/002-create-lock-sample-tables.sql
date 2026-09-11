-- =====================================================
-- ตารางเก็บตัวอย่างสถานะ lock ของ SQL Server ที่ backend
-- ใช้โดย scripts/sample-sqlserver-locks.sh (cron ทุก 1 นาที)
-- อ่านโดย dashboard sqlserver-lock-history.json
--
-- ทำไมต้องมี: DMV ของ SQL Server เก็บแต่สถานะ "ตอนนี้" ถ้าไม่เก็บตัวอย่างไว้
-- พอ lock convoy จบไปแล้วจะย้อนดูไม่ได้ว่าใครเป็นคนถือ lock
--
-- หมายเหตุ: ไฟล์ใน init-db/ รันเฉพาะตอนสร้าง volume ครั้งแรกเท่านั้น
-- ถ้า DB มีอยู่แล้วให้ใช้ scripts/install-lock-sampler.sh ซึ่งรันไฟล์นี้ให้
-- =====================================================

-- ── ใครบล็อกใคร ณ วินาทีที่เก็บตัวอย่าง ────────────────────
CREATE TABLE IF NOT EXISTS sql_blocking_samples (
    id                    BIGSERIAL PRIMARY KEY,
    sampled_at            TIMESTAMP WITH TIME ZONE NOT NULL,
    session_id            INT,
    blocking_session_id   INT,
    wait_type             VARCHAR(60),
    wait_ms               BIGINT,
    db_name               VARCHAR(128),
    login_name            VARCHAR(128),
    host_name             VARCHAR(128),
    program_name          VARCHAR(200),
    sql_text              TEXT
);

CREATE INDEX IF NOT EXISTS idx_blocking_sampled_at
    ON sql_blocking_samples (sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_blocking_blocker
    ON sql_blocking_samples (blocking_session_id)
    WHERE blocking_session_id <> 0;

-- ── ยอดสะสมของ lock wait ทั้ง instance ────────────────────
-- เก็บเป็นค่าสะสม (counter) เวลาใช้ใน dashboard ต้องทำ delta เอง
CREATE TABLE IF NOT EXISTS sql_lock_wait_samples (
    id                    BIGSERIAL PRIMARY KEY,
    sampled_at            TIMESTAMP WITH TIME ZONE NOT NULL,
    wait_type             VARCHAR(60),
    waiting_tasks_count   BIGINT,
    wait_time_ms          BIGINT,
    max_wait_time_ms      BIGINT
);

CREATE INDEX IF NOT EXISTS idx_lockwait_sampled_at
    ON sql_lock_wait_samples (sampled_at DESC, wait_type);

-- ── การใช้งาน index ของ Manpower_Operations ────────────────
-- ค่าสะสมเช่นกัน ใช้ดูว่า scan หยุดจริงไหมหลังสร้าง index
CREATE TABLE IF NOT EXISTS sql_index_usage_samples (
    id                    BIGSERIAL PRIMARY KEY,
    sampled_at            TIMESTAMP WITH TIME ZONE NOT NULL,
    table_name            VARCHAR(128),
    index_name            VARCHAR(128),
    index_type            VARCHAR(40),
    user_seeks            BIGINT,
    user_scans            BIGINT,
    user_lookups          BIGINT,
    user_updates          BIGINT
);

CREATE INDEX IF NOT EXISTS idx_indexusage_sampled_at
    ON sql_index_usage_samples (sampled_at DESC, index_name);

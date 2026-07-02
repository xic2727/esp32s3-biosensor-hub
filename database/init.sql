-- =========================================================================
-- ESP32-S3 Biosensor Hub - Relational Database (PostgreSQL / MySQL compatible)
-- Database Initialization & Seed Script
-- =========================================================================

-- 1. Create Sleep Records Table (睡眠历史记录表)
CREATE TABLE IF NOT EXISTS sleep_records (
    id VARCHAR(50) PRIMARY KEY,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    duration INTEGER NOT NULL, -- in minutes
    quality_score INTEGER NOT NULL CHECK (quality_score >= 0 AND quality_score <= 100),
    average_heart_rate NUMERIC(5, 2) NOT NULL,
    average_spo2 NUMERIC(5, 2) NOT NULL,
    deep_sleep_percent INTEGER NOT NULL CHECK (deep_sleep_percent >= 0 AND deep_sleep_percent <= 100),
    rem_sleep_percent INTEGER NOT NULL CHECK (rem_sleep_percent >= 0 AND rem_sleep_percent <= 100),
    light_sleep_percent INTEGER NOT NULL CHECK (light_sleep_percent >= 0 AND light_sleep_percent <= 100),
    status VARCHAR(20) NOT NULL, -- 'optimal' | 'regular' | 'hypoxia' | 'warning'
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexing for fast retrieval of sleep logs by start time
CREATE INDEX IF NOT EXISTS idx_sleep_records_start_time ON sleep_records (start_time DESC);


-- 2. Create Telemetry Logs Table (实时物理遥测流水表)
CREATE TABLE IF NOT EXISTS telemetry_logs (
    id BIGSERIAL PRIMARY KEY,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    pulse_rate NUMERIC(5, 2) NOT NULL,
    blood_oxygen NUMERIC(5, 2) NOT NULL,
    skin_conductance NUMERIC(5, 2) NOT NULL,
    heart_rate_variability INTEGER NOT NULL,
    cpu_temp NUMERIC(4, 1) NOT NULL,
    power_draw INTEGER NOT NULL, -- in mW
    anomaly_type VARCHAR(20) DEFAULT 'none'
);

-- Indexing for high-frequency queries on recent metrics
CREATE INDEX IF NOT EXISTS idx_telemetry_recorded_at ON telemetry_logs (recorded_at DESC);


-- 3. Seed Initial Demo Sleep Records (预置演示数据)
INSERT INTO sleep_records (
    id, 
    start_time, 
    end_time, 
    duration, 
    quality_score, 
    average_heart_rate, 
    average_spo2, 
    deep_sleep_percent, 
    rem_sleep_percent, 
    light_sleep_percent, 
    status, 
    notes
) VALUES 
(
    'rec-1', 
    '2026-06-30 22:30:00+00', 
    '2026-07-01 06:30:00+00', 
    480, 
    88, 
    58.0, 
    97.8, 
    24, 
    22, 
    54, 
    'optimal', 
    '自动检测：睡眠周期十分完整，呼吸规律，未见明显乏氧事件。'
),
(
    'rec-2', 
    '2026-06-29 23:15:00+00', 
    '2026-06-30 06:45:00+00', 
    450, 
    64, 
    63.0, 
    91.2, 
    12, 
    18, 
    70, 
    'hypoxia', 
    '自动警告：凌晨 02:14 - 02:40 间检测到 4 次一过性睡眠呼吸暂停，最低血氧跌至 87%。建议调高止鼾枕高度。'
)
ON CONFLICT (id) DO NOTHING;

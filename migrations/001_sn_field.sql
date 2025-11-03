PRAGMA foreign_keys = OFF;
BEGIN;

-- Rename robot_SN column to sn when present.
-- This statement is a no-op if the column was already renamed in a previous migration.
ALTER TABLE sensor_data RENAME COLUMN robot_SN TO sn;

-- Ensure required measurement columns exist.
ALTER TABLE sensor_data ADD COLUMN IF NOT EXISTS distance_cm REAL;
ALTER TABLE sensor_data ADD COLUMN IF NOT EXISTS distance_mm INTEGER;
ALTER TABLE sensor_data ADD COLUMN IF NOT EXISTS battery INTEGER;
ALTER TABLE sensor_data ADD COLUMN IF NOT EXISTS temperature_c REAL;
ALTER TABLE sensor_data ADD COLUMN IF NOT EXISTS position TEXT;
ALTER TABLE sensor_data ADD COLUMN IF NOT EXISTS temperature_alarm INTEGER;
ALTER TABLE sensor_data ADD COLUMN IF NOT EXISTS distance_alarm INTEGER;
ALTER TABLE sensor_data ADD COLUMN IF NOT EXISTS ts DATETIME DEFAULT CURRENT_TIMESTAMP;

COMMIT;
PRAGMA foreign_keys = ON;

-- Create index for efficient retrieval by serial number and timestamp.
CREATE INDEX IF NOT EXISTS idx_sensor_sn_ts ON sensor_data (sn, ts);

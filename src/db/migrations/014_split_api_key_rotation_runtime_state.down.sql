-- Rollback 014: Restore telemetry columns to api_key_rotation and drop runtime state table.

-- 1. Re-add telemetry columns to api_key_rotation.
ALTER TABLE api_key_rotation ADD COLUMN IF NOT EXISTS usage_count BIGINT DEFAULT 0;
ALTER TABLE api_key_rotation ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0;
ALTER TABLE api_key_rotation ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;
ALTER TABLE api_key_rotation ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMP;
ALTER TABLE api_key_rotation ADD COLUMN IF NOT EXISTS last_error_type TEXT;
ALTER TABLE api_key_rotation ADD COLUMN IF NOT EXISTS last_error_message TEXT;

-- 2. Backfill from runtime state table back into api_key_rotation.
UPDATE api_key_rotation akr
SET usage_count      = rs.usage_count,
    error_count      = rs.error_count,
    last_used_at     = rs.last_used_at,
    last_error_at    = rs.last_error_at,
    last_error_type  = rs.last_error_type,
    last_error_message = rs.last_error_message
FROM api_key_rotation_runtime_state rs
WHERE akr.rotation_key_id = rs.rotation_key_id;

-- 3. Drop the runtime state table (trigger drops automatically with the table).
DROP TABLE IF EXISTS api_key_rotation_runtime_state;

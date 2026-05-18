-- Migration 014: Split runtime telemetry out of api_key_rotation into api_key_rotation_runtime_state.
--
-- Motivation: api_key_rotation stores encrypted credentials alongside high-frequency telemetry
-- (usage_count, error_count, cooldown timestamps). Wiping telemetry to recover from a transient
-- outage required UPDATE-ing the same row that holds the encrypted key — a footgun.
-- After this migration:
--   api_key_rotation         — config/security: api_key, key_version, is_main_key_pointer, is_enabled
--   api_key_rotation_runtime_state — telemetry: usage_count, error_count, last_used_at, last_error_*
--
-- Key selection behavior is unchanged; queries JOIN both tables for round-robin sort and cooldown.

-- 1. Create the runtime state table with PK/FK to api_key_rotation.
CREATE TABLE IF NOT EXISTS api_key_rotation_runtime_state (
  rotation_key_id  INT PRIMARY KEY,
  usage_count      BIGINT NOT NULL DEFAULT 0,      -- Round-robin sort key
  error_count      INTEGER NOT NULL DEFAULT 0,     -- Consecutive errors since last success
  last_used_at     TIMESTAMP,                       -- Last successful API call
  last_error_at    TIMESTAMP,                       -- Timestamp of most recent error (for cooldown)
  last_error_type  TEXT,                            -- 'rate_limit' (60s) or 'api_error' (5min)
  last_error_message TEXT,                          -- Human-readable error message (truncated to 500)
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rotation_key_id) REFERENCES api_key_rotation(rotation_key_id) ON DELETE CASCADE
);

-- 2. updated_at trigger for runtime state table.
DROP TRIGGER IF EXISTS update_api_key_rotation_runtime_state_timestamp ON api_key_rotation_runtime_state;
CREATE TRIGGER update_api_key_rotation_runtime_state_timestamp
BEFORE UPDATE ON api_key_rotation_runtime_state
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- 3. Backfill all existing keys — every api_key_rotation row gets a runtime state row.
INSERT INTO api_key_rotation_runtime_state (
  rotation_key_id, usage_count, error_count,
  last_used_at, last_error_at, last_error_type, last_error_message, updated_at
)
SELECT
  rotation_key_id,
  COALESCE(usage_count, 0),
  COALESCE(error_count, 0),
  last_used_at,
  last_error_at,
  last_error_type,
  last_error_message,
  COALESCE(updated_at, CURRENT_TIMESTAMP)
FROM api_key_rotation
ON CONFLICT (rotation_key_id) DO NOTHING;

-- 4. Drop telemetry columns from api_key_rotation (config table stays lean).
ALTER TABLE api_key_rotation DROP COLUMN IF EXISTS usage_count;
ALTER TABLE api_key_rotation DROP COLUMN IF EXISTS error_count;
ALTER TABLE api_key_rotation DROP COLUMN IF EXISTS last_used_at;
ALTER TABLE api_key_rotation DROP COLUMN IF EXISTS last_error_at;
ALTER TABLE api_key_rotation DROP COLUMN IF EXISTS last_error_type;
ALTER TABLE api_key_rotation DROP COLUMN IF EXISTS last_error_message;

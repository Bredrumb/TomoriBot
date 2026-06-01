-- Rollback for migration 015: restore autoch_counter / autoch_next_target to tomoris.
--
-- Steps (inverted):
--   1. Re-add the counter columns to tomoris with safe defaults.
--   2. Backfill from persona_autoch_runtime_state (restores non-zero counters).
--   3. Drop persona_autoch_runtime_state.

-- 1. Re-add counter columns to tomoris.
ALTER TABLE tomoris ADD COLUMN IF NOT EXISTS autoch_counter     INT NOT NULL DEFAULT 0;
ALTER TABLE tomoris ADD COLUMN IF NOT EXISTS autoch_next_target INT NOT NULL DEFAULT 0;

-- 2. Restore counter values from the runtime state table.
UPDATE tomoris t
SET
  autoch_counter     = r.autoch_counter,
  autoch_next_target = r.autoch_next_target
FROM persona_autoch_runtime_state r
WHERE t.tomori_id = r.persona_id;

-- 3. Drop the runtime state table (and its trigger, which cascades with the table).
DROP TABLE IF EXISTS persona_autoch_runtime_state;

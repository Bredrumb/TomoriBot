-- Migration 015: Split autochat runtime counters out of tomoris into persona_autoch_runtime_state.
--
-- Motivation: tomoris stores persona identity alongside high-frequency autochat counters
-- (autoch_counter, autoch_next_target). These counters are mutated on every message
-- processed by the autochat tick — a transient-reset operation that does not belong in
-- the same row as persona identity, name, and system prompt.
-- After this migration:
--   tomoris                       — identity: nickname, system prompt, voice, nai params, etc.
--   persona_autoch_runtime_state  — hot-path counters: autoch_counter, autoch_next_target
--
-- FK column is named persona_id (not tomori_id) — forward-compatible with the #16.8 rename.
-- Pattern matches server_auto_trigger_persona_overrides.persona_id → tomoris(tomori_id).
-- Autochat tick behavior is unchanged; reads/writes target the new table via UPSERT.

-- 1. Create the runtime state table with PK/FK to tomoris.
CREATE TABLE IF NOT EXISTS persona_autoch_runtime_state (
  persona_id         INT PRIMARY KEY,
  autoch_counter     INT NOT NULL DEFAULT 0,   -- Messages seen since cycle start
  autoch_next_target INT NOT NULL DEFAULT 0,   -- Target message count for next autochat trigger (0 = always-reply)
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (persona_id) REFERENCES tomoris(tomori_id) ON DELETE CASCADE
);

-- 2. updated_at trigger for the runtime state table.
DROP TRIGGER IF EXISTS update_persona_autoch_runtime_state_timestamp ON persona_autoch_runtime_state;
CREATE TRIGGER update_persona_autoch_runtime_state_timestamp
BEFORE UPDATE ON persona_autoch_runtime_state
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- 3. Backfill all existing personas — every tomoris row gets a runtime state row.
INSERT INTO persona_autoch_runtime_state (persona_id, autoch_counter, autoch_next_target)
SELECT
  tomori_id,
  COALESCE(autoch_counter, 0),
  COALESCE(autoch_next_target, 0)
FROM tomoris
ON CONFLICT (persona_id) DO UPDATE SET
  autoch_counter = EXCLUDED.autoch_counter,
  autoch_next_target = EXCLUDED.autoch_next_target;

-- 4. Drop the counter columns from tomoris (identity table stays lean).
ALTER TABLE tomoris DROP COLUMN IF EXISTS autoch_counter;
ALTER TABLE tomoris DROP COLUMN IF EXISTS autoch_next_target;

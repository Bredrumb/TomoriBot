-- Migration 015: Split autochat runtime counters out of personas into persona_autoch_runtime_state.
--
-- Motivation: personas stores persona identity alongside high-frequency autochat counters
-- (autoch_counter, autoch_next_target). These counters are mutated on every message
-- processed by the autochat tick — a transient-reset operation that does not belong in
-- the same row as persona identity, name, and system prompt.
-- After this migration:
--   personas                      — identity: nickname, system prompt, voice, nai params, etc.
--   persona_autoch_runtime_state  — hot-path counters: autoch_counter, autoch_next_target
--
-- FK column is named persona_id.
-- Pattern matches server_auto_trigger_persona_overrides.persona_id → personas(persona_id).
-- Autochat tick behavior is unchanged; reads/writes target the new table via UPSERT.

-- 1. Create the runtime state table with PK/FK to personas.
CREATE TABLE IF NOT EXISTS persona_autoch_runtime_state (
  persona_id         INT PRIMARY KEY,
  autoch_counter     INT NOT NULL DEFAULT 0,   -- Messages seen since cycle start
  autoch_next_target INT NOT NULL DEFAULT 0,   -- Target message count for next autochat trigger (0 = always-reply)
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (persona_id) REFERENCES personas(persona_id) ON DELETE CASCADE
);

-- 2. updated_at trigger for the runtime state table.
DROP TRIGGER IF EXISTS update_persona_autoch_runtime_state_timestamp ON persona_autoch_runtime_state;
CREATE TRIGGER update_persona_autoch_runtime_state_timestamp
BEFORE UPDATE ON persona_autoch_runtime_state
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- 3. Backfill all existing personas. On already-normalized fresh schemas, the
-- legacy counter columns are absent, so seed zero-default runtime rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'personas' AND column_name = 'autoch_counter'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'personas' AND column_name = 'autoch_next_target'
  ) THEN
    INSERT INTO persona_autoch_runtime_state (persona_id, autoch_counter, autoch_next_target)
    SELECT
      persona_id,
      COALESCE(autoch_counter, 0),
      COALESCE(autoch_next_target, 0)
    FROM personas
    ON CONFLICT (persona_id) DO UPDATE SET
      autoch_counter = EXCLUDED.autoch_counter,
      autoch_next_target = EXCLUDED.autoch_next_target;
  ELSE
    INSERT INTO persona_autoch_runtime_state (persona_id, autoch_counter, autoch_next_target)
    SELECT persona_id, 0, 0
    FROM personas
    ON CONFLICT (persona_id) DO NOTHING;
  END IF;
END $$;

-- 4. Drop the counter columns from personas (identity table stays lean).
ALTER TABLE personas DROP COLUMN IF EXISTS autoch_counter;
ALTER TABLE personas DROP COLUMN IF EXISTS autoch_next_target;

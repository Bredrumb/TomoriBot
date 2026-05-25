-- Adds official persona preset lineage metadata and per-persona sync baselines.
-- Seed-time sync uses these baselines to update untouched preset content while
-- preserving local additions, edits, and removals.

SELECT add_column_if_not_exists('persona_presets', 'preset_lineage_id', 'BIGINT');

CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_presets_lineage_language_unique
  ON persona_presets(preset_lineage_id, preset_language)
  WHERE preset_lineage_id IS NOT NULL;

CREATE OR REPLACE FUNCTION persona_preset_array_starts_with(
  candidate TEXT[],
  prefix TEXT[]
) RETURNS BOOLEAN AS $$
DECLARE
  candidate_array TEXT[] := COALESCE(candidate, ARRAY[]::TEXT[]);
  prefix_array TEXT[] := COALESCE(prefix, ARRAY[]::TEXT[]);
  candidate_len INT := COALESCE(array_length(candidate_array, 1), 0);
  prefix_len INT := COALESCE(array_length(prefix_array, 1), 0);
BEGIN
  IF prefix_len = 0 THEN
    RETURN true;
  END IF;

  IF candidate_len < prefix_len THEN
    RETURN false;
  END IF;

  RETURN candidate_array[1:prefix_len] = prefix_array;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION persona_preset_rebase_text_array(
  current_array TEXT[],
  old_base_array TEXT[],
  new_base_array TEXT[]
) RETURNS TEXT[] AS $$
DECLARE
  current_values TEXT[] := COALESCE(current_array, ARRAY[]::TEXT[]);
  old_base_values TEXT[] := COALESCE(old_base_array, ARRAY[]::TEXT[]);
  new_base_values TEXT[] := COALESCE(new_base_array, ARRAY[]::TEXT[]);
  current_len INT := COALESCE(array_length(current_values, 1), 0);
  old_base_len INT := COALESCE(array_length(old_base_values, 1), 0);
  local_tail TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NOT persona_preset_array_starts_with(current_values, old_base_values) THEN
    RETURN current_values;
  END IF;

  IF current_len > old_base_len THEN
    local_tail := current_values[(old_base_len + 1):current_len];
  END IF;

  RETURN new_base_values || local_tail;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION persona_preset_snapshot_text_array(
  snapshot JSONB,
  snapshot_key TEXT
) RETURNS TEXT[] AS $$
BEGIN
  IF snapshot IS NULL OR jsonb_typeof(snapshot -> snapshot_key) <> 'array' THEN
    RETURN ARRAY[]::TEXT[];
  END IF;

  RETURN ARRAY(SELECT jsonb_array_elements_text(snapshot -> snapshot_key));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE TABLE IF NOT EXISTS persona_preset_sync_state (
  persona_id INT PRIMARY KEY,
  preset_lineage_id BIGINT NOT NULL,
  preset_language TEXT NOT NULL DEFAULT 'en-US',
  sync_mode TEXT NOT NULL DEFAULT 'auto',
  base_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (persona_id) REFERENCES personas(persona_id) ON DELETE CASCADE,
  CHECK (sync_mode IN ('auto', 'manual', 'forked'))
);

CREATE INDEX IF NOT EXISTS idx_persona_preset_sync_state_lineage
  ON persona_preset_sync_state(preset_lineage_id, preset_language);

DROP TRIGGER IF EXISTS update_persona_preset_sync_state_timestamp ON persona_preset_sync_state;
CREATE TRIGGER update_persona_preset_sync_state_timestamp
BEFORE UPDATE ON persona_preset_sync_state
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

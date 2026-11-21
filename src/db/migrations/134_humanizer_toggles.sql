-- Migration 134: Split the humanizer degree into one toggle per delivery behavior.
--
-- Degrees 0-3 were cumulative, so each degree maps to the toggles it already implied and every server
-- and persona keeps its current delivery. A persona override is all five columns or none: NULL across
-- the set inherits the server, and the CHECK keeps a row from being half-set.

ALTER TABLE server_chat_configs
  ADD COLUMN IF NOT EXISTS humanizer_streaming_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS humanizer_pacing_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS humanizer_sentence_split_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS humanizer_lowercase_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS humanizer_punctuation_split_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE persona_configs
  ADD COLUMN IF NOT EXISTS humanizer_streaming_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS humanizer_pacing_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS humanizer_sentence_split_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS humanizer_lowercase_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS humanizer_punctuation_split_enabled BOOLEAN;

-- One statement because the runner applies statements outside a transaction, so a retry after a
-- failed boot finds humanizer_degree either untouched or already dropped.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'server_chat_configs' AND column_name = 'humanizer_degree'
  ) THEN
    -- The new columns already default to degree 1, so only other degrees need a write.
    UPDATE server_chat_configs SET
      humanizer_streaming_enabled = humanizer_degree >= 1,
      humanizer_pacing_enabled = humanizer_degree >= 2,
      humanizer_sentence_split_enabled = humanizer_degree >= 3,
      humanizer_lowercase_enabled = humanizer_degree >= 3,
      humanizer_punctuation_split_enabled = humanizer_degree >= 3
    WHERE humanizer_degree <> 1;
    ALTER TABLE server_chat_configs DROP COLUMN humanizer_degree;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'persona_configs' AND column_name = 'humanizer_degree'
  ) THEN
    UPDATE persona_configs SET
      humanizer_streaming_enabled = humanizer_degree >= 1,
      humanizer_pacing_enabled = humanizer_degree >= 2,
      humanizer_sentence_split_enabled = humanizer_degree >= 3,
      humanizer_lowercase_enabled = humanizer_degree >= 3,
      humanizer_punctuation_split_enabled = humanizer_degree >= 3
    WHERE humanizer_degree IS NOT NULL;
    ALTER TABLE persona_configs DROP COLUMN humanizer_degree;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'persona_configs_humanizer_override_complete') THEN
    ALTER TABLE persona_configs ADD CONSTRAINT persona_configs_humanizer_override_complete CHECK (
      num_nulls(
        humanizer_streaming_enabled,
        humanizer_pacing_enabled,
        humanizer_sentence_split_enabled,
        humanizer_lowercase_enabled,
        humanizer_punctuation_split_enabled
      ) IN (0, 5)
    );
  END IF;
END;
$$;

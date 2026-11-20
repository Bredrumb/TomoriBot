-- Migration 134 down: Restore the single humanizer degree.
--
-- A toggle set that matches no degree becomes the highest degree whose behaviors are all on, so a
-- custom combination loses every toggle above that degree.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'server_chat_configs' AND column_name = 'humanizer_streaming_enabled'
  ) THEN
    ALTER TABLE server_chat_configs ADD COLUMN IF NOT EXISTS humanizer_degree INT NOT NULL DEFAULT 1;
    UPDATE server_chat_configs SET humanizer_degree = CASE
      WHEN NOT humanizer_streaming_enabled THEN 0
      WHEN NOT humanizer_pacing_enabled THEN 1
      WHEN NOT (
        humanizer_sentence_split_enabled AND humanizer_lowercase_enabled AND humanizer_punctuation_split_enabled
      ) THEN 2
      ELSE 3
    END;
    ALTER TABLE server_chat_configs
      DROP COLUMN humanizer_streaming_enabled,
      DROP COLUMN humanizer_pacing_enabled,
      DROP COLUMN humanizer_sentence_split_enabled,
      DROP COLUMN humanizer_lowercase_enabled,
      DROP COLUMN humanizer_punctuation_split_enabled;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'persona_configs' AND column_name = 'humanizer_streaming_enabled'
  ) THEN
    ALTER TABLE persona_configs
      ADD COLUMN IF NOT EXISTS humanizer_degree INT CHECK (humanizer_degree BETWEEN 0 AND 3);
    UPDATE persona_configs SET humanizer_degree = CASE
      WHEN NOT humanizer_streaming_enabled THEN 0
      WHEN NOT humanizer_pacing_enabled THEN 1
      WHEN NOT (
        humanizer_sentence_split_enabled AND humanizer_lowercase_enabled AND humanizer_punctuation_split_enabled
      ) THEN 2
      ELSE 3
    END
    WHERE humanizer_streaming_enabled IS NOT NULL;
    ALTER TABLE persona_configs DROP CONSTRAINT IF EXISTS persona_configs_humanizer_override_complete;
    ALTER TABLE persona_configs
      DROP COLUMN humanizer_streaming_enabled,
      DROP COLUMN humanizer_pacing_enabled,
      DROP COLUMN humanizer_sentence_split_enabled,
      DROP COLUMN humanizer_lowercase_enabled,
      DROP COLUMN humanizer_punctuation_split_enabled;
  END IF;
END;
$$;

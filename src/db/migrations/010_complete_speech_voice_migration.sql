-- Migration 010: Complete elevenlabs_* → speech_* voice migration (Phase 6 Step #14.2)
--
-- 1. Backfill persona_voice_configs rows that still have only elevenlabs_* values.
-- 2. Backfill tomoris rows that still have only elevenlabs_* values (guard: column may
--    not exist on fresh DBs created after schema.sql removed the add_column_if_not_exists calls).
-- 3. Drop elevenlabs_voice_id and elevenlabs_voice_name from persona_voice_configs.
-- 4. Drop elevenlabs_voice_id and elevenlabs_voice_name from tomoris.

-- 1. persona_voice_configs backfill (columns are present; created by migration 003).
UPDATE persona_voice_configs
SET
  speech_voice_id = CASE
    WHEN speech_voice_id IS NULL OR TRIM(speech_voice_id) = '' THEN elevenlabs_voice_id
    ELSE speech_voice_id
  END,
  speech_voice_name = CASE
    WHEN speech_voice_name IS NULL OR TRIM(speech_voice_name) = '' THEN elevenlabs_voice_name
    ELSE speech_voice_name
  END
WHERE (
    elevenlabs_voice_id IS NOT NULL
    AND (speech_voice_id IS NULL OR TRIM(speech_voice_id) = '')
  )
  OR (
    elevenlabs_voice_name IS NOT NULL
    AND (speech_voice_name IS NULL OR TRIM(speech_voice_name) = '')
  );

-- 2. tomoris backfill — guarded because fresh DBs no longer have these columns in schema.sql.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tomoris' AND column_name = 'elevenlabs_voice_id'
  ) THEN
    UPDATE tomoris
    SET
      speech_voice_id = CASE
        WHEN speech_voice_id IS NULL OR TRIM(speech_voice_id) = '' THEN elevenlabs_voice_id
        ELSE speech_voice_id
      END,
      speech_voice_name = CASE
        WHEN speech_voice_name IS NULL OR TRIM(speech_voice_name) = '' THEN elevenlabs_voice_name
        ELSE speech_voice_name
      END
    WHERE (
        elevenlabs_voice_id IS NOT NULL
        AND (speech_voice_id IS NULL OR TRIM(speech_voice_id) = '')
      )
      OR (
        elevenlabs_voice_name IS NOT NULL
        AND (speech_voice_name IS NULL OR TRIM(speech_voice_name) = '')
      );
  END IF;
END $$;

-- 3. Drop deprecated columns from persona_voice_configs.
ALTER TABLE persona_voice_configs
  DROP COLUMN IF EXISTS elevenlabs_voice_id,
  DROP COLUMN IF EXISTS elevenlabs_voice_name;

-- 4. Drop deprecated columns from tomoris.
ALTER TABLE tomoris
  DROP COLUMN IF EXISTS elevenlabs_voice_id,
  DROP COLUMN IF EXISTS elevenlabs_voice_name;

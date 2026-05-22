-- Migration 010: Complete elevenlabs_* → speech_* voice migration (Phase 6 Step #14.2)
--
-- 1. Backfill persona_voice_configs rows that still have only elevenlabs_* values.
-- 2. Backfill personas rows that still have only elevenlabs_* values (guard: column may
--    not exist on fresh DBs created after schema.sql removed the add_column_if_not_exists calls).
-- 3. Drop elevenlabs_voice_id and elevenlabs_voice_name from persona_voice_configs.
-- 4. Drop elevenlabs_voice_id and elevenlabs_voice_name from personas.

-- 1. persona_voice_configs backfill. Fresh schemas created from the latest
-- schema.sql no longer have the elevenlabs_* columns, so guard replay.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'persona_voice_configs'
      AND column_name = 'elevenlabs_voice_id'
  ) THEN
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
  END IF;
END $$;

-- 2. personas backfill — guarded because fresh DBs no longer have these columns in schema.sql.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'personas'
      AND column_name = 'elevenlabs_voice_id'
  ) THEN
    UPDATE personas
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

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'persona_voice_configs'
        AND column_name = 'elevenlabs_voice_id'
    ) THEN
      UPDATE persona_voice_configs pvc
      SET
        speech_voice_id = CASE
          WHEN pvc.speech_voice_id IS NULL OR TRIM(pvc.speech_voice_id) = '' THEN p.elevenlabs_voice_id
          ELSE pvc.speech_voice_id
        END,
        speech_voice_name = CASE
          WHEN pvc.speech_voice_name IS NULL OR TRIM(pvc.speech_voice_name) = '' THEN p.elevenlabs_voice_name
          ELSE pvc.speech_voice_name
        END
      FROM personas p
      WHERE p.persona_id = pvc.persona_id
        AND (
          (
            p.elevenlabs_voice_id IS NOT NULL
            AND (pvc.speech_voice_id IS NULL OR TRIM(pvc.speech_voice_id) = '')
          )
          OR (
            p.elevenlabs_voice_name IS NOT NULL
            AND (pvc.speech_voice_name IS NULL OR TRIM(pvc.speech_voice_name) = '')
          )
        );
    END IF;
  END IF;
END $$;

-- 3. Drop deprecated columns from persona_voice_configs.
ALTER TABLE persona_voice_configs
  DROP COLUMN IF EXISTS elevenlabs_voice_id,
  DROP COLUMN IF EXISTS elevenlabs_voice_name;

-- 4. Drop deprecated columns from personas.
ALTER TABLE personas
  DROP COLUMN IF EXISTS elevenlabs_voice_id,
  DROP COLUMN IF EXISTS elevenlabs_voice_name;

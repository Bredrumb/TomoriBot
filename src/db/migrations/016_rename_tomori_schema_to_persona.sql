-- Migration 016: Rename internal DB schema from tomori_* to persona_*.
--
-- This is the DB portion of Phase 6 Step #16.8. User-facing Tomori branding
-- remains unchanged; this migration only renames internal tables, columns,
-- constraints, triggers, sequences, and indexes.

DO $$
DECLARE
  item RECORD;
BEGIN
  -- Table renames.
  FOR item IN
    SELECT * FROM (VALUES
      ('tomoris', 'personas'),
      ('tomori_presets', 'persona_presets')
    ) AS v(old_name, new_name)
  LOOP
    IF to_regclass(format('public.%I', item.old_name)) IS NOT NULL
      AND to_regclass(format('public.%I', item.new_name)) IS NULL
    THEN
      EXECUTE format('ALTER TABLE %I RENAME TO %I', item.old_name, item.new_name);
    END IF;
  END LOOP;

  -- Column renames.
  FOR item IN
    SELECT * FROM (VALUES
      ('personas', 'tomori_id', 'persona_id'),
      ('personas', 'tomori_nickname', 'persona_nickname'),
      ('persona_configs', 'tomori_id', 'persona_id'),
      ('persona_context_note_configs', 'tomori_id', 'persona_id'),
      ('persona_voice_configs', 'tomori_id', 'persona_id'),
      ('persona_imagegen_configs', 'tomori_id', 'persona_id'),
      ('persona_textgen_configs', 'tomori_id', 'persona_id'),
      ('server_memories', 'tomori_id', 'persona_id'),
      ('documents', 'tomori_id', 'persona_id'),
      ('channel_persona_whitelist', 'tomori_id', 'persona_id'),
      ('personal_spotlights', 'auto_trigger_tomori_id', 'auto_trigger_persona_id'),
      ('personal_spotlight_personas', 'tomori_id', 'persona_id'),
      ('error_logs', 'tomori_id', 'persona_id'),
      ('random_triggers', 'tomori_id', 'persona_id'),
      ('persona_presets', 'tomori_preset_id', 'persona_preset_id'),
      ('persona_presets', 'tomori_preset_name', 'persona_preset_name'),
      ('persona_presets', 'tomori_preset_desc', 'persona_preset_desc')
    ) AS v(table_name, old_name, new_name)
  LOOP
    IF to_regclass(format('public.%I', item.table_name)) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = item.table_name
          AND column_name = item.old_name
      )
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = item.table_name
          AND column_name = item.new_name
      )
    THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', item.table_name, item.old_name, item.new_name);
    END IF;
  END LOOP;

  -- Constraint renames. Renamed FK columns keep their constraints, but PostgreSQL
  -- does not rename the constraint identifiers automatically.
  FOR item IN
    SELECT * FROM (VALUES
      ('personas', 'tomoris_pkey', 'personas_pkey'),
      ('personas', 'tomoris_server_id_fkey', 'personas_server_id_fkey'),
      ('personas', 'tomoris_speech_voice_sample_id_fkey', 'personas_speech_voice_sample_id_fkey'),
      ('persona_configs', 'persona_configs_tomori_id_fkey', 'persona_configs_persona_id_fkey'),
      ('persona_context_note_configs', 'persona_context_note_configs_tomori_id_fkey', 'persona_context_note_configs_persona_id_fkey'),
      ('persona_voice_configs', 'persona_voice_configs_tomori_id_fkey', 'persona_voice_configs_persona_id_fkey'),
      ('persona_imagegen_configs', 'persona_imagegen_configs_tomori_id_fkey', 'persona_imagegen_configs_persona_id_fkey'),
      ('persona_textgen_configs', 'persona_textgen_configs_tomori_id_fkey', 'persona_textgen_configs_persona_id_fkey'),
      ('server_memories', 'server_memories_tomori_id_fkey', 'server_memories_persona_id_fkey'),
      ('documents', 'documents_tomori_id_fkey', 'documents_persona_id_fkey'),
      ('channel_persona_whitelist', 'channel_persona_whitelist_tomori_id_fkey', 'channel_persona_whitelist_persona_id_fkey'),
      ('personal_spotlights', 'personal_spotlights_auto_trigger_tomori_id_fkey', 'personal_spotlights_auto_trigger_persona_id_fkey'),
      ('personal_spotlight_personas', 'personal_spotlight_personas_tomori_id_fkey', 'personal_spotlight_personas_persona_id_fkey'),
      ('error_logs', 'error_logs_tomori_id_fkey', 'error_logs_persona_id_fkey'),
      ('random_triggers', 'random_triggers_tomori_id_fkey', 'random_triggers_persona_id_fkey'),
      ('persona_presets', 'tomori_presets_pkey', 'persona_presets_pkey'),
      ('persona_presets', 'tomori_presets_tomori_preset_name_key', 'persona_presets_persona_preset_name_key')
    ) AS v(table_name, old_name, new_name)
  LOOP
    IF to_regclass(format('public.%I', item.table_name)) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = to_regclass(format('public.%I', item.table_name))
          AND conname = item.old_name
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = to_regclass(format('public.%I', item.table_name))
          AND conname = item.new_name
      )
    THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', item.table_name, item.old_name, item.new_name);
    END IF;
  END LOOP;

  -- Index renames where old identifiers encoded tomoris/tomori_id.
  FOR item IN
    SELECT * FROM (VALUES
      ('idx_tomoris_server_is_alter', 'idx_personas_server_is_alter'),
      ('idx_tomoris_persona_lineage_id', 'idx_personas_persona_lineage_id'),
      ('idx_tomoris_server_nickname_ci_unique', 'idx_personas_server_nickname_ci_unique'),
      ('idx_server_memories_tomori_id', 'idx_server_memories_persona_id'),
      ('idx_server_memories_tomori_created_at', 'idx_server_memories_persona_created_at'),
      ('idx_documents_server_tomori', 'idx_documents_server_persona')
    ) AS v(old_name, new_name)
  LOOP
    IF to_regclass(format('public.%I', item.old_name)) IS NOT NULL
      AND to_regclass(format('public.%I', item.new_name)) IS NULL
    THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', item.old_name, item.new_name);
    END IF;
  END LOOP;

  -- Sequence renames for SERIAL columns.
  FOR item IN
    SELECT * FROM (VALUES
      ('tomoris_tomori_id_seq', 'personas_persona_id_seq'),
      ('tomori_presets_tomori_preset_id_seq', 'persona_presets_persona_preset_id_seq')
    ) AS v(old_name, new_name)
  LOOP
    IF to_regclass(format('public.%I', item.old_name)) IS NOT NULL
      AND to_regclass(format('public.%I', item.new_name)) IS NULL
    THEN
      EXECUTE format('ALTER SEQUENCE %I RENAME TO %I', item.old_name, item.new_name);
    END IF;
  END LOOP;

  -- Trigger rename for persona identity rows.
  IF to_regclass('public.personas') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'public.personas'::regclass
        AND tgname = 'update_tomoris_timestamp'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'public.personas'::regclass
        AND tgname = 'update_personas_timestamp'
    )
  THEN
    ALTER TRIGGER update_tomoris_timestamp ON personas RENAME TO update_personas_timestamp;
  END IF;
END $$;

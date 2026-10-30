-- Migration 125 Rollback: Restore nai_char_ref_url

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['persona_imagegen_configs', 'user_personalization_configs'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = target_table AND column_name = 'char_ref_url'
    ) THEN
      EXECUTE format('ALTER TABLE %I RENAME COLUMN char_ref_url TO nai_char_ref_url', target_table);
    END IF;
  END LOOP;
END $$;

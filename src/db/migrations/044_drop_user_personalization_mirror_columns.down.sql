-- 044_drop_user_personalization_mirror_columns.down.sql
--
-- Recreate the former users-table mirror columns and backfill them from the
-- split table so older code can read the values again after rollback.

ALTER TABLE users ADD COLUMN IF NOT EXISTS shortterm_cache_crossserver_opt_in BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS physical_appearance_tags TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS nai_char_ref_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS impersonation_prompt TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_dtm TEXT DEFAULT 'follow';

DO $$
BEGIN
  IF to_regclass('public.user_personalization_configs') IS NOT NULL THEN
    UPDATE users u
    SET
      shortterm_cache_crossserver_opt_in = COALESCE(upc.shortterm_cache_crossserver_opt_in, false),
      physical_appearance_tags = COALESCE(upc.physical_appearance_tags, ARRAY[]::TEXT[]),
      nai_char_ref_url = upc.nai_char_ref_url,
      impersonation_prompt = upc.impersonation_prompt,
      personal_dtm = COALESCE(upc.personal_dtm, 'follow')
    FROM user_personalization_configs upc
    WHERE upc.user_id = u.user_id;
  END IF;
END $$;

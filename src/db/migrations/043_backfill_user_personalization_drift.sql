-- 043_backfill_user_personalization_drift.sql
--
-- Re-run migration 004's user personalization backfill before cutting reads over
-- to user_personalization_configs. Existing split rows may have drifted because
-- runtime writes still targeted users; users is the live source of truth here.

DO $$
BEGIN
  IF to_regclass('public.user_personalization_configs') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'shortterm_cache_crossserver_opt_in'
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'physical_appearance_tags'
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'nai_char_ref_url'
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'impersonation_prompt'
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'personal_dtm'
    )
  THEN
    INSERT INTO user_personalization_configs (
      user_id,
      shortterm_cache_crossserver_opt_in,
      physical_appearance_tags,
      nai_char_ref_url,
      impersonation_prompt,
      personal_dtm
    )
    SELECT
      user_id,
      COALESCE(shortterm_cache_crossserver_opt_in, false),
      COALESCE(physical_appearance_tags, ARRAY[]::TEXT[]),
      nai_char_ref_url,
      impersonation_prompt,
      COALESCE(personal_dtm, 'follow')
    FROM users
    ON CONFLICT (user_id) DO UPDATE SET
      shortterm_cache_crossserver_opt_in = EXCLUDED.shortterm_cache_crossserver_opt_in,
      physical_appearance_tags = EXCLUDED.physical_appearance_tags,
      nai_char_ref_url = EXCLUDED.nai_char_ref_url,
      impersonation_prompt = EXCLUDED.impersonation_prompt,
      personal_dtm = EXCLUDED.personal_dtm,
      updated_at = NOW();
  END IF;
END $$;

-- 004_user_personalization_configs.sql
--
-- Stage A (Expand): creates user_personalization_configs to extract user-scoped
-- personalization fields from the users table. Source columns remain in users;
-- Stage B (a future session after soak) drops them from users.
--
-- After Stage B, users will hold only pure identity columns:
--   user_disc_id, user_nickname, language_pref, privacy_level, registration_locale

CREATE TABLE IF NOT EXISTS user_personalization_configs (
  user_id                          INT  PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  shortterm_cache_crossserver_opt_in BOOLEAN NOT NULL DEFAULT false,
  nai_char_tags                    TEXT[]  NOT NULL DEFAULT '{}',
  nai_char_ref_url                 TEXT,
  impersonation_prompt             TEXT,
  -- personal_dtm: tri-state deliberate trigger mode ('off', 'follow', 'on')
  personal_dtm                     TEXT    NOT NULL DEFAULT 'follow',
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_user_personalization_configs_timestamp ON user_personalization_configs;
CREATE TRIGGER update_user_personalization_configs_timestamp
  BEFORE UPDATE ON user_personalization_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Backfill personalization fields from users. Migration 021 (decouple_image_tags)
-- renames nai_char_tags -> physical_appearance_tags. On a schema.sql-first legacy
-- boot this table was created by schema.sql in its post-021 shape, so we write
-- physical_appearance_tags; the source users.nai_char_tags column still exists at
-- this point (schema.sql only adds the new column, 021 drops the old one later).
-- Detecting the post-021 target avoids `column "nai_char_tags" of relation
-- "user_personalization_configs" does not exist` (42703).
DO $img$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_personalization_configs'
      AND column_name = 'physical_appearance_tags'
  ) THEN
    INSERT INTO user_personalization_configs (
      user_id, shortterm_cache_crossserver_opt_in, physical_appearance_tags, nai_char_ref_url,
      impersonation_prompt, personal_dtm
    )
    SELECT
      user_id,
      COALESCE(shortterm_cache_crossserver_opt_in, false),
      COALESCE(nai_char_tags, '{}'),
      nai_char_ref_url,
      impersonation_prompt,
      COALESCE(personal_dtm, 'follow')
    FROM users
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    INSERT INTO user_personalization_configs (
      user_id, shortterm_cache_crossserver_opt_in, nai_char_tags, nai_char_ref_url,
      impersonation_prompt, personal_dtm
    )
    SELECT
      user_id,
      COALESCE(shortterm_cache_crossserver_opt_in, false),
      COALESCE(nai_char_tags, '{}'),
      nai_char_ref_url,
      impersonation_prompt,
      COALESCE(personal_dtm, 'follow')
    FROM users
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $img$;

-- 044_drop_user_personalization_mirror_columns.sql
--
-- Contract phase for user_personalization_configs. The split table is now the
-- runtime source for these user-scoped personalization fields.

ALTER TABLE users DROP COLUMN IF EXISTS shortterm_cache_crossserver_opt_in;
ALTER TABLE users DROP COLUMN IF EXISTS physical_appearance_tags;
ALTER TABLE users DROP COLUMN IF EXISTS nai_char_ref_url;
ALTER TABLE users DROP COLUMN IF EXISTS impersonation_prompt;
ALTER TABLE users DROP COLUMN IF EXISTS personal_dtm;

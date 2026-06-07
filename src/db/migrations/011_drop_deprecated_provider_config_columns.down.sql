-- Rollback 011: Re-add deprecated columns as nullable with no default data.
-- Data that was in these columns before the migration is not restored;
-- this rollback only makes the schema compatible again for the previous code version.

-- Restore saved_provider_configs deprecated columns
ALTER TABLE saved_provider_configs ADD COLUMN IF NOT EXISTS custom_endpoint_url TEXT;
ALTER TABLE saved_provider_configs ADD COLUMN IF NOT EXISTS custom_model_name TEXT;
ALTER TABLE saved_provider_configs ADD COLUMN IF NOT EXISTS custom_num_ctx INT;
ALTER TABLE saved_provider_configs ADD COLUMN IF NOT EXISTS fallback_llm_ids JSONB DEFAULT '[]'::JSONB;
ALTER TABLE saved_provider_configs ADD COLUMN IF NOT EXISTS channel_llm_overrides JSONB DEFAULT '[]'::JSONB;
ALTER TABLE saved_provider_configs ADD COLUMN IF NOT EXISTS persona_llm_overrides JSONB DEFAULT '[]'::JSONB;

-- Restore user_saved_provider_configs deprecated columns
ALTER TABLE user_saved_provider_configs ADD COLUMN IF NOT EXISTS custom_endpoint_url TEXT;
ALTER TABLE user_saved_provider_configs ADD COLUMN IF NOT EXISTS custom_model_name TEXT;
ALTER TABLE user_saved_provider_configs ADD COLUMN IF NOT EXISTS custom_num_ctx INT;
ALTER TABLE user_saved_provider_configs ADD COLUMN IF NOT EXISTS fallback_llm_ids JSONB DEFAULT '[]'::JSONB;

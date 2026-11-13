CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('tomori.credential_activity_update', true) = 'true'
      OR current_setting('tomori.encryption_rotation', true) = 'true' THEN RETURN NEW; END IF;
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

SELECT add_column_if_not_exists('saved_provider_configs', 'credential_created_at', 'TIMESTAMPTZ NOT NULL', 'NOW()');
SELECT add_column_if_not_exists('saved_provider_configs', 'credential_last_attempt_at', 'TIMESTAMPTZ', 'NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'credential_created_at', 'TIMESTAMPTZ NOT NULL', 'NOW()');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'credential_last_attempt_at', 'TIMESTAMPTZ', 'NULL');
SELECT add_column_if_not_exists('api_key_rotation', 'credential_activity_epoch', 'UUID NOT NULL', 'gen_random_uuid()');
SELECT add_column_if_not_exists('api_key_rotation', 'credential_created_at', 'TIMESTAMPTZ NOT NULL', 'NOW()');
SELECT add_column_if_not_exists('api_key_rotation', 'credential_last_attempt_at', 'TIMESTAMPTZ', 'NULL');
SELECT add_column_if_not_exists('opt_api_keys', 'credential_activity_epoch', 'UUID NOT NULL', 'gen_random_uuid()');
SELECT add_column_if_not_exists('opt_api_keys', 'credential_created_at', 'TIMESTAMPTZ NOT NULL', 'NOW()');
SELECT add_column_if_not_exists('opt_api_keys', 'credential_last_attempt_at', 'TIMESTAMPTZ', 'NULL');
SELECT add_column_if_not_exists('server_model_configs', 'credential_activity_epoch', 'UUID NOT NULL', 'gen_random_uuid()');
SELECT add_column_if_not_exists('server_model_configs', 'credential_created_at', 'TIMESTAMPTZ NOT NULL', 'NOW()');
SELECT add_column_if_not_exists('server_model_configs', 'credential_last_attempt_at', 'TIMESTAMPTZ', 'NULL');
CREATE OR REPLACE FUNCTION track_api_key_replacement() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.api_key IS DISTINCT FROM OLD.api_key
      AND current_setting('tomori.encryption_rotation', true) IS DISTINCT FROM 'true' THEN
    IF TG_TABLE_NAME NOT IN ('saved_provider_configs', 'user_saved_provider_configs') THEN
      NEW.credential_activity_epoch = gen_random_uuid();
    END IF;
    NEW.credential_created_at = clock_timestamp();
    NEW.credential_last_attempt_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS track_api_key_replacement ON saved_provider_configs;
CREATE TRIGGER track_api_key_replacement BEFORE UPDATE OF api_key ON saved_provider_configs
  FOR EACH ROW EXECUTE FUNCTION track_api_key_replacement();
DROP TRIGGER IF EXISTS track_api_key_replacement ON user_saved_provider_configs;
CREATE TRIGGER track_api_key_replacement BEFORE UPDATE OF api_key ON user_saved_provider_configs
  FOR EACH ROW EXECUTE FUNCTION track_api_key_replacement();
DROP TRIGGER IF EXISTS track_api_key_replacement ON api_key_rotation;
CREATE TRIGGER track_api_key_replacement BEFORE UPDATE OF api_key ON api_key_rotation
  FOR EACH ROW EXECUTE FUNCTION track_api_key_replacement();
DROP TRIGGER IF EXISTS track_api_key_replacement ON opt_api_keys;
CREATE TRIGGER track_api_key_replacement BEFORE UPDATE OF api_key ON opt_api_keys
  FOR EACH ROW EXECUTE FUNCTION track_api_key_replacement();
DROP TRIGGER IF EXISTS track_api_key_replacement ON server_model_configs;
CREATE TRIGGER track_api_key_replacement BEFORE UPDATE OF api_key ON server_model_configs
  FOR EACH ROW EXECUTE FUNCTION track_api_key_replacement();
CREATE OR REPLACE FUNCTION revise_speech_credentials() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('tomori.encryption_rotation', true) = 'true' THEN RETURN NEW; END IF;
  IF NEW.api_key IS DISTINCT FROM OLD.api_key THEN
    NEW.credential_revision = OLD.credential_revision + 1;
    IF TG_TABLE_NAME = 'saved_provider_configs' THEN
      UPDATE speech_voice_bindings SET pending_delete = true WHERE saved_config_id = OLD.saved_config_id;
      IF NEW.api_key IS NULL THEN
        UPDATE server_speech_configs SET
          speech_design_model_id = CASE WHEN speech_design_model_id IN (SELECT speech_model_id FROM speech_models WHERE provider = OLD.provider) THEN NULL ELSE speech_design_model_id END,
          speech_clone_model_id = CASE WHEN speech_clone_model_id IN (SELECT speech_model_id FROM speech_models WHERE provider = OLD.provider) THEN NULL ELSE speech_clone_model_id END
        WHERE server_id = OLD.server_id;
      END IF;
    ELSE
      UPDATE speech_voice_bindings SET pending_delete = true WHERE user_saved_config_id = OLD.user_saved_config_id;
      IF NEW.api_key IS NULL THEN
        NEW.speech_design_model_id = NULL;
        NEW.speech_clone_model_id = NULL;
        NEW.enabled_capabilities = array_remove(array_remove(NEW.enabled_capabilities, 'speech_design'), 'speech_clone');
        NEW.assigned_capabilities = array_remove(array_remove(NEW.assigned_capabilities, 'speech_design'), 'speech_clone');
      END IF;
    END IF;
  ELSE
    NEW.credential_revision = OLD.credential_revision;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


INSERT INTO saved_provider_configs (
  server_id, provider, api_key, key_version, llm_id, embedding_model_id, diffusion_model_id,
  video_model_id, vision_llm_id, thinking_level, llm_temperature
)
SELECT m.server_id, l.llm_provider, m.api_key, COALESCE(m.key_version, 1), m.llm_id, m.embedding_model_id,
  m.diffusion_model_id, m.video_model_id, m.vision_llm_id, m.thinking_level, m.llm_temperature
FROM server_model_configs m JOIN llms l ON l.llm_id = m.llm_id
WHERE m.api_key IS NOT NULL
ON CONFLICT (server_id, provider) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_retention_saved_provider_configs_api_key ON saved_provider_configs USING hash (api_key) WHERE api_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_retention_user_saved_provider_configs_api_key ON user_saved_provider_configs USING hash (api_key) WHERE api_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_retention_api_key_rotation_api_key ON api_key_rotation USING hash (api_key) WHERE api_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_retention_opt_api_keys_api_key ON opt_api_keys USING hash (api_key) WHERE api_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_retention_server_model_configs_api_key ON server_model_configs USING hash (api_key) WHERE api_key IS NOT NULL;

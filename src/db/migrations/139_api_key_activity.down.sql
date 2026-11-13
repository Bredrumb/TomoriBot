DROP INDEX IF EXISTS idx_retention_saved_provider_configs_api_key;
DROP INDEX IF EXISTS idx_retention_user_saved_provider_configs_api_key;
DROP INDEX IF EXISTS idx_retention_api_key_rotation_api_key;
DROP INDEX IF EXISTS idx_retention_opt_api_keys_api_key;
DROP INDEX IF EXISTS idx_retention_server_model_configs_api_key;
DROP TRIGGER IF EXISTS track_api_key_replacement ON saved_provider_configs;
ALTER TABLE saved_provider_configs DROP COLUMN IF EXISTS credential_created_at, DROP COLUMN IF EXISTS credential_last_attempt_at;
DROP TRIGGER IF EXISTS track_api_key_replacement ON user_saved_provider_configs;
ALTER TABLE user_saved_provider_configs DROP COLUMN IF EXISTS credential_created_at, DROP COLUMN IF EXISTS credential_last_attempt_at;
DROP TRIGGER IF EXISTS track_api_key_replacement ON api_key_rotation;
ALTER TABLE api_key_rotation DROP COLUMN IF EXISTS credential_activity_epoch, DROP COLUMN IF EXISTS credential_created_at, DROP COLUMN IF EXISTS credential_last_attempt_at;
DROP TRIGGER IF EXISTS track_api_key_replacement ON opt_api_keys;
ALTER TABLE opt_api_keys DROP COLUMN IF EXISTS credential_activity_epoch, DROP COLUMN IF EXISTS credential_created_at, DROP COLUMN IF EXISTS credential_last_attempt_at;
DROP TRIGGER IF EXISTS track_api_key_replacement ON server_model_configs;
ALTER TABLE server_model_configs DROP COLUMN IF EXISTS credential_activity_epoch, DROP COLUMN IF EXISTS credential_created_at, DROP COLUMN IF EXISTS credential_last_attempt_at;
DROP FUNCTION IF EXISTS track_api_key_replacement();
CREATE OR REPLACE FUNCTION revise_speech_credentials() RETURNS TRIGGER AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

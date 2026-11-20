-- Migration 133: Hosted transcription models.
--
-- schema.sql creates the same table, columns, and triggers before migrations run, so on an upgraded
-- database every statement here finds its object already in place.

CREATE TABLE IF NOT EXISTS transcription_models (
  transcription_model_id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'openrouter', 'vertex')),
  codename TEXT NOT NULL,
  descriptions JSONB,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_deprecated BOOLEAN NOT NULL DEFAULT false,
  is_scoped_registration BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, codename)
);

SELECT add_column_if_not_exists('scoped_model_registrations', 'transcription_model_id', 'INT REFERENCES transcription_models(transcription_model_id) ON DELETE CASCADE');
SELECT add_column_if_not_exists('server_speech_configs', 'transcription_model_id', 'INT REFERENCES transcription_models(transcription_model_id) ON DELETE SET NULL');
SELECT add_column_if_not_exists('user_saved_provider_configs', 'transcription_model_id', 'INT REFERENCES transcription_models(transcription_model_id) ON DELETE SET NULL');

ALTER TABLE scoped_model_registrations DROP CONSTRAINT IF EXISTS scoped_model_registrations_one_model;
ALTER TABLE scoped_model_registrations ADD CONSTRAINT scoped_model_registrations_one_model
  CHECK (num_nonnulls(llm_id, embedding_model_id, diffusion_model_id, video_model_id, decision_model_id, speech_model_id, transcription_model_id) = 1);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scoped_model_registrations_server_transcription
  ON scoped_model_registrations(server_id, transcription_model_id) WHERE user_id IS NULL AND transcription_model_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scoped_model_registrations_user_transcription
  ON scoped_model_registrations(user_id, transcription_model_id) WHERE server_id IS NULL AND transcription_model_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_hosted_transcription_selection() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'server_speech_configs' THEN
    IF NEW.transcription_model_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM transcription_models m JOIN saved_provider_configs c ON c.provider = m.provider
      WHERE m.transcription_model_id = NEW.transcription_model_id AND c.server_id = NEW.server_id
        AND c.api_key IS NOT NULL AND NOT m.is_deprecated
        AND (NOT m.is_scoped_registration OR EXISTS (
          SELECT 1 FROM scoped_model_registrations r WHERE r.transcription_model_id = m.transcription_model_id
            AND r.server_id = NEW.server_id AND r.user_id IS NULL))
    ) THEN RAISE EXCEPTION 'Invalid server hosted transcription selection'; END IF;
  ELSE
    IF NEW.transcription_model_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM transcription_models m WHERE m.transcription_model_id = NEW.transcription_model_id
        AND m.provider = NEW.provider AND NEW.api_key IS NOT NULL AND NOT m.is_deprecated
        AND (NOT m.is_scoped_registration OR EXISTS (
          SELECT 1 FROM scoped_model_registrations r WHERE r.transcription_model_id = m.transcription_model_id
            AND r.user_id = NEW.user_id AND r.server_id IS NULL))
    ) THEN RAISE EXCEPTION 'Invalid personal hosted transcription selection'; END IF;
    IF NEW.enabled_capabilities @> ARRAY['transcription'] AND NOT NEW.assigned_capabilities @> ARRAY['transcription']
    THEN RAISE EXCEPTION 'Enabled personal transcription requires ownership'; END IF;
    IF NEW.assigned_capabilities @> ARRAY['transcription'] THEN
      PERFORM 1 FROM users WHERE user_id = NEW.user_id FOR UPDATE;
      IF EXISTS (
        SELECT 1 FROM user_saved_provider_configs c WHERE c.user_id = NEW.user_id AND c.provider <> NEW.provider
          AND c.assigned_capabilities @> ARRAY['transcription']
      ) THEN RAISE EXCEPTION 'Personal transcription already assigned'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS validate_hosted_transcription_selection ON server_speech_configs;
CREATE TRIGGER validate_hosted_transcription_selection BEFORE INSERT OR UPDATE OF transcription_model_id
  ON server_speech_configs FOR EACH ROW EXECUTE FUNCTION validate_hosted_transcription_selection();
DROP TRIGGER IF EXISTS validate_hosted_transcription_selection ON user_saved_provider_configs;
CREATE TRIGGER validate_hosted_transcription_selection BEFORE INSERT OR UPDATE OF transcription_model_id, provider, api_key, assigned_capabilities, enabled_capabilities
  ON user_saved_provider_configs FOR EACH ROW EXECUTE FUNCTION validate_hosted_transcription_selection();

CREATE OR REPLACE FUNCTION clear_transcription_credentials() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'user_saved_provider_configs' THEN
    IF NEW.api_key IS NULL THEN
      NEW.transcription_model_id = NULL;
      NEW.enabled_capabilities = array_remove(NEW.enabled_capabilities, 'transcription');
      NEW.assigned_capabilities = array_remove(NEW.assigned_capabilities, 'transcription');
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.api_key IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM servers WHERE server_id = OLD.server_id) THEN
    UPDATE server_speech_configs SET transcription_model_id = NULL
    WHERE server_id = OLD.server_id
      AND transcription_model_id IN (SELECT transcription_model_id FROM transcription_models WHERE provider = OLD.provider);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
-- BEFORE triggers fire in name order, so this must sort before validate_hosted_transcription_selection,
-- which would otherwise reject the keyless row before its selection is cleared.
DROP TRIGGER IF EXISTS clear_transcription_credentials ON user_saved_provider_configs;
CREATE TRIGGER clear_transcription_credentials BEFORE UPDATE OF api_key ON user_saved_provider_configs
  FOR EACH ROW EXECUTE FUNCTION clear_transcription_credentials();
DROP TRIGGER IF EXISTS clear_transcription_credentials ON saved_provider_configs;
CREATE TRIGGER clear_transcription_credentials BEFORE UPDATE OF api_key OR DELETE ON saved_provider_configs
  FOR EACH ROW EXECUTE FUNCTION clear_transcription_credentials();

CREATE OR REPLACE FUNCTION clear_hosted_transcription_registration() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.transcription_model_id IS NOT NULL THEN
    UPDATE server_speech_configs SET transcription_model_id = NULL
    WHERE server_id = OLD.server_id AND transcription_model_id = OLD.transcription_model_id
      AND EXISTS (SELECT 1 FROM servers WHERE server_id = OLD.server_id);
    UPDATE user_saved_provider_configs SET
      transcription_model_id = NULL,
      assigned_capabilities = array_remove(assigned_capabilities, 'transcription'),
      enabled_capabilities = array_remove(enabled_capabilities, 'transcription')
    WHERE user_id = OLD.user_id AND transcription_model_id = OLD.transcription_model_id
      AND EXISTS (SELECT 1 FROM users WHERE user_id = OLD.user_id);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS clear_hosted_transcription_registration ON scoped_model_registrations;
CREATE TRIGGER clear_hosted_transcription_registration AFTER DELETE ON scoped_model_registrations
  FOR EACH ROW EXECUTE FUNCTION clear_hosted_transcription_registration();

CREATE OR REPLACE FUNCTION clear_changed_transcription_model() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_deprecated OR NEW.provider <> OLD.provider THEN
    UPDATE server_speech_configs SET transcription_model_id = NULL WHERE transcription_model_id = NEW.transcription_model_id;
    UPDATE user_saved_provider_configs SET
      transcription_model_id = NULL,
      assigned_capabilities = array_remove(assigned_capabilities, 'transcription'),
      enabled_capabilities = array_remove(enabled_capabilities, 'transcription')
    WHERE transcription_model_id = NEW.transcription_model_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS clear_changed_transcription_model ON transcription_models;
CREATE TRIGGER clear_changed_transcription_model AFTER UPDATE OF provider, is_deprecated ON transcription_models
  FOR EACH ROW EXECUTE FUNCTION clear_changed_transcription_model();

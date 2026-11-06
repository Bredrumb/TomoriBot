DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM server_speech_configs WHERE transcription_model_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM user_saved_provider_configs WHERE transcription_model_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM scoped_model_registrations WHERE transcription_model_id IS NOT NULL)
  THEN RAISE EXCEPTION 'Clear hosted transcription selections and registrations before downgrade'; END IF;
END $$;
DROP TRIGGER IF EXISTS validate_hosted_transcription_selection ON server_speech_configs;
DROP TRIGGER IF EXISTS validate_hosted_transcription_selection ON user_saved_provider_configs;
DROP FUNCTION IF EXISTS validate_hosted_transcription_selection();
DROP TRIGGER IF EXISTS clear_transcription_credentials ON user_saved_provider_configs;
DROP TRIGGER IF EXISTS clear_transcription_credentials ON saved_provider_configs;
DROP FUNCTION IF EXISTS clear_transcription_credentials();
DROP TRIGGER IF EXISTS clear_hosted_transcription_registration ON scoped_model_registrations;
DROP FUNCTION IF EXISTS clear_hosted_transcription_registration();
DROP FUNCTION IF EXISTS clear_changed_transcription_model() CASCADE;
UPDATE user_saved_provider_configs SET
  enabled_capabilities = array_remove(enabled_capabilities, 'transcription'),
  assigned_capabilities = array_remove(assigned_capabilities, 'transcription');
ALTER TABLE server_speech_configs DROP COLUMN IF EXISTS transcription_model_id;
ALTER TABLE user_saved_provider_configs DROP COLUMN IF EXISTS transcription_model_id;
ALTER TABLE scoped_model_registrations DROP CONSTRAINT IF EXISTS scoped_model_registrations_one_model;
ALTER TABLE scoped_model_registrations DROP COLUMN IF EXISTS transcription_model_id;
ALTER TABLE scoped_model_registrations ADD CONSTRAINT scoped_model_registrations_one_model
  CHECK (num_nonnulls(llm_id, embedding_model_id, diffusion_model_id, video_model_id, decision_model_id, speech_model_id) = 1);
DROP TABLE IF EXISTS transcription_models;

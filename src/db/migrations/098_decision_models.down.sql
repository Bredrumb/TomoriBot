DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM decision_models WHERE is_scoped_registration = true) OR
     EXISTS (SELECT 1 FROM scoped_model_registrations WHERE decision_model_id IS NOT NULL) OR
     EXISTS (SELECT 1 FROM custom_endpoint_connections WHERE capability = 'decision') THEN
    RAISE EXCEPTION 'Remove decision registrations and endpoint connections before downgrading';
  END IF;
END $$;
ALTER TABLE scoped_model_registrations DROP CONSTRAINT IF EXISTS scoped_model_registrations_one_model;
ALTER TABLE scoped_model_registrations DROP COLUMN IF EXISTS decision_model_id;
ALTER TABLE scoped_model_registrations ADD CONSTRAINT scoped_model_registrations_check1
  CHECK (num_nonnulls(llm_id, embedding_model_id, diffusion_model_id, video_model_id) = 1);
DROP TABLE IF EXISTS decision_models;

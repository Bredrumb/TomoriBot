-- Stored vectors keep their original family until an explicit re-embedding pass rebuilds them.
DO $$
DECLARE
  retired_model_id INTEGER;
  replacement_model_id INTEGER;
BEGIN
  SELECT embedding_model_id INTO retired_model_id
  FROM embedding_models
  WHERE provider = 'nvidia' AND codename = 'nv-embed-v1';

  IF retired_model_id IS NULL THEN
    RETURN;
  END IF;

  SELECT embedding_model_id INTO replacement_model_id
  FROM embedding_models
  WHERE provider = 'nvidia' AND codename = 'nvidia/nemotron-3.5-embed-1b';

  IF replacement_model_id IS NULL THEN
    RAISE EXCEPTION 'Seed the current NVIDIA embedding catalog before migrating selections';
  END IF;

  UPDATE server_model_configs
  SET embedding_model_id = replacement_model_id
  WHERE embedding_model_id = retired_model_id;

  UPDATE saved_provider_configs
  SET embedding_model_id = replacement_model_id
  WHERE embedding_model_id = retired_model_id;

  UPDATE user_saved_provider_configs
  SET embedding_model_id = replacement_model_id
  WHERE embedding_model_id = retired_model_id;
END;
$$;

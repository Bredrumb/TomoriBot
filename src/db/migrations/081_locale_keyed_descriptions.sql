SELECT add_column_if_not_exists('llms', 'descriptions', 'JSONB');
SELECT add_column_if_not_exists('image_diffusion_models', 'descriptions', 'JSONB');
SELECT add_column_if_not_exists('video_generation_models', 'descriptions', 'JSONB');
SELECT add_column_if_not_exists('embedding_models', 'descriptions', 'JSONB');
SELECT add_column_if_not_exists('system_prompt_presets', 'descriptions', 'JSONB');
SELECT add_column_if_not_exists('nai_presets', 'descriptions', 'JSONB');

UPDATE llms SET descriptions = jsonb_strip_nulls(jsonb_build_object(
  'en-US', NULLIF(llm_description, ''), 'ja', NULLIF(ja_description, '')
)) WHERE descriptions IS NULL;
UPDATE image_diffusion_models SET descriptions = jsonb_strip_nulls(jsonb_build_object(
  'en-US', NULLIF(model_description, ''), 'ja', NULLIF(ja_description, '')
)) WHERE descriptions IS NULL;
UPDATE video_generation_models SET descriptions = jsonb_strip_nulls(jsonb_build_object(
  'en-US', NULLIF(model_description, ''), 'ja', NULLIF(ja_description, '')
)) WHERE descriptions IS NULL;
UPDATE embedding_models SET descriptions = jsonb_strip_nulls(jsonb_build_object(
  'en-US', NULLIF(model_description, ''), 'ja', NULLIF(ja_description, '')
)) WHERE descriptions IS NULL;
UPDATE system_prompt_presets SET descriptions = jsonb_strip_nulls(jsonb_build_object(
  'en-US', NULLIF(system_prompt_preset_desc, ''), 'ja', NULLIF(ja_description, '')
)) WHERE descriptions IS NULL;
UPDATE nai_presets SET descriptions = jsonb_strip_nulls(jsonb_build_object(
  'en-US', NULLIF(preset_desc, ''), 'ja', NULLIF(ja_preset_desc, '')
)) WHERE descriptions IS NULL;

ALTER TABLE nai_presets ALTER COLUMN ja_preset_desc DROP NOT NULL;

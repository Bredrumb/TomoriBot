UPDATE nai_presets SET ja_preset_desc = COALESCE(NULLIF(ja_preset_desc, ''), preset_desc)
WHERE ja_preset_desc IS NULL OR ja_preset_desc = '';
ALTER TABLE nai_presets ALTER COLUMN ja_preset_desc SET NOT NULL;

ALTER TABLE llms DROP COLUMN IF EXISTS descriptions;
ALTER TABLE image_diffusion_models DROP COLUMN IF EXISTS descriptions;
ALTER TABLE video_generation_models DROP COLUMN IF EXISTS descriptions;
ALTER TABLE embedding_models DROP COLUMN IF EXISTS descriptions;
ALTER TABLE system_prompt_presets DROP COLUMN IF EXISTS descriptions;
ALTER TABLE nai_presets DROP COLUMN IF EXISTS descriptions;

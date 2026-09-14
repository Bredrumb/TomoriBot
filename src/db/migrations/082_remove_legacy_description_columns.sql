-- Migration: 082_remove_legacy_description_columns
-- Removes the legacy ja_description and ja_preset_desc columns now that
-- all descriptions are managed via the descriptions JSONB map.

ALTER TABLE llms DROP COLUMN IF EXISTS ja_description;
ALTER TABLE image_diffusion_models DROP COLUMN IF EXISTS ja_description;
ALTER TABLE video_generation_models DROP COLUMN IF EXISTS ja_description;
ALTER TABLE embedding_models DROP COLUMN IF EXISTS ja_description;
ALTER TABLE system_prompt_presets DROP COLUMN IF EXISTS ja_description;
ALTER TABLE nai_presets DROP COLUMN IF EXISTS ja_preset_desc;

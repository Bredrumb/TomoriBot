-- Down migration: 082_remove_legacy_description_columns
-- Restores the nullable ja_description and ja_preset_desc columns and backfills
-- from the descriptions JSONB map.

SELECT add_column_if_not_exists('llms', 'ja_description', 'TEXT');
SELECT add_column_if_not_exists('image_diffusion_models', 'ja_description', 'TEXT');
SELECT add_column_if_not_exists('video_generation_models', 'ja_description', 'TEXT');
SELECT add_column_if_not_exists('embedding_models', 'ja_description', 'TEXT');
SELECT add_column_if_not_exists('system_prompt_presets', 'ja_description', 'TEXT');
SELECT add_column_if_not_exists('nai_presets', 'ja_preset_desc', 'TEXT');

UPDATE llms SET ja_description = descriptions->>'ja' WHERE descriptions ? 'ja';
UPDATE image_diffusion_models SET ja_description = descriptions->>'ja' WHERE descriptions ? 'ja';
UPDATE video_generation_models SET ja_description = descriptions->>'ja' WHERE descriptions ? 'ja';
UPDATE embedding_models SET ja_description = descriptions->>'ja' WHERE descriptions ? 'ja';
UPDATE system_prompt_presets SET ja_description = descriptions->>'ja' WHERE descriptions ? 'ja';
UPDATE nai_presets SET ja_preset_desc = descriptions->>'ja' WHERE descriptions ? 'ja';

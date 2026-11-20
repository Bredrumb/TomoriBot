-- Migration 045: Backfill persona-scoped split config tables from the live
-- personas mirror columns before cutting runtime reads over to the split tables.
--
-- The mirror value wins on conflict because these columns remained the runtime
-- source of truth until this migration.

INSERT INTO persona_context_note_configs (persona_id, context_note, context_note_depth)
SELECT
  persona_id,
  context_note,
  COALESCE(context_note_depth, 0)
FROM personas
ON CONFLICT (persona_id) DO UPDATE SET
  context_note = EXCLUDED.context_note,
  context_note_depth = EXCLUDED.context_note_depth,
  updated_at = NOW();

INSERT INTO persona_voice_configs (
  persona_id,
  speech_voice_sample_id,
  speech_voice_id,
  speech_voice_name,
  speech_voice_design_prompt
)
SELECT
  persona_id,
  speech_voice_sample_id,
  speech_voice_id,
  speech_voice_name,
  speech_voice_design_prompt
FROM personas
ON CONFLICT (persona_id) DO UPDATE SET
  speech_voice_sample_id = EXCLUDED.speech_voice_sample_id,
  speech_voice_id = EXCLUDED.speech_voice_id,
  speech_voice_name = EXCLUDED.speech_voice_name,
  speech_voice_design_prompt = EXCLUDED.speech_voice_design_prompt,
  updated_at = NOW();

INSERT INTO persona_imagegen_configs (persona_id, physical_appearance_tags, nai_char_ref_url)
SELECT
  persona_id,
  COALESCE(physical_appearance_tags, ARRAY[]::TEXT[]),
  nai_char_ref_url
FROM personas
ON CONFLICT (persona_id) DO UPDATE SET
  physical_appearance_tags = EXCLUDED.physical_appearance_tags,
  nai_char_ref_url = EXCLUDED.nai_char_ref_url,
  updated_at = NOW();

INSERT INTO persona_textgen_configs (
  persona_id,
  nai_attg_author,
  nai_attg_title,
  nai_attg_tags,
  nai_attg_genre,
  nai_attg_stars
)
SELECT
  persona_id,
  nai_attg_author,
  nai_attg_title,
  nai_attg_tags,
  nai_attg_genre,
  nai_attg_stars
FROM personas
ON CONFLICT (persona_id) DO UPDATE SET
  nai_attg_author = EXCLUDED.nai_attg_author,
  nai_attg_title = EXCLUDED.nai_attg_title,
  nai_attg_tags = EXCLUDED.nai_attg_tags,
  nai_attg_genre = EXCLUDED.nai_attg_genre,
  nai_attg_stars = EXCLUDED.nai_attg_stars,
  updated_at = NOW();

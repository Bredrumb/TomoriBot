-- Migration 046: Drop persona-scoped mirror columns from personas after the
-- split tables have been backfilled and runtime reads/writes have cut over.

ALTER TABLE personas
  DROP COLUMN IF EXISTS context_note,
  DROP COLUMN IF EXISTS context_note_depth,
  DROP COLUMN IF EXISTS speech_voice_sample_id,
  DROP COLUMN IF EXISTS speech_voice_id,
  DROP COLUMN IF EXISTS speech_voice_name,
  DROP COLUMN IF EXISTS speech_voice_design_prompt,
  DROP COLUMN IF EXISTS physical_appearance_tags,
  DROP COLUMN IF EXISTS nai_char_ref_url,
  DROP COLUMN IF EXISTS nai_attg_author,
  DROP COLUMN IF EXISTS nai_attg_title,
  DROP COLUMN IF EXISTS nai_attg_tags,
  DROP COLUMN IF EXISTS nai_attg_genre,
  DROP COLUMN IF EXISTS nai_attg_stars;

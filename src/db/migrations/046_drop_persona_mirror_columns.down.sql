-- Rollback 046: restore persona-scoped mirror columns and backfill them from
-- the canonical split config tables so older code can read them again.

ALTER TABLE personas ADD COLUMN IF NOT EXISTS context_note TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS context_note_depth INTEGER DEFAULT 0;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS speech_voice_sample_id INTEGER;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS speech_voice_id TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS speech_voice_name TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS speech_voice_design_prompt TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS physical_appearance_tags TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE personas ADD COLUMN IF NOT EXISTS nai_char_ref_url TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS nai_attg_author TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS nai_attg_title TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS nai_attg_tags TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS nai_attg_genre TEXT;
ALTER TABLE personas ADD COLUMN IF NOT EXISTS nai_attg_stars SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'personas_speech_voice_sample_id_fkey'
  ) THEN
    ALTER TABLE personas
      ADD CONSTRAINT personas_speech_voice_sample_id_fkey
      FOREIGN KEY (speech_voice_sample_id)
      REFERENCES voice_samples(sample_id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE personas p
SET
  context_note = pcnc.context_note,
  context_note_depth = COALESCE(pcnc.context_note_depth, 0)
FROM persona_context_note_configs pcnc
WHERE pcnc.persona_id = p.persona_id;

UPDATE personas p
SET
  speech_voice_sample_id = pvc.speech_voice_sample_id,
  speech_voice_id = pvc.speech_voice_id,
  speech_voice_name = pvc.speech_voice_name,
  speech_voice_design_prompt = pvc.speech_voice_design_prompt
FROM persona_voice_configs pvc
WHERE pvc.persona_id = p.persona_id;

UPDATE personas p
SET
  physical_appearance_tags = COALESCE(pic.physical_appearance_tags, ARRAY[]::TEXT[]),
  nai_char_ref_url = pic.nai_char_ref_url
FROM persona_imagegen_configs pic
WHERE pic.persona_id = p.persona_id;

UPDATE personas p
SET
  nai_attg_author = ptc.nai_attg_author,
  nai_attg_title = ptc.nai_attg_title,
  nai_attg_tags = ptc.nai_attg_tags,
  nai_attg_genre = ptc.nai_attg_genre,
  nai_attg_stars = ptc.nai_attg_stars
FROM persona_textgen_configs ptc
WHERE ptc.persona_id = p.persona_id;

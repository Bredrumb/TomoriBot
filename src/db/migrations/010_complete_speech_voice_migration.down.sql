-- Rollback for migration 010: restore elevenlabs_* columns
-- Note: data in the dropped columns cannot be recovered from this rollback alone.
-- If a data snapshot was taken before running 010, restore it before running this rollback.

ALTER TABLE persona_voice_configs
  ADD COLUMN IF NOT EXISTS elevenlabs_voice_id   TEXT,
  ADD COLUMN IF NOT EXISTS elevenlabs_voice_name TEXT;

ALTER TABLE tomoris
  ADD COLUMN IF NOT EXISTS elevenlabs_voice_id   TEXT,
  ADD COLUMN IF NOT EXISTS elevenlabs_voice_name TEXT;

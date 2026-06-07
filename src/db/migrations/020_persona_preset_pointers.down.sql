-- Rollback for 020_persona_preset_pointers.sql.

DROP INDEX IF EXISTS idx_personas_pointer_preset;

ALTER TABLE IF EXISTS personas
  DROP COLUMN IF EXISTS preset_language,
  DROP COLUMN IF EXISTS preset_lineage_id,
  DROP COLUMN IF EXISTS is_pointer;

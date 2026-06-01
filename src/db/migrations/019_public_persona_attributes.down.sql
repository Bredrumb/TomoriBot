-- Rollback for 019_public_persona_attributes.sql.

ALTER TABLE IF EXISTS persona_presets
  DROP COLUMN IF EXISTS preset_attribute_public_flags;

DROP TRIGGER IF EXISTS update_persona_attributes_timestamp ON persona_attributes;
DROP TABLE IF EXISTS persona_attributes;

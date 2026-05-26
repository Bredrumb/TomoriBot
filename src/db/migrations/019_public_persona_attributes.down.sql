-- Rollback for 019_public_persona_attributes.sql.

DROP FUNCTION IF EXISTS persona_preset_snapshot_bool_array(JSONB, TEXT);
DROP FUNCTION IF EXISTS persona_preset_rebase_bool_array(BOOLEAN[], TEXT[], TEXT[], BOOLEAN[]);

ALTER TABLE IF EXISTS persona_presets
  DROP COLUMN IF EXISTS preset_attribute_public_flags;

DROP TRIGGER IF EXISTS update_persona_attributes_timestamp ON persona_attributes;
DROP TABLE IF EXISTS persona_attributes;

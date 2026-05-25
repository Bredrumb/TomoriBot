-- Rollback for 017_persona_preset_sync_state.sql.
-- Drops the preset sync state table and helper functions. The lineage column is
-- also removed from persona_presets; existing personas keep their lineage IDs.

DROP TRIGGER IF EXISTS update_persona_preset_sync_state_timestamp ON persona_preset_sync_state;
DROP TABLE IF EXISTS persona_preset_sync_state;

DROP FUNCTION IF EXISTS persona_preset_snapshot_text_array(JSONB, TEXT);
DROP FUNCTION IF EXISTS persona_preset_rebase_text_array(TEXT[], TEXT[], TEXT[]);
DROP FUNCTION IF EXISTS persona_preset_array_starts_with(TEXT[], TEXT[]);

DROP INDEX IF EXISTS idx_persona_presets_lineage_language_unique;
ALTER TABLE persona_presets DROP COLUMN IF EXISTS preset_lineage_id;

-- Rollback for 018_persona_preset_avatar_sync.sql.

ALTER TABLE IF EXISTS persona_preset_sync_state
  DROP CONSTRAINT IF EXISTS chk_persona_preset_sync_state_avatar_sync_mode;

ALTER TABLE IF EXISTS persona_preset_sync_state
  DROP COLUMN IF EXISTS avatar_synced_at;

ALTER TABLE IF EXISTS persona_preset_sync_state
  DROP COLUMN IF EXISTS avatar_source_hash;

ALTER TABLE IF EXISTS persona_preset_sync_state
  DROP COLUMN IF EXISTS avatar_source_path;

ALTER TABLE IF EXISTS persona_preset_sync_state
  DROP COLUMN IF EXISTS avatar_sync_mode;

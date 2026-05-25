-- Add avatar-specific baseline metadata for official persona preset sync.
-- Content sync and avatar sync intentionally have separate modes so a server can
-- keep preset text updates while preserving an explicitly customized avatar.

ALTER TABLE persona_preset_sync_state
  ADD COLUMN IF NOT EXISTS avatar_sync_mode TEXT NOT NULL DEFAULT 'auto';

ALTER TABLE persona_preset_sync_state
  ADD COLUMN IF NOT EXISTS avatar_source_path TEXT;

ALTER TABLE persona_preset_sync_state
  ADD COLUMN IF NOT EXISTS avatar_source_hash TEXT;

ALTER TABLE persona_preset_sync_state
  ADD COLUMN IF NOT EXISTS avatar_synced_at TIMESTAMP;

DO $$
BEGIN
  ALTER TABLE persona_preset_sync_state
    ADD CONSTRAINT chk_persona_preset_sync_state_avatar_sync_mode
    CHECK (avatar_sync_mode IN ('auto', 'manual'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE persona_preset_sync_state
SET avatar_source_path = COALESCE(
  base_snapshot ->> 'preset_avatar_path',
  CASE preset_lineage_id
    WHEN 4 THEN 'src/db/img/default.png'
    WHEN 716 THEN 'src/db/img/bratty.png'
    WHEN 1770 THEN 'src/db/img/gloomy.png'
    WHEN 3585 THEN 'src/db/img/shy.png'
    WHEN 50 THEN 'src/db/img/blind.png'
    ELSE NULL
  END
)
WHERE avatar_source_path IS NULL;

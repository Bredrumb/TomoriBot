-- Rollback 033: drop the preset avatar syncing columns.
--
-- WARNING: dropping these columns discards the shared preset avatar reference,
-- its content-hash version token, and every persona's last-applied avatar hash.
-- They are re-added (and re-seeded / re-reconciled) on the next forward run.

ALTER TABLE personas DROP COLUMN IF EXISTS applied_avatar_hash;
ALTER TABLE persona_presets DROP COLUMN IF EXISTS preset_avatar_hash;
ALTER TABLE persona_presets DROP COLUMN IF EXISTS preset_avatar_shared_url;

-- 005_consolidate_alter_triggers (down)
--
-- Restores the alter_triggers column. Row data is NOT restored — this only re-adds
-- the column with a default empty array. If data restoration is needed, restore from
-- a pre-migration backup.
--
-- After rolling back this migration, also revert the Stage B code changes that removed
-- the alter_triggers ternary from readers (git revert the Step 2 commit).
ALTER TABLE tomoris ADD COLUMN IF NOT EXISTS alter_triggers TEXT[] NOT NULL DEFAULT '{}';

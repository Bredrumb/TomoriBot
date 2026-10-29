DO $$
BEGIN
  LOCK TABLE persona_lorebook_entries, server_lorebooks IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM persona_lorebook_entries WHERE trigger_chance = 0) THEN
    RAISE EXCEPTION 'Zero-chance lore must be exported and adjusted before rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM server_lorebooks WHERE name <> 'General' OR NOT enabled OR cardinality(channel_disc_ids) > 0) THEN
    RAISE EXCEPTION 'Lorebook collection settings must be exported before rollback';
  END IF;
  ALTER TABLE persona_lorebook_entries DROP CONSTRAINT IF EXISTS persona_lorebook_entries_book_scope;
  ALTER TABLE persona_lorebook_entries DROP CONSTRAINT IF EXISTS persona_lorebook_entries_book;
  ALTER TABLE persona_lorebook_entries DROP COLUMN IF EXISTS lorebook_name;
  DROP TABLE IF EXISTS server_lorebooks;
  ALTER TABLE persona_lorebook_entries DROP CONSTRAINT IF EXISTS persona_lorebook_entries_trigger_chance_check;
  ALTER TABLE persona_lorebook_entries ADD CONSTRAINT persona_lorebook_entries_trigger_chance_check
  CHECK (trigger_chance BETWEEN 1 AND 100);
END $$;

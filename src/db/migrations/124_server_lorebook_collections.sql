DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS server_lorebooks (
    lorebook_id SERIAL PRIMARY KEY,
    server_id INT NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL CHECK (length(trim(name)) > 0),
    enabled BOOLEAN NOT NULL DEFAULT true,
    channel_disc_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    UNIQUE (server_id, name)
  );
  LOCK TABLE persona_lorebook_entries, server_lorebooks IN ACCESS EXCLUSIVE MODE;
  PERFORM add_column_if_not_exists('server_lorebooks', 'enabled', 'BOOLEAN', 'true');
  PERFORM add_column_if_not_exists('server_lorebooks', 'channel_disc_ids', 'TEXT[]', 'ARRAY[]::TEXT[]');
  UPDATE persona_lorebook_entries SET channel_disc_ids = ARRAY[]::TEXT[] WHERE persona_lineage_id IS NULL;
  DELETE FROM legacy_channel_scope_tags l USING persona_lorebook_entries e
    WHERE l.source_table = 'persona_lorebook_entries' AND l.row_id = e.entry_id AND e.persona_lineage_id IS NULL;
  PERFORM add_column_if_not_exists('persona_lorebook_entries', 'lorebook_name', 'VARCHAR(128)', NULL);
  INSERT INTO server_lorebooks (server_id, name)
  SELECT DISTINCT server_id, 'General' FROM persona_lorebook_entries
    WHERE persona_lineage_id IS NULL AND lorebook_name IS NULL
  ON CONFLICT (server_id, name) DO NOTHING;
  UPDATE persona_lorebook_entries SET lorebook_name = 'General'
  WHERE persona_lineage_id IS NULL AND lorebook_name IS NULL;
  ALTER TABLE persona_lorebook_entries DROP CONSTRAINT IF EXISTS persona_lorebook_entries_book;
  ALTER TABLE persona_lorebook_entries ADD CONSTRAINT persona_lorebook_entries_book
    FOREIGN KEY (server_id, lorebook_name) REFERENCES server_lorebooks(server_id, name)
    ON UPDATE CASCADE ON DELETE CASCADE;
  ALTER TABLE persona_lorebook_entries DROP CONSTRAINT IF EXISTS persona_lorebook_entries_book_scope;
  ALTER TABLE persona_lorebook_entries ADD CONSTRAINT persona_lorebook_entries_book_scope
    CHECK ((persona_lineage_id IS NULL) = (lorebook_name IS NOT NULL));
  ALTER TABLE persona_lorebook_entries DROP CONSTRAINT IF EXISTS persona_lorebook_entries_trigger_chance_check;
  ALTER TABLE persona_lorebook_entries ADD CONSTRAINT persona_lorebook_entries_trigger_chance_check
    CHECK (trigger_chance BETWEEN 0 AND 100);
END $$;

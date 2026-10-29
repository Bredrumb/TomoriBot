DO $$
BEGIN
  IF to_regclass('public.lorebook_migration_123_backup') IS NULL THEN RETURN; END IF;
  LOCK TABLE server_memories, persona_lorebook_entries, legacy_channel_scope_tags IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1 FROM lorebook_migration_123_backup b JOIN server_memories sm USING (server_memory_id)
    WHERE EXISTS (SELECT 1 FROM servers s WHERE s.server_id = b.server_id)
  ) THEN
    RAISE EXCEPTION 'A backed-up memory identifier is occupied; rollback would overwrite data';
  END IF;

  INSERT INTO server_memories (
    server_memory_id, server_id, persona_id, persona_lineage_id, user_id, content, tags,
    channel_disc_ids, created_at, updated_at
  )
  SELECT b.server_memory_id, b.server_id,
         CASE WHEN EXISTS (SELECT 1 FROM personas p WHERE p.persona_id = b.persona_id AND p.server_id = b.server_id)
              THEN b.persona_id END,
         b.persona_lineage_id,
         CASE WHEN EXISTS (SELECT 1 FROM users u WHERE u.user_id = b.user_id) THEN b.user_id END,
         b.content, b.tags, b.channel_disc_ids, b.created_at, b.updated_at
  FROM lorebook_migration_123_backup b
  WHERE EXISTS (SELECT 1 FROM servers s WHERE s.server_id = b.server_id);

  INSERT INTO legacy_channel_scope_tags (source_table, row_id, server_id, channel_tags, resolved_at)
  SELECT 'server_memories', b.server_memory_id, b.server_id, b.legacy_channel_tags, b.legacy_resolved_at
  FROM lorebook_migration_123_backup b
  WHERE b.legacy_channel_tags IS NOT NULL
    AND EXISTS (SELECT 1 FROM server_memories sm WHERE sm.server_memory_id = b.server_memory_id);

  DELETE FROM legacy_channel_scope_tags l USING lorebook_migration_123_backup b
  WHERE l.source_table = 'persona_lorebook_entries' AND l.row_id = b.entry_id;
  DELETE FROM persona_lorebook_entries e USING lorebook_migration_123_backup b
  WHERE e.entry_id = b.entry_id AND e.server_id = b.server_id AND e.persona_lineage_id = b.persona_lineage_id;
  PERFORM setval(pg_get_serial_sequence('server_memories', 'server_memory_id'),
    GREATEST((SELECT COALESCE(max(server_memory_id), 1) FROM server_memories),
      (SELECT last_value FROM server_memories_server_memory_id_seq)), true);
  DROP TABLE lorebook_migration_123_backup;
END $$;

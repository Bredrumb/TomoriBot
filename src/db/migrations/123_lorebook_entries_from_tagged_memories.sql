DO $$
DECLARE
  memory RECORD;
  cleaned_keys TEXT[];
  new_entry_id INT;
  -- Match JavaScript trim whitespace so migration and backup-import eligibility agree.
  trim_characters CONSTANT TEXT := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  LOCK TABLE server_memories, persona_lorebook_entries, legacy_channel_scope_tags IN SHARE ROW EXCLUSIVE MODE;
  CREATE TABLE IF NOT EXISTS lorebook_migration_123_backup (
    server_memory_id INT PRIMARY KEY,
    entry_id INT NOT NULL,
    server_id INT NOT NULL,
    persona_id INT,
    persona_lineage_id BIGINT NOT NULL,
    user_id INT,
    content TEXT NOT NULL,
    tags TEXT[],
    channel_disc_ids TEXT[] NOT NULL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    legacy_channel_tags TEXT[],
    legacy_resolved_at TIMESTAMPTZ
  );

  FOR memory IN
    SELECT sm.*, COALESCE(c.memory_tagging_enabled, false) AS tagging_enabled,
           l.channel_tags AS legacy_channel_tags, l.resolved_at AS legacy_resolved_at
    FROM server_memories sm
    LEFT JOIN server_memory_configs c USING (server_id)
    LEFT JOIN legacy_channel_scope_tags l
      ON l.source_table = 'server_memories' AND l.row_id = sm.server_memory_id
    WHERE NOT EXISTS (
      SELECT 1 FROM lorebook_migration_123_backup b WHERE b.server_memory_id = sm.server_memory_id
    )
    ORDER BY sm.server_memory_id
  LOOP
    SELECT COALESCE(array_agg(key ORDER BY first_position), ARRAY[]::TEXT[]) INTO cleaned_keys
    FROM (
      SELECT key, min(position) AS first_position
      FROM (
        SELECT btrim(tag, trim_characters || chr(34) || chr(39)) AS key, position
        FROM unnest(memory.tags) WITH ORDINALITY AS tags(tag, position)
      ) cleaned
      WHERE key <> '' AND left(key, 1) <> '#'
      GROUP BY key
    ) unique_keys;
    CONTINUE WHEN cardinality(cleaned_keys) = 0;

    IF cardinality(cleaned_keys) > 20 OR EXISTS (
         SELECT 1 FROM unnest(cleaned_keys) k
         WHERE length(k) + length(regexp_replace(k, U&'[^\+010000-\+10FFFF]', '', 'g')) > 64
       )
       OR length(memory.content) + length(regexp_replace(memory.content, U&'[^\+010000-\+10FFFF]', '', 'g')) > 4000
       OR btrim(memory.content, trim_characters) = ''
       OR EXISTS (SELECT 1 FROM unnest(memory.channel_disc_ids) c WHERE c !~ '^[0-9]{17,20}$')
       OR (SELECT count(*) FROM persona_lorebook_entries e
           WHERE e.server_id = memory.server_id AND e.persona_lineage_id = memory.persona_lineage_id) >= 250 THEN
      RAISE EXCEPTION 'Memory % cannot fit lorebook limits; no memories were moved', memory.server_memory_id;
    END IF;

    INSERT INTO persona_lorebook_entries (
      server_id, persona_lineage_id, title, content, keys, scan_depth, trigger_chance,
      constant, enabled, channel_disc_ids, created_at, updated_at
    ) VALUES (
      memory.server_id, memory.persona_lineage_id, left(cleaned_keys[1], 128), memory.content,
      cleaned_keys, 5, 100, NOT memory.tagging_enabled, true, memory.channel_disc_ids,
      memory.created_at, memory.updated_at
    ) RETURNING entry_id INTO new_entry_id;

    INSERT INTO lorebook_migration_123_backup VALUES (
      memory.server_memory_id, new_entry_id, memory.server_id, memory.persona_id, memory.persona_lineage_id,
      memory.user_id, memory.content, memory.tags, memory.channel_disc_ids, memory.created_at, memory.updated_at,
      memory.legacy_channel_tags, memory.legacy_resolved_at
    );
    INSERT INTO legacy_channel_scope_tags (source_table, row_id, server_id, channel_tags, resolved_at)
    SELECT 'persona_lorebook_entries', new_entry_id, memory.server_id, l.channel_tags, l.resolved_at
    FROM legacy_channel_scope_tags l
    WHERE l.source_table = 'server_memories' AND l.row_id = memory.server_memory_id;
    DELETE FROM legacy_channel_scope_tags
    WHERE source_table = 'server_memories' AND row_id = memory.server_memory_id;
    DELETE FROM server_memories WHERE server_memory_id = memory.server_memory_id;
  END LOOP;
END $$;

ALTER TABLE short_term_memories
  DROP COLUMN IF EXISTS summarized_through;

ALTER TABLE server_stm_configs
  DROP COLUMN IF EXISTS summarizer_instructions_override,
  ALTER COLUMN refresh_cadence SET DEFAULT 5;

UPDATE server_stm_configs SET refresh_cadence = 5
WHERE refresh_cadence = 10 AND server_id IN (SELECT server_id FROM stm_cadence_migration_145);

DROP TABLE IF EXISTS stm_cadence_migration_145;

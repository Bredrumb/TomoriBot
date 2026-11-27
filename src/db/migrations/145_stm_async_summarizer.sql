ALTER TABLE server_stm_configs
  ADD COLUMN IF NOT EXISTS summarizer_instructions_override TEXT,
  ALTER COLUMN refresh_cadence SET DEFAULT 10;

CREATE TABLE IF NOT EXISTS stm_cadence_migration_145 (
  server_id INT PRIMARY KEY REFERENCES server_stm_configs(server_id) ON DELETE CASCADE
);

WITH rewritten AS (
  UPDATE server_stm_configs SET refresh_cadence = 10 WHERE refresh_cadence = 5 RETURNING server_id
)
INSERT INTO stm_cadence_migration_145 (server_id)
SELECT server_id FROM rewritten ON CONFLICT DO NOTHING;

ALTER TABLE short_term_memories
  ADD COLUMN IF NOT EXISTS summarized_through TIMESTAMPTZ;

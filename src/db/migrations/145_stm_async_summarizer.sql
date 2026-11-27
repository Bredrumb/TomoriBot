ALTER TABLE server_stm_configs
  ADD COLUMN IF NOT EXISTS summarizer_instructions_override TEXT,
  ALTER COLUMN refresh_cadence SET DEFAULT 10;

UPDATE server_stm_configs SET refresh_cadence = 10 WHERE refresh_cadence = 5;

ALTER TABLE short_term_memories
  ADD COLUMN IF NOT EXISTS summarized_through TIMESTAMPTZ;

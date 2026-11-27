ALTER TABLE server_stm_configs
  ADD COLUMN IF NOT EXISTS tool_description_override TEXT,
  ADD COLUMN IF NOT EXISTS update_nudge_override TEXT,
  ADD COLUMN IF NOT EXISTS nudge_injection_depth INT NOT NULL DEFAULT 2;

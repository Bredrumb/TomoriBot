-- Rollback 035: Remove the verbatim tool-calling workaround opt-in flag.

ALTER TABLE server_capabilities_configs
  DROP COLUMN IF EXISTS verbatim_tool_calling_enabled;

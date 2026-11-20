-- Migration 042: Server opt-in for the verbatim tool-calling workaround.
--
-- The flag is default-off because it enables a text parser that converts
-- strict assistant output into tool calls for Custom OpenAI-compatible bridges.

ALTER TABLE server_capabilities_configs
  ADD COLUMN IF NOT EXISTS verbatim_tool_calling_enabled BOOLEAN NOT NULL DEFAULT false;

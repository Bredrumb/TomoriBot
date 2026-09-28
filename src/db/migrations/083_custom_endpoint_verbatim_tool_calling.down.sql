-- Rollback 083: restore the server-wide verbatim tool-calling opt-in.

ALTER TABLE server_capabilities_configs
  ADD COLUMN IF NOT EXISTS verbatim_tool_calling_enabled BOOLEAN NOT NULL DEFAULT false;

-- A server gets the flag back when any of its endpoints had it, which is the closest single
-- server-wide value for a set of per-model choices.
UPDATE server_capabilities_configs scc
SET verbatim_tool_calling_enabled = true
WHERE EXISTS (
  SELECT 1
  FROM custom_endpoint_connections cec
  JOIN custom_endpoints ce ON ce.connection_id = cec.connection_id
  WHERE cec.server_id = scc.server_id
    AND ce.verbatim_tool_calling = true
);

ALTER TABLE custom_endpoints DROP COLUMN IF EXISTS verbatim_tool_calling;
ALTER TABLE llms DROP COLUMN IF EXISTS verbatim_tool_calling;

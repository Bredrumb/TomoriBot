-- Migration 083: Move verbatim tool-calling from server capabilities to custom endpoints/llms.
--
-- The toggle describes one backend's parser, not server-wide behavior, so a server running both a
-- native-tool-calling endpoint and a text-only one could not express both. It now lives on the
-- model it affects, and the server-level flag is retired after backfilling whatever it selected.

ALTER TABLE custom_endpoints
  ADD COLUMN IF NOT EXISTS verbatim_tool_calling BOOLEAN NOT NULL DEFAULT false;

SELECT add_column_if_not_exists('llms', 'verbatim_tool_calling', 'BOOLEAN', 'false');

-- Backfill each server's custom text endpoints from the flag it set while the setting was
-- server-wide. The capability filter is load-bearing: `model_ref_id` is chosen by capability and
-- points at `llms`, `image_diffusion_models`, `video_generation_models`, or `embedding_models`, so
-- without it a non-text endpoint's id would be read as an `llm_id` below and could switch the flag
-- on for an unrelated model, including another server's.
UPDATE custom_endpoints ce
SET verbatim_tool_calling = true
FROM custom_endpoint_connections cec
JOIN server_capabilities_configs scc ON scc.server_id = cec.server_id
WHERE ce.connection_id = cec.connection_id
  AND cec.capability = 'text'
  AND scc.verbatim_tool_calling_enabled = true;

-- Carry the same value onto the synthetic text model rows the runtime reads it from. Restricting the
-- join to text connections keeps the `model_ref_id` -> `llm_id` reading valid.
UPDATE llms l
SET verbatim_tool_calling = true
FROM custom_endpoints ce
JOIN custom_endpoint_connections cec ON cec.connection_id = ce.connection_id
WHERE l.llm_id = ce.model_ref_id
  AND cec.capability = 'text'
  AND ce.verbatim_tool_calling = true;

ALTER TABLE server_capabilities_configs
  DROP COLUMN IF EXISTS verbatim_tool_calling_enabled;

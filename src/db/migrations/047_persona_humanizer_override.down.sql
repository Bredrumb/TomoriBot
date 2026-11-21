-- Rollback 047: drop the per-persona humanizer degree override.
--
-- WARNING: dropping this column discards all per-persona humanizer overrides. Every
-- persona reverts to the server-wide server_chat_configs.humanizer_degree. The column
-- is re-added as NULL (inherit) on the next forward migration run.

ALTER TABLE persona_configs DROP COLUMN IF EXISTS humanizer_degree;

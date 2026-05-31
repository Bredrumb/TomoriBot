-- 006_server_model_configs (down)
--
-- Drops the server_model_configs table created in the up migration.
-- Data loss: all active model selection state (llm_id, api_key, etc.)
-- for all servers is lost. Restore from a backup if this migration needs
-- to be reversed in production.
DROP TABLE IF EXISTS server_model_configs;

-- Rollback 031: drop the text model randomizer flag.
--
-- WARNING: dropping this column discards the per-server randomizer toggle. The column is
-- re-added defaulting OFF on the next forward migration run.

ALTER TABLE server_chat_configs DROP COLUMN IF EXISTS model_randomizer_enabled;

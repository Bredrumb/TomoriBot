DROP TRIGGER IF EXISTS update_persona_user_blocks_timestamp ON persona_user_blocks;
DROP TABLE IF EXISTS persona_user_blocks;

ALTER TABLE server_capabilities_configs
DROP COLUMN IF EXISTS user_blocking_enabled;

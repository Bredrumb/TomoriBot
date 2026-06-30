-- Rollback 026: remove fast-regeneration split-config toggles.

ALTER TABLE server_trigger_behavior_configs DROP COLUMN IF EXISTS fast_regeneration_enabled;
ALTER TABLE server_trigger_behavior_configs DROP COLUMN IF EXISTS fast_regeneration_retry_enabled;
ALTER TABLE server_trigger_behavior_configs DROP COLUMN IF EXISTS fast_regeneration_continue_enabled;

ALTER TABLE server_trigger_behavior_configs
  DROP COLUMN IF EXISTS fast_regeneration_retry_enabled,
  DROP COLUMN IF EXISTS fast_regeneration_continue_enabled;

SELECT add_column_if_not_exists('server_trigger_behavior_configs', 'fast_regeneration_retry_enabled', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('server_trigger_behavior_configs', 'fast_regeneration_continue_enabled', 'BOOLEAN', 'false');

-- Migration 026: Persist fast-regeneration feature toggles in split config.
--
-- /server fast-regeneration belongs with trigger/reply behavior controls. The legacy
-- monolithic config writer is gone, so these columns need to live in
-- server_trigger_behavior_configs for both command writes and TomoriState reads.

SELECT add_column_if_not_exists('server_trigger_behavior_configs', 'fast_regeneration_enabled', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('server_trigger_behavior_configs', 'fast_regeneration_retry_enabled', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('server_trigger_behavior_configs', 'fast_regeneration_continue_enabled', 'BOOLEAN', 'false');

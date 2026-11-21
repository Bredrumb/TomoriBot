-- Rollback for migration 035: drop the stat_counters telemetry table.
-- Indexes are dropped implicitly with the table.
DROP TABLE IF EXISTS stat_counters;

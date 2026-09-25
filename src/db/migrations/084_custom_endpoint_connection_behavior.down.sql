-- Rollback 084: drop per-connection endpoint behavior settings.

ALTER TABLE custom_endpoint_connections DROP CONSTRAINT IF EXISTS custom_endpoint_connections_behavior_object;
ALTER TABLE custom_endpoint_connections DROP COLUMN IF EXISTS behavior;

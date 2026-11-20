-- Migration 084: Per-connection endpoint behavior settings.
--
-- A connection is one backend server, and some settings describe the server rather than any model
-- it hosts (the first is unloading a local text model while ComfyUI needs the GPU). The object CHECK
-- keeps a stringified value from landing as a JSONB scalar string, which the runtime would read as
-- "no behavior" without any error.

ALTER TABLE custom_endpoint_connections
  ADD COLUMN IF NOT EXISTS behavior JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_endpoint_connections_behavior_object'
  ) THEN
    ALTER TABLE custom_endpoint_connections
      ADD CONSTRAINT custom_endpoint_connections_behavior_object CHECK (jsonb_typeof(behavior) = 'object');
  END IF;
END $$;

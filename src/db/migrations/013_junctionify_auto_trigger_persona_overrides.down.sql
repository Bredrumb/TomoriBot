-- Rollback 013: Restore autoch_persona_overrides JSONB column from the junction table.

-- 1. Restore the JSONB column with a safe default.
ALTER TABLE server_auto_trigger_configs
  ADD COLUMN IF NOT EXISTS autoch_persona_overrides JSONB NOT NULL DEFAULT '[]'::JSONB;

-- 2. Backfill from junction rows back into the JSONB column per server.
UPDATE server_auto_trigger_configs satc
SET autoch_persona_overrides = COALESCE(
  (
    SELECT JSONB_AGG(JSONB_BUILD_OBJECT('channel_disc_id', o.channel_disc_id, 'tomori_id', o.persona_id))
    FROM server_auto_trigger_persona_overrides o
    WHERE o.server_id = satc.server_id
  ),
  '[]'::JSONB
);

-- 3. Drop the junction table.
DROP TABLE IF EXISTS server_auto_trigger_persona_overrides;

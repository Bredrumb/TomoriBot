ALTER TABLE server_capabilities_configs
  ADD COLUMN IF NOT EXISTS dice_rolling_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE server_capabilities_configs ALTER COLUMN dice_rolling_enabled SET DEFAULT true;
UPDATE server_capabilities_configs SET dice_rolling_enabled = true;

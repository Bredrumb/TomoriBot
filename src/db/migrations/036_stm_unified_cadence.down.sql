-- Down-migration 036: restore create_nudge_override, drop nudge_injection_depth,
-- revert refresh_cadence default to 1. (Existing per-row cadence values are left as-is.)

ALTER TABLE server_stm_configs
  ADD COLUMN IF NOT EXISTS create_nudge_override TEXT;

ALTER TABLE server_stm_configs
  DROP COLUMN IF EXISTS nudge_injection_depth;

ALTER TABLE server_stm_configs
  ALTER COLUMN refresh_cadence SET DEFAULT 1;

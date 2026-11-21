-- Migration 055 down: restore `supersede` as the STM render-mode default.
--
-- Only the column default is reverted. Stored values are left alone because a
-- rewrite cannot distinguish rows this migration changed from rows an admin
-- later set to `crude_summary` on purpose.

ALTER TABLE server_stm_configs
  ALTER COLUMN render_mode SET DEFAULT 'supersede';

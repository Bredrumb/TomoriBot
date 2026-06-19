-- Down-migration 037: drop the STM content-block injection depth column.

ALTER TABLE server_stm_configs
  DROP COLUMN IF EXISTS content_injection_depth;

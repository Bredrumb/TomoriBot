-- Down-migration 054: drop the short-term memory capability toggle column.

ALTER TABLE server_capabilities_configs
  DROP COLUMN IF EXISTS short_term_memory_enabled;

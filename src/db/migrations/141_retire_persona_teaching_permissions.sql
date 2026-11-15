ALTER TABLE server_member_permissions_configs
  DROP COLUMN IF EXISTS attribute_memteaching_enabled,
  DROP COLUMN IF EXISTS sampledialogue_memteaching_enabled;

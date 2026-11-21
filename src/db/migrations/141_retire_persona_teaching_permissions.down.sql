ALTER TABLE server_member_permissions_configs
  ADD COLUMN IF NOT EXISTS attribute_memteaching_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sampledialogue_memteaching_enabled BOOLEAN NOT NULL DEFAULT false;

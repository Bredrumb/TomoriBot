-- Down-migration 060: drop capability ownership.
--
-- enabled_capabilities is left untouched: it never stopped meaning "currently on",
-- so the live routing is already correct without it. Ownership of a capability the
-- user has switched off is lost, which is the pre-060 behaviour being restored.

ALTER TABLE user_saved_provider_configs DROP COLUMN IF EXISTS assigned_capabilities;

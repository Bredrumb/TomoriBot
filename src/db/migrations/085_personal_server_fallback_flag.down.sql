-- Rollback 085: drop the account-wide server model fallback preference.
--
-- WARNING: dropping this column discards every account's choice, and the next forward migration
-- run re-adds it as if no account had ever turned the fallback off.

ALTER TABLE user_personalization_configs DROP COLUMN IF EXISTS personal_server_fallback_enabled;

-- Rollback for migration 056: drop the PluralKit identity data layer.
-- Indexes and triggers are dropped implicitly with their tables.
DROP TABLE IF EXISTS pluralkit_message_index;
DROP TABLE IF EXISTS pluralkit_system_accounts;
DROP TABLE IF EXISTS pluralkit_members;
DROP TABLE IF EXISTS pluralkit_systems;
DROP TABLE IF EXISTS external_identities;

ALTER TABLE users DROP COLUMN IF EXISTS pluralkit_enabled;

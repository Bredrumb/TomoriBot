-- Migration 057 down: drop the PluralKit host-account lookup index.

DROP INDEX IF EXISTS idx_pluralkit_system_accounts_host;

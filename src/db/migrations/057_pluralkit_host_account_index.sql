-- Migration 057: Index PluralKit host accounts for by-name member references.
--
-- Context building now resolves a member named in conversation but absent from the
-- history window, scoped to systems whose host account is in the guild. That lookup
-- filters on host_user_disc_id alone, which the table's (pk_system_id,
-- host_user_disc_id) primary key cannot serve: its leading column is the system.
-- Without this index the lane sequentially scans the link table on every context
-- rebuild.

CREATE INDEX IF NOT EXISTS idx_pluralkit_system_accounts_host
  ON pluralkit_system_accounts(host_user_disc_id);

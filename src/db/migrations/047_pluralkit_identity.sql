-- Migration 047: PluralKit integration data layer.
--
-- Canonical per-member identity for PluralKit system members, so a proxied
-- member gets its own `users` row and therefore its own personal memories
-- instead of degrading to server-wide (the fate this table family exists to
-- avoid). `external_identities` is a generic (kind, external_key) -> users-row
-- anchor; only kind = 'pluralkit_member' ships today, but the shape is ready
-- for future external identity kinds (e.g. 'matrix_user', 'persona') without
-- a redesign. Never key on names (volatile) -- member_uuid/system_uuid are
-- canonical; short hids are cached "just in case". Authorization (privacy,
-- blacklist, cooldowns, quotas) keys on the host Discord account
-- (pluralkit_system_accounts); conversational identity and memories key on
-- the member. See plans/pluralkit-integration.md.

-- 1. User opt-in toggle (Phase 1/4 gate this feature entirely on it).
-- NOT NULL matters: the Zod userSchema .default(false) only absorbs undefined,
-- so a NULL value would fail parsing and break loading the user row entirely.
SELECT add_column_if_not_exists('users', 'pluralkit_enabled', 'BOOLEAN', 'false', 'NOT NULL');
-- Backstop for databases that added this column nullable (pre-review draft of
-- this migration). Both statements are idempotent no-ops once converged.
UPDATE users SET pluralkit_enabled = false WHERE pluralkit_enabled IS NULL;
ALTER TABLE users ALTER COLUMN pluralkit_enabled SET NOT NULL;

-- 2. Generic external-identity anchor.
CREATE TABLE IF NOT EXISTS external_identities (
  external_identity_id SERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,
  external_key TEXT NOT NULL,
  user_id      INT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, external_key)
);

DROP TRIGGER IF EXISTS update_external_identities_timestamp ON external_identities;
CREATE TRIGGER update_external_identities_timestamp
BEFORE UPDATE ON external_identities
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- 3. PluralKit systems (cosmetic name/tag cache; system_uuid is canonical).
CREATE TABLE IF NOT EXISTS pluralkit_systems (
  pk_system_id SERIAL PRIMARY KEY,
  system_uuid  UUID UNIQUE NOT NULL,
  system_hid   TEXT NOT NULL,
  system_name  TEXT,
  system_tag   TEXT,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS update_pluralkit_systems_timestamp ON pluralkit_systems;
CREATE TRIGGER update_pluralkit_systems_timestamp
BEFORE UPDATE ON pluralkit_systems
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- 4. PluralKit members: the conversational identity behind an external_identities row.
CREATE TABLE IF NOT EXISTS pluralkit_members (
  pk_member_id          SERIAL PRIMARY KEY,
  pk_system_id          INT NOT NULL REFERENCES pluralkit_systems(pk_system_id) ON DELETE CASCADE,
  external_identity_id  INT NOT NULL UNIQUE REFERENCES external_identities(external_identity_id) ON DELETE CASCADE,
  member_uuid           UUID UNIQUE NOT NULL,
  member_hid            TEXT NOT NULL,
  display_name          TEXT,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pluralkit_members_system ON pluralkit_members(pk_system_id);

DROP TRIGGER IF EXISTS update_pluralkit_members_timestamp ON pluralkit_members;
CREATE TRIGGER update_pluralkit_members_timestamp
BEFORE UPDATE ON pluralkit_members
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- 5. Systems link 1..n Discord host accounts that proxy for them.
CREATE TABLE IF NOT EXISTS pluralkit_system_accounts (
  pk_system_id      INT NOT NULL REFERENCES pluralkit_systems(pk_system_id) ON DELETE CASCADE,
  host_user_disc_id TEXT NOT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pk_system_id, host_user_disc_id)
);

-- 6. Durable message -> identity index so context rebuilds survive restarts
--    without re-querying the PluralKit API. Rows are immutable (a message's
--    identity never changes), so there is no updated_at/trigger.
CREATE TABLE IF NOT EXISTS pluralkit_message_index (
  message_disc_id      TEXT PRIMARY KEY,
  external_identity_id INT NOT NULL REFERENCES external_identities(external_identity_id) ON DELETE CASCADE,
  sender_disc_id       TEXT NOT NULL,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Retention pruning deletes by age (governed by PLURALKIT_MESSAGE_INDEX_RETENTION_DAYS).
CREATE INDEX IF NOT EXISTS idx_pluralkit_message_index_created
  ON pluralkit_message_index(created_at);

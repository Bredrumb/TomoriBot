-- Migration 035: STM Customization — durable categories + per-server config.
--
-- Adds three tables:
--   server_stm_configs:   per-server refresh cadence, render mode, prompt overrides
--   stm_categories:       ordered (0-4) label+description sets per server
--   short_term_memories:  durable replacement for the volatile in-process STM Map
--
-- The cache layer (shortTermMemoryCache.ts) becomes write-through over
-- short_term_memories; callers' existing public signatures are unchanged.
-- Backward compat: every server gets one default 'summary' category at position 0
-- and cadence 1, preserving today's single-blob/always-nudge behavior exactly.

-- 1. server_stm_configs: split-config table mirroring other server_*_configs tables.
CREATE TABLE IF NOT EXISTS server_stm_configs (
  server_id                 INT         PRIMARY KEY REFERENCES servers(server_id) ON DELETE CASCADE,
  refresh_cadence           INT         NOT NULL DEFAULT 1,
  render_mode               TEXT        NOT NULL DEFAULT 'supersede'
                                          CHECK (render_mode IN ('supersede', 'crude_summary')),
  crude_message_count       INT         NOT NULL DEFAULT 6,
  tool_description_override TEXT,
  create_nudge_override     TEXT,
  update_nudge_override     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_server_stm_configs_timestamp ON server_stm_configs;
CREATE TRIGGER update_server_stm_configs_timestamp
  BEFORE UPDATE ON server_stm_configs
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- 2. stm_categories: ordered label+description set owned by a server (positions 0–4).
CREATE TABLE IF NOT EXISTS stm_categories (
  stm_category_id  SERIAL      PRIMARY KEY,
  server_id        INT         NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
  position         INT         NOT NULL CHECK (position BETWEEN 0 AND 4),
  label            TEXT        NOT NULL,
  description      TEXT        NOT NULL,
  UNIQUE (server_id, position)
);

CREATE INDEX IF NOT EXISTS idx_stm_categories_server ON stm_categories(server_id);

-- 3. short_term_memories: durable per-scope STM state.
--    Scope identity uses Discord snowflake TEXT (not INT FK) to avoid an async
--    server-id lookup on the synchronous hot-path cache write. The janitor uses
--    updated_at for time-based purge; referential integrity is enforced at the
--    category/config level via server_stm_configs and stm_categories (INT FKs).
CREATE TABLE IF NOT EXISTS short_term_memories (
  stm_id               SERIAL      PRIMARY KEY,
  server_disc_id       TEXT,                        -- Discord server snowflake; NULL for DMs
  user_disc_id         TEXT,                        -- Discord user snowflake; NULL for server-shared guild scope
  channel_disc_id      TEXT        NOT NULL,
  persona_id           INT,
  persona_lineage_id   INT,
  scope_kind           TEXT        NOT NULL CHECK (scope_kind IN ('server', 'user')),
  categories           JSONB       NOT NULL DEFAULT '{}',
  summary              TEXT,
  turns_since_refresh  INT         NOT NULL DEFAULT 0,
  last_refreshed_turn  INT         NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One durable row per scope identity (functional unique on NULLable columns).
CREATE UNIQUE INDEX IF NOT EXISTS idx_stm_scope_unique
  ON short_term_memories(
    scope_kind,
    COALESCE(server_disc_id, ''),
    COALESCE(user_disc_id,   ''),
    channel_disc_id,
    COALESCE(persona_id, 0)
  );

-- Index for the janitor's time-based purge query.
CREATE INDEX IF NOT EXISTS idx_stm_updated_at ON short_term_memories(updated_at);

DROP TRIGGER IF EXISTS update_short_term_memories_timestamp ON short_term_memories;
CREATE TRIGGER update_short_term_memories_timestamp
  BEFORE UPDATE ON short_term_memories
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- 4. Backfill server_stm_configs for all existing servers (defaults: cadence 1, supersede).
INSERT INTO server_stm_configs (server_id)
SELECT server_id FROM servers
ON CONFLICT (server_id) DO NOTHING;

-- 5. Seed one default 'summary' category (position 0) for every server that has none,
--    so a server with no STM configuration still resolves exactly one category and
--    behaves identically to today (single-blob summary, nudge every turn).
INSERT INTO stm_categories (server_id, position, label, description)
SELECT
  s.server_id,
  0,
  'summary',
  'A running summary of recent events, topics, and context from this conversation.'
FROM servers s
WHERE NOT EXISTS (
  SELECT 1 FROM stm_categories c WHERE c.server_id = s.server_id
);

-- Migration 035: Pre-aggregated usage statistics counter table.
--
-- Backs the stat-tracking data layer (plans/stat-tracking.md, Phase 1). Tracks
-- per-persona / per-server / per-user usage as bucketed daily counters rather
-- than an event log: one row per (server, user, persona lineage, metric,
-- metric_key, day), incremented by UPSERT. A day of 5,000 messages from one
-- user to one persona is a single row with count = 5000, so row count scales
-- with the breadth of distinct daily behavior, not raw message volume.
--
-- Design notes (see plan §2/§3 for the full rationale):
--   * persona_lineage_id is the cross-server persona identity anchor (same key
--     personal_memories / conditioning_history use). It is BIGINT to mirror
--     those tables exactly, with the established 0 sentinel for metrics that are
--     not persona-scoped (e.g. command_used). NOT NULL DEFAULT 0 lets it sit in
--     a genuine composite PRIMARY KEY without a COALESCE expression index.
--   * user_id is the internal users FK (never the Discord snowflake), so the
--     table gains ON DELETE CASCADE and native users joins for leaderboards.
--   * count is a generic accumulator: event metrics add 1, token/cost metrics
--     add the turn's token delta. Same column, same UPSERT mechanism.
--   * bucket is a plain DATE (finest grain ever queried). Weeks/months/all-time
--     compose via SUM, and a future downsampling job needs no schema change.
--   * This is high-frequency runtime telemetry: it follows the runtime-state
--     table pattern (FK cascades) and is excluded from export.

-- 1. Counter table. Composite PK doubles as the hot write-path index.
CREATE TABLE IF NOT EXISTS stat_counters (
  server_id          INT         NOT NULL REFERENCES servers(server_id) ON DELETE CASCADE,
  user_id            INT         NOT NULL REFERENCES users(user_id)     ON DELETE CASCADE,
  persona_lineage_id BIGINT      NOT NULL DEFAULT 0,  -- 0 sentinel = persona-agnostic metric
  metric             TEXT        NOT NULL,            -- enum-like metric name (see plan §5)
  metric_key         TEXT        NOT NULL DEFAULT '', -- command name / model id / hour / '' for scalars
  bucket             DATE        NOT NULL,            -- CURRENT_DATE at write time (daily grain)
  count              BIGINT      NOT NULL DEFAULT 0,  -- generic accumulator (events or token deltas)
  first_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, user_id, persona_lineage_id, metric, metric_key, bucket)
);

-- 2. Read-oriented secondary indexes on the dimension columns reads filter on.
--    NOTE: never index count or last_at — keeping the mutating columns out of
--    every index preserves Postgres HOT updates on hot counter rows (in-page,
--    no index churn), the single most important performance detail. "Top N" is
--    sorted at read time on a small result set, not via a count index.
CREATE INDEX IF NOT EXISTS idx_stat_counters_server_metric_bucket
  ON stat_counters(server_id, metric, bucket);
CREATE INDEX IF NOT EXISTS idx_stat_counters_user_metric_bucket
  ON stat_counters(user_id, metric, bucket);
CREATE INDEX IF NOT EXISTS idx_stat_counters_user_lineage_metric
  ON stat_counters(user_id, persona_lineage_id, metric);

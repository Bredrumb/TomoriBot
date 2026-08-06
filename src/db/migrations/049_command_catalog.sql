-- Migration 049: Command catalog dimension table (the "universe" of commands).
--
-- Powers the Grafana "least-used / never-used commands" panel. stat_counters is a
-- FACT table: a command only gets a `command_used` row once it has been invoked at
-- least once, so a never-used command is simply absent and cannot be surfaced by any
-- query over stat_counters alone (SQL can aggregate rows that exist, not rows that
-- don't). This table supplies the missing DIMENSION — the full set of registered
-- commands — so a LEFT JOIN can report every command with COALESCE(count, 0).
--
-- Design notes:
--   * command_name is the SAME space-joined full path stat_counters.metric_key stores
--     for the command_used metric (e.g. "update", "config humanizer",
--     "server welcome-channel set"), so the two tables JOIN directly with no mapping.
--   * This is NOT a hand-maintained list. The bot self-populates it on every startup
--     from the command list it already builds in loadCommandData() (see the
--     04_syncCommandCatalog clientReady handler + StatRepository.syncCommandCatalog),
--     upserting current commands and pruning any that no longer exist. Code is the
--     source of truth, so the catalog can never drift.
--   * category is the top-level command/category name, kept for grouping/filtering.
--   * Global (no server_id): the catalog is the same everywhere the bot runs.

CREATE TABLE IF NOT EXISTS command_catalog (
  command_name   TEXT        PRIMARY KEY,          -- space-joined full path (= stat_counters.metric_key)
  category       TEXT        NOT NULL,             -- top-level command/category name
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

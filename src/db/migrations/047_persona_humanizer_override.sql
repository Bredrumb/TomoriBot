-- Migration 047: Per-persona humanizer degree override.
--
-- Adds a nullable `humanizer_degree` column to `persona_configs`. When set (0-3), the
-- persona's assembled TomoriState overlays this value onto config.humanizer_degree at
-- load time, so all runtime consumers (providers, stream buffer, context templates) see
-- the persona-scoped value with no call-site changes. NULL (the default) inherits the
-- server-wide `server_chat_configs.humanizer_degree`.
--
-- Managed via `/config humanizer scope:persona`; the modal's "Inherit" choice writes NULL.
--
-- This migration is additive (one nullable column, no default, no backfill); no rows are
-- modified and no destructive changes occur.

-- 1. Add the column (idempotent), NULL = inherit global.
SELECT add_column_if_not_exists('persona_configs', 'humanizer_degree', 'INT', NULL, 'CHECK (humanizer_degree BETWEEN 0 AND 3)');

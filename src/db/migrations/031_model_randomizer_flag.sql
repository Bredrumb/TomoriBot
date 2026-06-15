-- Migration 031: Text model randomizer flag.
--
-- Adds an opt-in, server-level toggle to `server_chat_configs`. When enabled, each generation
-- turn picks a random model from the pool (primary model + configured fallbacks) to *lead* the
-- attempt list, breaking the bot out of a single model's habitual phrasing while keeping the
-- remaining models as the existing failover safety net.
--
-- The toggle mirrors `self_debug_enabled`: a single BOOLEAN defaulting OFF. Enabling is gated at
-- the command layer on the server having >=1 configured fallback, so the pool always has >=2
-- members and the toggle is never a silent no-op.
--
-- This migration is additive (one nullable-with-default boolean column); no rows are deleted and
-- no destructive changes occur.

-- 1. Add the column (idempotent), defaulting OFF.
SELECT add_column_if_not_exists('server_chat_configs', 'model_randomizer_enabled', 'BOOLEAN', 'false');

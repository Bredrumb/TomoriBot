-- Migration 025: Strict chat-completion compatibility flags.
--
-- Adds two independent, orthogonal toggles to both the catalog `llms` table and the
-- `custom_endpoints` table so any provider path (built-in or proxy) can declare which strict
-- chat-completion normalizations its backend requires:
--   * strict_role_alternation    — merge consecutive same-role turns + force a leading user turn.
--   * supports_prefix_completion — allow `prefix: true` on the trailing assistant prefill turn.
--
-- The column on the active llms row is the runtime source of truth (D4 "column-is-truth"); a
-- request-time providerRequires(...) set is the belt-and-suspenders safety net. The built-in
-- defaults backfilled here are also enforced going forward by the seed catalog + `check-models`.
--
-- This migration is additive (new nullable-with-default boolean columns + value backfills); no
-- rows are deleted and no destructive changes occur.

-- 1. Add the columns (idempotent) to both tables, defaulting OFF.
SELECT add_column_if_not_exists('llms', 'strict_role_alternation', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('llms', 'supports_prefix_completion', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('custom_endpoints', 'strict_role_alternation', 'BOOLEAN', 'false');
SELECT add_column_if_not_exists('custom_endpoints', 'supports_prefix_completion', 'BOOLEAN', 'false');

-- 2. Backfill the required built-in defaults on catalog llms rows.
--    Anthropic requires strict role alternation; DeepSeek and both Z.ai providers require prefix
--    completion. Synthetic custom-endpoint llms rows (llm_provider LIKE 'custom:%') are left OFF
--    and remain user-controlled via the custom-endpoint capability modal.
UPDATE llms
SET strict_role_alternation = true, updated_at = CURRENT_TIMESTAMP
WHERE llm_provider = 'anthropic' AND strict_role_alternation = false;

UPDATE llms
SET supports_prefix_completion = true, updated_at = CURRENT_TIMESTAMP
WHERE llm_provider IN ('deepseek', 'zai', 'zaicoding') AND supports_prefix_completion = false;

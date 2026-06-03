-- Rollback 025: drop the strict chat-completion compatibility flags.
--
-- WARNING: dropping these columns discards any per-endpoint toggles users configured on custom
-- endpoints. Built-in defaults are re-derived from the seed catalog on the next startup if the
-- columns are re-added.

ALTER TABLE llms DROP COLUMN IF EXISTS strict_role_alternation;
ALTER TABLE llms DROP COLUMN IF EXISTS supports_prefix_completion;
ALTER TABLE custom_endpoints DROP COLUMN IF EXISTS strict_role_alternation;
ALTER TABLE custom_endpoints DROP COLUMN IF EXISTS supports_prefix_completion;

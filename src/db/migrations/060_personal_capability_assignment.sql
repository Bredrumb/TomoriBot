-- Migration 060: separate "which provider owns a personal capability" from
-- "is that capability switched on".
--
-- enabled_capabilities carried both facts at once. Switching a capability off
-- removed it from every row, which destroyed the only record of the owning
-- provider. The next read re-derived an owner by sorting provider names
-- alphabetically, so a user whose text route was `deepseek` came back on
-- `anthropic` after one off/on cycle, and the re-enable wrote that wrong provider
-- through to the live route rather than only displaying it.
--
-- enabled_capabilities keeps its exact meaning (currently on) so every existing
-- read stays correct. Ownership moves to assigned_capabilities, which a disable
-- leaves alone. The invariant is enabled_capabilities ⊆ assigned_capabilities.

SELECT add_column_if_not_exists(
  'user_saved_provider_configs', 'assigned_capabilities', 'TEXT[]', 'ARRAY[]::TEXT[]'
);

-- Anything currently on is owned by the row serving it. A capability that is
-- currently off backfills to no owner: that fact was already destroyed by the old
-- disable path and cannot be recovered from this table, so those users re-pick once.
UPDATE user_saved_provider_configs
SET assigned_capabilities = enabled_capabilities
WHERE COALESCE(array_length(enabled_capabilities, 1), 0) > 0
  AND COALESCE(array_length(assigned_capabilities, 1), 0) = 0;

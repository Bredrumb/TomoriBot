-- Migration 038: Short-term memory capability toggle.
--
-- Adds a per-server on/off switch for the entire short-term memory subsystem,
-- surfaced in `/capabilities manage` alongside the other feature toggles.
--
-- When disabled (false):
--   - the update_short_term_memory tool is suppressed (not offered to the model), and
--   - NO STM is injected into context — same-channel block, cadence nudge, AND
--     other-channel ("remembers a recent conversation in #X") memories all go dark.
--
-- Disabling does NOT delete stored short_term_memories rows; flipping it back on
-- restores prior behavior. Defaults to TRUE so every existing server is unchanged.

ALTER TABLE server_capabilities_configs
  ADD COLUMN IF NOT EXISTS short_term_memory_enabled BOOLEAN NOT NULL DEFAULT true;

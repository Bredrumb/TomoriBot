-- Migration 037: Add STM content-block injection depth.
--
-- content_injection_depth controls WHERE the same/other-channel STM memory block
-- ("content block") is placed in the assembled context, mirroring the existing
-- nudge_injection_depth knob but with an extra sentinel:
--   -1 = default — keep the block anchored near the top as ambient knowledge
--        (current/legacy behavior; the block is NOT deferred to a dialogue depth).
--    0 = tail — just after the last dialogue turn (the "last dialogue item").
--    N = before the Nth dialogue TURN from the bottom (not pairs), same semantics
--        as nudge_injection_depth (clamps to the earliest turn when fewer exist).
--
-- When the content depth and nudge depth are equal, the content block is injected
-- first and the nudge second, so the nudge always lands just below the block.

ALTER TABLE server_stm_configs
  ADD COLUMN IF NOT EXISTS content_injection_depth INT NOT NULL DEFAULT -1;

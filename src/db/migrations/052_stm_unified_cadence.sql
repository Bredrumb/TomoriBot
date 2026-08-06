-- Migration 052: Unify STM nudge cadence — default 5, nudge depth, drop create_nudge_override.
--
-- crude_message_count is kept (now correctly used to cap crude-message render depth).
-- create_nudge_override is dropped (merged into update_nudge_override).
-- refresh_cadence default bumped 1 → 5; existing rows at the old default are updated.
-- nudge_injection_depth added. Depth counts individual dialogue TURNS from the
-- bottom (a user turn and a bot turn are separate turns, NOT pairs):
--   0 = tail (after every turn), 1 = before the final turn, 2 = before the latest
-- user/bot pair, N = before the Nth turn from the bottom. Default 2 keeps the nudge
-- just above the most recent exchange (mirrors the legacy create-nudge placement).

ALTER TABLE server_stm_configs
  ALTER COLUMN refresh_cadence SET DEFAULT 5;

UPDATE server_stm_configs
  SET refresh_cadence = 5
  WHERE refresh_cadence = 1;

ALTER TABLE server_stm_configs
  DROP COLUMN IF EXISTS create_nudge_override;

ALTER TABLE server_stm_configs
  ADD COLUMN IF NOT EXISTS nudge_injection_depth INT NOT NULL DEFAULT 2;

-- Migration 055: Make hybrid (summary + verbatim) the default STM render mode.
--
-- `crude_summary` renders the summary/category block AND the recent raw messages
-- for other-channel memories, where `supersede` showed only the summary block.
-- Same-channel rendering is unaffected either way: that channel's raw turns are
-- the live dialogue history, which is always present.
--
-- Existing rows are rewritten as well as the column default. The STM customization
-- feature is unreleased, so no server has deliberately chosen `supersede`; every
-- stored value is the old default rather than an admin decision.

ALTER TABLE server_stm_configs
  ALTER COLUMN render_mode SET DEFAULT 'crude_summary';

UPDATE server_stm_configs
  SET render_mode = 'crude_summary'
  WHERE render_mode = 'supersede';

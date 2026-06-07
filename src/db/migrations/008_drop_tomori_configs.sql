-- Migration 008: Drop legacy tomori_configs table
-- This table has been fully replaced by the 13 split server config tables.
-- All data has been backfilled by migration 007 and all application code
-- now routes through the split tables via ConfigRepository.
--
-- Pre-drop safety net: rescue contributor-added columns that landed on `main`
-- AFTER the refactor branch wrote migrations 002/007. These columns
-- (deliberate_tool_mode, deliberate_tool_context_turns, deliberate_tool_triggers,
-- channel_memory_enabled) were never copied to per-domain tables by 002/007 because
-- those migrations predate the columns. Without this guard, a pre-refactor main user
-- pulling the merged refactor would silently lose their settings.
--
-- Each block is wrapped in an information_schema check so refactor-only databases
-- (where tomori_configs never had these columns) skip the block cleanly.

-- 1. Rescue deliberate_tool_* columns into server_trigger_behavior_configs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tomori_configs' AND column_name = 'deliberate_tool_mode'
  ) THEN
    EXECUTE $rescue$
      UPDATE server_trigger_behavior_configs stbc
      SET deliberate_tool_mode = COALESCE(tc.deliberate_tool_mode, stbc.deliberate_tool_mode)
      FROM tomori_configs tc
      WHERE stbc.server_id = tc.server_id
    $rescue$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tomori_configs' AND column_name = 'deliberate_tool_context_turns'
  ) THEN
    EXECUTE $rescue$
      UPDATE server_trigger_behavior_configs stbc
      SET deliberate_tool_context_turns = tc.deliberate_tool_context_turns
      FROM tomori_configs tc
      WHERE stbc.server_id = tc.server_id
        AND tc.deliberate_tool_context_turns IS NOT NULL
    $rescue$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tomori_configs' AND column_name = 'deliberate_tool_triggers'
  ) THEN
    EXECUTE $rescue$
      UPDATE server_trigger_behavior_configs stbc
      SET deliberate_tool_triggers = COALESCE(tc.deliberate_tool_triggers, stbc.deliberate_tool_triggers)
      FROM tomori_configs tc
      WHERE stbc.server_id = tc.server_id
    $rescue$;
  END IF;
END
$$;

-- 2. Rescue channel_memory_enabled into server_memory_configs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tomori_configs' AND column_name = 'channel_memory_enabled'
  ) THEN
    EXECUTE $rescue$
      UPDATE server_memory_configs smc
      SET channel_memory_enabled = COALESCE(tc.channel_memory_enabled, smc.channel_memory_enabled)
      FROM tomori_configs tc
      WHERE smc.server_id = tc.server_id
    $rescue$;
  END IF;
END
$$;

-- 3. Final drop
DROP TABLE IF EXISTS tomori_configs;

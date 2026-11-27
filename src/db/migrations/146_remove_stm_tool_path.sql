DO $$
DECLARE
  retired_tool CONSTANT TEXT := 'update_short_term_memory';
  retired_prerequisite CONSTANT TEXT := 'tool:' || retired_tool;
  tool_match CONSTANT JSONB := jsonb_build_object('recommended_tools', jsonb_build_array(retired_tool));
  prerequisite_match CONSTANT JSONB := jsonb_build_object('prerequisites', jsonb_build_array(retired_prerequisite));
  store RECORD;
BEGIN
  ALTER TABLE server_natural_nudge_custom_idle_nudges
    DISABLE TRIGGER update_server_natural_nudge_custom_idle_nudges_timestamp;
  UPDATE server_natural_nudge_custom_idle_nudges
  SET recommended_tools = array_remove(recommended_tools, retired_tool),
      prerequisites = array_remove(prerequisites, retired_prerequisite)
  WHERE retired_tool = ANY(recommended_tools) OR retired_prerequisite = ANY(prerequisites);

  ALTER TABLE server_natural_nudge_custom_idle_nudges
    ENABLE TRIGGER update_server_natural_nudge_custom_idle_nudges_timestamp;

  -- The authored columns arrive through schema reconciliation, so replaying numbered migrations alone can omit them.
  FOR store IN
    SELECT table_name, column_name, timestamp_trigger
    FROM (VALUES
      ('persona_presets', 'natural_nudge_idle_nudges', NULL),
      ('persona_natural_nudge_configs', 'authored_idle_nudges', 'update_persona_natural_nudge_configs_timestamp')
    ) AS stores(table_name, column_name, timestamp_trigger)
    JOIN pg_attribute ON attrelid = to_regclass(table_name) AND attname = column_name AND NOT attisdropped
  LOOP
    IF store.timestamp_trigger IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER %I', store.table_name, store.timestamp_trigger);
    END IF;

    EXECUTE format($cleanup$
      UPDATE %1$I
      SET %2$I = (
        SELECT jsonb_agg(
          CASE WHEN jsonb_typeof(nudge) = 'object' THEN
            nudge
            || CASE WHEN nudge @> $1
              THEN jsonb_build_object('recommended_tools', (nudge->'recommended_tools') - $3)
              ELSE '{}'::jsonb END
            || CASE WHEN nudge @> $2
              THEN jsonb_build_object('prerequisites', (nudge->'prerequisites') - $4)
              ELSE '{}'::jsonb END
          ELSE nudge END
          ORDER BY position
        )
        FROM jsonb_array_elements(%2$I) WITH ORDINALITY AS entries(nudge, position)
      )
      WHERE %2$I @> jsonb_build_array($1) OR %2$I @> jsonb_build_array($2)
    $cleanup$, store.table_name, store.column_name)
    USING tool_match, prerequisite_match, retired_tool, retired_prerequisite;

    IF store.timestamp_trigger IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER %I', store.table_name, store.timestamp_trigger);
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE server_stm_configs
  DROP COLUMN IF EXISTS tool_description_override,
  DROP COLUMN IF EXISTS update_nudge_override,
  DROP COLUMN IF EXISTS nudge_injection_depth;

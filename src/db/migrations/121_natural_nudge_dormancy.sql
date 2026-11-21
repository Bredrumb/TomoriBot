SELECT add_column_if_not_exists('server_natural_nudge_runtime_state', 'last_direct_chat_at', 'TIMESTAMPTZ');

CREATE INDEX IF NOT EXISTS idx_natural_nudge_runtime_direct_chat
  ON server_natural_nudge_runtime_state(last_direct_chat_at) WHERE last_direct_chat_at IS NOT NULL;

WITH measured_activity AS (
  SELECT sc.server_id,
    SUM(sc.count * CASE WHEN sc.metric_key = 'reward' THEN 3 ELSE 1 END
      * POWER(0.5::double precision, ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - sc.bucket)::double precision / 3))
      / (SELECT SUM(POWER(0.5::double precision, age::double precision / 3)) FROM generate_series(0, 29) AS age) AS heat
  FROM stat_counters sc
  WHERE sc.metric = 'message_sent'
    AND sc.bucket BETWEEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 29
      AND (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
  GROUP BY sc.server_id
), recent_channel_activity AS (
  SELECT sc.server_id, MAX(sc.last_at) AS last_at
  FROM stat_counters sc
  WHERE sc.metric = 'channel_turn'
    AND sc.bucket >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 14
    AND sc.last_at > NOW() - INTERVAL '14 days'
  GROUP BY sc.server_id
)
INSERT INTO server_natural_nudge_runtime_state (server_id, last_direct_chat_at)
SELECT s.server_id, activity.last_at
FROM servers s
JOIN measured_activity measured ON measured.server_id = s.server_id
JOIN recent_channel_activity activity ON activity.server_id = s.server_id
LEFT JOIN server_natural_nudge_configs config ON config.server_id = s.server_id
LEFT JOIN server_channel_scope_configs scope ON scope.server_id = s.server_id
WHERE COALESCE(s.is_dm_channel, false) = false
  AND (COALESCE(config.idle_nudges_enabled, true) OR COALESCE(config.active_nudges_enabled, true))
  AND measured.heat >= 1
  AND measured.heat + COALESCE((to_jsonb(config) ->> 'heat_offset')::int, 0) >= 1
  AND (CARDINALITY(config.channel_disc_ids) > 0 OR EXISTS (
    SELECT 1 FROM stat_counters channel
    WHERE channel.server_id = s.server_id AND channel.metric = 'channel_turn'
      AND channel.bucket >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 13
      AND NOT (channel.metric_key = ANY(COALESCE(scope.rp_channel_ids, ARRAY[]::text[])))
  ))
ON CONFLICT (server_id) DO UPDATE SET last_direct_chat_at = EXCLUDED.last_direct_chat_at
WHERE server_natural_nudge_runtime_state.last_direct_chat_at IS NULL;

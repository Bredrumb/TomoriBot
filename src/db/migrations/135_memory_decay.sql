SELECT add_column_if_not_exists('server_memories', 'decay_days', 'INT', '0', 'NOT NULL');
SELECT add_column_if_not_exists('server_memories', 'decay_counted_on', 'DATE');
SELECT add_column_if_not_exists('server_memories', 'reinforced_on', 'DATE');
SELECT add_column_if_not_exists('server_memories', 'manually_written', 'BOOLEAN', 'false', 'NOT NULL');
SELECT add_column_if_not_exists('personal_memories', 'decay_days', 'INT', '0', 'NOT NULL');
SELECT add_column_if_not_exists('personal_memories', 'decay_counted_on', 'DATE');
SELECT add_column_if_not_exists('personal_memories', 'reinforced_on', 'DATE');
SELECT add_column_if_not_exists('personal_memories', 'manually_written', 'BOOLEAN', 'false', 'NOT NULL');

-- The literals 100 and 7 match the default memory cap and MEMORY_DORMANT_DAYS.
WITH ranked AS (
  SELECT server_memory_id,
    row_number() OVER (PARTITION BY server_id, persona_lineage_id ORDER BY created_at DESC, server_memory_id DESC) AS rank
  FROM server_memories
)
UPDATE server_memories m SET decay_days = CASE WHEN r.rank > 100 THEN 7 ELSE 0 END
FROM ranked r WHERE r.server_memory_id = m.server_memory_id;

WITH scopes AS (
  SELECT DISTINCT user_id, persona_lineage_id FROM personal_memories WHERE persona_lineage_id <> 0
  UNION ALL
  SELECT DISTINCT m.user_id, 0::BIGINT FROM personal_memories m
  WHERE NOT EXISTS (
    SELECT 1 FROM personal_memories specific WHERE specific.user_id = m.user_id AND specific.persona_lineage_id <> 0
  )
), ranked AS (
  SELECT m.personal_memory_id,
    row_number() OVER (PARTITION BY s.user_id, s.persona_lineage_id ORDER BY m.created_at DESC, m.personal_memory_id DESC) AS rank
  FROM scopes s JOIN personal_memories m
    ON m.user_id = s.user_id AND (m.persona_lineage_id = s.persona_lineage_id OR m.persona_lineage_id = 0)
), demotions AS (
  SELECT personal_memory_id, bool_and(rank > 100) AS dormant FROM ranked GROUP BY personal_memory_id
)
UPDATE personal_memories m SET decay_days = CASE WHEN d.dormant THEN 7 ELSE 0 END
FROM demotions d WHERE d.personal_memory_id = m.personal_memory_id;

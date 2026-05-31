-- Add copy-on-write persona preset pointers.

SELECT add_column_if_not_exists('personas', 'is_pointer', 'BOOLEAN', 'false', 'NOT NULL');
SELECT add_column_if_not_exists('personas', 'preset_lineage_id', 'BIGINT');
SELECT add_column_if_not_exists('personas', 'preset_language', 'TEXT');

UPDATE personas SET is_pointer = false WHERE is_pointer IS NULL;
ALTER TABLE personas ALTER COLUMN is_pointer SET DEFAULT false;
ALTER TABLE personas ALTER COLUMN is_pointer SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_personas_pointer_preset
  ON personas(preset_lineage_id, preset_language)
  WHERE is_pointer = true;

WITH candidate_matches AS (
  SELECT
    p.persona_id,
    pp.preset_lineage_id,
    pp.preset_language,
    ROW_NUMBER() OVER (
      PARTITION BY p.persona_id
      ORDER BY (pp.preset_language = 'en-US') DESC, pp.persona_preset_id ASC
    ) AS match_rank
  FROM personas p
  LEFT JOIN persona_configs pc ON pc.persona_id = p.persona_id
  JOIN persona_presets pp ON pp.preset_lineage_id IS NOT NULL
  WHERE COALESCE(p.is_pointer, false) = false
    AND p.persona_lineage_id = pp.preset_lineage_id
    AND COALESCE(
      (
        SELECT array_agg(pa.attribute_text ORDER BY pa.attribute_order)
        FROM persona_attributes pa
        WHERE pa.persona_id = p.persona_id
      ),
      COALESCE(p.attribute_list, ARRAY[]::TEXT[])
    ) = COALESCE(pp.preset_attribute_list, ARRAY[]::TEXT[])
    AND COALESCE(
      (
        SELECT array_agg(pa.is_public ORDER BY pa.attribute_order)
        FROM persona_attributes pa
        WHERE pa.persona_id = p.persona_id
      ),
      ARRAY(
        SELECT false
        FROM generate_subscripts(COALESCE(p.attribute_list, ARRAY[]::TEXT[]), 1)
      )
    ) = ARRAY(
      SELECT COALESCE(pp.preset_attribute_public_flags[attr_index], false)
      FROM generate_subscripts(COALESCE(pp.preset_attribute_list, ARRAY[]::TEXT[]), 1) AS attr_index
      ORDER BY attr_index
    )
    AND COALESCE(p.sample_dialogues_in, ARRAY[]::TEXT[]) = COALESCE(pp.preset_sample_dialogues_in, ARRAY[]::TEXT[])
    AND COALESCE(p.sample_dialogues_out, ARRAY[]::TEXT[]) = COALESCE(pp.preset_sample_dialogues_out, ARRAY[]::TEXT[])
    AND COALESCE(pc.trigger_words, ARRAY[]::TEXT[]) = COALESCE(pp.preset_trigger_words, ARRAY[]::TEXT[])
    AND pc.persona_prompt IS NOT DISTINCT FROM NULLIF(BTRIM(pp.persona_preset_desc), '')
)
UPDATE personas p
SET
  is_pointer = true,
  preset_lineage_id = cm.preset_lineage_id,
  preset_language = cm.preset_language,
  updated_at = NOW()
FROM candidate_matches cm
WHERE p.persona_id = cm.persona_id
  AND cm.match_rank = 1;

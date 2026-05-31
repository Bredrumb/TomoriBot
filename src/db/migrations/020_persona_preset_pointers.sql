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
    AND (
      -- Exact attribute match
      COALESCE(
        (
          SELECT array_agg(pa.attribute_text ORDER BY pa.attribute_order)
          FROM persona_attributes pa
          WHERE pa.persona_id = p.persona_id
        ),
        COALESCE(p.attribute_list, ARRAY[]::TEXT[])
      ) = COALESCE(pp.preset_attribute_list, ARRAY[]::TEXT[])
      -- OR: match after stripping the legacy description attribute.
      -- The old bot prepended "{bot}'s Description: <desc>" (or bare <desc>) as an
      -- extra attribute entry.  The new schema stores the description in
      -- persona_preset_desc, so production copies carry one extra attribute that the
      -- current preset_attribute_list does not include.
      OR (
        SELECT array_agg(pa.attribute_text ORDER BY pa.attribute_order)
        FROM persona_attributes pa
        WHERE pa.persona_id = p.persona_id
          AND pa.attribute_text != pp.persona_preset_desc
          AND pa.attribute_text != '{bot}''s Description: ' || pp.persona_preset_desc
      ) = COALESCE(pp.preset_attribute_list, ARRAY[]::TEXT[])
    )
    AND (
      -- Exact public-flag match
      COALESCE(
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
      -- OR persona predates the is_public concept: migration 019 backfills all existing
      -- personas with is_public=false, so no attribute will ever be true on a legacy row.
      -- Requiring an exact match against the preset's flags (which may have some true) would
      -- incorrectly block every production persona from being identified as a pointer.
      OR NOT EXISTS (
        SELECT 1 FROM persona_attributes pa
        WHERE pa.persona_id = p.persona_id AND pa.is_public = true
      )
    )
    -- Sample dialogues are intentionally not compared here. Dialogues are the most
    -- frequently updated part of a preset (developer content changes, text renames
    -- such as "Tomoris" → "personas"). Production personas hold the text from when
    -- they were first created, so an exact match against the current seed would
    -- block every legitimate pointer from being identified. The causal link is
    -- established by persona_lineage_id = preset_lineage_id (stamped at creation);
    -- attribute + prompt matching provides sufficient divergence detection.
    --
    -- Trigger words are intentionally not compared here. Triggers are server-context-
    -- dependent: when multiple preset personas share a server (e.g. all four Tomori
    -- sisters via /persona default), the shared "tomori" trigger can only be assigned
    -- to one of them to avoid conflicts. Users also add localized triggers (e.g.
    -- "アフェル"). The preset's trigger list is a template, not a fingerprint of an
    -- unmodified copy, so requiring a match would incorrectly exclude legitimate pointers.
    AND (
      pc.persona_prompt IS NOT DISTINCT FROM NULLIF(BTRIM(pp.persona_preset_desc), '')
      OR pc.persona_prompt IS NULL
      OR EXISTS (
        SELECT 1 FROM persona_attributes pa
        WHERE pa.persona_id = p.persona_id
          AND (
            pa.attribute_text = pp.persona_preset_desc
            OR pa.attribute_text = '{bot}''s Description: ' || pp.persona_preset_desc
          )
      )
    )
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

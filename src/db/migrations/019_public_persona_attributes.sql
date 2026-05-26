-- Add first-class persona attributes with public/private visibility metadata.
-- `personas.attribute_list` remains as a compatibility mirror for existing
-- import/export/status/generation paths.

CREATE TABLE IF NOT EXISTS persona_attributes (
  attribute_id SERIAL PRIMARY KEY,
  persona_id INT NOT NULL,
  attribute_order INT NOT NULL,
  attribute_text TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (persona_id) REFERENCES personas(persona_id) ON DELETE CASCADE,
  UNIQUE (persona_id, attribute_order),
  CHECK (attribute_order >= 1)
);

CREATE INDEX IF NOT EXISTS idx_persona_attributes_persona_public
  ON persona_attributes(persona_id, is_public, attribute_order);

INSERT INTO persona_attributes (persona_id, attribute_order, attribute_text, is_public)
SELECT
  p.persona_id,
  attr.ord::INT,
  attr.attribute_text,
  false
FROM personas p
CROSS JOIN LATERAL unnest(COALESCE(p.attribute_list, ARRAY[]::TEXT[]))
  WITH ORDINALITY AS attr(attribute_text, ord)
WHERE NOT EXISTS (
  SELECT 1
  FROM persona_attributes pa
  WHERE pa.persona_id = p.persona_id
)
ON CONFLICT (persona_id, attribute_order) DO NOTHING;

DROP TRIGGER IF EXISTS update_persona_attributes_timestamp ON persona_attributes;
CREATE TRIGGER update_persona_attributes_timestamp
BEFORE UPDATE ON persona_attributes
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

ALTER TABLE persona_presets
  ADD COLUMN IF NOT EXISTS preset_attribute_public_flags BOOLEAN[] DEFAULT ARRAY[]::BOOLEAN[];

CREATE OR REPLACE FUNCTION persona_preset_rebase_bool_array(
  current_bool_array BOOLEAN[],
  current_text_array TEXT[],
  old_base_text_array TEXT[],
  new_base_bool_array BOOLEAN[]
) RETURNS BOOLEAN[] AS $$
DECLARE
  current_flags BOOLEAN[] := COALESCE(current_bool_array, ARRAY[]::BOOLEAN[]);
  current_values TEXT[] := COALESCE(current_text_array, ARRAY[]::TEXT[]);
  old_base_values TEXT[] := COALESCE(old_base_text_array, ARRAY[]::TEXT[]);
  new_base_flags BOOLEAN[] := COALESCE(new_base_bool_array, ARRAY[]::BOOLEAN[]);
  current_len INT := COALESCE(array_length(current_values, 1), 0);
  old_base_len INT := COALESCE(array_length(old_base_values, 1), 0);
  local_tail BOOLEAN[] := ARRAY[]::BOOLEAN[];
  idx INT;
BEGIN
  IF current_len > old_base_len THEN
    FOR idx IN (old_base_len + 1)..current_len LOOP
      local_tail := array_append(local_tail, COALESCE(current_flags[idx], false));
    END LOOP;
  END IF;

  RETURN new_base_flags || local_tail;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION persona_preset_snapshot_bool_array(
  snapshot JSONB,
  snapshot_key TEXT
) RETURNS BOOLEAN[] AS $$
BEGIN
  IF snapshot IS NULL OR jsonb_typeof(snapshot -> snapshot_key) <> 'array' THEN
    RETURN ARRAY[]::BOOLEAN[];
  END IF;

  RETURN ARRAY(
    SELECT item.value::BOOLEAN
    FROM jsonb_array_elements_text(snapshot -> snapshot_key) AS item(value)
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

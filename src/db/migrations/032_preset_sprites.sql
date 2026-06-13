-- Shared, official preset sprites resolved live by pointer personas.
--
-- Unlike persona_sprites (keyed by persona_id, one set per server persona),
-- preset_sprites are keyed by the official preset identity
-- (preset_lineage_id, preset_language) and shared across every server whose
-- default persona still points at that preset. Images live once in shared
-- object storage (the `presets/` prefix) and are referenced by URL, so N servers
-- cost one copy. A pointer persona resolves these live; materialization copies
-- them into persona_sprites (reusing the shared URL, not duplicating bytes).

CREATE TABLE IF NOT EXISTS preset_sprites (
  preset_sprite_id SERIAL PRIMARY KEY,
  preset_lineage_id BIGINT NOT NULL,
  preset_language TEXT NOT NULL,
  sprite_name TEXT NOT NULL,
  sprite_key TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  usage_instructions TEXT NOT NULL DEFAULT '',
  is_identity BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (preset_lineage_id, preset_language, sprite_key),
  CHECK (char_length(btrim(sprite_name)) BETWEEN 1 AND 64),
  CHECK (char_length(btrim(sprite_key)) BETWEEN 1 AND 64),
  CHECK (char_length(usage_instructions) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_preset_sprites_lineage_language
  ON preset_sprites(preset_lineage_id, preset_language);

DROP TRIGGER IF EXISTS update_preset_sprites_timestamp ON preset_sprites;
CREATE TRIGGER update_preset_sprites_timestamp
BEFORE UPDATE ON preset_sprites
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

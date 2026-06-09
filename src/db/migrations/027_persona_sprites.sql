-- Persona sprite images for render-modifier delivery.
-- A sprite belongs to one persona and is selected by a normalized label key
-- parsed from generated prefixes like "Tomori (mad):".

CREATE TABLE IF NOT EXISTS persona_sprites (
  sprite_id SERIAL PRIMARY KEY,
  persona_id INT NOT NULL,
  sprite_name TEXT NOT NULL,
  sprite_key TEXT NOT NULL,
  avatar_url TEXT NOT NULL,
  usage_instructions TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (persona_id) REFERENCES personas(persona_id) ON DELETE CASCADE,
  UNIQUE (persona_id, sprite_key),
  CHECK (char_length(btrim(sprite_name)) BETWEEN 1 AND 64),
  CHECK (char_length(btrim(sprite_key)) BETWEEN 1 AND 64),
  CHECK (char_length(usage_instructions) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_persona_sprites_persona
  ON persona_sprites(persona_id, sprite_key);

DROP TRIGGER IF EXISTS update_persona_sprites_timestamp ON persona_sprites;
CREATE TRIGGER update_persona_sprites_timestamp
BEFORE UPDATE ON persona_sprites
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

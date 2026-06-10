-- Maps webhook-delivered sprite messages to the sprite label they rendered with.
-- Sprite messages display a clean persona name in Discord (no "(sprite)" suffix);
-- this table lets context rebuilding recover the decorated "Name (sprite):" label
-- for the model. Rows are immutable and pruned after a configurable retention.

CREATE TABLE IF NOT EXISTS persona_sprite_messages (
  message_disc_id TEXT PRIMARY KEY,
  persona_id INT NOT NULL,
  sprite_name TEXT NOT NULL,
  channel_disc_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (persona_id) REFERENCES personas(persona_id) ON DELETE CASCADE,
  CHECK (char_length(btrim(sprite_name)) BETWEEN 1 AND 64)
);

-- Retention pruning deletes by age.
CREATE INDEX IF NOT EXISTS idx_persona_sprite_messages_created
  ON persona_sprite_messages(created_at);

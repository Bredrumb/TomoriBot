ALTER TABLE server_capabilities_configs
ADD COLUMN IF NOT EXISTS user_blocking_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS persona_user_blocks (
  server_id INT NOT NULL,
  persona_id INT NOT NULL,
  user_disc_id TEXT NOT NULL,
  block_type TEXT NOT NULL CHECK (block_type IN ('mute', 'block')),
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (server_id, persona_id, user_disc_id),
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (persona_id) REFERENCES personas(persona_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_persona_user_blocks_persona_active
ON persona_user_blocks(server_id, persona_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_persona_user_blocks_user_active
ON persona_user_blocks(server_id, user_disc_id, expires_at);

DROP TRIGGER IF EXISTS update_persona_user_blocks_timestamp ON persona_user_blocks;
CREATE TRIGGER update_persona_user_blocks_timestamp
BEFORE UPDATE ON persona_user_blocks
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Migration 013: Replace autoch_persona_overrides JSONB with a canonical junction table.
--
-- autoch_persona_overrides was a JSONB array of {channel_disc_id, tomori_id} entries on
-- server_auto_trigger_configs. The tomori_id field is a genuine FK — junction-ifying it
-- gains ON DELETE CASCADE when a persona is deleted (previously left dangling JSONB).
--
-- Backfill skips entries where the referenced persona no longer exists so that stale JSONB
-- from deleted personas does not block the migration.

-- 1. Create the junction table with FK cascades on both sides.
CREATE TABLE IF NOT EXISTS server_auto_trigger_persona_overrides (
  server_id       INT NOT NULL,
  channel_disc_id TEXT NOT NULL,
  persona_id      INT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (server_id, channel_disc_id),
  FOREIGN KEY (server_id)  REFERENCES servers(server_id)      ON DELETE CASCADE,
  FOREIGN KEY (persona_id) REFERENCES tomoris(tomori_id)      ON DELETE CASCADE
);

-- 2. Backfill from JSONB, skipping dangling persona references.
INSERT INTO server_auto_trigger_persona_overrides (server_id, channel_disc_id, persona_id)
SELECT
  satc.server_id,
  (entry->>'channel_disc_id')::TEXT,
  (entry->>'tomori_id')::INT
FROM server_auto_trigger_configs satc
CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(satc.autoch_persona_overrides) AS entry
WHERE
  (entry->>'channel_disc_id') IS NOT NULL
  AND (entry->>'channel_disc_id') <> ''
  AND (entry->>'tomori_id') ~ '^\d+$'
  AND EXISTS (
    SELECT 1 FROM tomoris t WHERE t.tomori_id = (entry->>'tomori_id')::INT
  )
ON CONFLICT (server_id, channel_disc_id) DO NOTHING;

-- 3. Drop the JSONB column now that data is canonical in the junction table.
ALTER TABLE server_auto_trigger_configs DROP COLUMN IF EXISTS autoch_persona_overrides;

-- Migration 058: move the personal model fallback chain off the per-provider
-- rows onto one chain per user.
--
-- user_saved_provider_configs.fallback_model_refs stored one chain per provider
-- row, but only the row enabled for the "text" capability is ever read at
-- inference. A chain configured while a different provider was active therefore
-- became unreachable the moment the user switched providers, and no sequence of
-- /personal model fallback runs could build a chain spanning two providers: each
-- run edited a different row. The server side never had this problem because
-- server_chat_configs.fallback_model_refs is a single provider-agnostic list, so
-- this table gives the personal side the same shape.

CREATE TABLE IF NOT EXISTS user_fallback_chains (
  user_id             INT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  fallback_model_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_user_fallback_chains_timestamp ON user_fallback_chains;
CREATE TRIGGER update_user_fallback_chains_timestamp
  BEFORE UPDATE ON user_fallback_chains
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Backfill. Writers passed an already-serialized string to a JSONB bind
-- parameter, so most historical rows hold a JSON *string* ("[{...}]") rather
-- than an array; `#>> '{}'` unwraps that one level before the re-cast. Copying
-- the column verbatim would land a jsonb string in the new table and every
-- reader would normalize it to an empty chain, making this migration a no-op
-- for exactly the users who had a chain worth migrating.
INSERT INTO user_fallback_chains (user_id, fallback_model_refs)
SELECT DISTINCT ON (user_id)
  user_id,
  normalized
FROM (
  SELECT
    user_id,
    provider,
    CASE jsonb_typeof(COALESCE(fallback_model_refs, '[]'::JSONB))
      WHEN 'array'  THEN COALESCE(fallback_model_refs, '[]'::JSONB)
      WHEN 'string' THEN COALESCE((fallback_model_refs #>> '{}')::JSONB, '[]'::JSONB)
      ELSE '[]'::JSONB
    END AS normalized
  FROM user_saved_provider_configs
) AS candidates
WHERE jsonb_typeof(normalized) = 'array'
-- A user with chains on several provider rows keeps the longest one; provider
-- name only breaks a genuine tie so the result does not depend on scan order.
ORDER BY user_id, jsonb_array_length(normalized) DESC, provider
ON CONFLICT (user_id) DO NOTHING;

-- Users with no chain get no row: the reader returns an empty chain for a missing
-- row, and the writer upserts, so seeding one row per user would only add bulk.

-- user_saved_provider_configs.fallback_model_refs is left in place and is no
-- longer read or written. A follow-up migration drops it once the new path is
-- confirmed in production.

-- Migration 037: Full-text search on document_chunks for hybrid retrieval.
--
-- Adds a tsvector column (tsv) to document_chunks so that vector similarity
-- search and keyword/FTS search can be merged with Reciprocal Rank Fusion.
-- This is especially effective for proper-noun-heavy content (character names,
-- place names) where embedding similarity alone can miss exact-match hits.
--
-- Changes are additive: one nullable column, one GIN index, one trigger.
-- The RAG schema is optional and is not installed when pgvector is unavailable.
-- In that configuration document_chunks does not exist, so this migration must
-- be a no-op rather than preventing the whole application from starting.
DO $$
BEGIN
  IF to_regclass('public.document_chunks') IS NULL THEN
    RAISE NOTICE 'Skipping document_chunks FTS migration: RAG schema is not installed.';
    RETURN;
  END IF;

  -- 1. Add the tsvector column (no-op if already present)
  PERFORM add_column_if_not_exists('document_chunks', 'tsv', 'TSVECTOR');

  -- 2. Backfill existing rows
  UPDATE document_chunks
  SET tsv = to_tsvector('english', content)
  WHERE tsv IS NULL;

  -- 3. GIN index for fast @@ lookups
  CREATE INDEX IF NOT EXISTS idx_document_chunks_tsv ON document_chunks USING GIN(tsv);

  -- 4. Trigger function: keeps tsv in sync whenever content is written
  CREATE OR REPLACE FUNCTION document_chunks_tsv_update()
  RETURNS TRIGGER AS $document_chunks_tsv$
  BEGIN
    NEW.tsv := to_tsvector('english', NEW.content);
    RETURN NEW;
  END;
  $document_chunks_tsv$ LANGUAGE plpgsql;

  -- 5. Attach trigger (drop first so re-running this migration is safe)
  DROP TRIGGER IF EXISTS trg_document_chunks_tsv ON document_chunks;
  CREATE TRIGGER trg_document_chunks_tsv
  BEFORE INSERT OR UPDATE OF content
  ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION document_chunks_tsv_update();
END;
$$;

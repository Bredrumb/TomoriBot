DO $$
BEGIN
  IF to_regclass('public.document_chunks') IS NULL THEN
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION document_chunks_tsv_update()
  RETURNS TRIGGER AS $document_chunks_tsv$
  BEGIN
    NEW.tsv := to_tsvector('english', NEW.content);
    RETURN NEW;
  END;
  $document_chunks_tsv$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_document_chunks_tsv ON document_chunks;
  CREATE TRIGGER trg_document_chunks_tsv
  BEFORE INSERT OR UPDATE OF content
  ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION document_chunks_tsv_update();

  ALTER TABLE document_chunks DROP COLUMN IF EXISTS lex_text;
  UPDATE document_chunks SET tsv = to_tsvector('english', content);
END;
$$;

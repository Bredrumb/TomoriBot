DO $$
BEGIN
  IF to_regclass('public.document_chunks') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS lex_text TEXT;

  CREATE OR REPLACE FUNCTION document_chunks_tsv_update()
  RETURNS TRIGGER AS $document_chunks_tsv$
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.content IS DISTINCT FROM OLD.content AND NEW.lex_text IS NOT DISTINCT FROM OLD.lex_text THEN
        NEW.lex_text := NULL;
      END IF;
    END IF;
    NEW.tsv := to_tsvector('russian', COALESCE(NEW.lex_text, NEW.content));
    RETURN NEW;
  END;
  $document_chunks_tsv$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_document_chunks_tsv ON document_chunks;
  CREATE TRIGGER trg_document_chunks_tsv
  BEFORE INSERT OR UPDATE OF content, lex_text
  ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION document_chunks_tsv_update();

  UPDATE document_chunks SET tsv = to_tsvector('russian', COALESCE(lex_text, content));
END;
$$;

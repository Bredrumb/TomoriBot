DO $$
BEGIN
  IF to_regclass('public.document_chunks') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS heading_path JSONB;
END;
$$;

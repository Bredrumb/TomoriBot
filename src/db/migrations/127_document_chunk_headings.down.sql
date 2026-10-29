DO $$
BEGIN
  IF to_regclass('public.document_chunks') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE document_chunks DROP COLUMN IF EXISTS heading_path;
END;
$$;

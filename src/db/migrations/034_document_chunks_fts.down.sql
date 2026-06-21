-- Rollback 034: remove FTS support from document_chunks.
--
-- WARNING: dropping these removes the GIN index, the tsv column, and the
-- auto-update trigger. Re-running the forward migration will re-add and
-- re-backfill everything, but the index rebuild takes time on large tables.

DROP TRIGGER IF EXISTS trg_document_chunks_tsv ON document_chunks;
DROP FUNCTION IF EXISTS document_chunks_tsv_update();
DROP INDEX IF EXISTS idx_document_chunks_tsv;
ALTER TABLE document_chunks DROP COLUMN IF EXISTS tsv;

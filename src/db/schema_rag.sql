-- RAG (Document Memory) schema
-- This file is loaded only when pgvector is detected in the database (auto-detect on startup).

-- Make sure pgvector extension is enabled for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table for server knowledge base
CREATE TABLE IF NOT EXISTS documents (
  document_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  tomori_id INT NULL, -- NULL = serverwide document, non-NULL = persona-scoped document
  uploader_user_id INT NULL,
  document_name TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  file_size_bytes INT,
  text_content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (uploader_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (tomori_id) REFERENCES tomoris(tomori_id) ON DELETE CASCADE
);

-- Add tomori_id column for existing databases
SELECT add_column_if_not_exists('documents', 'tomori_id', 'INTEGER');

-- Channel tag filtering for documents (May 2026)
SELECT add_column_if_not_exists('documents', 'channel_tags', 'TEXT[]', 'ARRAY[]::TEXT[]');

-- Normalize stale persona references to serverwide scope (existing pre-scope rows are already NULL)
UPDATE documents
SET tomori_id = NULL
WHERE tomori_id IS NOT NULL
  AND tomori_id NOT IN (SELECT tomori_id FROM tomoris);

-- Add FK for documents.tomori_id if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'documents_tomori_id_fkey'
    ) THEN
        ALTER TABLE documents
        ADD CONSTRAINT documents_tomori_id_fkey
        FOREIGN KEY (tomori_id)
        REFERENCES tomoris(tomori_id)
        ON DELETE CASCADE;
    END IF;
END $$;

-- Drop old unique constraint that only allowed one name per server
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'documents_server_id_document_name_key'
    ) THEN
        ALTER TABLE documents DROP CONSTRAINT documents_server_id_document_name_key;
    END IF;
END $$;

-- Scope-aware uniqueness: allow same document name across different personas,
-- but keep names unique within each scope (persona or serverwide).
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_scope_name_unique
ON documents(server_id, COALESCE(tomori_id, -1), document_name);
CREATE INDEX IF NOT EXISTS idx_documents_server_tomori ON documents(server_id, tomori_id);

-- Create updated_at trigger for documents table
DROP TRIGGER IF EXISTS update_documents_timestamp ON documents;
CREATE TRIGGER update_documents_timestamp
BEFORE UPDATE ON documents
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

-- Add source_type column to distinguish document origins (upload vs history extraction)
SELECT add_column_if_not_exists('documents', 'source_type', 'TEXT NOT NULL DEFAULT ''upload''');

-- Document chunks table with embeddings
CREATE TABLE IF NOT EXISTS document_chunks (
  document_chunk_id SERIAL PRIMARY KEY,
  document_id INT NOT NULL,
  server_id INT NOT NULL,
  embedding_model_id INT NOT NULL,
  embedding_family TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (embedding_model_id) REFERENCES embedding_models(embedding_model_id) ON DELETE RESTRICT
);

-- Create indexes for document chunks
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_server_family ON document_chunks(server_id, embedding_family);
CREATE UNIQUE INDEX IF NOT EXISTS idx_document_chunks_unique_idx ON document_chunks(document_id, chunk_index);

-- RAG (Document Memory) schema
-- This file is loaded only when RAG is enabled (production or ACTIVATE_LOCAL_RAG=true).

-- Make sure pgvector extension is enabled for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table for server knowledge base
CREATE TABLE IF NOT EXISTS documents (
  document_id SERIAL PRIMARY KEY,
  server_id INT NOT NULL,
  uploader_user_id INT NULL,
  document_name TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT,
  file_size_bytes INT,
  text_content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (server_id, document_name),
  FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
  FOREIGN KEY (uploader_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Create updated_at trigger for documents table
DROP TRIGGER IF EXISTS update_documents_timestamp ON documents;
CREATE TRIGGER update_documents_timestamp
BEFORE UPDATE ON documents
FOR EACH ROW
EXECUTE FUNCTION update_timestamp();

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

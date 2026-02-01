# RAG (Document Memory)

This document explains how TomoriBot's document memory (RAG) works, how to use it, and where it lives in the codebase.

## Overview

TomoriBot can store large text files as server-scoped documents and retrieve relevant snippets automatically during chat. This prevents large documents from flooding the prompt while still giving TomoriBot access to important context.

Key points:
- Documents are scoped to a single server (or DM server).
- Retrieval is automatic once documents exist for the server.
- In non-production environments, retrieval is disabled unless `ACTIVATE_LOCAL_RAG=true`.
- Embeddings are stored in PostgreSQL using pgvector.
- Only text inputs are sent to embedding providers (PDFs are parsed locally first).

## Data Flow

1. Upload a document
   - Command: `/teach document`
   - Input: a unique document name + a file attachment (.txt/.md/.pdf)

2. Parse + normalize
   - Text is normalized (whitespace + line breaks)
   - PDFs are parsed via `pdf-parse`

3. Chunking
   - Document text is split into chunks with overlap
   - Limits are enforced (file size, chunk count, per-server totals)

4. Embedding
   - Chunks are embedded using the configured embedding model
   - Task type: `RETRIEVAL_DOCUMENT` for Google embeddings

5. Storage
   - `documents` table stores metadata + full text
   - `document_chunks` stores chunk content + embedding vector

6. Automatic retrieval
   - On each message, the latest user message is embedded
   - Task type: `RETRIEVAL_QUERY` for Google embeddings
   - Top K chunks are retrieved by cosine distance
   - Relevant snippets are injected into the system context

## Commands

- `/config model embedding`
  Choose the embedding model for the current provider.

- `/teach document`
  Upload and store a document for the server.

- `/forget document`
  Remove a document and all its chunks.

## Embedding Models

Embedding models are stored in `embedding_models` with a `model_family` field.
- Switching models re-embeds documents if the family changes.
- Google and OpenRouter Gemini embedding models share the same family, so switching providers does not require re-embedding.

## Limits and Guardrails

Limits are controlled by environment variables (see `.env.example`):
- `MAX_DOCUMENT_SIZE_MB`
- `MAX_DOCUMENT_TEXT_LENGTH`
- `DOCUMENT_CHUNK_SIZE`
- `DOCUMENT_CHUNK_OVERLAP`
- `MAX_DOCUMENT_CHUNKS`
- `MAX_DOCUMENTS_PER_SERVER`
- `MAX_DOCUMENT_CHUNKS_PER_SERVER`
- `MAX_DOCUMENT_OPERATIONS_PER_DAY`
- `ACTIVATE_LOCAL_RAG` (non-production only)

The memory guard can disable retrieval under critical memory pressure.

## Database Schema

- Base schema lives in `src/db/schema.sql`.
- RAG tables + pgvector extension live in `src/db/schema_rag.sql` and are only initialized when RAG is enabled.

- `documents`
  - `server_id`, `document_name`, `text_content`, file metadata
- `document_chunks`
  - `document_id`, `embedding_model_id`, `embedding_family`, `content`, `embedding`

pgvector must be installed on the database host:
- Extension: `vector`

## Code Pointers

- Upload + parsing + chunking: `src/commands/teach/document.ts`
- Deletion: `src/commands/forget/document.ts`
- Embedding selection: `src/commands/config/model/embedding.ts`
- Embedding requests: `src/utils/embeddings/embeddingProvider.ts`
- Chunking + retrieval: `src/utils/documents/documentService.ts`
- Automatic retrieval injection: `src/utils/text/contextBuilder.ts`
- Limits: `src/utils/db/memoryLimits.ts` and `src/utils/security/rateLimiter.ts`

## Privacy

Documents are scoped to the server they were uploaded in. Retrieval only queries documents for that server.

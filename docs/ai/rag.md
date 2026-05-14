<!-- ARCH-ALIGNMENT: prereq-phase-5.5c -->

# RAG (Document Memory)

This document explains the full RAG lifecycle in TomoriBot: how documents are uploaded, stored, embedded, retrieved, and injected into prompts, plus the exact settings and code paths involved.

## What RAG Does (Short Version)

RAG lets TomoriBot reference long documents without sending them in full to the model. Each document is chunked, embedded into vectors, and stored. During chat, the user's latest message is embedded and used to find the most similar chunks. Only those chunks (not the entire file) are injected into the prompt.

## Feature Gate (Local vs Production)

RAG is always on in production. In non-production, it is auto-detected based on whether the [pgvector](https://github.com/pgvector/pgvector) extension is available in the connected PostgreSQL server:

- On startup, TomoriBot queries `pg_available_extensions` to check if `vector` is present.
- If pgvector is available, the RAG schema (tables, indexes) is initialized automatically.
- If pgvector is not available, RAG features are disabled and users are directed to install pgvector (see README.md).

This gate affects both schema initialization and runtime behavior:
- The pgvector extension and document tables are not created locally unless pgvector is detected.
- `/memory document add` and `/memory document remove` are blocked locally unless pgvector is detected.
- Automatic retrieval is skipped locally unless pgvector is detected.

## End-to-End Flow (Detailed)

### 1) Upload (`/memory document add`)
Input:
- `name` (string, unique per server)
- `file` (attachment: .txt, .md, .pdf)

Checks:
- Permissions (uses same server teaching toggle as memory).
- `embedding_model_id` must be set in `/config model embedding`.
- API key must exist.
- File extension and MIME type must be allowed.
- Size, text length, chunk count, and per-server chunk limits.
- Duplicate document name is rejected.

### 2) Download + Parse
The file is downloaded and parsed:
- `.txt` / `.md` are read as UTF-8 text.
- `.pdf` uses `pdf-parse` to extract text.

### 3) Normalize
Text is normalized before chunking:
- Null bytes removed
- Line endings normalized to `\n`
- Excess whitespace collapsed

### 4) Chunking
Text is split into overlapping chunks:
- `DOCUMENT_CHUNK_SIZE` (default 1000 chars)
- `DOCUMENT_CHUNK_OVERLAP` (default 200 chars)
- Empty chunks are dropped
- Chunk count caps enforced

### 5) Embedding (Document)
Each chunk is embedded using the configured embedding model.
For Google embeddings, task type is:
- `RETRIEVAL_DOCUMENT`

### 6) Storage
Two tables are written:
- `documents` (metadata + full text)
- `document_chunks` (chunk content + vector embedding)

Each chunk stores:
- `embedding_model_id` (specific model row)
- `embedding_family` (used for compatibility)
- `embedding` (pgvector)

## Retrieval Flow (Detailed)

Retrieval runs on every chat message that passes these checks:
- RAG enabled (production, or pgvector detected in non-production)
- Memory guard not critical
- Server has at least one document
- Embedding model and API key exist
- Latest user message has at least 3 characters

### 1) Query Preparation
The latest user message is selected as the query:
- Only user-authored messages
- Skips system/synthetic messages
- Truncated to 1000 characters

### 2) Query Embedding
The query is embedded with the same model family as the documents.
For Google embeddings, task type is:
- `RETRIEVAL_QUERY`

### 3) Vector Search
PostgreSQL finds closest chunks by vector distance:
- Uses pgvector cosine distance
- Limits to top K (default 6)
- Filters out results below minimum similarity (default 0.2)

### 4) Prompt Injection
The retrieved chunks are formatted as:

```
# Server Documents

## document_name
- [Chunk 4, score 0.47] ...
- [Chunk 5, score 0.46] ...
```

This block is injected as a system context item tagged:
- `ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS`

## Commands (Behavior Summary)

- `/config model embedding`
  - Sets `embedding_model_id` for the server.
  - If the model family changes, documents are re-embedded.
  - If RAG is disabled locally, re-embedding is skipped.

- `/memory document add`
  - Upload + parse + chunk + embed + store.
  - Blocked when RAG is disabled locally.

- `/memory document remove`
  - Deletes the selected document and cascades its chunks.
  - Blocked when RAG is disabled locally.

## Embedding Model Families

Each embedding model row has:
- `embedding_model_id`
  - Internal DB identifier
- `model_family`
  - Compatibility key for retrieval

Rules:
- Retrieval only uses chunks from the same family as the active model.
- Re-embedding is only required when the family changes.
- Google Gemini embeddings via Google or OpenRouter share the same family.

## Limits and Guardrails

Limits live in `.env.optional.example` and are enforced at upload time. Positive values are accepted as configured;
non-numeric, zero, and negative values fall back to defaults. `DOCUMENT_CHUNK_OVERLAP` must stay lower than
`DOCUMENT_CHUNK_SIZE`.
- `MAX_DOCUMENT_SIZE_MB`
- `MAX_DOCUMENT_TEXT_LENGTH`
- `DOCUMENT_CHUNK_SIZE`
- `DOCUMENT_CHUNK_OVERLAP`
- `MAX_DOCUMENT_CHUNKS`
- `MAX_DOCUMENTS_PER_SERVER`
- `MAX_DOCUMENT_CHUNKS_PER_SERVER`
- `MAX_DOCUMENT_OPERATIONS_PER_DAY`
- pgvector auto-detection on startup (no env var needed)

Runtime guards:
- Memory guard can disable retrieval under critical memory pressure.
- Retrieval uses hard caps on max results and max injected chars.

## Database Schema

Schema locations:
- Base schema: `src/db/schema.sql`
- RAG schema (pgvector + document tables): `src/db/schema_rag.sql`

Tables:
- `documents`
  - `server_id`, `document_name`, `text_content`, file metadata
- `document_chunks`
  - `document_id`, `embedding_model_id`, `embedding_family`, `content`, `embedding`

pgvector requirement:
- Extension: `vector` must be installed on the database host.

## Code Pointers (Primary Paths)

- Upload + parse + chunk + embed:
  - `src/commands/memory/document/add.ts`
- Delete:
  - `src/commands/memory/document/remove.ts`
- Model selection + optional re-embed:
  - `src/commands/config/model/embedding.ts`
- Embedding requests:
  - `src/utils/embeddings/embeddingProvider.ts`
- Chunking + retrieval:
  - `src/utils/documents/documentService.ts`
- Retrieval injection:
  - `src/utils/text/context/rag.ts`
  - `src/utils/text/context/nativeBuilder.ts`
- Limits:
  - `src/utils/db/memoryLimits.ts`
  - `src/utils/security/rateLimiter.ts`

## Observability and Debugging

To confirm retrieval is running:
- Look for the injected "Server Documents" block in the prompt.
- If needed, add a temporary log around the retrieval block in:
  - `src/utils/text/context/rag.ts`

Common failure points:
- pgvector missing (local RAG enabled but extension not installed)
- No embedding model selected
- API key missing
- Document text too long or too many chunks
- Similarity below threshold (returns empty)

## Privacy and Scope

Documents are scoped to the server they were uploaded in. Retrieval only queries `documents` and `document_chunks` for the current server, and only within the active `embedding_family`.

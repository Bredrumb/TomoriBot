---
title: "02.8: RAG Documents"
---

pgvector-backed long-term retrieval over server-uploaded documents.

**File:** `src/utils/text/context/rag.ts:36-96`

## Mission

When the server has documents uploaded (via `/document` commands or chat
history capture), find the most relevant chunks for the current user query
using vector similarity search, and inject them into the prompt as a
retrieval-augmented-generation context item.

## Input

- `tomoriState` (provides `server_id`, `persona_id`, `config.embedding_model_id`)
- `simplifiedMessageHistory` — used to extract the latest user query
- `triggererUserId: number | undefined` — for personal-BYOK embedding
  credentials

## Output

`Promise<StructuredContextItem | null>` — `null` if any precondition fails,
otherwise one `user`-role item tagged `KNOWLEDGE_SERVER_DOCUMENTS`.

Content shape: assembled by `ragRepository.formatChunksForPrompt(chunks)`
— typically a series of `[Document: name]\n${chunk content}` blocks.

## Side effects

- **Query extraction** — finds the latest non-system user message, trims
  `[System:` blocks, slices to `DOCUMENT_QUERY_MAX_LENGTH` (1000 chars).
- **Document scope check** —
  `serverMemoryRepository.hasDocumentInScope(server_id, persona_id)` early-exits
  if no documents exist for this persona.
- **Credential resolution** — `resolveCapabilityCredentials("embedding", ...)`
  picks server or personal BYOK credentials for the embedding call.
- **Embedding model load** — `llmModelRepo.loadEmbeddingModelById(...)`
  resolves the model row (provider, capabilities).
- **Vector similarity search** —
  `ragRepository.retrieveRelevantChunks({ serverId, personaId, query,
  embeddingModel, apiKey, maxResults, minSimilarity })`. This is the
  actual pgvector query.
- **Chunk formatting** — `ragRepository.formatChunksForPrompt(chunks)`
  builds the LLM-shaped text.
- **Memory-pressure gate** — `memoryGuard.getStatus() === "critical"`
  short-circuits to `null` so RAG doesn't worsen pressure.

## Invariants

After this stage runs:

- Returns `null` if: RAG is unavailable (`isRagAvailable() === false`),
  memory pressure is critical, no `server_id`, no recent user query,
  query is shorter than `DOCUMENT_QUERY_MIN_LENGTH` (3 chars), no
  documents in scope, no embedding model resolved, or no chunks above
  similarity threshold.
- Each search is *fresh* (no caching layer here) — the query embedding
  is computed every turn. Documents themselves are pre-embedded at
  upload time.
- Errors are logged and return `null` — RAG failure never blocks the
  rest of the build.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `DOCUMENT_MAX_RESULTS` | `6` | Max chunks to retrieve per turn |
| `DOCUMENT_MIN_SIMILARITY` | `0.5` | Cosine similarity floor (0..1) |
| Constant | `DOCUMENT_QUERY_MIN_LENGTH = 3` | Skip RAG for very short queries |
| Constant | `DOCUMENT_QUERY_MAX_LENGTH = 1000` | Truncate query to avoid embedding cost |

| Source | Field | Effect |
|---|---|---|
| `tomoriConfig` | `embedding_model_id` | Fallback embedding model |
| Personal config (BYOK) | overrides embedding model | Per-user routing |

## Extension points

| Surface | Plugin-relevance |
|---|---|
| Embedding model selection (`resolveCapabilityCredentials`) | A plugin adding a new embedding provider registers via the capability system; this contributor consumes it polymorphically. |
| `ragRepository` (retrieval + formatting) | The repository is the seam — a plugin replacing pgvector with another vector store would extend the repository, not this file. |
| Query extraction (`getLatestUserQuery`) | Coupled to history shape; if a plugin wants to derive queries differently (e.g. include reply context, full conversation summary), it would extend this helper. → plugin plan candidate. |
| Document scope (per-persona) | `hasDocumentInScope(server_id, persona_id)` — a plugin adding cross-persona document sharing would extend the scope check. → plugin plan candidate. |
| Memory-pressure gate (`memoryGuard.getStatus()`) | Internal — coupled to OOM avoidance during heavy load. |

## Related docs

- RAG availability + repository: → no dedicated doc;
  `ragAvailability.ts` and `ragRepository.ts` helpers only
- Capability credentials (server vs personal): → folded into stage 05 of
  the chat pipeline ([`05-plan-turns.md`](../../chat/05-plan-turns))
- Embedding models: → [`docs/architecture/subsystems/database-schema.md`](../../../subsystems/database-schema) (embedding_models table)
- Document upload + chunking: → no dedicated doc;
  `insertDocumentWithChunks` in `serverMemoryRepository` only

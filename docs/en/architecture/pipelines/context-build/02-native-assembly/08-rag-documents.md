---
title: "02.8: RAG Documents"
aiGenerated: true
---

The RAG document contributor injects relevant text chunks from server-uploaded documents into the prompt using vector similarity retrieval.

## Flow and ownership

The contributor `buildServerDocumentContextItem` in `src/utils/text/context/rag.ts` retrieves document chunks for the user's latest query. Native assembly starts it right after the persona state resolves and awaits it at its insertion point, so its embedding round trip and database query overlap the rest of assembly while prompt order stays unchanged.

1. **Preconditions**:
   - `isRagAvailable()` must return true (pgvector support enabled).
   - Server must have an active `server_id`.
   - Returns `null` if system memory pressure is `critical` (`memoryGuard.getStatus() === "critical"`).
2. **Query extraction**:
   - Scans recent history for the latest non-system user message.
   - Truncates query text to `DOCUMENT_QUERY_MAX_LENGTH` (1,000 characters). Queries shorter than `DOCUMENT_QUERY_MIN_LENGTH` (3 characters) return `null`.
3. **Scope and credentials**:
   - Checks `serverMemoryRepository.hasDocumentInScope(serverId, personaId)`. If no documents exist for the persona or server, returns `null`.
   - Resolves embedding credentials via `resolveCapabilityCredentials`, supporting server and personal providers, including registered managed options.
   - Loads the configured embedding model via `llmModelRepo.loadEmbeddingModelById`.
4. **Hybrid retrieval**:
   - Calls `ragRepository.retrieveRelevantChunks` with a similarity threshold of `DOCUMENT_MIN_SIMILARITY` (0.5) and a result limit of `DOCUMENT_MAX_RESULTS` (10 chunks).
   - Builds candidate lists from vector distance and English full-text rank, each limited to `maxResults * 4` (40), then fuses them by reciprocal rank fusion with k = 60.
   - Applies the cosine floor inside the SQL before the final limit. A chunk qualifies when its similarity reaches the floor or when the full-text list matched it, so a below-floor row cannot take a slot from a lower-ranked qualifying row.
   - Binds the resolved usage context and supplies `createProviderUsageRecorder` for each embedding response.
   - When `channel_memory_enabled` is true, retrieval scopes documents through `channelScopeCandidates(channelId, parentChannelId)`: the active channel ID and, inside a thread, the parent channel ID. It matches stored `channel_disc_ids` (empty means every channel), never a channel name.
5. **Formatting and emission**:
   - Sorts the selected chunks by `(document_id, chunk_index)` before formatting: retrieval selects by score, while rendering follows document and chunk order.
   - `ragRepository.formatChunksForPrompt` formats matching chunks into document sections.
   - Emits a `user`-role item tagged `KNOWLEDGE_SERVER_DOCUMENTS`.
   - Emits exactly one `rag_retrieval` metric per call.

## Constraints and rationale

- **Memory guard short-circuit**: Under critical host memory pressure, RAG retrieval aborts immediately. This avoids high-memory vector and embedding operations during traffic spikes. Because retrieval starts early, the check samples host memory before the remaining contributors finish.
- **Stable document block**: Chunks render in `(document_id, chunk_index)` order rather than RRF score order, so two retrievals that select the same chunks produce byte-identical text and a rank-only change cannot break the provider's prompt-prefix cache. `formatRetrievedChunksForPrompt` itself is unchanged, so channel-history extraction keeps its own order.
- **Fail-safe fallback**: Database or embedding API failures log a warning and return `null`, allowing context assembly to finish without document chunks.
- **Retrieval telemetry**: `rag_retrieval` carries a fixed `outcome` label for every exit (`rag_unavailable`, `memory_critical`, `no_server`, `no_query`, `query_too_short`, `no_documents`, `no_model`, `no_results`, `injected`, `error`). `total_ms` is always present, and `embedding_ms`, `sql_ms`, `result_count`, `injected_chars`, and `injected_tokens` appear when those phases ran. The fields are aggregate only: query text, document text, names, vectors, keys, and server, channel, or user identifiers never reach a log. Like other graphable samples, it goes to both `log.metric` and `metricSampleRepository` so the host JSONL and Grafana each keep a copy.
- **Preset reassembly**: Tagged as `KNOWLEDGE_SERVER_DOCUMENTS`. Each world info marker pulls its own lore block first and then documents, and the first marker consumes the document block. When neither marker exists, the before lore block, documents, and the after lore block flush before the first dialogue anchor.

## Source pointers

- `src/utils/text/context/rag.ts`: `buildServerDocumentContextItem` and query extraction.
- `src/utils/db/repositories/RagRepository.ts`: `retrieveRelevantChunks` and chunk formatting.
- `src/utils/db/ragAvailability.ts`: `isRagAvailable` capability check.
- `src/utils/security/rateLimiter.ts`: `memoryGuard` memory pressure status.

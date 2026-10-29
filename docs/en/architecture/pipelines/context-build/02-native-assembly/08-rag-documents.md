---
title: "02.8: RAG Documents"
aiGenerated: true
---

The RAG document contributor injects relevant text chunks from server-uploaded documents into the prompt using hybrid vector and lexical retrieval.

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
   - Checks `serverMemoryRepository.hasDocumentInScope(serverId, personaId)`. An empty scope returns `null` with outcome `no_documents`; a failed lookup reaches the contributor's error handler and records `error`.
   - Resolves embedding credentials via `resolveCapabilityCredentials`, supporting server and personal providers, including registered managed options.
   - Loads the configured embedding model via `llmModelRepo.loadEmbeddingModelById`.
4. **Hybrid retrieval**:
   - Calls `ragRepository.retrieveRelevantChunks` with a similarity threshold of `DOCUMENT_MIN_SIMILARITY` (0.5) and a result limit of `DOCUMENT_MAX_RESULTS` (10 chunks).
   - Builds candidate lists from vector distance and full-text rank, each limited to `maxResults * 4` (40), then fuses them by reciprocal rank fusion with k = 60.
   - Applies the cosine floor inside the SQL before the final limit. A chunk qualifies when its similarity reaches the floor or when the full-text list matched it, so a below-floor row cannot take a slot from a lower-ranked qualifying row.
   - Binds the resolved usage context and supplies `createProviderUsageRecorder` for each embedding response.
   - When `channel_memory_enabled` is true, retrieval scopes documents through `channelScopeCandidates(channelId, parentChannelId)`: the active channel ID and, inside a thread, the parent channel ID. It matches stored `channel_disc_ids` (empty means every channel), never a channel name.
5. **Formatting and emission**:
   - Sorts the selected chunks by `(document_id, chunk_index)` before formatting: retrieval selects by score, while rendering follows document and chunk order.
   - `ragRepository.formatChunksForPrompt` formats matching chunks into document sections.
   - Emits a `user`-role item tagged `KNOWLEDGE_SERVER_DOCUMENTS`.
   - Emits exactly one `rag_retrieval` metric per call.

## New document chunking

Uploads, memory vectorization, and compaction saves use `documentChunker.ts`. They check the
per-document and per-scope chunk limits before reserving quota, embedding, or inserting a document;
an oversized document fails as a whole. Defaults are 150 chunks per document and 1,000 per scope.
Existing chunks, imported history facts, and edits retain their boundaries. Model switches embed
stored chunks in place, and editing still accepts up to 4,000 characters.

The chunker starts a new section at each Markdown ATX heading and stores the actual depths,
including skipped levels. It merges small blocks only within the same section, so sibling labels
remain distinct. Paragraphs, list items with continuation lines, and `Field: value` blocks precede
sentence and word boundaries selected with `Intl.Segmenter`. An oversized word, URL, table row,
or code line finally splits at Unicode code points. Normalization removes NUL bytes and converts CRLF to LF, trims trailing line whitespace,
collapses blank-line runs, and trims chunk edges; whitespace at a split may change.
All non-whitespace characters in the normalized source remain in order.

The target is 900 weighted characters, with a hard maximum of 1,400 including embedding heading
context and repeated table headers or fences. Han, kana, Hangul, and non-whitespace runs of at
least 64 UTF-16 code units count triple; other code points count once. On the multilingual fixture
corpus, the largest formatted input uses 464 E5 tokens including its passage prefix and special
tokens, below the 512-token input limit. Weighted characters estimate density rather than
guaranteeing a tokenizer-specific limit for arbitrary input.

Tables repeat their header and separator with every row fragment. Fenced code closes and reopens
with the original fence and language marker. A header too large to accompany any row is preserved
as plain text; fence delimiters too large to fit beside content are preserved as indented code.
There is no prose overlap. Only table headers and code fences repeat.

One embedding formatter prepends at most 180 weighted characters of heading context, while the
stored path and lexical text retain complete titles. It serves new writes, chunk edits, and
re-embedding. With no heading path it returns the exact stored content, preserving existing
embedding inputs. See the [schema contract](/architecture/subsystems/database-schema/#document-heading-paths).

## Lexical text

`src/utils/documents/lexicalText.ts` derives `lex_text` from the document name and chunk
content, with an optional heading path for structured chunks. The shared tokenizer preserves
non-CJK text, emits overlapping bigrams for Han and kana runs, and indexes Han characters
individually for single-character queries. Multi-character CJK queries use bigrams with AND
semantics. Kana terms are retained, and no common-character exclusions or term cap apply.

Both the stored `tsv` and the query use PostgreSQL's `russian` configuration. On the labeled
fixture tuning split, it recovered Cyrillic inflections without losing English matches;
`simple` lost an English match. Accents remain significant. The lexical candidate
pool still has depth 40, and every lexical hit still bypasses the cosine floor. Including a
document name can admit sibling chunks that share the title but lack the requested detail.

Document inserts, incremental history writes, and chunk edits derive lexical text when they
write content. Compaction saves use the document insert path. Re-embedding updates vectors
without changing lexical text. Existing rows are backfilled after login in bounded batches;
until then, their full-text index uses raw content. See the
[database schema](/architecture/subsystems/database-schema/#document-lexical-index) for the
trigger and concurrent-edit safeguards. The contributor's three-character query minimum still
applies before retrieval, even though the lexical stage supports shorter CJK terms.

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

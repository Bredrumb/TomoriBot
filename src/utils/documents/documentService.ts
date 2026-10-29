import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { generateEmbeddingsBatched, providerSupportsEmbeddingTaskType } from "@/utils/embeddings/embeddingProvider";
import type { EmbeddingModelRow } from "@/types/db/schema";
import type { EmbeddingRequest } from "@/types/provider/featureInterfaces";

export interface RetrievedDocumentChunk {
  document_id: number;
  document_name: string;
  chunk_index: number;
  content: string;
  similarity: number;
}

export interface RetrievalTimings {
  embeddingMs?: number;
  sqlMs?: number;
}

export function normalizeDocumentText(text: string): string {
  return text
    .replaceAll("\u0000", "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function chunkDocumentText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];

  if (chunkSize <= 0) {
    return chunks;
  }

  const safeOverlap = Math.max(0, Math.min(overlap, Math.max(0, chunkSize - 1)));
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    if (end >= text.length) {
      break;
    }
    start = Math.max(0, end - safeOverlap);
  }

  return chunks;
}

export function formatVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

// postgres.js passes JS arrays as plain toString() output for TEXT[] columns, which PostgreSQL
// rejects ("Array value must start with {"). Format explicitly as a PostgreSQL array literal.
function toPgTextArray(values: string[]): string {
  if (values.length === 0) return "{}";
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

/**
 * Creates a document record without chunks. Use with appendDocumentChunks for
 * incremental writes across long-running extraction pipelines.
 */
export async function createDocumentRecord(params: {
  serverId: number;
  personaId: number | null;
  uploaderUserId: number | null;
  documentName: string;
  sourceType?: string;
  channelDiscIds?: string[];
}): Promise<number> {
  const { serverId, personaId, uploaderUserId, documentName, sourceType = "upload", channelDiscIds = [] } = params;
  const [row] = await sql`
    INSERT INTO documents (
      server_id, persona_id, uploader_user_id, document_name,
      file_name, mime_type, file_size_bytes, text_content, source_type, channel_disc_ids
    ) VALUES (
      ${serverId}, ${personaId}, ${uploaderUserId}, ${documentName},
      NULL, NULL, NULL, '', ${sourceType}, ${toPgTextArray(channelDiscIds)}::text[]
    )
    RETURNING document_id
  `;
  if (!row?.document_id) throw new Error("Failed to insert document row");
  return Number(row.document_id);
}

/**
 * Appends a batch of chunks (with embeddings) to an existing document starting
 * at the given chunk index.
 */
export async function appendDocumentChunks(params: {
  documentId: number;
  serverId: number;
  embeddingModelId: number;
  embeddingFamily: string;
  startIndex: number;
  chunks: string[];
  embeddings: number[][];
}): Promise<void> {
  const { documentId, serverId, embeddingModelId, embeddingFamily, startIndex, chunks, embeddings } = params;
  if (chunks.length !== embeddings.length) {
    throw new Error(`Chunk/embedding count mismatch: ${chunks.length} vs ${embeddings.length}`);
  }
  await sql.transaction(async (tx) => {
    for (let i = 0; i < chunks.length; i++) {
      const embeddingVector = formatVector(embeddings[i]);
      await tx`
        INSERT INTO document_chunks (
          document_id, server_id, embedding_model_id, embedding_family,
          chunk_index, content, embedding
        ) VALUES (
          ${documentId}, ${serverId}, ${embeddingModelId}, ${embeddingFamily},
          ${startIndex + i}, ${chunks[i]}, ${embeddingVector}::vector
        )
      `;
    }
  });
}

/**
 * Sets text_content after all chunks have been appended.
 */
export async function finalizeDocumentContent(documentId: number, textContent: string): Promise<void> {
  await sql`UPDATE documents SET text_content = ${textContent} WHERE document_id = ${documentId}`;
}

/**
 * Keeps text_content consistent with stored chunks after edits or deletes.
 */
export async function rebuildDocumentTextContent(documentId: number): Promise<void> {
  const rows = await sql<Array<{ content: string }>>`
    SELECT content
    FROM document_chunks
    WHERE document_id = ${documentId}
    ORDER BY chunk_index ASC
  `;
  const joined = rows.map((r) => r.content).join("\n\n");
  await sql`UPDATE documents SET text_content = ${joined} WHERE document_id = ${documentId}`;
}

export async function insertDocumentWithChunks(params: {
  serverId: number;
  personaId: number | null;
  uploaderUserId: number | null;
  documentName: string;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  textContent: string;
  chunks: string[];
  embeddings: number[][];
  embeddingModelId: number;
  embeddingFamily: string;
  /** Document origin: 'upload' (default) or 'history' */
  sourceType?: string;
  /** Discord channel IDs restricting retrieval; empty means every channel. */
  channelDiscIds?: string[];
}): Promise<number> {
  const {
    serverId,
    personaId,
    uploaderUserId,
    documentName,
    fileName,
    mimeType,
    fileSizeBytes,
    textContent,
    chunks,
    embeddings,
    embeddingModelId,
    embeddingFamily,
    sourceType = "upload",
    channelDiscIds = [],
  } = params;

  if (chunks.length !== embeddings.length) {
    throw new Error(`Chunk count (${chunks.length}) does not match embedding count (${embeddings.length})`);
  }

  return sql.transaction(async (tx) => {
    const [documentRow] = await tx`
			INSERT INTO documents (
				server_id,
				persona_id,
				uploader_user_id,
				document_name,
				file_name,
				mime_type,
				file_size_bytes,
				text_content,
				source_type,
				channel_disc_ids
			) VALUES (
				${serverId},
				${personaId},
				${uploaderUserId},
				${documentName},
				${fileName},
				${mimeType},
				${fileSizeBytes},
				${textContent},
				${sourceType},
				${toPgTextArray(channelDiscIds)}::text[]
			)
			RETURNING document_id
		`;

    if (!documentRow?.document_id) {
      throw new Error("Failed to insert document row");
    }

    const documentId = Number(documentRow.document_id);

    for (let i = 0; i < chunks.length; i += 1) {
      const embeddingVector = formatVector(embeddings[i]);
      await tx`
				INSERT INTO document_chunks (
					document_id,
					server_id,
					embedding_model_id,
					embedding_family,
					chunk_index,
					content,
					embedding
				) VALUES (
					${documentId},
					${serverId},
					${embeddingModelId},
					${embeddingFamily},
					${i},
					${chunks[i]},
					${embeddingVector}::vector
				)
			`;
    }

    return documentId;
  });
}

export async function retrieveRelevantDocumentChunks(params: {
  serverId: number;
  personaId?: number | null;
  query: string;
  embeddingModel: EmbeddingModelRow;
  apiKey: string;
  onUsage?: EmbeddingRequest["onUsage"];
  maxResults: number;
  minSimilarity: number;
  batchSize?: number;
  /**
   * When set, excludes chunks whose document is scoped to channels outside this list. Pass the current
   * channel and, inside a thread, its parent so a thread inherits its channel's scope.
   */
  channelIds?: readonly string[] | null;
  /** Optional sink filled in place, so callers that only need chunks keep the same return type. */
  timings?: RetrievalTimings;
}): Promise<RetrievedDocumentChunk[]> {
  const {
    serverId,
    personaId,
    query,
    embeddingModel,
    apiKey,
    onUsage,
    maxResults,
    minSimilarity,
    batchSize,
    channelIds,
    timings,
  } = params;

  if (!query.trim()) {
    return [];
  }

  const embeddingStartedAt = performance.now();
  const queryEmbeddings = await generateEmbeddingsBatched({
    provider: embeddingModel.provider,
    apiKey,
    model: embeddingModel.codename,
    modelId: embeddingModel.embedding_model_id,
    inputs: [query],
    taskType: (await providerSupportsEmbeddingTaskType(embeddingModel.provider)) ? "RETRIEVAL_QUERY" : undefined,
    batchSize,
    onUsage,
  });
  if (timings) timings.embeddingMs = performance.now() - embeddingStartedAt;

  if (queryEmbeddings.length === 0) {
    return [];
  }

  const queryVector = formatVector(queryEmbeddings[0]);
  // Cast a wide net so RRF has enough candidates from each ranked list to merge well.
  const candidateLimit = maxResults * 4;

  const channelFilter =
    channelIds != null
      ? sql`AND (cardinality(d.channel_disc_ids) = 0 OR d.channel_disc_ids && ${toPgTextArray([...channelIds])}::text[])`
      : sql``;

  const personaFilter =
    personaId === null || personaId === undefined
      ? sql`AND d.persona_id IS NULL`
      : sql`AND (d.persona_id = ${personaId} OR d.persona_id IS NULL)`;

  // Hybrid retrieval: vector similarity + full-text search merged via Reciprocal Rank Fusion.
  //
  // RRF score = Σ 1/(k + rank_i) for each ranked list a chunk appears in (k=60 is standard).
  // Chunks that score well in both lists rank higher than single-list results, which is
  // especially effective for proper-noun-heavy content where embeddings can miss exact name
  // matches. fts_candidates is a no-op when plainto_tsquery returns an empty tsquery (all
  // stop words), so pure vector ranking applies transparently as the fallback.
  const sqlStartedAt = performance.now();
  const rows = await sql<
    Array<{
      document_id: number;
      document_name: string;
      chunk_index: number;
      content: string;
      distance: number | string;
    }>
  >`
    WITH fts_q AS (
      SELECT plainto_tsquery('english', ${query}::text) AS q
    ),
    vector_candidates AS (
      SELECT dc.document_chunk_id,
             ROW_NUMBER() OVER (ORDER BY dc.embedding <=> ${queryVector}::vector) AS rnk
      FROM document_chunks dc
      JOIN documents d ON d.document_id = dc.document_id
      WHERE dc.server_id = ${serverId}
        AND dc.embedding_family = ${embeddingModel.model_family}
        ${personaFilter}
        ${channelFilter}
      ORDER BY dc.embedding <=> ${queryVector}::vector
      LIMIT ${candidateLimit}
    ),
    fts_candidates AS (
      SELECT dc.document_chunk_id,
             ROW_NUMBER() OVER (ORDER BY ts_rank(dc.tsv, fts_q.q) DESC) AS rnk
      FROM document_chunks dc
      JOIN documents d ON d.document_id = dc.document_id
      CROSS JOIN fts_q
      WHERE dc.server_id = ${serverId}
        AND dc.embedding_family = ${embeddingModel.model_family}
        ${personaFilter}
        ${channelFilter}
        AND dc.tsv IS NOT NULL
        AND fts_q.q::text != ''
        AND dc.tsv @@ fts_q.q
      ORDER BY ts_rank(dc.tsv, fts_q.q) DESC
      LIMIT ${candidateLimit}
    ),
    rrf_merged AS (
      SELECT document_chunk_id,
             SUM(1.0 / (60.0 + rnk)) AS rrf_score,
             MIN(CASE WHEN src = 'fts' THEN rnk END) AS fts_rank,
             MIN(CASE WHEN src = 'vec' THEN rnk END) AS vector_rank
      FROM (
        SELECT document_chunk_id, rnk, 'vec'::text AS src FROM vector_candidates
        UNION ALL
        SELECT document_chunk_id, rnk, 'fts'::text AS src FROM fts_candidates
      ) combined
      GROUP BY document_chunk_id
    )
    SELECT dc.document_id, d.document_name, dc.chunk_index, dc.content,
           (dc.embedding <=> ${queryVector}::vector) AS distance
    FROM rrf_merged r
    JOIN document_chunks dc ON dc.document_chunk_id = r.document_chunk_id
    JOIN documents d ON d.document_id = dc.document_id
    -- Filter before the limit, or a below-floor row takes a slot from a lower-ranked qualifying one.
    -- FTS hits bypass the floor: verbose chunks have dilute centroids that under-rate contextual
    -- queries, so the lexical match is the trusted signal for those rows.
    WHERE r.fts_rank IS NOT NULL
       OR (1 - (dc.embedding <=> ${queryVector}::vector)) >= ${minSimilarity}::float8
    ORDER BY r.rrf_score DESC
    LIMIT ${maxResults}
  `;
  if (timings) timings.sqlMs = performance.now() - sqlStartedAt;

  const results: RetrievedDocumentChunk[] = [];
  for (const row of rows) {
    const distance = typeof row.distance === "string" ? Number.parseFloat(row.distance) : Number(row.distance);
    const similarity = Number.isFinite(distance) ? 1 - distance : 0;
    results.push({
      document_id: row.document_id,
      document_name: row.document_name,
      chunk_index: row.chunk_index,
      content: row.content,
      similarity,
    });
  }

  return results;
}

export function formatRetrievedChunksForPrompt(chunks: RetrievedDocumentChunk[]): string | null {
  if (!chunks.length) {
    return null;
  }

  let output = "[System: The following are relevant excerpts from server documents:\n\n";
  let currentDoc = "";

  for (const chunk of chunks) {
    if (chunk.document_name !== currentDoc) {
      output += `${currentDoc ? "\n" : ""}${chunk.document_name}:\n`;
      currentDoc = chunk.document_name;
    }
    output += `${chunk.content}\n`;
  }

  const trimmed = output.trim();
  return trimmed.length > 0 ? `${trimmed}]` : null;
}

export async function reembedServerDocuments(params: {
  serverId: number;
  embeddingModel: EmbeddingModelRow;
  apiKey: string;
  onUsage?: EmbeddingRequest["onUsage"];
}): Promise<void> {
  const { serverId, embeddingModel, apiKey, onUsage } = params;
  const modelId = embeddingModel.embedding_model_id;
  if (!modelId) {
    throw new Error("Embedding model ID is missing for re-embedding");
  }

  interface StoredChunk {
    document_chunk_id: number;
    chunk_index: number;
    content: string;
    embedding_model_id: number;
    embedding_family: string;
  }

  const documents = await sql<Array<{ document_id: number }>>`
    SELECT document_id FROM documents
    WHERE server_id = ${serverId}
    ORDER BY document_id ASC
  `;
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  let conflicted = 0;
  let firstFailure: unknown;

  for (const document of documents) {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const chunks = await sql<StoredChunk[]>`
          SELECT document_chunk_id, chunk_index, content, embedding_model_id, embedding_family
          FROM document_chunks
          WHERE document_id = ${document.document_id}
          ORDER BY chunk_index ASC
        `;
        const pending = chunks.filter((chunk) => chunk.embedding_model_id !== modelId);
        const embeddings =
          pending.length === 0
            ? []
            : await generateEmbeddingsBatched({
                provider: embeddingModel.provider,
                apiKey,
                model: embeddingModel.codename,
                modelId,
                inputs: pending.map((chunk) => chunk.content),
                taskType: (await providerSupportsEmbeddingTaskType(embeddingModel.provider))
                  ? "RETRIEVAL_DOCUMENT"
                  : undefined,
                batchSize: 16,
                onUsage,
              });
        if (pending.length > 0) {
          const dimensions = embeddings[0]?.length ?? 0;
          if (
            embeddings.length !== pending.length ||
            dimensions === 0 ||
            embeddings.some((vector) => vector.length !== dimensions || !vector.every(Number.isFinite))
          ) {
            throw new Error("Invalid re-embedding vector count or dimensions");
          }
          const familyDimensions = await sql<Array<{ dimensions: number }>>`
            SELECT DISTINCT vector_dims(embedding) AS dimensions
            FROM document_chunks
            WHERE server_id = ${serverId}
              AND embedding_family = ${embeddingModel.model_family}
              AND embedding IS NOT NULL
          `;
          if (familyDimensions.some((row) => row.dimensions !== dimensions)) {
            throw new Error("Re-embedding dimensions do not match the stored target family");
          }
        }

        const committed = await sql.transaction(async (tx) => {
          // The parent lock blocks FK inserts until commit, and the chunk locks block edits and deletes after comparison.
          const [parent] = await tx`
            SELECT document_id FROM documents
            WHERE document_id = ${document.document_id} AND server_id = ${serverId}
            FOR UPDATE
          `;
          if (!parent) return false;
          const current = await tx<StoredChunk[]>`
            SELECT document_chunk_id, chunk_index, content, embedding_model_id, embedding_family
            FROM document_chunks
            WHERE document_id = ${document.document_id}
            ORDER BY chunk_index ASC
            FOR UPDATE
          `;
          if (
            current.length !== chunks.length ||
            current.some((chunk, index) => {
              const snapshot = chunks[index];
              return (
                chunk.document_chunk_id !== snapshot.document_chunk_id ||
                chunk.chunk_index !== snapshot.chunk_index ||
                chunk.content !== snapshot.content ||
                chunk.embedding_model_id !== snapshot.embedding_model_id ||
                chunk.embedding_family !== snapshot.embedding_family
              );
            })
          ) {
            return false;
          }
          for (let index = 0; index < pending.length; index++) {
            await tx`
              UPDATE document_chunks
              SET embedding = ${formatVector(embeddings[index])}::vector,
                  embedding_model_id = ${modelId},
                  embedding_family = ${embeddingModel.model_family}
              WHERE document_chunk_id = ${pending[index].document_chunk_id}
            `;
          }
          return true;
        });
        if (committed) {
          if (pending.length === 0) skipped++;
          else completed++;
          break;
        }
        if (attempt === 1) {
          conflicted++;
          throw new Error("Document chunks changed during both re-embedding attempts");
        }
      }
    } catch (error) {
      failed++;
      firstFailure ??= error;
    }
  }

  if (failed > 0) {
    log.warn("Document re-embedding incomplete", undefined, {
      serverId,
      metadata: { total: documents.length, completed, skipped, failed, conflicted },
    });
    throw new Error("Document re-embedding incomplete", { cause: firstFailure });
  }
}

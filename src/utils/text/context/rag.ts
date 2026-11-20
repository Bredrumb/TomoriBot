import { ragRepository } from "@/utils/db/repositories";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import { log } from "@/utils/misc/logger";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { TomoriState } from "@/types/db/schema";
import { channelScopeCandidates } from "@/utils/discord/channelScope";
import { charsToTokensText } from "@/utils/text/tokenEstimate";
import type { RetrievalTimings } from "@/utils/documents/documentService";
import type { QueryRetrieval } from "@/utils/text/context/queryRetrieval";

const DOCUMENT_MAX_RESULTS = 10;
const DOCUMENT_MIN_SIMILARITY = 0.5;
const RAG_RETRIEVAL_METRIC = "rag_retrieval";

type RagRetrievalOutcome =
  | "rag_unavailable"
  | "memory_critical"
  | "no_server"
  | "no_query"
  | "query_too_short"
  | "no_documents"
  | "no_model"
  | "no_results"
  | "injected"
  | "error";

/**
 * Emits one aggregate-only sample. Query text, document text, names, vectors, keys, and server,
 * channel, or user identifiers must never reach a metric field.
 */
function recordRetrievalMetric(params: {
  outcome: RagRetrievalOutcome;
  startedAt: number;
  timings: RetrievalTimings;
  resultCount?: number;
  injectedChars?: number;
}): void {
  const fields: Record<string, number | string> = {
    outcome: params.outcome,
    total_ms: Math.round(performance.now() - params.startedAt),
  };
  if (params.timings.embeddingMs !== undefined) fields.embedding_ms = Math.round(params.timings.embeddingMs);
  if (params.timings.sqlMs !== undefined) fields.sql_ms = Math.round(params.timings.sqlMs);
  if (params.resultCount !== undefined) fields.result_count = params.resultCount;
  if (params.injectedChars !== undefined) {
    fields.injected_chars = params.injectedChars;
    fields.injected_tokens = charsToTokensText(params.injectedChars);
  }
  log.metric(RAG_RETRIEVAL_METRIC, fields);
  void metricSampleRepository.recordSample(RAG_RETRIEVAL_METRIC, fields);
}

/** Records one skip sample and returns null, so every exit path emits exactly one metric. */
function skipRetrieval(
  outcome: RagRetrievalOutcome,
  startedAt: number,
  timings: RetrievalTimings,
  resultCount?: number,
): null {
  recordRetrievalMetric({ outcome, startedAt, timings, resultCount });
  return null;
}

export async function buildServerDocumentContextItem(params: {
  tomoriState: TomoriState | null | undefined;
  channelId: string;
  parentChannelId?: string | null;
  retrieval: QueryRetrieval;
}): Promise<StructuredContextItem | null> {
  const startedAt = performance.now();
  const timings: RetrievalTimings = {};
  try {
    const { tomoriState, channelId, parentChannelId, retrieval } = params;
    const ready = await retrieval.prepared;
    const skip = ready.documentSkip ?? ready.skip;
    if (skip) return skipRetrieval(skip, startedAt, timings);
    if (!ready.embedding || !tomoriState?.server_id || !retrieval.query)
      return skipRetrieval("no_model", startedAt, timings);
    const queryEmbedding = await retrieval.vector;
    timings.embeddingMs = retrieval.timings.embeddingMs;
    if (!queryEmbedding) return skipRetrieval("error", startedAt, timings);
    const { model: embeddingModel, credentials: creds } = ready.embedding;

    const channelFilter = tomoriState.config.channel_memory_enabled
      ? channelScopeCandidates(channelId, parentChannelId)
      : null;

    const chunks = await ragRepository.retrieveRelevantChunks({
      serverId: tomoriState.server_id,
      personaId: tomoriState.persona_id ?? null,
      query: retrieval.query,
      queryEmbedding,
      embeddingModel,
      apiKey: creds.apiKey,
      maxResults: DOCUMENT_MAX_RESULTS,
      minSimilarity: DOCUMENT_MIN_SIMILARITY,
      channelIds: channelFilter,
      timings,
    });

    // Selection stays score-ordered; document and chunk order makes the rendered bytes independent of rank changes.
    const selectedChunks = [...chunks].sort((a, b) => a.document_id - b.document_id || a.chunk_index - b.chunk_index);
    const documentContext = ragRepository.formatChunksForPrompt(selectedChunks);
    if (!documentContext) return skipRetrieval("no_results", startedAt, timings, chunks.length);

    recordRetrievalMetric({
      outcome: "injected",
      startedAt,
      timings,
      resultCount: chunks.length,
      injectedChars: documentContext.length,
    });
    return {
      role: "user",
      parts: [{ type: "text", text: documentContext }],
      metadataTag: ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
    };
  } catch (error) {
    log.warn("Failed to add server document context", error);
    return skipRetrieval("error", startedAt, timings);
  }
}

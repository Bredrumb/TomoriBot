import { createProviderUsageRecorder, withProviderUsageContext } from "@/utils/provider/providerUsage";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { llmModelRepo, ragRepository, serverMemoryRepository } from "@/utils/db/repositories";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import { log } from "@/utils/misc/logger";
import { resolveCapabilityCredentials, getResolvedCapabilityModelId } from "@/utils/provider/credentialResolver";
import { memoryGuard } from "@/utils/security/rateLimiter";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { TomoriState } from "@/types/db/schema";
import type { SimplifiedMessageForContext } from "./types";
import { channelScopeCandidates } from "@/utils/discord/channelScope";
import { charsToTokensText } from "@/utils/text/tokenEstimate";
import type { RetrievalTimings } from "@/utils/documents/documentService";

const DOCUMENT_QUERY_MAX_LENGTH = 1000;
const DOCUMENT_QUERY_MIN_LENGTH = 3;
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

function getLatestUserQuery(messages: SimplifiedMessageForContext[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.authorType !== "user") continue;
    if (!msg.content) continue;
    if (msg.authorId === "0") continue;
    const trimmed = msg.content.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[System:")) continue;
    return trimmed.slice(0, DOCUMENT_QUERY_MAX_LENGTH);
  }

  return null;
}

export async function buildServerDocumentContextItem(params: {
  tomoriState: TomoriState | null | undefined;
  simplifiedMessageHistory: SimplifiedMessageForContext[];
  triggererUserId?: number;
  channelId: string;
  parentChannelId?: string | null;
}): Promise<StructuredContextItem | null> {
  const startedAt = performance.now();
  const timings: RetrievalTimings = {};
  try {
    const { tomoriState, simplifiedMessageHistory, triggererUserId, channelId, parentChannelId } = params;
    if (!isRagAvailable()) return skipRetrieval("rag_unavailable", startedAt, timings);
    if (memoryGuard.getStatus() === "critical") return skipRetrieval("memory_critical", startedAt, timings);
    if (!tomoriState?.server_id) return skipRetrieval("no_server", startedAt, timings);

    const queryText = getLatestUserQuery(simplifiedMessageHistory);
    if (!queryText) return skipRetrieval("no_query", startedAt, timings);
    if (queryText.length < DOCUMENT_QUERY_MIN_LENGTH) return skipRetrieval("query_too_short", startedAt, timings);

    const hasDocument = await serverMemoryRepository.hasDocumentInScope(
      tomoriState.server_id,
      tomoriState.persona_id ?? null,
    );
    if (!hasDocument) return skipRetrieval("no_documents", startedAt, timings);

    const creds = await resolveCapabilityCredentials(tomoriState.server_id, "embedding", {
      userId: triggererUserId ?? null,
    });
    const resolvedEmbeddingModelId =
      getResolvedCapabilityModelId(creds, "embedding") ?? tomoriState.config.embedding_model_id;
    const embeddingModel = resolvedEmbeddingModelId
      ? await llmModelRepo.loadEmbeddingModelById(resolvedEmbeddingModelId)
      : null;
    if (!embeddingModel) return skipRetrieval("no_model", startedAt, timings);

    const channelFilter = tomoriState.config.channel_memory_enabled
      ? channelScopeCandidates(channelId, parentChannelId)
      : null;

    const chunks = await withProviderUsageContext(creds.usageContext, async () =>
      ragRepository.retrieveRelevantChunks({
        serverId: tomoriState.server_id,
        personaId: tomoriState.persona_id ?? null,
        query: queryText,
        embeddingModel,
        apiKey: creds.apiKey,
        onUsage: createProviderUsageRecorder(creds.usageContext, embeddingModel.codename),
        maxResults: DOCUMENT_MAX_RESULTS,
        minSimilarity: DOCUMENT_MIN_SIMILARITY,
        channelIds: channelFilter,
        timings,
      }),
    );

    const documentContext = ragRepository.formatChunksForPrompt(chunks);
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

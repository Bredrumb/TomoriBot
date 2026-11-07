import type { EmbeddingModelRow, TomoriState } from "@/types/db/schema";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { llmModelRepo, serverMemoryRepository } from "@/utils/db/repositories";
import { embedWithBatchFallback } from "@/utils/embeddings/embeddingProvider";
import { resolveEmbeddingsCapability } from "@/utils/provider/providerCapabilityResolver";
import {
  resolveCapabilityCredentials,
  getResolvedCapabilityModelId,
  type ResolvedCredentials,
  CredentialUnavailableError,
  PersonalProviderRequiredError,
} from "@/utils/provider/credentialResolver";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { createProviderUsageRecorder, withProviderUsageContext } from "@/utils/provider/providerUsage";
import { memoryGuard } from "@/utils/security/rateLimiter";
import { charsToTokensText } from "@/utils/text/tokenEstimate";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";

const QUERY_MAX_LENGTH = 1000;
const QUERY_MIN_LENGTH = 3;
const EMBEDDING_BATCH_SIZE = 16;

type RetrievalSkip =
  | "rag_unavailable"
  | "memory_critical"
  | "no_server"
  | "no_query"
  | "query_too_short"
  | "no_documents"
  | "no_model"
  | "error";
export interface RetrievalModel {
  model: EmbeddingModelRow & { embedding_model_id: number };
  credentials: ResolvedCredentials;
}
export interface QueryRetrieval {
  prepared: Promise<{ embedding?: RetrievalModel; skip?: RetrievalSkip; documentSkip?: RetrievalSkip }>;
  query: string | null;
  vector: Promise<number[] | null>;
  timings: { embeddingMs?: number; embeddingStartedAt?: number; queryTokens: number };
}

function getLatestUserQuery(messages: SimplifiedMessageForContext[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.authorType !== "user" || msg.authorId === "0") continue;
    const trimmed = msg.content?.trim();
    if (!trimmed || trimmed.startsWith("[System:")) continue;
    return trimmed.slice(0, QUERY_MAX_LENGTH);
  }
  return null;
}

export async function embedRetrievalInputs(
  embedding: RetrievalModel,
  inputs: string[],
  taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT",
): Promise<number[][]> {
  const { model, credentials } = embedding;
  try {
    return await withProviderUsageContext(credentials.usageContext, async () => {
      const capability = await resolveEmbeddingsCapability(model.provider);
      if (!capability) throw new Error("Embedding capability unavailable");
      const vectors: number[][] = [];
      for (let offset = 0; offset < inputs.length; offset += EMBEDDING_BATCH_SIZE) {
        vectors.push(
          ...(await embedWithBatchFallback(
            inputs.slice(offset, offset + EMBEDDING_BATCH_SIZE),
            `${model.provider}:${model.codename}`,
            (batch) =>
              capability.generateEmbeddings({
                provider: model.provider,
                apiKey: credentials.apiKey,
                model: model.codename,
                modelId: model.embedding_model_id,
                inputs: batch,
                taskType: capability.supportsEmbeddingTaskType() ? taskType : undefined,
                onUsage: createProviderUsageRecorder(credentials.usageContext, model.codename),
              }),
          )),
        );
      }
      if (
        vectors.some(
          (vector) =>
            !vector.length || vector.some((value) => !Number.isFinite(value)) || vector.every((value) => value === 0),
        )
      ) {
        throw new Error("Invalid embedding vector");
      }
      return vectors;
    });
  } catch (error) {
    await reportProviderFailure({
      summary: "Context embedding failed",
      errorType: "ContextEmbeddingError",
      error,
      expected: true,
      dimensions: { operation: taskType === "RETRIEVAL_QUERY" ? "query" : "memory_fill" },
      redactValues: [credentials.apiKey],
    });
    throw error;
  }
}

export function startQueryRetrieval(
  params: {
    tomoriState: TomoriState | null | undefined;
    simplifiedMessageHistory: SimplifiedMessageForContext[];
    triggererUserId?: number;
  },
  memories?: { enabled: boolean; demand: Promise<boolean> },
): QueryRetrieval {
  const query = getLatestUserQuery(params.simplifiedMessageHistory);
  const timings: QueryRetrieval["timings"] = { queryTokens: 0 };
  let requestKey: string | undefined;
  const prepared: QueryRetrieval["prepared"] = (async (): Promise<Awaited<QueryRetrieval["prepared"]>> => {
    if (!isRagAvailable()) return { skip: "rag_unavailable" };
    if (memoryGuard.getStatus() === "critical") return { skip: "memory_critical" };
    const state = params.tomoriState;
    if (!state?.server_id) return { skip: "no_server" };
    const documentSkip = !query
      ? "no_query"
      : query.length < QUERY_MIN_LENGTH
        ? "query_too_short"
        : !(await serverMemoryRepository.hasDocumentInScope(state.server_id, state.persona_id ?? null))
          ? "no_documents"
          : undefined;
    if (documentSkip && !(memories?.enabled && (await memories.demand))) return { documentSkip };
    const credentials = await resolveCapabilityCredentials(state.server_id, "embedding", {
      userId: params.triggererUserId ?? null,
    });
    requestKey = credentials.apiKey;
    const modelId = getResolvedCapabilityModelId(credentials, "embedding") ?? state.config.embedding_model_id;
    const model = modelId ? await llmModelRepo.loadEmbeddingModelById(modelId) : null;
    return {
      documentSkip,
      ...(model
        ? { embedding: { model: { ...model, embedding_model_id: modelId as number }, credentials } }
        : { skip: "no_model" as const }),
    };
  })().catch(async (error: unknown) => {
    if (
      (error instanceof PersonalProviderRequiredError && error.capability === "embedding") ||
      (error instanceof CredentialUnavailableError &&
        error.capability === "embedding" &&
        (error.reason === "missing_model_id" || error.reason === "no_saved_config"))
    ) {
      return { skip: "no_model" as const };
    }
    await reportProviderFailure({
      summary: "Failed to prepare context retrieval",
      errorType: "ContextRetrievalError",
      error,
      expected: true,
      dimensions: { operation: "prepare_retrieval" },
      redactValues: requestKey ? [requestKey] : [],
    });
    return { skip: "error" as const };
  });
  const vector = (async () => {
    const ready = await prepared;
    if (!ready.embedding || !query || query.length < QUERY_MIN_LENGTH) return null;
    if (ready.documentSkip && !(memories?.enabled && (await memories.demand))) return null;
    const startedAt = performance.now();
    timings.embeddingStartedAt = startedAt;
    timings.queryTokens = charsToTokensText(query.length);
    try {
      return (await embedRetrievalInputs(ready.embedding, [query], "RETRIEVAL_QUERY"))[0] ?? null;
    } finally {
      timings.embeddingMs = performance.now() - startedAt;
    }
  })().catch(() => null);
  return { prepared, query, vector, timings };
}

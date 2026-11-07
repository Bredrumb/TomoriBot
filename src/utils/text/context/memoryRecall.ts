import { isRagAvailable } from "@/utils/db/ragAvailability";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import {
  memoryDecayRepository,
  type MemoryRef,
  type MemoryCandidateIds,
  type MissingMemoryVector,
} from "@/utils/db/repositories/MemoryDecayRepository";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import {
  getMemoryStage,
  isMemoryDecayEnabled,
  MEMORY_DORMANT_DAYS,
  MEMORY_RECALL_TIMEOUT_MS,
} from "@/utils/memory/memoryDecay";
import { log } from "@/utils/misc/logger";
import { charsToTokensText } from "@/utils/text/tokenEstimate";
import { embedRetrievalInputs, type QueryRetrieval, type RetrievalModel } from "@/utils/text/context/queryRetrieval";

export const MEMORY_QUICK_RETURN_DAYS = 7;

export type MemoryRecallLabel =
  | "disabled"
  | "rag_unavailable"
  | "memory_critical"
  | "no_model"
  | "no_query"
  | "no_candidates"
  | "timeout"
  | "provider_error"
  | "scored";
export type RecallCandidate = MemoryRef & { decayDays: number; line: string };
export interface MemoryRecallOutcome {
  outcome: MemoryRecallLabel;
  embeddingResolved: boolean;
  totalMs: number;
  candidateCount: number;
  scored: MemoryRef[];
  reinforced: MemoryRef[];
  recalled: MemoryRef[];
  missing: MissingMemoryVector[];
  embedding?: RetrievalModel;
  queryTimings: QueryRetrieval["timings"];
  dormantTokens: number;
  recalledTokens: number;
}

export interface MemoryRecallCollector {
  include(candidate: RecallCandidate): Promise<boolean>;
}

function memoryKey(memory: MemoryRef): string {
  return `${memory.kind}:${memory.id}`;
}

function candidateIds(memories: MemoryRef[]): MemoryCandidateIds {
  return {
    serverMemoryIds: memories.filter((memory) => memory.kind === "server").map((memory) => memory.id),
    personalMemoryIds: memories.filter((memory) => memory.kind === "personal").map((memory) => memory.id),
  };
}

export function createMemoryRecall(
  retrieval: QueryRetrieval,
  signalDemand: (needed: boolean) => void,
): MemoryRecallCollector & {
  finish(): Promise<{ outcome: MemoryRecallOutcome; item: StructuredContextItem | null }>;
} {
  const startedAt = performance.now();
  const enabled = isMemoryDecayEnabled();
  const candidates = new Map<string, RecallCandidate>();
  const dormant = new Set<string>();
  return {
    async include(candidate) {
      if (!enabled) return true;
      candidates.set(memoryKey(candidate), candidate);
      signalDemand(true);
      const ready = await retrieval.prepared;
      if (
        getMemoryStage(enabled, ready.skip !== "rag_unavailable", Boolean(ready.embedding), candidate.decayDays) === 2
      ) {
        dormant.add(memoryKey(candidate));
        return false;
      }
      return true;
    },
    async finish() {
      signalDemand(candidates.size > 0);
      const outcome: MemoryRecallOutcome = {
        outcome: "disabled",
        embeddingResolved: false,
        totalMs: 0,
        candidateCount: candidates.size,
        scored: [],
        reinforced: [],
        recalled: [],
        missing: [],
        queryTimings: retrieval.timings,
        dormantTokens: charsToTokensText(
          [...candidates.values()]
            .filter((memory) => dormant.has(memoryKey(memory)))
            .map((memory) => memory.line)
            .join("\n").length,
        ),
        recalledTokens: 0,
      };
      let item: StructuredContextItem | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!enabled) return { outcome, item };
        const ready = await retrieval.prepared;
        outcome.embeddingResolved = Boolean(ready.embedding);
        if (!ready.skip && !candidates.size) {
          outcome.outcome = "no_candidates";
          return { outcome, item };
        }
        if (ready.skip || !ready.embedding) {
          outcome.outcome =
            ready.skip === "rag_unavailable" || ready.skip === "memory_critical"
              ? ready.skip
              : ready.skip === "error"
                ? "provider_error"
                : "no_model";
          return { outcome, item };
        }
        if (ready.documentSkip === "no_query" || ready.documentSkip === "query_too_short") {
          outcome.outcome = "no_query";
          return { outcome, item };
        }
        const embedding = ready.embedding;
        const ids = candidateIds([...candidates.values()]);
        const score = (async () => {
          const vector = await retrieval.vector;
          if (!vector) throw new Error("Query embedding unavailable");
          const [winners, missing] = await Promise.all([
            memoryDecayRepository.scoreCandidates(vector, embedding.model.model_family, ids),
            memoryDecayRepository.findMissingVectors(ids, embedding.model.model_family),
          ]);
          return { winners, missing };
        })();
        const result = await Promise.race([
          score,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), MEMORY_RECALL_TIMEOUT_MS);
          }),
        ]);
        if (!result) {
          outcome.outcome = "timeout";
          log.warn("Memory recall timed out");
          return { outcome, item };
        }
        const missingKeys = new Set(result.missing.map(memoryKey));
        const winners = result.winners;
        const recalled = winners
          .map((memory) => candidates.get(memoryKey(memory)) as RecallCandidate)
          .filter((memory) => dormant.has(memoryKey(memory)))
          .sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
        if (recalled.length) {
          const text = `## Recalled Memories\n${recalled.map((memory) => memory.line).join("\n")}\n`;
          item = {
            role: "user",
            metadataTag: ContextItemTag.KNOWLEDGE_RECALLED_MEMORIES,
            parts: [{ type: "text", text }],
          };
          outcome.recalledTokens = charsToTokensText(text.length);
        }
        outcome.outcome = "scored";
        outcome.embedding = embedding;
        outcome.scored = [...candidates.values()]
          .filter((memory) => !missingKeys.has(memoryKey(memory)))
          .map(({ kind, id }) => ({ kind, id }));
        outcome.reinforced = winners.map(({ kind, id }) => ({ kind, id }));
        outcome.recalled = recalled.map(({ kind, id }) => ({ kind, id }));
        outcome.missing = result.missing;
        return { outcome, item };
      } catch (error) {
        outcome.outcome = "provider_error";
        log.warn("Memory recall failed", error);
        return { outcome, item };
      } finally {
        if (timer) clearTimeout(timer);
        outcome.totalMs = performance.now() - startedAt;
      }
    },
  };
}

export async function persistMemoryRecall(outcome: MemoryRecallOutcome): Promise<void> {
  const startedAt = performance.now();
  let filledCount = 0;
  let quickReturnCount = 0;
  let fillTokens = 0;
  let persistenceFailed = false;
  if (outcome.outcome === "scored" && outcome.embedding && isMemoryDecayEnabled() && isRagAvailable()) {
    try {
      const changes = await memoryDecayRepository.recordRecallDay(
        candidateIds(outcome.scored),
        candidateIds(outcome.reinforced),
      );
      const recalledKeys = new Set(outcome.recalled.map(memoryKey));
      quickReturnCount = changes.filter(
        (memory) =>
          recalledKeys.has(memoryKey(memory)) &&
          memory.previous_decay_days <= MEMORY_DORMANT_DAYS + MEMORY_QUICK_RETURN_DAYS,
      ).length;
    } catch (error) {
      persistenceFailed = true;
      log.warn("Failed to record memory recall day", error);
    }
    if (outcome.missing.length) {
      try {
        const { model } = outcome.embedding;
        const vectors = await embedRetrievalInputs(
          outcome.embedding,
          outcome.missing.map((memory) => memory.content),
          "RETRIEVAL_DOCUMENT",
        );
        fillTokens = charsToTokensText(outcome.missing.map((memory) => memory.content).join("").length);
        for (const [index, memory] of outcome.missing.entries()) {
          if (
            await memoryDecayRepository.upsertVector(
              memory,
              model.model_family,
              model.embedding_model_id,
              vectors[index],
              memory.content,
            )
          )
            filledCount += 1;
        }
      } catch (error) {
        persistenceFailed = true;
        filledCount = 0;
        fillTokens = 0;
        log.warn("Failed to fill memory vectors", error, undefined, {
          redactValues: [outcome.embedding.credentials.apiKey],
        });
      }
    }
  }
  const fields: Record<string, string | number> = {
    outcome: outcome.outcome,
    total_ms: Math.round(outcome.totalMs + performance.now() - startedAt),
    candidate_count: outcome.candidateCount,
    scored_count: outcome.scored.length,
    recalled_count: outcome.recalled.length,
    reinforced_count: outcome.reinforced.length,
    quick_return_count: quickReturnCount,
    dormant_tokens: outcome.dormantTokens,
    recalled_tokens: outcome.recalledTokens,
    query_tokens: outcome.queryTimings.queryTokens,
    filled_count: filledCount,
    fill_tokens: fillTokens,
    persistence_failed: Number(persistenceFailed),
  };
  const embeddingMs =
    outcome.queryTimings.embeddingMs ??
    (outcome.queryTimings.embeddingStartedAt === undefined
      ? undefined
      : performance.now() - outcome.queryTimings.embeddingStartedAt);
  if (embeddingMs !== undefined) fields.embedding_ms = Math.round(embeddingMs);
  log.metric("memory_recall", fields);
  try {
    await metricSampleRepository.recordSample("memory_recall", fields);
  } catch (error) {
    log.warn("Failed to record memory recall metric", error);
  }
}

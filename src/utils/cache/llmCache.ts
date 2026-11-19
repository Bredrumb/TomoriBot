import type { LlmRow } from "../../types/db/schema";
import { log } from "../misc/logger";
import { llmModelRepo } from "@/utils/db/repositories/LlmModelRepository";
import { cachedLlmCount, readCachedLlm, readCachedLlms, replaceCachedLlms } from "@/utils/cache/llmCacheStore";

export async function initializeLLMCache(): Promise<void> {
  try {
    log.info("Initializing LLM configuration cache...");

    const llms = await llmModelRepo.loadAvailableLlms(true);

    if (!llms || llms.length === 0) {
      replaceCachedLlms([]);
      log.warn("No LLM configurations found in database");
      return;
    }

    replaceCachedLlms(llms as LlmRow[]);

    const providerCounts = new Map<string, number>();
    for (const llm of llms) {
      const count = providerCounts.get(llm.llm_provider) || 0;
      providerCounts.set(llm.llm_provider, count + 1);
    }

    const providerStats = Array.from(providerCounts.entries())
      .map(([provider, count]) => `${provider}: ${count}`)
      .join(", ");

    log.success(`LLM cache initialized with ${cachedLlmCount()} models (${providerStats})`);
  } catch (error) {
    log.error("Failed to initialize LLM configuration cache:", error as Error);
  }
}

export function getCachedLLM(llmId: number): LlmRow | undefined {
  return readCachedLlm(llmId);
}

export function getCachedDefaultLLM(provider: string): LlmRow | undefined {
  const normalizedProvider = provider.toLowerCase();
  return readCachedLlms().find((llm) => llm.llm_provider.toLowerCase() === normalizedProvider && llm.is_default);
}

export function isLLMCacheReady(): boolean {
  return cachedLlmCount() > 0;
}

export function getLLMCacheSize(): number {
  return cachedLlmCount();
}

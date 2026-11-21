/**
 * LLM Configuration Cache
 * Provides in-memory caching for LLM model configurations to eliminate database queries on every chat message
 */

import type { LlmRow } from "../../types/db/schema";
import { log } from "../misc/logger";
import { llmModelRepo } from "@/utils/db/repositories/LlmModelRepository";
import { cachedLlmCount, readCachedLlm, readCachedLlms, replaceCachedLlms } from "@/utils/cache/llmCacheStore";

/**
 * Initializes the LLM configuration cache by loading all LLM models into memory
 * This should be called once at bot startup for optimal performance
 */
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

/**
 * Returns undefined if LLM is not found in cache
 * @param llmId - ID of the LLM to retrieve
 * @returns LLM configuration or undefined
 */
export function getCachedLLM(llmId: number): LlmRow | undefined {
  return readCachedLlm(llmId);
}

/**
 * Gets the default LLM configuration for a provider
 * @param provider - Provider name (e.g., "google", "openai", "anthropic")
 * @returns Default LLM configuration or undefined
 */
export function getCachedDefaultLLM(provider: string): LlmRow | undefined {
  const normalizedProvider = provider.toLowerCase();
  return readCachedLlms().find((llm) => llm.llm_provider.toLowerCase() === normalizedProvider && llm.is_default);
}

/**
 * Checks if the LLM cache is initialized and not empty
 * @returns True if cache is ready, false otherwise
 */
export function isLLMCacheReady(): boolean {
  return cachedLlmCount() > 0;
}

/**
 * Gets the size of the LLM cache
 */
export function getLLMCacheSize(): number {
  return cachedLlmCount();
}

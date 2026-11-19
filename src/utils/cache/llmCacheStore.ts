import type { LlmRow } from "@/types/db/schema";

// This store stays dependency-free so repository writes can refresh the cache-first state without importing llmCache
// into a circular dependency.

const llmCache = new Map<number, LlmRow>();

export function readCachedLlm(llmId: number): LlmRow | undefined {
  return llmCache.get(llmId);
}

export function readCachedLlms(): LlmRow[] {
  return Array.from(llmCache.values());
}

export function cachedLlmCount(): number {
  return llmCache.size;
}

export function replaceCachedLlms(llms: readonly LlmRow[]): void {
  llmCache.clear();
  for (const llm of llms) {
    if (llm.llm_id !== undefined) {
      llmCache.set(llm.llm_id, llm);
    }
  }
}

export function forgetCachedLlm(llmId: number): void {
  llmCache.delete(llmId);
}

import type { LlmRow } from "@/types/db/schema";

/**
 * Leaf-level store for the LLM model cache.
 *
 * Owns the Map and the write entry points. Kept deliberately dependency-free (only a type import)
 * so repository writers can refresh a cached model from the same code path as their DB write
 * without importing `llmCache.ts`, which imports the repositories barrel and would create a
 * circular dependency. Readers live in `llmCache.ts` and share state with writers via this module.
 *
 * The repository reads that back a model are cache-first, so a write that skips this refresh is
 * invisible to the running bot until the next startup reloads the whole table.
 */

/** Key: llm_id, Value: LLM configuration row. */
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

/** Drops one model's cached row so the next read falls through to the database. */
export function forgetCachedLlm(llmId: number): void {
  llmCache.delete(llmId);
}

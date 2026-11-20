export function isMemoryDecayEnabled(): boolean {
  return process.env.MEMORY_DECAY_ENABLED !== "false";
}

export const MEMORY_DORMANT_DAYS = 7;
export const MEMORY_RECALL_LIMIT = 3;
export const MEMORY_RECALL_MIN_SIMILARITY = 0.5;
export const MEMORY_RECALL_TIMEOUT_MS = 1_500;

export type MemoryStage = 1 | 2;

// Stage 2 dormancy requires RAG and resolved embeddings so memories stay active instead of vanishing when retrieval
// is unavailable.
export function getMemoryStage(
  switchEnabled: boolean,
  ragAvailable: boolean,
  embeddingResolved: boolean,
  decayDays: number,
): MemoryStage {
  return switchEnabled && ragAvailable && embeddingResolved && decayDays >= MEMORY_DORMANT_DAYS ? 2 : 1;
}

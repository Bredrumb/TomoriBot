/** Reads the switch on each call, enabling decay unless its value is the literal false. */
export function isMemoryDecayEnabled(): boolean {
  return process.env.MEMORY_DECAY_ENABLED !== "false";
}

export const MEMORY_DORMANT_DAYS = 7;
export const MEMORY_RECALL_LIMIT = 3;
export const MEMORY_RECALL_MIN_SIMILARITY = 0.5;
export const MEMORY_RECALL_TIMEOUT_MS = 1_500;

export type MemoryStage = 1 | 2;

/** Dormancy requires every retrieval prerequisite, so unavailable embeddings leave memories active. */
export function getMemoryStage(
  switchEnabled: boolean,
  ragAvailable: boolean,
  embeddingResolved: boolean,
  decayDays: number,
): MemoryStage {
  return switchEnabled && ragAvailable && embeddingResolved && decayDays >= MEMORY_DORMANT_DAYS ? 2 : 1;
}

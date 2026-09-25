/**
 * Shared TTL for the in-memory caches keyed on Tomori/channel configuration state
 * (tomoriStateCache, channelContextNoteCacheStore, channelLlmCacheStore,
 * channelPromptCacheStore, personaSpriteCacheStore). Kept in `src/constants/` rather
 * than re-exported from `tomoriStateCache.ts` because that module pulls in the
 * repositories barrel, and importing it from these leaf cache-store files would risk
 * a circular dependency.
 */
export const TOMORI_STATE_CACHE_TTL_MS = 10 * 60 * 1000;

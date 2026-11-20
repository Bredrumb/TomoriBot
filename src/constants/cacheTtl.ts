// Kept outside tomoriStateCache.ts because that module imports the repositories barrel, which would create circular
// imports from leaf cache stores.
export const TOMORI_STATE_CACHE_TTL_MS = 10 * 60 * 1000;

import type { TomoriState } from "@/types/db/schema";
import { clearPersonaAppearances } from "@/utils/cache/personaAppearanceCacheStore";
import { DatabaseUnavailableError } from "@/types/errors";
import { TOMORI_STATE_CACHE_TTL_MS } from "@/constants/cacheTtl";
import { personaRepository } from "@/utils/db/repositories";
import { cache, lastDbError, invalidateTomoriStateCache } from "./tomoriStateCacheStore";
import { log } from "../misc/logger";

// Re-export so existing callers can still import these from "tomoriStateCache".
// New code (especially repositories) should import directly from
// "tomoriStateCacheStore" to avoid the circular dependency through the
// repositories barrel.
export { invalidateTomoriStateCache };

const DB_ERROR_STALENESS_MS = 2 * 60 * 1000;

let cacheHits = 0;
let cacheMisses = 0;

// Grace period prevents showing Initial Setup Required to configured servers when early queries on a fresh container
// start return empty before DB connections stabilize.
const botStartTimestamp = Date.now();

const STARTUP_GRACE_PERIOD_MS = 3 * 60 * 1000;

export function getRecordedDbError(serverDiscId: string): { message: string; timestamp: number } | null {
  const entry = lastDbError.get(serverDiscId);
  if (entry) {
    if (Date.now() - entry.timestamp > DB_ERROR_STALENESS_MS) {
      lastDbError.delete(serverDiscId);
    } else {
      return entry;
    }
  }

  return null;
}

// During startup this returns a synthetic grace marker when no error is recorded, so callers must not use it to
// downgrade successfully loaded data.
export function getLastDbError(serverDiscId: string): { message: string; timestamp: number } | null {
  const entry = getRecordedDbError(serverDiscId);
  if (entry) return entry;

  // During startup grace period, treat empty results as "updating"
  //    so users don't see "Initial Setup Required" on servers that ARE
  //    configured but whose data hasn't been fetched yet.
  if (Date.now() - botStartTimestamp < STARTUP_GRACE_PERIOD_MS) {
    return {
      message: "Bot is still starting up (startup grace period)",
      timestamp: botStartTimestamp,
    };
  }

  return null;
}

export async function getCachedAllPersonas(serverDiscId: string): Promise<TomoriState[]> {
  const now = Date.now();
  const cachedEntry = cache.get(serverDiscId);

  if (cachedEntry) {
    // Check if cache is still fresh (< 10 minutes old)
    const cacheAge = now - cachedEntry.cachedAt;
    if (cacheAge < TOMORI_STATE_CACHE_TTL_MS) {
      cacheHits++;
      return cachedEntry.personas;
    }

    // Cache stale - fall through to refresh
  }

  // Cache miss or stale - refresh from DB
  cacheMisses++;

  try {
    const personas = await personaRepository.loadAllForServer(serverDiscId);

    lastDbError.delete(serverDiscId);

    if (personas.length > 0) {
      const mainPersona = personas.find((p) => !p.is_alter);
      if (!mainPersona) {
        log.error(`[TomoriState Cache] No main persona found for server ${serverDiscId}`);
        return personas; // Return alters anyway, but log error
      }

      // Apply tool-use master toggle: when tool_use_enabled is false, artificially
      // override has_tools to false on every persona so all providers see no tools.
      // The narrowed flag also carries the toggle into context synthesis, but it is not the
      // enforcement point: a provider holding a live capability catalog can raise it again, so
      // `resolveToolsEnabled` re-reads tool_use_enabled at every gate.
      const effectivePersonas = personas.map((p) =>
        p.config.tool_use_enabled ? p : { ...p, llm: { ...p.llm, has_tools: false } },
      );
      const effectiveMainPersona = effectivePersonas.find((p) => !p.is_alter) ?? mainPersona;

      cache.set(serverDiscId, {
        personas: effectivePersonas,
        mainPersona: effectiveMainPersona,
        cachedAt: now,
      });

      return effectivePersonas;
    }

    return personas;
  } catch (error) {
    // Track DB errors so the UI layer can show "Currently Updating..."
    // instead of the misleading "Initial Setup Required"
    if (error instanceof DatabaseUnavailableError) {
      lastDbError.set(serverDiscId, {
        message: error.message,
        timestamp: Date.now(),
      });
      log.warn(`[TomoriState Cache] DB unavailable for server ${serverDiscId}, recorded for UI differentiation`);
    }

    log.error(`[TomoriState Cache] Error loading personas for server ${serverDiscId}:`, error);

    // Return stale cache if available (graceful fallback)
    if (cachedEntry) {
      log.warn(`[TomoriState Cache] Returning stale cache for server ${serverDiscId} due to error`);
      return cachedEntry.personas;
    }

    // No cache available, return empty array
    return [];
  }
}

export async function getCachedMainPersona(serverDiscId: string): Promise<TomoriState | null> {
  const cachedEntry = cache.get(serverDiscId);
  if (cachedEntry) {
    const cacheAge = Date.now() - cachedEntry.cachedAt;
    if (cacheAge < TOMORI_STATE_CACHE_TTL_MS) {
      cacheHits++;
      return cachedEntry.mainPersona;
    }
  }

  // Cache miss or stale - load all personas
  const personas = await getCachedAllPersonas(serverDiscId);

  if (personas.length === 0) {
    return null;
  }

  const mainPersona = personas.find((p) => !p.is_alter);
  return mainPersona || null;
}

export async function getCachedTomoriState(serverDiscId: string): Promise<TomoriState | null> {
  return getCachedMainPersona(serverDiscId);
}

export function clearTomoriStateCache(): void {
  clearPersonaAppearances();
  cache.clear();
  lastDbError.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

export function getTomoriStateCacheStats(): {
  hits: number;
  misses: number;
  hitRate: string;
  cacheSize: number;
} {
  const total = cacheHits + cacheMisses;
  const hitRate = total > 0 ? `${((cacheHits / total) * 100).toFixed(2)}%` : "N/A";

  return {
    hits: cacheHits,
    misses: cacheMisses,
    hitRate,
    cacheSize: cache.size,
  };
}

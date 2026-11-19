import type { TomoriState } from "@/types/db/schema";
import { invalidateServerPersonaAppearances, clearPersonaAppearances } from "@/utils/cache/personaAppearanceCacheStore";
import { z } from "zod";
import {
  broadcastInvalidation,
  registerInvalidation,
  invalidationKey,
  withoutInvalidationBroadcast,
} from "@/utils/cache/invalidationBus";

// Repository writers import this store instead of readers so the cache avoids a repository dependency cycle.

export interface TomoriStateCacheEntry {
  personas: TomoriState[]; // Array of all personas (main first, then alters)
  mainPersona: TomoriState; // Quick reference to main persona (is_alter=false)
  cachedAt: number; // Timestamp in milliseconds
}

export const cache = new Map<string, TomoriStateCacheEntry>();

// Recent DB errors per server let the UI distinguish an unconfigured server from a DB outage when the cache returns
// empty.
export const lastDbError = new Map<string, { message: string; timestamp: number }>();

export function invalidateTomoriStateCache(serverDiscId: string): void {
  invalidateServerPersonaAppearances(serverDiscId);
  cache.delete(serverDiscId);
  lastDbError.delete(serverDiscId);
  broadcastInvalidation("tomoriState", [[serverDiscId]]);
}

export function invalidateTomoriStateCaches(serverDiscIds: Iterable<string>): void {
  const tuples: [string][] = [];
  withoutInvalidationBroadcast(() => {
    for (const serverDiscId of serverDiscIds) {
      invalidateTomoriStateCache(serverDiscId);
      tuples.push([serverDiscId]);
    }
  });
  broadcastInvalidation("tomoriState", tuples);
}

registerInvalidation(
  "tomoriState",
  z.tuple([invalidationKey]),
  ([server]) => invalidateTomoriStateCache(server),
  () => {
    clearPersonaAppearances();
    cache.clear();
    lastDbError.clear();
  },
);

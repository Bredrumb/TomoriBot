import type { PersonaSpriteRow } from "@/types/db/schema";
import { TOMORI_STATE_CACHE_TTL_MS } from "@/constants/cacheTtl";

const CACHE_TTL_MS = TOMORI_STATE_CACHE_TTL_MS;

const personaSpriteCache = new Map<number, { sprites: PersonaSpriteRow[]; expiresAt: number }>();

export function getPersonaSpriteCacheEntry(personaId: number): PersonaSpriteRow[] | undefined {
  const cached = personaSpriteCache.get(personaId);
  if (!cached) return undefined;

  if (cached.expiresAt <= Date.now()) {
    personaSpriteCache.delete(personaId);
    return undefined;
  }

  return cached.sprites;
}

export function setPersonaSpriteCache(personaId: number, sprites: PersonaSpriteRow[]): void {
  personaSpriteCache.set(personaId, {
    sprites,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function invalidatePersonaSpriteCache(personaId: number): void {
  personaSpriteCache.delete(personaId);
}

export function clearPersonaSpriteCache(): void {
  personaSpriteCache.clear();
}

export function getPersonaSpriteCacheSize(): number {
  return personaSpriteCache.size;
}

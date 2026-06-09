import type { PersonaSpriteRow } from "@/types/db/schema";

const parsedCacheTtlMinutes = Number.parseInt(
  process.env.PERSONA_SPRITE_CACHE_TTL_MINUTES || process.env.TOMORI_STATE_CACHE_TTL_MINUTES || "10",
  10,
);
const CACHE_TTL_MINUTES =
  Number.isFinite(parsedCacheTtlMinutes) && parsedCacheTtlMinutes > 0 ? parsedCacheTtlMinutes : 10;
const CACHE_TTL_MS = CACHE_TTL_MINUTES * 60 * 1000;

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

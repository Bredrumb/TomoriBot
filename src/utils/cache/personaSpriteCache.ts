import type { PersonaSpriteRow } from "@/types/db/schema";
import {
  clearPersonaSpriteCache,
  getPersonaSpriteCacheEntry,
  getPersonaSpriteCacheSize,
  invalidatePersonaSpriteCache,
  setPersonaSpriteCache,
} from "@/utils/cache/personaSpriteCacheStore";
import { personaSpriteRepository } from "@/utils/db/repositories/PersonaSpriteRepository";
import { log } from "@/utils/misc/logger";

export { clearPersonaSpriteCache, getPersonaSpriteCacheSize, invalidatePersonaSpriteCache, setPersonaSpriteCache };

export async function getCachedPersonaSprites(personaId: number): Promise<PersonaSpriteRow[]> {
  const cached = getPersonaSpriteCacheEntry(personaId);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const sprites = await personaSpriteRepository.listForPersona(personaId);
    setPersonaSpriteCache(personaId, sprites);
    return sprites;
  } catch (error) {
    log.error(`[PersonaSpriteCache] Failed to load sprites for persona ${personaId}:`, error);
    return [];
  }
}

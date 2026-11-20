import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { personaRepository, personaSpriteRepository } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { isSharedPresetAssetReference } from "@/utils/storage/avatarStorage";

// Errors are logged rather than thrown because the avatar write has already committed, and shared preset files stay
// untouched for other servers.
export async function removePresetSpritesAfterAvatarChange(personaId: number, serverDiscId: string): Promise<number> {
  try {
    const sprites = await personaSpriteRepository.listForPersona(personaId);
    const presetSpriteKeys = sprites
      .filter((sprite) => isSharedPresetAssetReference(sprite.avatar_url))
      .map((sprite) => sprite.sprite_key);
    const removed = await personaSpriteRepository.deleteSpritesByKeys(personaId, presetSpriteKeys);
    return removed.length;
  } catch (error) {
    await log.error(`Failed to remove preset sprites after avatar change for persona ${personaId}:`, error, {
      errorType: "PersonaAvatarPresetSpriteCleanupError",
      metadata: { personaId, serverDiscId },
    });
    return 0;
  }
}

export async function clearPresetCharacterReferenceAfterAvatarChange(
  personaId: number,
  serverDiscId: string,
): Promise<boolean> {
  try {
    const cleared = await personaRepository.clearPresetCharRef(personaId);
    if (cleared) invalidateTomoriStateCache(serverDiscId);
    return cleared;
  } catch (error) {
    await log.error(`Failed to clear preset character reference after avatar change for persona ${personaId}:`, error, {
      errorType: "PersonaAvatarPresetCharacterReferenceCleanupError",
      metadata: { personaId, serverDiscId },
    });
    return false;
  }
}

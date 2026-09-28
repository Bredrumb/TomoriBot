import { personaSpriteRepository } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { isSharedPresetAssetReference } from "@/utils/storage/avatarStorage";

/**
 * Removes the preset sprites a persona inherited once its avatar stops showing the preset character.
 *
 * Materialization copies preset sprites by reference, so a user who repaints a default persona with
 * a new avatar would otherwise keep the preset character's expressions under a different face. Only
 * rows whose image is a shared `presets/` reference go: sprites the user uploaded belong to the new
 * identity, and the shared image files stay because other servers still resolve them. Failures are
 * logged rather than thrown because the avatar write has already committed by the time this runs.
 *
 * @returns How many preset sprites were removed
 */
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

import { getPersonaSpriteMessageRecord } from "@/utils/cache/personaSpriteMessageCache";
import { formatRenderModifierWebhookName } from "@/utils/discord/renderModifierParser";
import { log } from "@/utils/misc/logger";

// Clean-name sprite webhooks omit the sprite in Discord, so this restores it for model context and returns null if
// personaId mismatches a recreated persona.
export async function resolveSpriteMessageDisplayName(
  messageDiscId: string,
  personaId: number | null | undefined,
  personaNickname: string,
): Promise<string | null> {
  if (typeof personaId !== "number") {
    return null;
  }

  try {
    const record = await getPersonaSpriteMessageRecord(messageDiscId);
    if (!record || record.persona_id !== personaId) {
      return null;
    }

    return formatRenderModifierWebhookName(personaNickname, record.sprite_name);
  } catch (error) {
    log.warn(`Failed to resolve sprite message label for message ${messageDiscId}`, error as Error);
    return null;
  }
}

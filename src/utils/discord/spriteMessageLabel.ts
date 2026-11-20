import { getPersonaSpriteMessageRecord } from "@/utils/cache/personaSpriteMessageCache";
import { formatRenderModifierWebhookName } from "@/utils/discord/renderModifierParser";
import { log } from "@/utils/misc/logger";

/**
 * Rebuilds the decorated "Name (sprite)" context label for a webhook message
 * that was delivered with a clean persona username.
 *
 * Sprite messages display only the persona name in Discord; the sprite label is
 * recovered from the persona_sprite_messages mapping so the model still sees
 * "Name (sprite):" in context. Returns null when the message has no sprite
 * mapping or the mapping belongs to a different persona (e.g. the nickname now
 * matches a recreated persona), so callers fall back to the plain persona name.
 *
 * @param personaNickname - current nickname used to build the label
 */
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

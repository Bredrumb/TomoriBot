import type { Message, SendableChannels } from "discord.js";
import { log } from "@/utils/misc/logger";

// Discord rejects an empty message body, so the placeholder uses a blank braille character.
const PLACEHOLDER_CONTENT = "⠀";

const seededAnchors = new WeakSet<Message>();

// System turns post and delete a placeholder because a turn cannot run in an empty channel without a trigger message.
export async function seedTurnAnchor(
  channel: SendableChannels,
  contextLabel: string,
  canSend: () => boolean = () => true,
): Promise<Message | null> {
  if (!canSend()) return null;
  try {
    const placeholder = await channel.send({ content: PLACEHOLDER_CONTENT });
    seededAnchors.add(placeholder);
    await placeholder
      .delete()
      .catch((error) =>
        log.warn(`Failed to remove placeholder message in channel ${channel.id} for ${contextLabel}:`, error),
      );
    log.info(`Seeded placeholder message in channel ${channel.id} for ${contextLabel}`);
    return placeholder;
  } catch (error) {
    log.warn(`Failed to seed placeholder message in channel ${channel.id} for ${contextLabel}:`, error);
    return null;
  }
}

export function isSeededTurnAnchor(message: Message): boolean {
  return seededAnchors.has(message);
}

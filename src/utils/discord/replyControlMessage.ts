import { ComponentType, type Message } from "discord.js";

export const REPLY_CONTROLS_NAMESPACE = "reply-controls";

export function isReplyControlMessage(message: Message, botUserId: string | undefined): boolean {
  return Boolean(
    botUserId &&
      (message.author.id === botUserId || message.applicationId === botUserId) &&
      !message.content &&
      message.embeds.length === 0 &&
      message.attachments.size === 0 &&
      message.components.some(
        (row) =>
          row.type === ComponentType.ActionRow &&
          row.components.some((button) => button.customId?.startsWith(`${REPLY_CONTROLS_NAMESPACE}:`)),
      ),
  );
}

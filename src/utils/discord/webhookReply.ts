import { EmbedBuilder, type Message, type WebhookMessageCreateOptions } from "discord.js";
import { stripBridgePrefix } from "@/utils/bridges";
import { localizer } from "@/utils/text/localizer";
import { verifyMessageWebhook, isManagedWebhookMessage } from "@/utils/chat/webhookIdentity";

// Send-mechanism branching is required because main personas and alters encode identity through different Discord
// primitives.
export function getReplyContextAuthorName(message: Message, botUserId?: string, botName?: string): string {
  // Webhook-delivered messages: the per-message `username` override captures the
  // persona identity at send time.
  if (message.webhookId) {
    return isManagedWebhookMessage(message) ? stripBridgePrefix(message.author.username) : message.author.username;
  }
  // Prefer message.member.displayName over current botName because Discord snapshots the guild member nickname
  // at send time.
  if (botUserId && message.author.id === botUserId) {
    return message.member?.displayName ?? botName ?? stripBridgePrefix(message.author.username);
  }
  return message.member?.displayName ?? message.author.globalName ?? stripBridgePrefix(message.author.username);
}

function buildReplyContextEmbed(
  targetMessage: Message,
  locale: string,
  botUserId?: string,
  botName?: string,
): EmbedBuilder {
  const authorIconUrl =
    targetMessage.member?.displayAvatarURL({
      size: 64,
      extension: "png",
      forceStatic: true,
    }) ??
    targetMessage.author.displayAvatarURL({
      size: 64,
      extension: "png",
      forceStatic: true,
    });

  return new EmbedBuilder().setURL(targetMessage.url).setAuthor({
    name: localizer(locale, "genai.message_interaction.reply_context_author", {
      user: getReplyContextAuthorName(targetMessage, botUserId, botName),
    }),
    url: targetMessage.url,
    iconURL: authorIconUrl,
  });
}

export async function buildWebhookReplyNoticePayload(
  targetMessage: Message,
  locale: string,
  options?: {
    threadId?: string;
    botUserId?: string;
    botName?: string;
  },
): Promise<WebhookMessageCreateOptions> {
  await verifyMessageWebhook(targetMessage);
  return {
    embeds: [buildReplyContextEmbed(targetMessage, locale, options?.botUserId, options?.botName)],
    ...(options?.threadId ? { threadId: options.threadId } : {}),
  };
}

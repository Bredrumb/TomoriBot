import { isManagedWebhookMessage } from "@/utils/chat/webhookIdentity";

import type { Message } from "discord.js";
import { MessageType } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { isRefreshMarkerEmbed } from "@/utils/discord/embedDetection";
import { isMatrixBridgeWebhookUsername, stripBridgePrefix } from "@/utils/bridges";
import { isAudioAttachment } from "@/utils/audio/audioAttachmentTranscription";
import { getCachedVoiceTranscript } from "@/utils/audio/voiceTranscriptCache";
import { getCachedRenderedMarkdownTable } from "@/utils/text/markdownTableCache";
import { normalizeRenderModifierName, parseRenderModifierWebhookName } from "@/utils/discord/renderModifierParser";

export interface FormattedHistoryResult {
  text: string;

  detectedPersonaTomoriIds: number[];

  messageCount: number;
}

const SKIPPED_MESSAGE_TYPES = new Set([
  MessageType.UserJoin,
  MessageType.GuildBoost,
  MessageType.GuildBoostTier1,
  MessageType.GuildBoostTier2,
  MessageType.GuildBoostTier3,
  MessageType.ChannelPinnedMessage,
  MessageType.RecipientAdd,
  MessageType.RecipientRemove,
  MessageType.Call,
  MessageType.ChannelNameChange,
  MessageType.ChannelIconChange,
  MessageType.ThreadCreated,
  MessageType.ThreadStarterMessage,
  MessageType.GuildInviteReminder,
  MessageType.AutoModerationAction,
]);

function resolveMentions(content: string, msg: Message): string {
  let resolved = content;

  resolved = resolved.replace(/<@!?(\d+)>/g, (_match, userId: string) => {
    const member = msg.guild?.members.cache.get(userId);
    if (member) return `@${member.displayName}`;
    // Read the message's own mentions first because the orphan-user sweeper evicts non-members from the client cache.
    const user = msg.mentions.users.get(userId) ?? msg.client.users.cache.get(userId);
    if (user) return `@${user.username}`;
    return `@UnknownUser`;
  });

  resolved = resolved.replace(/<#(\d+)>/g, (_match, channelId: string) => {
    const channel = msg.guild?.channels.cache.get(channelId);
    if (channel) return `#${channel.name}`;
    return `#unknown-channel`;
  });

  resolved = resolved.replace(/<@&(\d+)>/g, (_match, roleId: string) => {
    const role = msg.guild?.roles.cache.get(roleId);
    if (role) return `@${role.name}`;
    return `@unknown-role`;
  });

  return resolved;
}

export function formatMessagesForExtraction(
  messages: Message[],
  serverPersonas: TomoriState[],
  clientUserId?: string,
): FormattedHistoryResult {
  const lines: string[] = [];
  const detectedTomoriIds = new Set<number>();

  const nicknameToTomoriId = new Map<string, number>();
  for (const persona of serverPersonas) {
    if (persona.persona_id !== undefined) {
      nicknameToTomoriId.set(normalizeRenderModifierName(persona.persona_nickname), persona.persona_id);
    }
  }

  // Main-persona messages fall back to the bot account when webhooks are unavailable, so detect non-webhook
  // bot turns too.
  const mainPersonaId = serverPersonas.find((persona) => !persona.is_alter)?.persona_id;

  for (const msg of messages) {
    if (SKIPPED_MESSAGE_TYPES.has(msg.type)) continue;

    let content = msg.content ? resolveMentions(msg.content, msg) : "";
    const cachedRenderedTable = getCachedRenderedMarkdownTable(msg.id);
    if (cachedRenderedTable) {
      content += ` [Rendered markdown table]\n${cachedRenderedTable}`;
    }

    let audioTranscriptAppended = false;
    for (const attachment of msg.attachments.values()) {
      if (cachedRenderedTable) continue;

      if (isAudioAttachment(attachment)) {
        // Cached "tts" voice transcripts are already in msg.content as captions, so skip the [Attachment] tag to
        // avoid duplication.
        const cached = getCachedVoiceTranscript(msg.id);
        if (cached) {
          if (cached.source === "user_stt" && !audioTranscriptAppended) {
            content += ` [Voice message: ${cached.transcript}]`;
            audioTranscriptAppended = true;
          }
          continue;
        }
      }
      content += ` [Attachment: ${attachment.name ?? "file"}]`;
    }

    for (const embed of msg.embeds) {
      if (isRefreshMarkerEmbed(embed)) continue;
      if (embed.title) {
        content += ` [Embed: ${embed.title}]`;
      }
    }

    content = content.trim();
    if (!content) continue;

    const timestamp = msg.createdAt.toISOString();

    const rawAuthorName = msg.member?.displayName ?? msg.author?.username ?? "Unknown";
    const authorName =
      msg.webhookId && !isManagedWebhookMessage(msg) ? rawAuthorName : stripBridgePrefix(rawAuthorName);

    lines.push(`[${timestamp}] ${authorName}: ${content}`);

    // Check both decorated name parts because copied identities put the persona in parens while legacy sprites put
    // it first.
    if (isManagedWebhookMessage(msg) && msg.author) {
      // Matrix bridge messages also arrive as webhooks; a bridged user whose display name
      // happens to match a persona nickname must not register as that persona.
      if (isMatrixBridgeWebhookUsername(msg.author.username)) continue;

      const renderModifierName = parseRenderModifierWebhookName(msg.author.username);
      const authorKeys = renderModifierName
        ? [renderModifierName.modifier, renderModifierName.sourceName]
        : [msg.author.username];
      for (const authorKey of authorKeys) {
        const matchedTomoriId = nicknameToTomoriId.get(normalizeRenderModifierName(authorKey));
        if (matchedTomoriId !== undefined) {
          detectedTomoriIds.add(matchedTomoriId);
          break;
        }
      }
      continue;
    }

    if (mainPersonaId !== undefined && clientUserId && msg.author?.id === clientUserId) {
      detectedTomoriIds.add(mainPersonaId);
    }
  }

  return {
    text: lines.join("\n"),
    detectedPersonaTomoriIds: [...detectedTomoriIds],
    messageCount: lines.length,
  };
}

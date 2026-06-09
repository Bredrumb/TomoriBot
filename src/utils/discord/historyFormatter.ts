/**
 * Formats Discord messages into a text representation suitable for LLM fact extraction.
 * Also detects which bot personas participated (via webhook author matching)
 * for the "automatic" scope in /memory history import.
 */

import type { Message } from "discord.js";
import { MessageType } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { isRefreshMarkerEmbed } from "@/utils/discord/embedDetection";
import { stripBridgePrefix } from "@/utils/bridges";
import { isAudioAttachment } from "@/utils/audio/audioAttachmentTranscription";
import { getCachedVoiceTranscript } from "@/utils/audio/voiceTranscriptCache";
import { getCachedRenderedMarkdownTable } from "@/utils/text/markdownTableCache";
import { normalizeRenderModifierName, parseRenderModifierWebhookName } from "@/utils/discord/renderModifierParser";

/** Result of formatting messages for extraction */
export interface FormattedHistoryResult {
  /** Formatted dialogue text for the extraction prompt */
  text: string;

  /** Unique tomori IDs detected from webhook-authored messages (for automatic scope) */
  detectedPersonaTomoriIds: number[];

  /** Number of messages that made it into the formatted text */
  messageCount: number;
}

/** System message types that should be skipped (joins, boosts, pins, etc.) */
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

/**
 * Resolves Discord mention formats to human-readable names using guild cache.
 *
 * @param content - Raw message content with Discord mention syntax
 * @param msg - The Discord message (for guild access)
 * @returns Content with resolved mentions
 */
function resolveMentions(content: string, msg: Message): string {
  let resolved = content;

  // 1. Resolve user mentions: <@123456> or <@!123456> → @Username
  resolved = resolved.replace(/<@!?(\d+)>/g, (_match, userId: string) => {
    const member = msg.guild?.members.cache.get(userId);
    if (member) return `@${member.displayName}`;
    const user = msg.client.users.cache.get(userId);
    if (user) return `@${user.username}`;
    return `@UnknownUser`;
  });

  // 2. Resolve channel mentions: <#123456> → #channel-name
  resolved = resolved.replace(/<#(\d+)>/g, (_match, channelId: string) => {
    const channel = msg.guild?.channels.cache.get(channelId);
    if (channel) return `#${channel.name}`;
    return `#unknown-channel`;
  });

  // 3. Resolve role mentions: <@&123456> → @RoleName
  resolved = resolved.replace(/<@&(\d+)>/g, (_match, roleId: string) => {
    const role = msg.guild?.roles.cache.get(roleId);
    if (role) return `@${role.name}`;
    return `@unknown-role`;
  });

  return resolved;
}

/**
 * Formats an array of Discord messages into a text representation
 * suitable for LLM fact extraction, and detects which bot personas
 * participated via webhook author name matching.
 *
 * Format per message: `[ISO timestamp] Username: content`
 *
 * Skips:
 * - System messages (joins, boosts, pins)
 * - Empty messages with no content and no attachments
 * - Bot refresh/system embeds
 *
 * Includes:
 * - Bot messages (they contain conversation context)
 * - Attachment indicators: `[Attachment: filename.ext]`
 * - Non-system embed indicators: `[Embed: title]`
 *
 * @param messages - Array of Discord messages in chronological order
 * @param serverPersonas - All personas for the server (for webhook author matching)
 * @returns Formatted text, detected persona IDs, and message count
 */
export function formatMessagesForExtraction(
  messages: Message[],
  serverPersonas: TomoriState[],
): FormattedHistoryResult {
  const lines: string[] = [];
  const detectedTomoriIds = new Set<number>();

  // Build a lowercase nickname → personaId map for persona detection
  const nicknameToTomoriId = new Map<string, number>();
  for (const persona of serverPersonas) {
    if (persona.persona_id !== undefined) {
      nicknameToTomoriId.set(normalizeRenderModifierName(persona.persona_nickname), persona.persona_id);
    }
  }

  for (const msg of messages) {
    // 1. Skip system messages
    if (SKIPPED_MESSAGE_TYPES.has(msg.type)) continue;

    // 2. Build message content
    let content = msg.content ? resolveMentions(msg.content, msg) : "";
    const cachedRenderedTable = getCachedRenderedMarkdownTable(msg.id);
    if (cachedRenderedTable) {
      content += ` [Rendered markdown table]\n${cachedRenderedTable}`;
    }

    // 3. Append attachment indicators (or cached voice transcript for audio)
    let audioTranscriptAppended = false;
    for (const attachment of msg.attachments.values()) {
      if (cachedRenderedTable) continue;

      if (isAudioAttachment(attachment)) {
        // Check the in-memory cache first — avoids re-running STT on history audio.
        // "tts" source = Tomori's own voice message; caption text is already
        // included in msg.content (sent alongside the attachment), so we just
        // skip the [Attachment] tag to avoid duplication.
        // "user_stt" source = user-sent audio; inline the transcript so the
        // extraction LLM sees the spoken words rather than just a filename.
        const cached = getCachedVoiceTranscript(msg.id);
        if (cached) {
          if (cached.source === "user_stt" && !audioTranscriptAppended) {
            content += ` [Voice message: ${cached.transcript}]`;
            audioTranscriptAppended = true;
          }
          // Either way, skip the generic [Attachment: ...] tag
          continue;
        }
      }
      content += ` [Attachment: ${attachment.name ?? "file"}]`;
    }

    // 4. Append non-system embed indicators
    for (const embed of msg.embeds) {
      // Skip refresh/system embeds
      if (isRefreshMarkerEmbed(embed)) continue;
      if (embed.title) {
        content += ` [Embed: ${embed.title}]`;
      }
    }

    // 5. Skip empty messages (no content, no attachments, no meaningful embeds)
    content = content.trim();
    if (!content) continue;

    // 6. Format timestamp
    const timestamp = msg.createdAt.toISOString();

    // 7. Determine author name
    //    Strip "[Matrix|@user:host] " prefix from Matrix bridge webhook messages
    //    so TomoriBot sees just the display name (e.g., "Neko Neechan") in context
    const rawAuthorName = msg.member?.displayName ?? msg.author?.username ?? "Unknown";
    const authorName = stripBridgePrefix(rawAuthorName);

    // 8. Build formatted line
    lines.push(`[${timestamp}] ${authorName}: ${content}`);

    // 9. Persona detection: match webhook-authored messages by name
    if (msg.webhookId && msg.author) {
      const renderModifierName = parseRenderModifierWebhookName(msg.author.username);
      const authorKey = normalizeRenderModifierName(renderModifierName?.sourceName ?? msg.author.username);
      const matchedTomoriId = nicknameToTomoriId.get(authorKey);
      if (matchedTomoriId !== undefined) {
        detectedTomoriIds.add(matchedTomoriId);
      }
    }
  }

  return {
    text: lines.join("\n"),
    detectedPersonaTomoriIds: [...detectedTomoriIds],
    messageCount: lines.length,
  };
}

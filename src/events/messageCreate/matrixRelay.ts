import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";

import type { Client, Embed, Message } from "discord.js";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { isSelfTriggerMessage } from "@/utils/chat/triggerProcessor";
import {
  isMatrixConfigured,
  getLinkedMatrixRoom,
  sendToMatrixRoom,
  sendAttachmentToMatrixRoom,
  ensureRoomRelayable,
  getMatrixSettings,
  getMatrixIdForDisplayName,
} from "@/utils/bridges/matrix";
import { log } from "@/utils/misc/logger";
import type { TomoriState } from "@/types/db/schema";
import { resolvePersonaAvatarPublicUrl } from "@/utils/storage/avatarStorage";
import { normalizeRenderModifierName, resolveRenderModifierSourcePersona } from "@/utils/discord/renderModifierParser";
import { safeDownload } from "@/utils/security/safeDownload";

const MATRIX_EMBED_CHUNK_MAX_CHARS = 3500;
const BYTES_PER_MIB = 1024 * 1024;

function stripDiscordMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .trim();
}

function pushEmbedTextPart(parts: string[], value: string | null | undefined): void {
  if (!value) return;
  const normalized = stripDiscordMarkdown(value);
  if (!normalized) return;
  parts.push(normalized);
}

function pushEmbedUrlPart(parts: string[], seen: Set<string>, value: string | null | undefined): void {
  if (!value) return;
  const normalized = value.trim();
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  parts.push(normalized);
}

function serializeEmbedToText(embed: Embed): string {
  const parts: string[] = [];
  const seenUrls = new Set<string>();

  pushEmbedTextPart(parts, embed.author?.name);
  pushEmbedUrlPart(parts, seenUrls, embed.author?.url);
  pushEmbedTextPart(parts, embed.title);
  pushEmbedUrlPart(parts, seenUrls, embed.url);
  pushEmbedTextPart(parts, embed.description);

  for (const field of embed.fields) {
    const name = stripDiscordMarkdown(field.name ?? "");
    const value = stripDiscordMarkdown(field.value ?? "");
    if (name && value) {
      parts.push(`${name}\n${value}`);
      continue;
    }
    if (name) parts.push(name);
    if (value) parts.push(value);
  }

  pushEmbedUrlPart(parts, seenUrls, embed.image?.url);
  pushEmbedUrlPart(parts, seenUrls, embed.thumbnail?.url);
  pushEmbedUrlPart(parts, seenUrls, embed.video?.url);

  if (embed.timestamp) {
    const parsed = new Date(embed.timestamp);
    parts.push(Number.isNaN(parsed.getTime()) ? embed.timestamp : parsed.toISOString());
  }

  pushEmbedTextPart(parts, embed.footer?.text);
  pushEmbedUrlPart(parts, seenUrls, embed.footer?.iconURL);

  return parts.join("\n\n").trim();
}

function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (line.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let index = 0; index < line.length; index += maxChars) {
        chunks.push(line.slice(index, index + maxChars));
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    chunks.push(current);
    current = line;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function resolveDiscordTextForMatrix(
  text: string,
  message: Message,
): { body: string; formattedBody: string | undefined; mentionedIds: string[] } {
  // Matches both Discord snowflakes (<@id>, <@!id>) and internal @{name} placeholders
  const pattern = /<@!?(\d+)>|@\{([^}]+)\}/g;

  if (!pattern.test(text)) {
    return { body: text, formattedBody: undefined, mentionedIds: [] };
  }
  pattern.lastIndex = 0;

  const mentionedIds: string[] = [];
  let hasMatrixMentions = false;

  const bodyParts: string[] = [];
  const htmlParts: string[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const literal = text.slice(lastIndex, match.index);
    bodyParts.push(literal);
    htmlParts.push(escapeHtml(literal));
    lastIndex = (match.index ?? 0) + match[0].length;

    const [, snowflake, internalName] = match;

    if (snowflake) {
      const user = message.mentions.users.get(snowflake);
      const displayName =
        message.guild?.members.cache.get(snowflake)?.displayName ?? user?.displayName ?? user?.username ?? snowflake;
      const matrixId = getMatrixIdForDisplayName(displayName);

      if (matrixId) {
        mentionedIds.push(matrixId);
        hasMatrixMentions = true;
        bodyParts.push(matrixId);
        htmlParts.push(`<a href="https://matrix.to/#/${matrixId}">${escapeHtml(displayName)}</a>`);
      } else {
        bodyParts.push(displayName);
        htmlParts.push(escapeHtml(displayName));
      }
    } else if (internalName) {
      const matrixId = getMatrixIdForDisplayName(internalName);

      if (matrixId) {
        mentionedIds.push(matrixId);
        hasMatrixMentions = true;
        bodyParts.push(matrixId);
        htmlParts.push(`<a href="https://matrix.to/#/${matrixId}">${escapeHtml(internalName)}</a>`);
      } else {
        bodyParts.push(internalName);
        htmlParts.push(escapeHtml(internalName));
      }
    }
  }

  const tail = text.slice(lastIndex);
  bodyParts.push(tail);
  htmlParts.push(escapeHtml(tail));

  return {
    body: bodyParts.join(""),
    // Matrix plain-name substitutions need no HTML formatted_body unless a mention anchor was produced.
    formattedBody: hasMatrixMentions ? htmlParts.join("") : undefined,
    mentionedIds,
  };
}

function embedToMatrixTextChunks(embed: Embed): string[] {
  const serialized = serializeEmbedToText(embed);
  if (!serialized) return [];

  const chunks = splitTextIntoChunks(serialized, MATRIX_EMBED_CHUNK_MAX_CHARS);
  if (chunks.length <= 1) return chunks;

  return chunks.map((chunk, index) => `[${index + 1}/${chunks.length}]\n${chunk}`);
}

const handler = async (client: Client, message: Message): Promise<void> => {
  if (!isMatrixConfigured()) return;

  if (!message.guild) return;

  const allPersonas: TomoriState[] = await getCachedAllPersonas(message.guild.id);
  await verifyMessageWebhook(message);
  if (!isSelfTriggerMessage(message, allPersonas)) return;

  const roomId = await getLinkedMatrixRoom(message.channelId);
  if (!roomId) return;
  if (!(await ensureRoomRelayable(roomId, client))) return;

  let persona: TomoriState | undefined;
  let avatarUrl: string | null;

  if (message.author.id === client.user?.id) {
    persona = allPersonas.find((p) => !p.is_alter);

    // Main persona sends as the bot account (no webhook_avatar_url), so displayAvatarURL resolves the guild avatar
    // before the global one.
    avatarUrl =
      message.guild?.members.me?.displayAvatarURL({
        size: 256,
        extension: "png",
      }) ?? message.author.displayAvatarURL({ size: 256, extension: "png" });
  } else {
    const personaByNickname = new Map(allPersonas.map((p) => [normalizeRenderModifierName(p.persona_nickname), p]));
    persona =
      resolveRenderModifierSourcePersona(message.author.username, personaByNickname)?.persona ??
      personaByNickname.get(normalizeRenderModifierName(message.author.username));

    // Warn if no persona matched, because the fallback uses the webhook username as the
    // virtual user localpart, which may create an orphaned Matrix user
    if (!persona) {
      log.warn(
        `Matrix relay: no persona found for alter webhook "${message.author.username}" ` +
          `— using webhook username as Matrix virtual user fallback`,
      );
    }

    avatarUrl = resolvePersonaAvatarPublicUrl(persona?.webhook_avatar_url) ?? null;
  }

  const personaName = persona?.persona_nickname ?? message.author.username;

  // Virtual Matrix users carry persona identity without a prefix, and @{name} placeholders become MSC3952 mention
  // links.
  const rawText = message.content.trim();
  if (rawText) {
    const { body, formattedBody, mentionedIds } = resolveDiscordTextForMatrix(rawText, message);
    try {
      await sendToMatrixRoom(
        roomId,
        body,
        personaName,
        avatarUrl,
        formattedBody,
        mentionedIds.length > 0 ? mentionedIds : undefined,
      );
    } catch (error) {
      log.warn(`Matrix relay: failed to relay message to room ${roomId}`, error);
    }
  }

  // proxyURL avoids the expiry that signed CDN URLs hit.
  const { maxAttachmentBytes, mediaTimeoutMs } = getMatrixSettings();

  for (const attachment of message.attachments.values()) {
    if (attachment.size > maxAttachmentBytes) {
      log.warn(
        `Matrix relay: skipping oversized attachment "${attachment.name}" ` +
          `(${(attachment.size / (1024 * 1024)).toFixed(1)} MB) for room ${roomId}`,
      );
      continue;
    }

    try {
      const download = await safeDownload(attachment.proxyURL, {
        maxSizeMB: maxAttachmentBytes / BYTES_PER_MIB,
        timeoutMs: mediaTimeoutMs,
        knownSize: attachment.size,
      });
      if (!download.success || !download.buffer) {
        log.warn(`Matrix relay: failed to fetch attachment "${attachment.name}" (${download.error ?? "unknown"})`);
        continue;
      }

      const mimeType = attachment.contentType ?? "application/octet-stream";
      const filename = attachment.name ?? "attachment";

      await sendAttachmentToMatrixRoom(
        roomId,
        download.buffer,
        filename,
        mimeType,
        attachment.size,
        personaName,
        avatarUrl,
      );
    } catch (error) {
      log.warn(`Matrix relay: failed to relay attachment "${attachment.name}" to room ${roomId}`, error);
    }
  }

  // Serialize all embeds as plain text rather than whitelisting shapes so new embed types never drop silently.
  for (const embed of message.embeds) {
    const chunks = embedToMatrixTextChunks(embed);
    if (chunks.length === 0) continue;

    for (const [chunkIndex, chunk] of chunks.entries()) {
      const { body, formattedBody, mentionedIds } = resolveDiscordTextForMatrix(chunk, message);
      try {
        await sendToMatrixRoom(
          roomId,
          body,
          personaName,
          avatarUrl,
          formattedBody,
          mentionedIds.length > 0 ? mentionedIds : undefined,
        );
      } catch (error) {
        log.warn(
          `Matrix relay: failed to relay embed chunk ${chunkIndex + 1}/${chunks.length} to room ${roomId}`,
          error,
        );
      }
    }
  }
};

export default handler;

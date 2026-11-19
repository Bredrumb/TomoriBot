import type { Message } from "discord.js";
import type { MessageIdMap } from "@/utils/text/messageIdMap";
import type { ChatIncoming } from "@/utils/chat/types";
import { stripBridgePrefix } from "@/utils/bridges";

const QUEUED_REPLY_DIRECTIVE_MAX_CONTENT_LENGTH = 280;
const SUPPORTED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/mpeg",
  "video/mov",
  "video/quicktime",
  "video/avi",
  "video/x-flv",
  "video/mpg",
  "video/webm",
  "video/wmv",
  "video/3gpp",
];

export function normalizeTailDirective(text: string): string {
  let trimmed = text.trim();
  if (!trimmed) return "";
  if (/^\[System:/i.test(trimmed)) {
    trimmed = trimmed.replace(/^\[System:\s*/i, "");
    if (trimmed.endsWith("]")) {
      trimmed = trimmed.slice(0, -1).trim();
    }
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function truncateForSystemContext(text: string, maxLength: number): string {
  const compacted = compactWhitespace(text);
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildQueuedReplyAttachmentSummary(message: Message): string | null {
  let imageCount = 0;
  let videoCount = 0;
  let fileCount = 0;

  for (const attachment of message.attachments.values()) {
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    if (contentType.startsWith("image/")) {
      imageCount++;
      continue;
    }
    if (SUPPORTED_VIDEO_MIME_TYPES.some((type) => contentType.startsWith(type))) {
      videoCount++;
      continue;
    }
    fileCount++;
  }

  const stickerCount = message.stickers.size;
  const parts: string[] = [];
  if (imageCount > 0) {
    parts.push(`${imageCount} image${imageCount === 1 ? "" : "s"}`);
  }
  if (videoCount > 0) {
    parts.push(`${videoCount} video${videoCount === 1 ? "" : "s"}`);
  }
  if (stickerCount > 0) {
    parts.push(`${stickerCount} sticker${stickerCount === 1 ? "" : "s"}`);
  }
  if (fileCount > 0) {
    parts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

// Scene and non-stop system turns stay excluded because they anchor on shared or arbitrary latest messages, which
// would reply to the wrong author.
export function answersQueuedTriggerMessage(
  incoming: Pick<ChatIncoming, "isFromQueue" | "isStopResponse" | "sceneTurn" | "textQuotaSource">,
): boolean {
  if (!incoming.isFromQueue || incoming.sceneTurn) return false;
  return incoming.isStopResponse === true || incoming.textQuotaSource !== "system";
}

export function buildQueuedReplyDirective(
  message: Message,
  replyTargetName: string,
  activePersonaName: string | null | undefined,
  idMap?: MessageIdMap,
  allowSpriteLabel = false,
): string {
  const normalizedTargetName = compactWhitespace(stripBridgePrefix(replyTargetName)) || "User";
  const normalizedPersonaName =
    compactWhitespace(stripBridgePrefix(activePersonaName ?? "")) || process.env.DEFAULT_BOTNAME || "Tomori";
  const contentPreview = truncateForSystemContext(
    message.cleanContent || message.content || "",
    QUEUED_REPLY_DIRECTIVE_MAX_CONTENT_LENGTH,
  );
  const attachmentSummary = buildQueuedReplyAttachmentSummary(message);
  const normalizedPreview = contentPreview.replaceAll('"', "'");
  const normalizedPersonaLabel = normalizedPersonaName.replaceAll('"', "'");

  let directive = `Create a reply as ${normalizedPersonaLabel} to ${normalizedTargetName}'s message from earlier (ID: ${idMap?.register(message.id, "ref") ?? message.id})`;
  if (attachmentSummary) {
    directive += `, which has ${attachmentSummary} attached`;
  }
  if (normalizedPreview) {
    directive += ` saying: "${normalizedPreview}"`;
  }

  // The persona-sprite prompt teaches `Name (sprite):` as the opening line format. Anchoring
  // the reply to a bare `Name:` here contradicts it on precisely the turns this directive
  // fires on (queued ones), and models resolve the conflict by dropping the sprite tag :
  // which is why sprites silently stopped working mid-chain. Offer both forms whenever the
  // sprite prompt is present, so neither instruction has to be violated to satisfy the other.
  const openingInstruction = allowSpriteLabel
    ? `Start your next reply with "${normalizedPersonaLabel}:", or with "${normalizedPersonaLabel} ({sprite label}):" if you are using a sprite`
    : `Start your next reply with "${normalizedPersonaLabel}:"`;

  return `${directive}. ${openingInstruction}`;
}

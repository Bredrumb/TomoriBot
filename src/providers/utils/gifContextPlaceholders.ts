import type { StreamContext } from "@/types/stream/interfaces";

// Production skips GIF decoding to save memory, and only Tenor URLs are kept in the placeholder because their path
// slugs carry usable context.
export function buildGifUrlPlaceholder(uri: string): string {
  if (uri.includes("tenor.com")) {
    return `[System: This message contains a GIF from Tenor: ${uri}. GIF processing disabled in production.]`;
  }
  return "[System: This message contains a GIF. GIF processing disabled in production.]";
}

export function buildInlineGifPlaceholder(): string {
  return "[System: This context contains inline GIF data. GIF processing disabled in production.]";
}

export interface GifToolHintInput {
  messageId?: string;
  messageIdMap?: StreamContext["messageIdMap"];
  subject: "a GIF" | "inline GIF data";
}

// URL is omitted so the model calls process_gif instead of guessing from a slug, and registering the ID here lets
// that tool resolve the attachment.
export function buildGifToolHint({ messageId, messageIdMap, subject }: GifToolHintInput): string {
  const mediaMessageId = messageId ? (messageIdMap?.register(messageId, "media") ?? messageId) : "unknown";
  return `[System: This message (ID: ${mediaMessageId}) contains ${subject}. Use process_gif tool with this message ID to process it if needed for context.]`;
}

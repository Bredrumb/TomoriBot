import type { StreamContext } from "@/types/stream/interfaces";

/**
 * Production placeholder for a GIF that arrived as a URL.
 *
 * Production does not fetch or decode GIF data (the decode path is memory intensive), so the model
 * only learns that a GIF was attached. A Tenor URL is the exception: its path is a descriptive
 * slug, which is real context the model can still use once the image itself is gone.
 */
export function buildGifUrlPlaceholder(uri: string): string {
  if (uri.includes("tenor.com")) {
    return `[System: This message contains a GIF from Tenor: ${uri}. GIF processing disabled in production.]`;
  }
  return "[System: This message contains a GIF. GIF processing disabled in production.]";
}

/** Production placeholder for a GIF that arrived as inline base64 data, which is not decoded either. */
export function buildInlineGifPlaceholder(): string {
  return "[System: This context contains inline GIF data. GIF processing disabled in production.]";
}

export interface GifToolHintInput {
  messageId?: string;
  messageIdMap?: StreamContext["messageIdMap"];
  /** What the withheld bytes were, phrased to complete "This message (ID: n) contains ...". */
  subject: "a GIF" | "inline GIF data";
}

/**
 * Development hint that points the model at the `process_gif` tool instead of the GIF bytes.
 *
 * The URL stays out of the hint on purpose: with nothing to describe, the model has to call the
 * tool rather than hallucinate a picture it never received. Registering the message ID with the
 * media map is what lets that tool resolve the attachment later, so the registration and the hint
 * stay in one place.
 */
export function buildGifToolHint({ messageId, messageIdMap, subject }: GifToolHintInput): string {
  const mediaMessageId = messageId ? (messageIdMap?.register(messageId, "media") ?? messageId) : "unknown";
  return `[System: This message (ID: ${mediaMessageId}) contains ${subject}. Use process_gif tool with this message ID to process it if needed for context.]`;
}

/**
 * Shared image extraction utilities for Discord messages.
 * Provides a unified pipeline for extracting images from attachments, embeds,
 * stickers, and custom emojis, then converting them to base64 format.
 *
 * Used by both `generate_image` (Gemini Imagen) and `generate_image_nai` (NovelAI)
 * tools to avoid duplicating extraction logic.
 */

import type { Message } from "discord.js";
import { log } from "../misc/logger";
import type { ToolContext } from "../../types/tool/interfaces";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { optimizeImageBuffer } from "@/utils/image/imageProcessor";
import { appendComponentMediaFromMessage } from "@/utils/chat/contextMedia";
import { resolveForwardChain } from "@/utils/discord/forwardChain";
import type { SimplifiedMessageForContext } from "@/utils/text/contextBuilder";

/** Intermediate representation of a discovered image URL before base64 conversion */
export interface ImageUrlInfo {
  url: string;
  mimeType: string;
  /** Human-readable source label for logging (e.g. "attachment: photo.png") */
  source: string;
  /** Discord proxy URL when known — used to dedupe the same media discovered via
   *  multiple paths (e.g. a Components V2 attachment also listed as a candidate). */
  proxyUrl?: string;
}

/** Base64-encoded image data ready for API consumption */
export interface ExtractedImage {
  mimeType: string;
  /** Raw base64-encoded image data (no data-URI prefix) */
  data: string;
}

/** Image URLs resolved from either the requested message or its direct reply target. */
export interface ResolvedMessageImageUrls {
  imageUrls: ImageUrlInfo[];
  /** The message that actually owns the returned images. */
  sourceMessageId: string;
}

/**
 * Build a Discord CDN URL for a custom emoji.
 * Always uses PNG so animated emojis fall back to their first frame.
 * @param emojiId - Discord emoji snowflake ID
 * @returns CDN URL string
 */
function buildEmojiCdnUrl(emojiId: string): string {
  return `https://cdn.discordapp.com/emojis/${emojiId}.png`;
}

function inferImageMimeType(urlOrName: string, fallback = "image/jpeg"): string {
  const lower = urlOrName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return fallback;
}

function isLikelyImageAttachment(attachment: {
  contentType?: string | null;
  name?: string | null;
  url?: string;
}): boolean {
  if (attachment.contentType?.startsWith("image/")) {
    return true;
  }
  return inferImageMimeType(attachment.name || attachment.url || "", "").startsWith("image/");
}

/**
 * Extract custom emoji image URLs from message text content.
 * Deduplicates by emoji ID so the same emoji used twice only produces one image.
 * @param content - Raw message text
 * @returns Array of image URL info objects for each unique custom emoji
 */
function extractCustomEmojis(content: string): ImageUrlInfo[] {
  const emojiUrls: ImageUrlInfo[] = [];
  if (!content) return emojiUrls;

  // Regex created inside the function to avoid stale lastIndex from module-level g-flag regex
  const emojiPattern = /<(a?):([^:]+):(\d{17,20})>/g;
  const seenEmojiIds = new Set<string>();
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex exec loop pattern
  while ((match = emojiPattern.exec(content)) !== null) {
    const emojiName = match[2];
    const emojiId = match[3];

    if (seenEmojiIds.has(emojiId)) continue;
    seenEmojiIds.add(emojiId);

    emojiUrls.push({
      url: buildEmojiCdnUrl(emojiId),
      mimeType: "image/png",
      source: `emoji: ${emojiName}`,
    });
  }

  return emojiUrls;
}

/** The subset of Message fields an image can live in — satisfied by both a full
 *  Message and a forwarded MessageSnapshot. */
type MessageImageSource = Pick<Message, "attachments" | "embeds" | "stickers" | "content" | "components">;

/**
 * Walk one message-like source (a full message or a forwarded snapshot) and feed
 * every discovered image URL to the collector.
 *
 * @param source - Message or snapshot to scan
 * @param addImageUrl - Deduplicating collector provided by the caller
 * @param labelPrefix - Prepended to `source` labels for logging (e.g. "forwarded ")
 */
function collectImageUrlsFromSource(
  source: MessageImageSource,
  addImageUrl: (info: ImageUrlInfo) => void,
  labelPrefix = "",
): void {
  // 1. Direct attachments
  const imageAttachments = source.attachments.filter((attachment) => isLikelyImageAttachment(attachment));

  for (const attachment of imageAttachments.values()) {
    addImageUrl({
      url: attachment.url,
      proxyUrl: attachment.proxyURL,
      mimeType: attachment.contentType || inferImageMimeType(attachment.name || attachment.url || ""),
      source: `${labelPrefix}attachment: ${attachment.name}`,
    });
  }

  // 2. Embed images and thumbnails
  for (const embed of source.embeds) {
    if (embed.image?.url) {
      addImageUrl({
        url: embed.image.url,
        mimeType: "image/jpeg", // Embeds don't provide explicit MIME type
        source: `${labelPrefix}embed.image: ${embed.url || "unknown"}`,
      });
    }

    if (embed.thumbnail?.url) {
      addImageUrl({
        url: embed.thumbnail.url,
        mimeType: "image/jpeg",
        source: `${labelPrefix}embed.thumbnail: ${embed.url || "unknown"}`,
      });
    }
  }

  // 3. Discord stickers
  if (source.stickers.size > 0) {
    for (const sticker of source.stickers.values()) {
      addImageUrl({
        url: sticker.url,
        mimeType: "image/png", // Discord serves stickers as PNG
        source: `${labelPrefix}sticker: ${sticker.name}`,
      });
    }
  }

  // 4. Custom emojis from message text
  if (source.content) {
    for (const emoji of extractCustomEmojis(source.content)) {
      addImageUrl({ ...emoji, source: `${labelPrefix}${emoji.source}` });
    }
  }

  // 5. Components V2 media (Media Gallery / Thumbnail / File). Reuses the same
  //    component-walking + attachment-resolution logic the context pipeline uses
  //    so bot-generated images (referenced only inside a component) are found.
  const componentImages: SimplifiedMessageForContext["imageAttachments"] = [];
  const componentVideosIgnored: SimplifiedMessageForContext["videoAttachments"] = [];
  appendComponentMediaFromMessage(source, componentImages, componentVideosIgnored);

  for (const componentImage of componentImages) {
    addImageUrl({
      url: componentImage.url,
      proxyUrl: componentImage.proxyUrl,
      mimeType: componentImage.mimeType || inferImageMimeType(componentImage.filename || componentImage.url),
      source: `${labelPrefix}component: ${componentImage.filename}`,
    });
  }
}

/**
 * Discover every image URL in a Discord message, without downloading anything.
 *
 * Extraction sources (checked in order):
 * 1. Direct file attachments with image/* MIME type
 * 2. Embed images (e.g. Twitter/X previews, direct image links)
 * 3. Embed thumbnails (fallback for embeds that use thumbnail instead of image)
 * 4. Discord stickers (served as PNG)
 * 5. Custom emojis parsed from message text
 * 6. Components V2 media (Media Gallery / Thumbnail / File items) — required for
 *    bot-generated images, whose attachment is referenced only inside a component
 *    and therefore never appears in the top-level attachment/embed sources above.
 * 7. Forwarded message snapshots — a forward wrapper has EMPTY top-level
 *    content/attachments/embeds; all its media lives inside `messageSnapshots`,
 *    which is re-scanned with sources 1-6. Nested forwards flatten to an empty
 *    snapshot, so the chain is resolved first (see {@link resolveForwardChain}).
 *
 * This is the single source of truth for "where can an image live in a message",
 * shared by every tool that needs to re-fetch image bytes by message/media ID.
 *
 * @param message - Fetched Discord message to scan
 * @returns Array of discovered image URL descriptors (may be empty)
 */
export async function collectImageUrlsFromMessage(message: Message): Promise<ImageUrlInfo[]> {
  const imageUrls: ImageUrlInfo[] = [];
  // Track URLs already added so the same media discovered via two paths
  // (e.g. a Components V2 attachment also listed as a candidate) is
  // only downloaded once.
  const seenUrls = new Set<string>();

  const addImageUrl = (info: ImageUrlInfo): void => {
    if (seenUrls.has(info.url) || (info.proxyUrl && seenUrls.has(info.proxyUrl))) return;
    seenUrls.add(info.url);
    if (info.proxyUrl) seenUrls.add(info.proxyUrl);
    imageUrls.push(info);
  };

  collectImageUrlsFromSource(message, addImageUrl);

  // Forwarded messages: resolve any nested-forward chain first, then scan each
  // snapshot with the same source walk. An unresolved chain yields no snapshots,
  // so the caller reports "no images found" rather than silently returning empty.
  const chain = await resolveForwardChain(message);
  for (const snapshot of chain.snapshots) {
    collectImageUrlsFromSource(snapshot, addImageUrl, "forwarded ");
  }

  return imageUrls;
}

/**
 * Resolve image URLs from a Discord message, falling back to the message it replies to.
 *
 * Reply messages often contain only text while using the referenced message's image as
 * their visual context. The vision tool can receive the reply's media ID in that case,
 * so this fallback makes the referenced image available without requiring the model to
 * know the underlying Discord message ID.
 *
 * The fallback is intentionally one level deep: Discord replies directly identify the
 * message whose media they are discussing, and a bounded lookup avoids surprising walks
 * through long reply chains.
 *
 * @param messageId - Discord message snowflake ID to fetch
 * @param context - Tool execution context providing channel access
 * @returns Image URL descriptors and the ID of the message that owns them
 * @throws Error if the requested message cannot be fetched or neither message has images
 */
export async function resolveMessageImageUrls(
  messageId: string,
  context: ToolContext,
): Promise<ResolvedMessageImageUrls> {
  const message = await context.channel.messages.fetch(messageId);
  const directImageUrls = await collectImageUrlsFromMessage(message);

  if (directImageUrls.length > 0) {
    return { imageUrls: directImageUrls, sourceMessageId: messageId };
  }

  const repliedToMessageId = message.reference?.messageId;
  if (!repliedToMessageId) {
    throw new Error(
      `No images found in message ${messageId} (checked attachments, embeds, stickers, custom emojis, and components)`,
    );
  }

  let repliedToMessage: Message;
  try {
    repliedToMessage = await context.channel.messages.fetch(repliedToMessageId);
  } catch (error) {
    log.warn(
      `Failed to fetch replied-to message ${repliedToMessageId} while resolving images for ${messageId}:`,
      error,
    );
    throw new Error(
      `No images found in message ${messageId}, and replied-to message ${repliedToMessageId} could not be fetched`,
    );
  }

  const repliedToImageUrls = await collectImageUrlsFromMessage(repliedToMessage);
  if (repliedToImageUrls.length === 0) {
    throw new Error(
      `No images found in message ${messageId} or replied-to message ${repliedToMessageId} (checked attachments, embeds, stickers, custom emojis, and components)`,
    );
  }

  log.info(
    `Using ${repliedToImageUrls.length} image(s) from replied-to message ${repliedToMessageId} for ${messageId}`,
  );
  return { imageUrls: repliedToImageUrls, sourceMessageId: repliedToMessageId };
}

/**
 * Extract all images from a Discord message and convert them to base64.
 *
 * Delegates discovery to {@link collectImageUrlsFromMessage} (which covers
 * attachments, embeds, stickers, custom emojis, and Components V2 media), then
 * downloads and optimizes each one.
 *
 * Each source is fetched independently — individual failures are logged and skipped
 * so that other images in the same message can still be processed.
 *
 * @param messageId - Discord message snowflake ID to fetch
 * @param context - Tool execution context providing channel access
 * @returns Array of base64-encoded images with MIME types
 * @throws Error if the message is not found or no images could be processed
 */
export async function extractImagesFromMessage(messageId: string, context: ToolContext): Promise<ExtractedImage[]> {
  // 1. Fetch the Discord message
  const message = await context.channel.messages.fetch(messageId);

  if (!message) {
    throw new Error(`Message ${messageId} not found`);
  }

  // 2. Discover every image URL in the message (all sources, including Components V2)
  const imageUrls = await collectImageUrlsFromMessage(message);

  // Validate we found at least one image source
  if (imageUrls.length === 0) {
    throw new Error(
      `No images found in message ${messageId} (checked attachments, embeds, stickers, custom emojis, and components)`,
    );
  }

  log.info(`Found ${imageUrls.length} image(s) in message ${messageId}`);

  // 3. Convert each URL to base64
  const results: ExtractedImage[] = [];

  for (const imageInfo of imageUrls) {
    try {
      const imageResponse = await safeDownload(imageInfo.url, {
        maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
        timeoutMs: 15_000,
        externalSignal: context.abortSignal,
      });
      if (!imageResponse.success || !imageResponse.buffer) {
        log.warn(`Failed to fetch image from ${imageInfo.source}: ${imageResponse.details ?? imageResponse.error}`);
        continue;
      }

      const optimized = await optimizeImageBuffer(imageResponse.buffer, imageInfo.mimeType);
      results.push({ mimeType: optimized.mimeType, data: optimized.data });

      log.info(`Successfully converted image from ${imageInfo.source} to base64`);
    } catch (imgErr) {
      log.warn(`Failed to process image from ${imageInfo.source}:`, imgErr as Error);
    }
  }

  // Ensure at least one image was successfully processed
  if (results.length === 0) {
    throw new Error(`Failed to process any images from message ${messageId}`);
  }

  return results;
}

/**
 * Fetch an image from a URL and return it as a raw Buffer.
 * Useful for tools that need the buffer directly (e.g. for sharp processing).
 * @param imageUrl - URL to fetch
 * @returns Image data as a Buffer
 * @throws Error if the fetch fails
 */
export async function fetchImageAsBuffer(imageUrl: string): Promise<Buffer> {
  const response = await safeDownload(imageUrl, {
    maxSizeMB: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB,
    timeoutMs: 15_000,
  });
  if (!response.success || !response.buffer) {
    throw new Error(`Failed to fetch image: ${response.details ?? response.error ?? "unknown error"}`);
  }

  return response.buffer;
}

/**
 * Fetch an image from a URL and return it as a base64-encoded string.
 * Convenience wrapper over fetchImageAsBuffer for tools that need base64 directly.
 * @param imageUrl - URL to fetch
 * @returns Base64-encoded image data (no data-URI prefix)
 * @throws Error if the fetch fails
 */
export async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  const buffer = await fetchImageAsBuffer(imageUrl);
  return buffer.toString("base64");
}

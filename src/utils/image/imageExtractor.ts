import type { Message } from "discord.js";
import { log } from "../misc/logger";
import type { ToolContext } from "../../types/tool/interfaces";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload, type SafeDownloadOptions, type SafeDownloadResult } from "@/utils/security/safeDownload";
import { optimizeImageBuffer } from "@/utils/image/imageProcessor";
import { appendComponentMediaFromMessage } from "@/utils/chat/contextMedia";
import { resolveForwardChain } from "@/utils/discord/forwardChain";
import type { SimplifiedMessageForContext } from "@/utils/text/contextBuilder";

export interface ImageUrlInfo {
  url: string;
  mimeType: string;
  source: string;
  proxyUrl?: string;
}

export interface ExtractedImage {
  mimeType: string;
  data: string;
}

export interface ResolvedMessageImageUrls {
  imageUrls: ImageUrlInfo[];
  sourceMessageId: string;
}

// Discord's emoji CDN returns the first static frame when .png is requested, so PNG is forced here for animated
// emojis too.
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

// HTTPS origins go before Discord's proxyUrl because the proxy can re-encode or serve stale copies, while proxyUrl
// saves HTTP origins blocked by the SSRF gate.
function buildImageDownloadCandidates(info: ImageUrlInfo): string[] {
  if (!info.proxyUrl || info.proxyUrl === info.url) {
    return [info.url];
  }

  return info.url.startsWith("http://") ? [info.proxyUrl, info.url] : [info.url, info.proxyUrl];
}

export async function downloadDiscoveredImage(
  info: ImageUrlInfo,
  options: SafeDownloadOptions,
): Promise<SafeDownloadResult> {
  const candidates = buildImageDownloadCandidates(info);
  let lastResult: SafeDownloadResult = {
    success: false,
    error: "invalid_response",
    details: "No download candidates available",
  };

  for (const candidate of candidates) {
    const result = await safeDownload(candidate, options);
    if (result.success) {
      return result;
    }

    lastResult = result;

    // Both mirrors carry the same bytes under the same deadline, so an oversized
    // or timed-out first attempt cannot be rescued by trying the second.
    if (result.error === "size_exceeded" || result.error === "timeout") {
      break;
    }
  }

  return lastResult;
}

type MessageImageSource = Pick<Message, "attachments" | "embeds" | "stickers" | "content" | "components">;

function collectImageUrlsFromSource(
  source: MessageImageSource,
  addImageUrl: (info: ImageUrlInfo) => void,
  labelPrefix = "",
): void {
  // Direct attachments
  const imageAttachments = source.attachments.filter((attachment) => isLikelyImageAttachment(attachment));

  for (const attachment of imageAttachments.values()) {
    addImageUrl({
      url: attachment.url,
      proxyUrl: attachment.proxyURL,
      mimeType: attachment.contentType || inferImageMimeType(attachment.name || attachment.url || ""),
      source: `${labelPrefix}attachment: ${attachment.name}`,
    });
  }

  // Embed images and thumbnails
  for (const embed of source.embeds) {
    if (embed.image?.url) {
      addImageUrl({
        url: embed.image.url,
        proxyUrl: embed.image.proxyURL,
        mimeType: "image/jpeg", // Embeds don't provide explicit MIME type
        source: `${labelPrefix}embed.image: ${embed.url || "unknown"}`,
      });
    }

    if (embed.thumbnail?.url) {
      addImageUrl({
        url: embed.thumbnail.url,
        proxyUrl: embed.thumbnail.proxyURL,
        mimeType: "image/jpeg",
        source: `${labelPrefix}embed.thumbnail: ${embed.url || "unknown"}`,
      });
    }
  }

  // Discord stickers
  if (source.stickers.size > 0) {
    for (const sticker of source.stickers.values()) {
      addImageUrl({
        url: sticker.url,
        mimeType: "image/png", // Discord serves stickers as PNG
        source: `${labelPrefix}sticker: ${sticker.name}`,
      });
    }
  }

  if (source.content) {
    for (const emoji of extractCustomEmojis(source.content)) {
      addImageUrl({ ...emoji, source: `${labelPrefix}${emoji.source}` });
    }
  }

  // Components V2 media (Media Gallery / Thumbnail / File). Reuses the same
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

// Reply fallback checks only the direct parent because models pass the reply's ID for referenced images and deeper
// walks risk unrelated history.
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
    repliedToMessage =
      message.reference?.channelId && message.reference.channelId !== context.channel.id
        ? await message.fetchReference()
        : await context.channel.messages.fetch(repliedToMessageId);
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

export async function extractImagesFromMessage(messageId: string, context: ToolContext): Promise<ExtractedImage[]> {
  const { imageUrls, sourceMessageId } = await resolveMessageImageUrls(messageId, context);
  log.info(
    `Found ${imageUrls.length} image(s) in message ${sourceMessageId}${
      sourceMessageId !== messageId ? ` via reply ${messageId}` : ""
    }`,
  );

  const results: ExtractedImage[] = [];

  for (const imageInfo of imageUrls) {
    try {
      const imageResponse = await downloadDiscoveredImage(imageInfo, {
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

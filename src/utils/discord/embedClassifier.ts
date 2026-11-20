import type { Embed } from "discord.js";
import { isMessageProxyReplyEmbed } from "@/utils/messageProxy/registry";

import {
  classifyProtocolEmbed,
  classifyProtocolTitle,
  isTargetProtocolKind,
  type TargetEmbedType,
} from "./embedProtocol";

export type TargetEmbedCheck = { isTarget: true; type: TargetEmbedType } | { isTarget: false; type: null };

export function checkTargetEmbedTitle(embedTitle: string | null | undefined): TargetEmbedCheck {
  const kind = classifyProtocolTitle(embedTitle);
  return isTargetProtocolKind(kind) ? { isTarget: true, type: kind } : { isTarget: false, type: null };
}

export function checkTargetEmbed(embed: Pick<Embed, "title" | "footer">): TargetEmbedCheck {
  const kind = classifyProtocolEmbed(embed);
  return isTargetProtocolKind(kind) ? { isTarget: true, type: kind } : { isTarget: false, type: null };
}

type LinkPreviewImageInfo = {
  url: string;
  proxyUrl: string;
  mimeType: string | null;
  filename: string;
};

export type LinkPreviewResult = {
  isLinkPreview: boolean;
  textContent: string | null;
  imageInfo: LinkPreviewImageInfo | null;
  thumbnailInfo: LinkPreviewImageInfo | null;
};

function extractEmbedTextParts(embed: Pick<Embed, "author" | "title" | "description" | "fields" | "footer">): string[] {
  const parts: string[] = [];
  if (embed.author?.name) parts.push(embed.author.name);
  if (embed.title) parts.push(embed.title);
  if (embed.description) parts.push(embed.description);
  for (const field of embed.fields) {
    if (field.name || field.value)
      parts.push(field.name && field.value ? `${field.name}: ${field.value}` : field.name || field.value);
  }
  if (embed.footer?.text) parts.push(embed.footer.text);
  return parts;
}

export function processLinkEmbed(embed: Embed): LinkPreviewResult {
  if (classifyProtocolEmbed(embed) === "unshared_dice_roll")
    return { isLinkPreview: false, textContent: null, imageInfo: null, thumbnailInfo: null };
  const hasContent = embed.url || embed.title || embed.description || embed.author?.name || embed.fields.length > 0;
  if (!hasContent) {
    return { isLinkPreview: false, textContent: null, imageInfo: null, thumbnailInfo: null };
  }

  // Skip bot-produced system embeds because those are handled separately
  const embedCheck = checkTargetEmbed(embed);
  if (embedCheck.isTarget) {
    return { isLinkPreview: false, textContent: null, imageInfo: null, thumbnailInfo: null };
  }

  // A message-proxy reply embed restates a reference the pipeline already annotates
  // from the pre-proxy original, so rendering it would duplicate the notice.
  if (isMessageProxyReplyEmbed(embed)) {
    return { isLinkPreview: false, textContent: null, imageInfo: null, thumbnailInfo: null };
  }

  const contentParts = extractEmbedTextParts({
    author: embed.author,
    title: embed.title,
    description: embed.description,
    fields: embed.fields,
    footer: null,
  });

  const textContent =
    contentParts.length > 0 ? `[System: Link preview embed content: ${contentParts.join(" - ")}]` : "";

  const imageInfo = embed.image?.url ? deriveEmbedImageInfo(embed.image.url, embed.image.proxyURL ?? null) : null;
  const thumbnailInfo =
    !imageInfo && embed.thumbnail?.url
      ? deriveEmbedImageInfo(embed.thumbnail.url, embed.thumbnail.proxyURL ?? null)
      : null;

  return {
    isLinkPreview: true,
    textContent: textContent.trim() || null,
    imageInfo,
    thumbnailInfo,
  };
}

function deriveEmbedImageInfo(rawUrl: string, proxyUrl: string | null): LinkPreviewImageInfo | null {
  try {
    const parsed = new URL(rawUrl);
    let filename = parsed.pathname.split("/").pop() || "embed_image";
    filename = filename.replace(/:(large|medium|small|orig)$/, "");

    let mimeType = "image/jpeg";
    const extension = filename.split(".").pop()?.toLowerCase();
    switch (extension) {
      case "png":
        mimeType = "image/png";
        break;
      case "gif":
        mimeType = "image/gif";
        break;
      case "webp":
        mimeType = "image/webp";
        break;
      default:
        mimeType = "image/jpeg";
        break;
    }

    if (!filename.includes(".")) filename = `${filename}.jpg`;

    return {
      url: rawUrl,
      proxyUrl: proxyUrl || rawUrl,
      mimeType,
      filename,
    };
  } catch {
    return null;
  }
}

export function formatSystemProducedEmbedHint(embedBody: string): string {
  return `[System: The following content came from a system-produced embed]\n${embedBody}`;
}

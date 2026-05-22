import type { Client } from "discord.js";
import { ContextItemTag, type ContextPart, type StructuredContextItem } from "@/types/misc/context";
import { HumanizerDegree, type AssembledServerConfig, type TomoriState } from "@/types/db/schema";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { log } from "@/utils/misc/logger";
import { memoryGuard } from "@/utils/security/rateLimiter";
import { humanizeString } from "@/utils/text/processors/formatters";
import { applyUncensorInputTransforms } from "@/utils/text/uncensor";
import type { MessageIdMap } from "@/utils/text/messageIdMap";
import type { ToolPromptMacroResolver } from "@/utils/tools/toolPromptMacros";
import {
  buildMediaAttributionText,
  buildMediaDescription,
  formatMessageTimestamp,
  getLastImageOccurrenceIndices,
  getRenderedImageMessageIdsWithinWindow,
  isCountedRenderedImageAttachment,
  MEDIA_IMAGE_MESSAGE_LIMIT,
  pushDialogueHistoryContextItem,
} from "./history";
import { normalizeCustomEmojisForLlm, splitLeadingSystemBlocks } from "./mentionNormalizer";
import type { MentionConverter } from "./templates";
import type { SimplifiedMessageForContext } from "./types";

export async function appendDialogueHistoryContext(params: {
  contextItems: StructuredContextItem[];
  client: Client;
  guildId: string;
  simplifiedMessageHistory: SimplifiedMessageForContext[];
  botName: string;
  tomoriConfig: AssembledServerConfig;
  tomoriState: TomoriState | null;
  mediaContextWindow?: number;
  includeTimestamps: boolean;
  seesImagesOverride?: boolean;
  seesVideosOverride?: boolean;
  hasVisionTool: boolean;
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
  messageIdMap?: MessageIdMap;
  toolPromptMacroResolver: ToolPromptMacroResolver;
  uncensorInputOptions: { unicodeSpacesEnabled: boolean; sanitizeEnabled: boolean };
  convertMentions: MentionConverter;
}): Promise<void> {
  const totalMessages = params.simplifiedMessageHistory.length;
  const configuredMessageFetchLimit = normalizeMessageFetchLimit(params.tomoriConfig.message_fetch_limit);
  const requestedMediaWindow = params.mediaContextWindow ?? memoryGuard.getMediaWindow();
  const effectiveMediaWindow = Math.min(requestedMediaWindow, configuredMessageFetchLimit);
  const maxExtendBy = Math.max(0, configuredMessageFetchLimit - effectiveMediaWindow);
  const mediaWindowCutoff = totalMessages - effectiveMediaWindow;
  const renderedImageMessageIds = getRenderedImageMessageIdsWithinWindow(
    params.simplifiedMessageHistory,
    mediaWindowCutoff,
  );
  const duplicateImageLastIndex = getLastImageOccurrenceIndices(
    params.simplifiedMessageHistory,
    renderedImageMessageIds,
    mediaWindowCutoff,
  );

  const effectiveContextNote =
    params.tomoriState?.context_note?.trim() || params.tomoriConfig.context_note?.trim() || null;
  const effectiveContextNoteDepth = effectiveContextNote
    ? params.tomoriState?.context_note?.trim()
      ? (params.tomoriState.context_note_depth ?? 0)
      : (params.tomoriConfig.context_note_depth ?? 0)
    : 0;
  const contextNoteTargetIndex = effectiveContextNote ? Math.max(0, totalMessages - effectiveContextNoteDepth) : -1;
  let contextNoteEmitted = false;

  const botNameLower = params.botName.toLowerCase();
  for (const [index, msg] of params.simplifiedMessageHistory.entries()) {
    const isPersonaMessage = msg.authorType === "persona" && !!msg.personaName;
    const isCurrentPersonaMessage = isPersonaMessage && msg.personaName?.toLowerCase() === botNameLower;
    const role =
      params.isUserImpersonation && msg.authorType === "user" && msg.authorId === params.impersonatedUserId
        ? "model"
        : params.isUserImpersonation || !isCurrentPersonaMessage
          ? "user"
          : "model";

    if (!contextNoteEmitted && effectiveContextNote && index === contextNoteTargetIndex) {
      pushDialogueHistoryContextItem(
        params.contextItems,
        "user",
        [{ type: "text", text: `[System: ${effectiveContextNote}]` }],
        "context_note_injection",
        ContextItemTag.CONTEXT_NOTE_INJECTION,
      );
      contextNoteEmitted = true;
    }

    const parts: ContextPart[] = [];
    const detachedSystemParts: ContextPart[] = [];
    const isWithinMediaWindow = index >= mediaWindowCutoff;
    const hasNonEmojiImages = msg.imageAttachments.some((attachment) => !attachment.isEmoji);
    const hasVideos = msg.videoAttachments.length > 0;
    const hasSignificantMedia = hasNonEmojiImages || hasVideos;
    const seesImages = params.seesImagesOverride ?? params.tomoriState?.llm.sees_images ?? false;
    const seesVideos = params.seesVideosOverride ?? params.tomoriState?.llm.sees_videos ?? false;

    const mediaIdHintAdded = await appendMediaParts({
      ...params,
      msg,
      index,
      parts,
      detachedSystemParts,
      isWithinMediaWindow,
      hasNonEmojiImages,
      hasVideos,
      seesImages,
      seesVideos,
      renderedImageMessageIds,
      duplicateImageLastIndex,
      mediaWindowCutoff,
      maxExtendBy,
    });

    const mediaAttributionHint =
      hasSignificantMedia && !mediaIdHintAdded
        ? await buildMediaAttributionHint({ ...params, msg, hasNonEmojiImages, hasVideos })
        : null;

    await appendTextParts({
      ...params,
      msg,
      role,
      parts,
      detachedSystemParts,
      mediaAttributionHint,
    });

    if (role === "user" && (parts.length > 0 || detachedSystemParts.length > 0)) {
      const mediaParts = parts.filter((part) => part.type !== "text");
      const textParts = parts.filter((part) => part.type === "text");
      pushDialogueHistoryContextItem(
        params.contextItems,
        "user",
        [...mediaParts, ...detachedSystemParts, ...textParts],
        msg.id,
      );
    } else {
      pushDialogueHistoryContextItem(params.contextItems, "user", detachedSystemParts, msg.id);
      pushDialogueHistoryContextItem(params.contextItems, role, parts, msg.id);
    }
  }

  if (!contextNoteEmitted && effectiveContextNote) {
    pushDialogueHistoryContextItem(
      params.contextItems,
      "user",
      [{ type: "text", text: `[System: ${effectiveContextNote}]` }],
      "context_note_injection",
      ContextItemTag.CONTEXT_NOTE_INJECTION,
    );
  }
}

async function appendMediaParts(
  params: Parameters<typeof appendDialogueHistoryContext>[0] & {
    msg: SimplifiedMessageForContext;
    index: number;
    parts: ContextPart[];
    detachedSystemParts: ContextPart[];
    isWithinMediaWindow: boolean;
    hasNonEmojiImages: boolean;
    hasVideos: boolean;
    seesImages: boolean;
    seesVideos: boolean;
    renderedImageMessageIds: Set<string>;
    duplicateImageLastIndex: Map<string, number>;
    mediaWindowCutoff: number;
    maxExtendBy: number;
  },
): Promise<boolean> {
  const hasViewableMediaOutsideWindow =
    (params.hasNonEmojiImages && params.seesImages) || (params.hasVideos && params.seesVideos);
  if (hasViewableMediaOutsideWindow && !params.isWithinMediaWindow) {
    const extendByNeeded = Math.min(params.mediaWindowCutoff - params.index, params.maxExtendBy);
    params.detachedSystemParts.push({
      type: "text",
      text: `[System: This message (ID: ${params.messageIdMap?.register(params.msg.id, "media") ?? params.msg.id}) contained ${buildMediaDescription(params.msg)} - use increase_media_context with extend_by=${extendByNeeded} to view]`,
    });
    return true;
  }

  if (!params.isWithinMediaWindow) {
    return false;
  }

  await appendImageParts(params);
  appendVideoParts(params);
  return false;
}

async function appendImageParts(params: Parameters<typeof appendMediaParts>[0]): Promise<void> {
  if (params.msg.imageAttachments.length === 0) return;

  if (params.seesImages) {
    const hasCountedImages = params.msg.imageAttachments.some(isCountedRenderedImageAttachment);
    const shouldRenderCountedImages = !hasCountedImages || params.renderedImageMessageIds.has(params.msg.id);
    let skippedCountedImageCount = 0;
    let skippedDuplicateImageCount = 0;

    for (const attachment of params.msg.imageAttachments) {
      const countsTowardRenderedImageLimit = isCountedRenderedImageAttachment(attachment);
      if (countsTowardRenderedImageLimit && !shouldRenderCountedImages) {
        skippedCountedImageCount++;
        continue;
      }

      const lastIndex = params.duplicateImageLastIndex.get(attachment.proxyUrl);
      if (lastIndex !== undefined && countsTowardRenderedImageLimit && lastIndex !== params.index) {
        skippedDuplicateImageCount++;
        continue;
      }

      if (attachment.mimeType) {
        params.parts.push({
          type: "image",
          uri: attachment.proxyUrl,
          mimeType: attachment.mimeType,
          ...(attachment.url !== attachment.proxyUrl && { fallbackUri: attachment.url }),
        });
      } else {
        log.warn(
          `Skipping image attachment due to missing mimeType: ${attachment.filename} from user ${params.msg.authorName}`,
        );
      }
    }

    if (skippedDuplicateImageCount > 0) {
      log.info(
        `Skipped ${skippedDuplicateImageCount} duplicate image(s) for message ${params.msg.id} - same image rendered in a later message`,
      );
    }
    if (skippedCountedImageCount > 0) {
      const skippedImageDescription =
        skippedCountedImageCount === 1
          ? "1 image omitted due to rendered-image limit. Do not claim to see it."
          : `${skippedCountedImageCount} images omitted due to rendered-image limit. Do not claim to see them.`;
      params.detachedSystemParts.push({ type: "text", text: `[System: ${skippedImageDescription}]` });
      log.info(
        `Skipped ${skippedCountedImageCount} counted image(s) for message ${params.msg.id} due to MEDIA_IMAGE_MESSAGE_LIMIT=${MEDIA_IMAGE_MESSAGE_LIMIT}`,
      );
    }
    return;
  }

  const imageCount = params.msg.imageAttachments.length;
  const hasGif = params.msg.imageAttachments.some((attachment) => attachment.mimeType?.includes("gif"));
  const imageDescription =
    hasGif && imageCount === 1
      ? "a GIF"
      : hasGif
        ? `${imageCount} images (including GIF)`
        : imageCount === 1
          ? "an image"
          : `${imageCount} images`;
  params.detachedSystemParts.push({
    type: "text",
    text: params.hasVisionTool
      ? await params.toolPromptMacroResolver.expand(
          `[System: This message contains ${imageDescription}. Do not guess the image contents. Use the {image_analysis_tool} tool only if the user explicitly asks about the image or if unseen visual details are necessary to answer correctly.]`,
        )
      : `[System: This message contains ${imageDescription}. Current model cannot see images, please do not describe or claim to see the image contents.]`,
  });
  log.info(
    `Images skipped for message ${params.msg.id} - model does not support images (visionTool=${params.hasVisionTool})`,
  );
}

function appendVideoParts(params: Parameters<typeof appendMediaParts>[0]): void {
  if (params.msg.videoAttachments.length === 0) return;

  if (params.seesVideos) {
    for (const attachment of params.msg.videoAttachments) {
      if (attachment.mimeType) {
        params.parts.push({
          type: "video",
          uri: attachment.isYouTubeLink ? attachment.url : attachment.proxyUrl,
          mimeType: attachment.mimeType,
          isYouTubeLink: attachment.isYouTubeLink,
        });
      } else {
        log.warn(
          `Skipping video attachment due to missing mimeType: ${attachment.filename} from user ${params.msg.authorName}`,
        );
      }
    }
    return;
  }

  const videoDescription =
    params.msg.videoAttachments.length === 1 ? "a video" : `${params.msg.videoAttachments.length} videos`;
  params.detachedSystemParts.push({
    type: "text",
    text: `[System: This message contains ${videoDescription}. Current model cannot see videos, please do not describe or claim to see the video contents.]`,
  });
  log.info(`Videos skipped for message ${params.msg.id} - model does not support videos`);
}

async function buildMediaAttributionHint(
  params: Parameters<typeof appendDialogueHistoryContext>[0] & {
    msg: SimplifiedMessageForContext;
    hasNonEmojiImages: boolean;
    hasVideos: boolean;
  },
): Promise<string> {
  const mediaMessageIds = params.msg.mediaSourceMessageIds ?? [params.msg.id];
  const nonEmojiImageCount = params.msg.imageAttachments.filter((attachment) => !attachment.isEmoji).length;
  const videoCount = params.msg.videoAttachments.length;
  const totalMediaCount = nonEmojiImageCount + videoCount;
  const mediaWord =
    nonEmojiImageCount > 0 && videoCount === 0
      ? nonEmojiImageCount === 1
        ? "image"
        : "images"
      : videoCount > 0 && nonEmojiImageCount === 0
        ? videoCount === 1
          ? "video"
          : "videos"
        : "media files";
  const idLabel = mediaMessageIds.length === 1 ? "Media ID" : "Media IDs";
  const idList = mediaMessageIds.map((id) => params.messageIdMap?.register(id, "media") ?? id).join(", ");
  const thisOrThese = totalMediaCount === 1 ? "This" : "These";
  const wasSent = totalMediaCount === 1 ? "was" : "were";

  if (!mediaMessageIds.includes(params.msg.id)) {
    return params.msg.remoteMediaSourceKind === "forwarded"
      ? `[System: ${thisOrThese} ${mediaWord} (${idLabel}: ${idList}) ${wasSent} attached to the forwarded message described above]`
      : `[System: ${thisOrThese} ${mediaWord} (${idLabel}: ${idList}) ${wasSent} included in the message being replied to]`;
  }

  const resolvedHintAuthorName = await params.convertMentions(
    params.msg.authorName,
    params.client,
    params.guildId,
    params.msg.authorName,
    params.botName,
    params.tomoriConfig.personal_memories_enabled,
  );
  return `[System: ${thisOrThese} ${mediaWord} (${idLabel}: ${idList}) ${wasSent} sent by ${resolvedHintAuthorName}]`;
}

async function appendTextParts(
  params: Parameters<typeof appendDialogueHistoryContext>[0] & {
    msg: SimplifiedMessageForContext;
    role: "user" | "model";
    parts: ContextPart[];
    detachedSystemParts: ContextPart[];
    mediaAttributionHint: string | null;
  },
): Promise<void> {
  if (params.msg.content) {
    const normalizedContent = normalizeCustomEmojisForLlm(params.msg.content);
    let processedContent: string;
    if (normalizedContent.startsWith("[System:")) {
      const { leadingSystemBlocks, remainingContent } = splitLeadingSystemBlocks(normalizedContent);
      processedContent =
        leadingSystemBlocks.length > 0 && remainingContent
          ? `${leadingSystemBlocks.join("\n")}\n${params.msg.authorName}: ${remainingContent}`
          : normalizedContent;
    } else {
      processedContent = `${params.msg.authorName}: ${normalizedContent}`;
    }

    if (params.tomoriConfig.humanizer_degree >= HumanizerDegree.HEAVY && params.role === "model") {
      processedContent = humanizeString(processedContent);
    }
    processedContent = await params.convertMentions(
      processedContent,
      params.client,
      params.guildId,
      params.msg.authorName,
      params.botName,
      params.tomoriConfig.personal_memories_enabled,
    );
    if (!processedContent.startsWith("[System:")) {
      processedContent = applyUncensorInputTransforms(processedContent, params.uncensorInputOptions);
    }
    if (params.mediaAttributionHint) processedContent += `\n${params.mediaAttributionHint}`;
    params.parts.push({ type: "text", text: processedContent });
    if (params.includeTimestamps && params.msg.createdAt) {
      params.parts.push({ type: "text", text: formatMessageTimestamp(params.msg.createdAt) });
    }
  } else if (params.parts.length > 0 || params.detachedSystemParts.length > 0) {
    if (params.mediaAttributionHint) {
      params.parts.push({ type: "text", text: params.mediaAttributionHint });
      return;
    }

    params.parts.push({
      type: "text",
      text: await params.convertMentions(
        buildMediaAttributionText(params.msg, params.msg.authorName),
        params.client,
        params.guildId,
        params.msg.authorName,
        params.botName,
        params.tomoriConfig.personal_memories_enabled,
      ),
    });
  }
}

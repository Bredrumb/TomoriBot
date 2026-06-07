import type { Client } from "discord.js";
import {
  ContextItemTag,
  type ContextPart,
  type MediaDescriptor,
  type StructuredContextItem,
} from "@/types/misc/context";
import { HumanizerDegree, type AssembledServerConfig, type TomoriState } from "@/types/db/schema";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { log } from "@/utils/misc/logger";
import { memoryGuard } from "@/utils/security/rateLimiter";
import { humanizeString } from "@/utils/text/processors/formatters";
import { applyUncensorInputTransforms } from "@/utils/text/uncensor";
import type { MessageIdMap } from "@/utils/text/messageIdMap";
import {
  buildMediaAttributionText,
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
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
  messageIdMap?: MessageIdMap;
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
    const sender: StructuredContextItem["sender"] = {
      name: msg.personaName ?? msg.authorName,
      type: msg.authorType,
    };

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
    const mediaDescriptors: MediaDescriptor[] = [];
    const isWithinMediaWindow = index >= mediaWindowCutoff;
    const hasNonEmojiImages = msg.imageAttachments.some((attachment) => !attachment.isEmoji);
    const hasVideos = msg.videoAttachments.length > 0;
    const hasSignificantMedia = hasNonEmojiImages || hasVideos;

    const mediaIdHintAdded = appendMediaDescriptors({
      ...params,
      msg,
      index,
      mediaDescriptors,
      detachedSystemParts,
      isWithinMediaWindow,
      hasNonEmojiImages,
      hasVideos,
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
      hasMediaDescriptors: mediaDescriptors.length > 0,
      mediaAttributionHint,
    });

    if (role === "user" && (parts.length > 0 || detachedSystemParts.length > 0 || mediaDescriptors.length > 0)) {
      pushDialogueHistoryContextItem(
        params.contextItems,
        "user",
        [...detachedSystemParts, ...parts],
        msg.id,
        undefined,
        sender,
        mediaDescriptors,
      );
    } else {
      pushDialogueHistoryContextItem(params.contextItems, "user", detachedSystemParts, msg.id, undefined, sender);
      pushDialogueHistoryContextItem(params.contextItems, role, parts, msg.id, undefined, sender, mediaDescriptors);
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

function appendMediaDescriptors(
  params: Parameters<typeof appendDialogueHistoryContext>[0] & {
    msg: SimplifiedMessageForContext;
    index: number;
    mediaDescriptors: MediaDescriptor[];
    detachedSystemParts: ContextPart[];
    isWithinMediaWindow: boolean;
    hasNonEmojiImages: boolean;
    hasVideos: boolean;
    renderedImageMessageIds: Set<string>;
    duplicateImageLastIndex: Map<string, number>;
    mediaWindowCutoff: number;
    maxExtendBy: number;
  },
): boolean {
  if (!params.isWithinMediaWindow) {
    const extendByNeeded = Math.min(params.mediaWindowCutoff - params.index, params.maxExtendBy);
    const mediaId = params.messageIdMap?.register(params.msg.id, "media") ?? params.msg.id;
    for (const attachment of params.msg.imageAttachments) {
      if (attachment.isEmoji) continue;
      params.mediaDescriptors.push({
        kind: "image",
        uri: attachment.proxyUrl,
        mimeType: attachment.mimeType,
        ...(attachment.url !== attachment.proxyUrl && { fallbackUri: attachment.url }),
        mediaId,
        withinWindow: false,
        extendBy: extendByNeeded,
        filename: attachment.filename,
      });
    }
    for (const attachment of params.msg.videoAttachments) {
      params.mediaDescriptors.push({
        kind: "video",
        uri: attachment.isYouTubeLink ? attachment.url : attachment.proxyUrl,
        mimeType: attachment.mimeType,
        mediaId,
        withinWindow: false,
        extendBy: extendByNeeded,
        isYouTubeLink: attachment.isYouTubeLink,
        filename: attachment.filename,
      });
    }
    return params.mediaDescriptors.length > 0;
  }

  appendImageDescriptors(params);
  appendVideoDescriptors(params);
  return false;
}

function appendImageDescriptors(params: Parameters<typeof appendMediaDescriptors>[0]): void {
  if (params.msg.imageAttachments.length === 0) return;

  const hasCountedImages = params.msg.imageAttachments.some(isCountedRenderedImageAttachment);
  const shouldRenderCountedImages = !hasCountedImages || params.renderedImageMessageIds.has(params.msg.id);
  let skippedCountedImageCount = 0;
  let skippedDuplicateImageCount = 0;
  const mediaId = params.messageIdMap?.register(params.msg.id, "media") ?? params.msg.id;

  for (const attachment of params.msg.imageAttachments) {
    if (attachment.isEmoji) continue;

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

    params.mediaDescriptors.push({
      kind: "image",
      uri: attachment.proxyUrl,
      mimeType: attachment.mimeType,
      ...(attachment.url !== attachment.proxyUrl && { fallbackUri: attachment.url }),
      mediaId,
      withinWindow: true,
      filename: attachment.filename,
    });
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
}

function appendVideoDescriptors(params: Parameters<typeof appendMediaDescriptors>[0]): void {
  if (params.msg.videoAttachments.length === 0) return;

  const mediaId = params.messageIdMap?.register(params.msg.id, "media") ?? params.msg.id;
  for (const attachment of params.msg.videoAttachments) {
    params.mediaDescriptors.push({
      kind: "video",
      uri: attachment.isYouTubeLink ? attachment.url : attachment.proxyUrl,
      mimeType: attachment.mimeType,
      mediaId,
      withinWindow: true,
      isYouTubeLink: attachment.isYouTubeLink,
      filename: attachment.filename,
    });
  }
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
    hasMediaDescriptors: boolean;
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
  } else if (params.parts.length > 0 || params.detachedSystemParts.length > 0 || params.hasMediaDescriptors) {
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

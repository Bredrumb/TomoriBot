import type { Embed, Message } from "discord.js";
import { MessageReferenceType } from "discord.js";
import { getCachedVoiceTranscript } from "@/utils/audio/voiceTranscriptCache";
import { isAudioAttachment } from "@/utils/audio/audioAttachmentTranscription";
import type { SimplifiedMessageForContext } from "@/utils/text/contextBuilder";
import { getCachedRenderedMarkdownTable } from "@/utils/text/markdownTableCache";
import { YOUTUBE_URL_PATTERNS } from "@/utils/text/youTubeUrlCleaner";
import type { MessageIdMap } from "@/utils/text/messageIdMap";
import { formatInlineSystemContent } from "@/utils/chat/contextAnnotations";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";

const SUPPORTED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/mpeg",
  "video/mov",
  "video/avi",
  "video/x-flv",
  "video/mpg",
  "video/webm",
  "video/wmv",
  "video/3gpp",
];

function buildEmojiCdnUrl(emojiId: string): string {
  return `https://cdn.discordapp.com/emojis/${emojiId}.png`;
}

export function extractEmojiImageAttachments(content: string): SimplifiedMessageForContext["imageAttachments"] {
  const attachments: SimplifiedMessageForContext["imageAttachments"] = [];
  if (!content) return attachments;

  const emojiPattern = /<(a?):([^:]+):(\d{17,20})>/g;
  const seenEmojiIds = new Set<string>();
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: Regex exec loop mirrors the pre-drain helper.
  while ((match = emojiPattern.exec(content)) !== null) {
    const emojiName = match[2];
    const emojiId = match[3];

    if (seenEmojiIds.has(emojiId)) {
      continue;
    }

    seenEmojiIds.add(emojiId);
    const emojiUrl = buildEmojiCdnUrl(emojiId);

    attachments.push({
      url: emojiUrl,
      proxyUrl: emojiUrl,
      mimeType: "image/png",
      filename: `emoji_${emojiName}_${emojiId}.png`,
      isEmoji: true,
    });
  }

  return attachments;
}

export function isSupportedImageAttachmentContentType(contentType: string | null | undefined): boolean {
  return (
    contentType?.startsWith("image/png") ||
    contentType?.startsWith("image/jpeg") ||
    contentType?.startsWith("image/webp") ||
    contentType?.startsWith("image/heic") ||
    contentType?.startsWith("image/heif") ||
    contentType?.startsWith("image/gif") ||
    false
  );
}

export function isSupportedVideoAttachmentContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && SUPPORTED_VIDEO_MIME_TYPES.some((type) => contentType.startsWith(type)));
}

function inferMimeTypeFromFilename(filename: string | null | undefined): string | null {
  const lower = (filename ?? "").toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/mov";
  return null;
}

export function appendSupportedMediaFromMessage(
  sourceMessage: Pick<Message, "attachments">,
  imageAttachments: SimplifiedMessageForContext["imageAttachments"],
  videoAttachments: SimplifiedMessageForContext["videoAttachments"],
): { imageCount: number; videoCount: number } {
  let imageCount = 0;
  let videoCount = 0;

  for (const attachment of sourceMessage.attachments.values()) {
    // Some Discord message types (e.g. IsComponentsV2) may omit contentType in the
    // API response. Fall back to filename-based inference so attachments aren't
    // silently dropped, which would cause the whole message to be skipped.
    const effectiveContentType = attachment.contentType ?? inferMimeTypeFromFilename(attachment.name);

    if (isSupportedImageAttachmentContentType(effectiveContentType)) {
      imageAttachments.push({
        url: attachment.url,
        proxyUrl: attachment.proxyURL,
        mimeType: effectiveContentType,
        filename: attachment.name,
      });
      imageCount++;
      continue;
    }

    if (isSupportedVideoAttachmentContentType(effectiveContentType)) {
      videoAttachments.push({
        url: attachment.url,
        proxyUrl: attachment.proxyURL,
        mimeType: effectiveContentType,
        filename: attachment.name,
        isYouTubeLink: false,
      });
      videoCount++;
    }
  }

  return { imageCount, videoCount };
}

export function formatAttachmentSystemHint(filename: string, messageId: string): string {
  return `[System: A file named \`${filename}\` is attached (message ID: ${messageId}). Use \`read_file\` with this message ID to read its contents, only if needed.]`;
}

export function formatAudioAttachmentHint(filename: string): string {
  return `[System: An audio file named \`${filename}\` was sent here but was not transcribed.]`;
}

export function appendStickersFromMessage(
  message: Pick<Message, "stickers">,
  imageAttachments: SimplifiedMessageForContext["imageAttachments"],
): number {
  let stickerCount = 0;
  for (const sticker of message.stickers.values()) {
    const stickerUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.png`;
    imageAttachments.push({
      url: stickerUrl,
      proxyUrl: stickerUrl,
      mimeType: "image/png",
      filename: `${sticker.name}.png`,
    });
    stickerCount++;
  }
  return stickerCount;
}

type ForwardedMessageSnapshot = {
  id?: string;
  channelId?: string | null;
  content?: string | null;
  attachments: Message["attachments"];
  embeds: readonly Embed[];
  author: Message["author"] | null;
  member: Message["member"] | null;
};

export function buildForwardContext(args: {
  message: Message;
  content: string;
  imageAttachments: SimplifiedMessageForContext["imageAttachments"];
  videoAttachments: SimplifiedMessageForContext["videoAttachments"];
  messageIdMap: MessageIdMap;
  forwarderName: string;
  clientUserId: string | undefined;
  tomoriNickname: string | null | undefined;
  selfDebugEnabled: boolean;
}): {
  content: string;
  mediaSourceMessageIds: string[];
  remoteMediaSourceKind?: SimplifiedMessageForContext["remoteMediaSourceKind"];
} {
  if (args.message.reference?.type !== MessageReferenceType.Forward || args.message.messageSnapshots.size === 0) {
    return { content: args.content, mediaSourceMessageIds: [] };
  }

  const blocks: string[] = [];
  const mediaSourceMessageIds: string[] = [];
  let remoteMediaSourceKind: SimplifiedMessageForContext["remoteMediaSourceKind"];
  for (const rawSnapshot of args.message.messageSnapshots.values()) {
    const snapshot = rawSnapshot as ForwardedMessageSnapshot;
    const preForwardImageCount = args.imageAttachments.length;
    const preForwardVideoCount = args.videoAttachments.length;
    const forwardedTextSegments: string[] = [];

    if (snapshot.content?.trim()) {
      forwardedTextSegments.push(snapshot.content.trim());
    }

    appendSupportedMediaFromMessage(snapshot, args.imageAttachments, args.videoAttachments);
    if (snapshot.content) {
      args.imageAttachments.push(...extractEmojiImageAttachments(snapshot.content));
    }

    const isForwardedTomoriAuthoredMessage = snapshot.author?.id === args.clientUserId;
    const embedResult = processEmbedsFromMessage({
      embeds: snapshot.embeds,
      content: forwardedTextSegments.join("\n"),
      imageAttachments: args.imageAttachments,
      isTomoriAuthoredMessage: isForwardedTomoriAuthoredMessage,
      selfDebugEnabled: args.selfDebugEnabled,
      tomoriNickname: args.tomoriNickname,
    });
    if (embedResult.content) {
      forwardedTextSegments.splice(0, forwardedTextSegments.length, embedResult.content);
    }

    const imageCount = args.imageAttachments.length - preForwardImageCount;
    const videoCount = args.videoAttachments.length - preForwardVideoCount;
    let attachmentInfo = "";
    if (imageCount > 0) {
      attachmentInfo += ` (with ${imageCount} image${imageCount > 1 ? "s" : ""})`;
    }
    if (videoCount > 0) {
      attachmentInfo += ` (with ${videoCount} video${videoCount > 1 ? "s" : ""})`;
    }

    const forwardedSourceChannel = snapshot.channelId ? `<#${snapshot.channelId}>` : "another channel";
    const authorName = formatForwardedAuthorName(snapshot, args.tomoriNickname || "Bot", args.clientUserId);
    const forwardedContent = formatInlineSystemContent(forwardedTextSegments.join("\n"));
    blocks.push(
      `[System: ${args.forwarderName} forwarded a message by ${authorName} from ${forwardedSourceChannel} saying: ${forwardedContent}${attachmentInfo}]`,
    );

    if (args.imageAttachments.length > preForwardImageCount || args.videoAttachments.length > preForwardVideoCount) {
      const forwardedMessageId = snapshot.id ?? args.message.reference.messageId;
      if (forwardedMessageId) {
        mediaSourceMessageIds.push(forwardedMessageId);
        remoteMediaSourceKind = "forwarded";
        args.messageIdMap.register(forwardedMessageId, "media");
      }
    }
  }

  return {
    content: blocks.length > 0 ? `${blocks.join("\n")}${args.content ? `\n${args.content}` : ""}` : args.content,
    mediaSourceMessageIds,
    remoteMediaSourceKind,
  };
}

export function appendDirectMediaFromMessage(args: {
  message: Message;
  imageAttachments: SimplifiedMessageForContext["imageAttachments"];
  videoAttachments: SimplifiedMessageForContext["videoAttachments"];
  messageIdMap: MessageIdMap;
  voiceTranscriptChatMode: boolean;
  appendTextHint: (hint: string) => void;
}): void {
  const cachedRenderedTable = getCachedRenderedMarkdownTable(args.message.id);
  if (cachedRenderedTable) {
    args.appendTextHint(`[System: This was sent as a rendered markdown table image.]\n${cachedRenderedTable}`);
    return;
  }

  appendSupportedMediaFromMessage(args.message, args.imageAttachments, args.videoAttachments);
  for (const attachment of args.message.attachments.values()) {
    if (
      isSupportedImageAttachmentContentType(attachment.contentType) ||
      isSupportedVideoAttachmentContentType(attachment.contentType)
    ) {
      continue;
    }
    if (isAudioAttachment(attachment)) {
      if (args.voiceTranscriptChatMode) {
        continue;
      }
      const cached = getCachedVoiceTranscript(args.message.id);
      args.appendTextHint(
        cached?.source === "user_stt"
          ? `[System: This was sent as a voice message.]\n${cached.transcript}`
          : formatAudioAttachmentHint(attachment.name ?? "audio"),
      );
      continue;
    }
    args.appendTextHint(
      formatAttachmentSystemHint(attachment.name ?? "file", args.messageIdMap.register(args.message.id, "media")),
    );
  }
}

function formatForwardedAuthorName(
  forwardedMessage: Pick<ForwardedMessageSnapshot, "author" | "member">,
  tomoriNickname: string,
  clientUserId: string | undefined,
): string {
  if (clientUserId && forwardedMessage.author?.id === clientUserId) {
    return tomoriNickname;
  }

  return (
    forwardedMessage.member?.displayName ??
    forwardedMessage.author?.globalName ??
    forwardedMessage.author?.username ??
    "Unknown user"
  );
}

export function appendYouTubeVideosFromContent(
  content: string,
  videoAttachments: SimplifiedMessageForContext["videoAttachments"],
): void {
  for (const pattern of YOUTUBE_URL_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(content);
    pattern.lastIndex = 0;
    if (!match) {
      continue;
    }
    const youtubeUrl = match[0];
    const videoId = match[1];
    videoAttachments.push({
      url: youtubeUrl,
      proxyUrl: youtubeUrl,
      mimeType: "video/youtube",
      filename: `youtube_video_${videoId}.mp4`,
      isYouTubeLink: true,
    });
    return;
  }
}

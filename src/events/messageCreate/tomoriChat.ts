import type {
  AnyThreadChannel,
  BaseGuildVoiceChannel,
  Client,
  Guild,
  GuildMember,
  Message,
  Sticker,
  Embed,
  Webhook,
} from "discord.js";
import {
  BaseGuildTextChannel,
  ChannelType,
  DMChannel,
  EmbedBuilder,
  MessageReferenceType,
  MessageType,
  TextChannel,
} from "discord.js"; // Import value for instanceof check
// Provider imports moved to factory pattern
import type { StructuredContextItem, RequestSnapshot } from "../../types/misc/context";
import { ContextItemTag } from "../../types/misc/context";
import type { StandardEmbedOptions } from "../../types/discord/embed";
// Provider-specific types moved to individual providers
import type { FunctionCall, FunctionResponseImageMetadata } from "../../types/provider/interfaces";
import type { StreamingContext } from "../../types/tool/interfaces";
import { getCachedAllPersonas, getLastDbError } from "../../utils/cache/tomoriStateCache";
import { getCachedUserRow, getCachedPrivacyLevel, getCachedBlacklistStatus } from "../../utils/cache/userCache";
import { getCachedWhitelistStatus } from "../../utils/cache/channelWhitelistCache";
import { getCachedPersonalSpotlightStatus } from "@/utils/cache/personalSpotlightCache";
import { getCachedChannelLlm } from "../../utils/cache/channelLlmCache";
import { storeShortTermMemory } from "../../utils/cache/shortTermMemoryCache";
import { incrementTomoriCounter, registerUser } from "@/utils/db/dbWrite";
import { loadSavedProviderConfig } from "@/utils/db/dbRead";
import { createStandardEmbed, sendStandardEmbed } from "../../utils/discord/embedHelper";
import { resolvePreferredDiscordDisplayName } from "../../utils/discord/displayName";
import { sendCooldownDM } from "../../utils/discord/cooldownDM";
import { StreamOrchestrator } from "../../utils/discord/streamOrchestrator";
import {
  getOrCreateWebhook,
  resolvePersonaWebhookIdentity,
  sendUserTranscriptViaWebhook,
  sendWebhookMessageWithIdentity,
  type WebhookCreateErrorReason,
} from "../../utils/discord/webhookManager";
import { ColorCode, log } from "../../utils/misc/logger";
import { buildContext, formatTimestampInline } from "../../utils/text/contextBuilder";
import { getEmojiPenaltyDirective } from "../../utils/text/emojiPenalty";
import { removeYouTubeUrls, extractYouTubeVideoIds } from "../../utils/text/youTubeUrlCleaner";
import { resolveTenorUrl } from "../../utils/media/tenorResolver";
import { PeekProfilePictureTool } from "../../tools/functionCalls/peekProfilePictureTool";
import { ProcessGifTool } from "../../tools/functionCalls/processGifTool";
import { decryptApiKey } from "@/utils/security/crypto";
import {
  selectApiKey,
  hasAvailableRotationKey,
  MAX_KEY_ATTEMPTS,
  recordKeySuccess,
  recordKeyError,
  type SelectedKeyResult,
} from "@/utils/security/keyRotation";
import { localizer, getSupportedLocales, getLocaleSubKeys } from "../../utils/text/localizer";
import { escapeRegExp, normalizeCustomEmojisForLlm } from "../../utils/text/stringHelper";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { hasExplicitLongTermMemoryIntent } from "@/utils/memory/explicitLongTermMemoryIntent";
import {
  getDeliberateToolIntentResult,
  getFollowUpToolIntentResult,
  resolveDeliberateToolContextTurns,
  resolveDeliberateToolMode,
  type DeliberateToolIntentMatch,
} from "@/utils/tools/deliberateToolMode";
import { routeHiddenToolNotice } from "@/utils/discord/toolProgressNotice";
import { sql } from "@/utils/db/client";
import { loadEmojiStickerCache } from "../../utils/cache/emojiStickerCache";
import { getLinkedMatrixRoom, pendingMatrixReplyChannels, sendMatrixTypingIndicator } from "@/utils/matrix";
import { isBridgeUserId, stripBridgePrefix, extractBridgeUserId, isMatrixBridgeWebhookUsername } from "@/utils/bridge";
import { isPersonaAllowedForTrigger } from "@/utils/db/personaAccess";

import type { TomoriState, TomoriConfigRow, ServerEmojiRow, ServerStickerRow, FallbackEntry } from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
// Provider-specific function declarations moved to providers
import { getProviderForTomori, ProviderFactory } from "../../utils/provider/providerFactory";
import type { LLMProvider, StreamResult, ThoughtLogPayload } from "../../types/provider/interfaces";
import { ToolRegistry } from "../../tools/toolRegistry";
import { keyManager } from "@/utils/security/keyManager";
import { checkUserRateLimit, checkServerRateLimit } from "@/utils/security/rateLimiter";
import {
  checkMessageTriggerCooldownWithWhitelist,
  setMessageTriggerCooldownWithWhitelist,
} from "@/utils/db/cooldownManager";
import { getCooldownTypeFooterKey } from "@/utils/db/messageCooldown";
import { CooldownType } from "@/types/db/schema";
import { truncateDialogueHistory } from "../../utils/text/contextTruncator";
import {
  getOpenRouterCapabilities,
  getOpenRouterTokenLimits,
  isOpenRouterCapabilityCacheReady,
} from "../../utils/cache/openrouterCapabilityCache";
import { getGeminiTokenLimits } from "../../utils/cache/geminiCapabilityCache";
import { getNovelAITokenLimits } from "../../utils/cache/novelaiCapabilityCache";
import { getCachedContextTokens, refreshNovelAISubscription } from "../../utils/cache/novelaiSubscriptionCache";
import type { NovelaiStreamConfig } from "../../providers/novelai/novelaiStreamAdapter";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { checkTextQuota, incrementTextQuota, type TextQuotaCheckResult } from "@/utils/quota/textQuotaManager";
import type { ForcedMention } from "@/types/discord/mentions";
import { buildForcedMentionsForUser } from "@/utils/discord/mentionHelper";
import {
  hasThoughtLogContent,
  mergeThoughtLogPayload,
  sendAttributionOnlyEmbed,
  sendThoughtLogEmbed,
  type ThoughtLogOwner,
} from "@/utils/discord/thoughtLog";
import { isAudioAttachment, transcribeMessageAudioAttachment } from "@/utils/audio/audioAttachmentTranscription";
import { getCachedVoiceTranscript, setCachedVoiceTranscript } from "@/utils/audio/voiceTranscriptCache";
import { getCachedRenderedMarkdownTable } from "@/utils/text/markdownTableCache";
import { sendFallbackModelUsageNotice } from "@/utils/discord/fallbackModelNotice";
import {
  CredentialUnavailableError,
  PersonalProviderRequiredError,
  resolveCapabilityCredentials,
} from "@/utils/provider/credentialResolver";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";

// Base trigger words that will always work (with or without spaces for English)
const BASE_TRIGGER_WORDS = process.env.BASE_TRIGGER_WORDS?.split(",").map((word) => word.trim()) || [
  "tomori",
  "tomo",
  "トモリ",
  "ともり",
];

function parseBooleanEnvFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (typeof value !== "string") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return defaultValue;
}

function parseIntegerEnvFlag(value: string | undefined, defaultValue: number, minimum: number): number {
  if (typeof value !== "string") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(minimum, parsed);
}

function thoughtLogOwnersMatch(existing: ThoughtLogOwner | undefined, incoming: ThoughtLogOwner): boolean {
  if (!existing) {
    return true;
  }

  if (existing.type !== incoming.type) {
    return false;
  }

  switch (existing.type) {
    case "default":
      return true;
    case "persona":
      return incoming.type === "persona" && existing.persona.tomori_id === incoming.persona.tomori_id;
    case "user_impersonation":
      return (
        incoming.type === "user_impersonation" &&
        existing.username === incoming.username &&
        (existing.avatarUrl ?? null) === (incoming.avatarUrl ?? null)
      );
    default: {
      const exhaustiveCheck: never = existing;
      return exhaustiveCheck;
    }
  }
}

function dropOldestHistoryExchangePairs(
  contextItems: StructuredContextItem[],
  pairsToDrop: number,
): {
  truncated: StructuredContextItem[];
  historyPairsDropped: number;
} {
  if (pairsToDrop <= 0) {
    return {
      truncated: contextItems,
      historyPairsDropped: 0,
    };
  }

  const items = [...contextItems];
  let historyPairsDropped = 0;

  const findNewestDialogueUserIndex = (): number => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY && items[i].role === "user") {
        return i;
      }
    }
    return -1;
  };

  const dropOneOldestExchange = (): boolean => {
    const newestDialogueUserIdx = findNewestDialogueUserIndex();
    let oldestDroppableUserIdx = -1;

    for (let i = 0; i < items.length; i++) {
      if (
        i !== newestDialogueUserIdx &&
        items[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY &&
        items[i].role === "user"
      ) {
        oldestDroppableUserIdx = i;
        break;
      }
    }

    if (oldestDroppableUserIdx === -1) {
      return false;
    }

    let followingModelIdx = -1;
    for (let i = oldestDroppableUserIdx + 1; i < items.length; i++) {
      if (i === newestDialogueUserIdx) {
        break;
      }
      if (items[i].metadataTag === ContextItemTag.DIALOGUE_HISTORY && items[i].role === "model") {
        followingModelIdx = i;
        break;
      }
    }

    if (followingModelIdx !== -1) {
      items.splice(oldestDroppableUserIdx, followingModelIdx - oldestDroppableUserIdx + 1);
    } else {
      items.splice(oldestDroppableUserIdx, 1);
    }

    historyPairsDropped++;
    return true;
  };

  while (historyPairsDropped < pairsToDrop) {
    if (!dropOneOldestExchange()) {
      break;
    }
  }

  return {
    truncated: items,
    historyPairsDropped,
  };
}

const WEBHOOK_ERROR_COOLDOWN_MS = parseIntegerEnvFlag(process.env.WEBHOOK_ERROR_COOLDOWN_MS, 600000, 1000);
const webhookErrorCooldowns = new Map<string, number>();
const REACTION_CONTEXT_ENABLED = parseBooleanEnvFlag(process.env.REACTION_CONTEXT_ENABLED, true);
const OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS = parseIntegerEnvFlag(
  process.env.OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS,
  2,
  1,
);
const REACTION_CONTEXT_MAX_API_CALLS_PER_TURN = parseIntegerEnvFlag(
  process.env.REACTION_CONTEXT_MAX_API_CALLS_PER_TURN,
  20,
  0,
);
const REACTION_CONTEXT_MAX_REACTIONS_PER_MESSAGE = parseIntegerEnvFlag(
  process.env.REACTION_CONTEXT_MAX_REACTIONS_PER_MESSAGE,
  4,
  1,
);
const REACTION_CONTEXT_MAX_USERS_PER_REACTION = parseIntegerEnvFlag(
  process.env.REACTION_CONTEXT_MAX_USERS_PER_REACTION,
  5,
  0,
);

/**
 * Hard safety ceiling on tool-call round-trips — prevents runaway loops from burning API credits indefinitely.
 * The "Thinking Loop" embed fires only if this ceiling is actually reached.
 * Configurable via BOT_MAX_FUNCTION_CALL_ITERATIONS (min: 1).
 */
const MAX_FUNCTION_CALL_ITERATIONS = parseIntegerEnvFlag(process.env.BOT_MAX_FUNCTION_CALL_ITERATIONS, 100, 1);
/** Iteration index (0-based) at which a soft "still working" embed is sent, reminding users they can /bot kill. */
const SOFT_WARN_ITERATION_THRESHOLD = 20;
const NAI_TOOL_FAILURE_RETRY_THRESHOLD = Number.parseInt(process.env.NAI_TOOL_FAILURE_RETRY_THRESHOLD || "3", 10); // Max consecutive tool failures before showing error embed (NAI GLM only)
/**
 * Provider-agnostic flail-detection cap. If the model's tool calls fail this many times
 * in a row (e.g., invalid args, nonexistent targets, repeated "not found" misses) we
 * assume the model is stuck in an error loop and abort the turn early — long before
 * `MAX_FUNCTION_CALL_ITERATIONS` would fire. Any successful tool execution resets the
 * counter. Configurable via BOT_MAX_CONSECUTIVE_TOOL_ERRORS (min: 1).
 */
const MAX_CONSECUTIVE_TOOL_ERRORS = parseIntegerEnvFlag(process.env.BOT_MAX_CONSECUTIVE_TOOL_ERRORS, 5, 1);
const TOOLS_SUPPRESS_FOLLOWUP_AFTER_PRETOOL_TEXT = new Set([
  "update_short_term_memory",
  //"update_long_term_memory",
  //"create_long_term_memory",
  //"create_task",
]);
const STREAM_SDK_CALL_TIMEOUT_MS = parseIntegerEnvFlag(process.env.STREAM_SDK_CALL_TIMEOUT_MS, 120000, 10000);
const DEFAULT_CASCADE_LIMIT = 3;
const MAX_CASCADE_LIMIT = 10;
const DEFAULT_MATCH_LIMIT = 3;
const MIN_MATCH_LIMIT = 1;
const MAX_MATCH_LIMIT = 10;
const SELF_DEBUG_ERROR_EMBED_MAX_DESCRIPTION_LENGTH = 1200;
const SELF_DEBUG_ERROR_EMBED_MAX_FIELD_COUNT = 6;
const SELF_DEBUG_ERROR_EMBED_MAX_FIELD_VALUE_LENGTH = 280;
const ERROR_EMBED_COLOR_DECIMAL = Number.parseInt(ColorCode.ERROR.replace("#", ""), 16);
const SELF_REPLY_CHAIN_TTL_MS = 30 * 60 * 1000; // Reset self-reply chain after 30 minutes of inactivity
const SELF_REPLY_SUPPRESSION_TTL_MS = 5000;
const selfReplySuppressionUntil = new Map<string, number>();
const USER_IMPERSONATION_WEBHOOK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
type CachedWebhookRelayKind = "user_impersonation";
type CachedWebhookRelay = {
  userId: string;
  kind: CachedWebhookRelayKind;
  cachedAt: number;
};
const webhookRelayCache = new Map<string, CachedWebhookRelay>();
const AUDIO_TRANSCRIPTION_HANDLED_KEY = "__tomoriAudioTranscriptionHandled";

type MessageWithInternalFlags = Message & {
  [AUDIO_TRANSCRIPTION_HANDLED_KEY]?: boolean;
};

export function suppressNextSelfReply(channelId: string, ttlMs = SELF_REPLY_SUPPRESSION_TTL_MS): void {
  selfReplySuppressionUntil.set(channelId, Date.now() + ttlMs);
}

function shouldSendWebhookError(channelId: string): boolean {
  const now = Date.now();
  const lastSent = webhookErrorCooldowns.get(channelId) ?? 0;

  if (now - lastSent < WEBHOOK_ERROR_COOLDOWN_MS) {
    return false;
  }

  webhookErrorCooldowns.set(channelId, now);
  return true;
}

function normalizeTailDirective(text: string): string {
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

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const DISCORD_MESSAGE_LINK_PATTERN =
  /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{17,19})\/(\d{17,19})\/(\d{17,19})/i;
const REPLY_CONTEXT_URL_SENTINEL = "__TOMORI_REPLY_CONTEXT_URL__";
const REPLY_CONTEXT_USER_SENTINEL = "__TOMORI_REPLY_CONTEXT_USER__";

const QUEUED_REPLY_DIRECTIVE_MAX_CONTENT_LENGTH = 280;

function truncateForSystemContext(text: string, maxLength: number): string {
  const compacted = compactWhitespace(text);
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildReplyReferenceAttachmentInfo(message: Message): string {
  let imageCount = 0;
  let videoCount = 0;

  for (const attachment of message.attachments.values()) {
    if (isSupportedImageAttachmentContentType(attachment.contentType)) {
      imageCount++;
      continue;
    }

    if (isSupportedVideoAttachmentContentType(attachment.contentType)) {
      videoCount++;
    }
  }

  let attachmentInfo = "";
  if (imageCount > 0) {
    attachmentInfo += ` (with ${imageCount} image${imageCount > 1 ? "s" : ""})`;
  }
  if (videoCount > 0) {
    attachmentInfo += ` (with ${videoCount} video${videoCount > 1 ? "s" : ""})`;
  }

  return attachmentInfo;
}

function matchesLocalizedReplyContextTemplate(
  text: string,
  templateKey: string,
  placeholderValues: Record<string, string>,
): boolean {
  for (const locale of getSupportedLocales()) {
    const template = localizer(locale, templateKey, placeholderValues);
    let pattern = escapeRegExp(template);
    for (const placeholderValue of Object.values(placeholderValues)) {
      pattern = pattern.replaceAll(escapeRegExp(placeholderValue), ".+?");
    }

    if (new RegExp(`^${pattern}$`).test(text)) {
      return true;
    }
  }

  return false;
}

function extractReplyContextTargetFromEmbed(embed: Embed): { channelId: string; messageId: string } | null {
  const description = embed.description?.trim() ?? "";
  const authorName = embed.author?.name?.trim() ?? "";
  const footerText = embed.footer?.text?.trim() ?? "";
  const hasReplyDescription = matchesLocalizedReplyContextTemplate(
    description,
    "genai.message_interaction.reply_context_description",
    {
      message_url: REPLY_CONTEXT_URL_SENTINEL,
    },
  );
  const hasReplyAuthor = matchesLocalizedReplyContextTemplate(
    authorName,
    "genai.message_interaction.reply_context_author",
    {
      user: REPLY_CONTEXT_USER_SENTINEL,
    },
  );
  const hasReplyFooter = matchesLocalizedReplyContextTemplate(
    footerText,
    "genai.message_interaction.reply_context_footer",
    {
      user: REPLY_CONTEXT_USER_SENTINEL,
      message_url: REPLY_CONTEXT_URL_SENTINEL,
    },
  );

  if (!hasReplyDescription && !hasReplyAuthor && !hasReplyFooter) {
    return null;
  }

  const match = `${embed.url ?? ""}\n${description}`.match(DISCORD_MESSAGE_LINK_PATTERN);
  if (!match) {
    return null;
  }

  return {
    channelId: match[1],
    messageId: match[2],
  };
}

function findReplyContextTargetInMessage(
  message: Pick<Message, "embeds">,
): { channelId: string; messageId: string } | null {
  for (const embed of message.embeds) {
    const target = extractReplyContextTargetFromEmbed(embed);
    if (target) {
      return target;
    }
  }

  return null;
}

/**
 * Resolves a display name for a message author, accounting for
 * webhooks, personas, nicknames, and blacklisted users.
 */
async function resolveMessageAuthorDisplayName(params: {
  message: Message;
  clientUserId: string | undefined;
  botDisplayName: string | null | undefined;
  personaByNickname: Map<string, TomoriState>;
  serverDiscId: string;
  serverPersonalizationDisabled: boolean;
}): Promise<string> {
  const { message, clientUserId, botDisplayName, personaByNickname, serverDiscId, serverPersonalizationDisabled } =
    params;

  const webhookName = stripBridgePrefix(message.author.username);
  const matchedPersona = message.webhookId ? personaByNickname.get(webhookName.toLowerCase()) : undefined;
  const userRow =
    message.author.id !== clientUserId && !matchedPersona ? await getCachedUserRow(message.author.id) : null;
  const userBlacklisted = userRow !== null ? await getCachedBlacklistStatus(serverDiscId, message.author.id) : false;
  const fallbackName = resolvePreferredDiscordDisplayName({
    memberDisplayName: message.member?.displayName,
    user: message.author,
    fallback: webhookName,
  });

  return message.author.id === clientUserId
    ? botDisplayName || "Bot"
    : (matchedPersona?.tomori_nickname ??
        (userBlacklisted || serverPersonalizationDisabled || !userRow?.user_nickname
          ? fallbackName
          : userRow.user_nickname));
}

/**
 * Builds the `[System: ...]` annotation that tells the LLM a message is a reply.
 * Both the reply and the referenced message get opaque `ref_N` IDs so the LLM
 * can target either one with `interact_with_recent_message`.
 */
async function buildReplyReferenceContextAnnotation(params: {
  replyMessage: Message;
  referencedMessage: Message;
  clientUserId: string | undefined;
  botDisplayName: string | null | undefined;
  personaByNickname: Map<string, TomoriState>;
  serverDiscId: string;
  serverPersonalizationDisabled: boolean;
  messageIdMap: MessageIdMap;
}): Promise<string> {
  const {
    replyMessage,
    referencedMessage,
    clientUserId,
    botDisplayName,
    personaByNickname,
    serverDiscId,
    serverPersonalizationDisabled,
    messageIdMap,
  } = params;

  const replyAuthorName = await resolveMessageAuthorDisplayName({
    message: replyMessage,
    clientUserId,
    botDisplayName,
    personaByNickname,
    serverDiscId,
    serverPersonalizationDisabled,
  });

  const referencedAuthorName = await resolveMessageAuthorDisplayName({
    message: referencedMessage,
    clientUserId,
    botDisplayName,
    personaByNickname,
    serverDiscId,
    serverPersonalizationDisabled,
  });

  const replyRef = messageIdMap.register(replyMessage.id, "ref");
  const referencedRef = messageIdMap.register(referencedMessage.id, "ref");

  return `[System: This message (ID: ${replyRef}) by ${replyAuthorName} is referring to a previous message (ID: ${referencedRef}) by ${referencedAuthorName} saying: ${formatInlineSystemContent(referencedMessage.content)}${buildReplyReferenceAttachmentInfo(referencedMessage)}]`;
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

function buildQueuedReplyDirective(
  message: Message,
  replyTargetName: string,
  activePersonaName: string | null | undefined,
  idMap?: MessageIdMap,
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

  return `${directive}. Start your next reply with "${normalizedPersonaLabel}:"`;
}

function checkSelfDebugDiagnosticEmbedTitle(embedTitle: string | null): boolean {
  if (!embedTitle) return false;

  for (const supportedLocale of getSupportedLocales()) {
    const diagnosticTitles = [
      localizer(supportedLocale, "genai.fallback_used_title"),
      localizer(supportedLocale, "genai.error_stream_timeout_title"),
      localizer(supportedLocale, "genai.empty_response_title"),
      localizer(supportedLocale, "genai.max_iterations_title"),
      localizer(supportedLocale, "genai.no_response_title"),
    ];
    if (diagnosticTitles.includes(embedTitle)) {
      return true;
    }
  }

  return false;
}

function shouldIncludeSelfDebugEmbed(embed: Embed): boolean {
  return embed.color === ERROR_EMBED_COLOR_DECIMAL || checkSelfDebugDiagnosticEmbedTitle(embed.title);
}

function formatTomoriSelfDebugEmbedAsSystemMessage(embed: Embed): string | null {
  if (!shouldIncludeSelfDebugEmbed(embed)) {
    return null;
  }

  const isErrorEmbed = embed.color === ERROR_EMBED_COLOR_DECIMAL;

  const lines: string[] = [isErrorEmbed ? "Tomori emitted an error embed." : "Tomori emitted a diagnostic embed."];

  if (embed.title?.trim()) {
    lines.push(`Title: ${truncateForSystemContext(embed.title, 160)}`);
  }
  if (embed.description?.trim()) {
    lines.push(
      `Description: ${truncateForSystemContext(embed.description, SELF_DEBUG_ERROR_EMBED_MAX_DESCRIPTION_LENGTH)}`,
    );
  }
  if (embed.author?.name?.trim()) {
    lines.push(`Embed Author: ${truncateForSystemContext(embed.author.name, 120)}`);
  }

  if (embed.fields.length > 0) {
    const fieldSummary = embed.fields
      .slice(0, SELF_DEBUG_ERROR_EMBED_MAX_FIELD_COUNT)
      .map((field) => {
        const fieldName = field.name?.trim() ? field.name : "Field";
        return `${truncateForSystemContext(fieldName, 90)}: ${truncateForSystemContext(field.value, SELF_DEBUG_ERROR_EMBED_MAX_FIELD_VALUE_LENGTH)}`;
      })
      .join(" | ");
    if (fieldSummary) {
      lines.push(`Fields: ${fieldSummary}`);
    }
    if (embed.fields.length > SELF_DEBUG_ERROR_EMBED_MAX_FIELD_COUNT) {
      lines.push(`Additional fields omitted: ${embed.fields.length - SELF_DEBUG_ERROR_EMBED_MAX_FIELD_COUNT}.`);
    }
  }

  if (embed.footer?.text?.trim()) {
    lines.push(`Footer: ${truncateForSystemContext(embed.footer.text, 220)}`);
  }

  return `[System: ${lines.join("\n")}]`;
}

function cacheWebhookRelay(webhookId: string, userId: string, kind: CachedWebhookRelayKind): void {
  if (!webhookId || !userId) {
    return;
  }

  webhookRelayCache.set(webhookId, {
    userId,
    kind,
    cachedAt: Date.now(),
  });
}

function cacheUserImpersonationWebhook(webhookId: string, userId: string): void {
  cacheWebhookRelay(webhookId, userId, "user_impersonation");
}

function getCachedWebhookRelay(webhookId: string | null | undefined): CachedWebhookRelay | null {
  if (!webhookId) {
    return null;
  }

  const cached = webhookRelayCache.get(webhookId);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.cachedAt > USER_IMPERSONATION_WEBHOOK_CACHE_TTL_MS) {
    webhookRelayCache.delete(webhookId);
    return null;
  }

  return cached;
}

function getCachedImpersonatedUserIdForWebhook(webhookId: string | null | undefined): string | null {
  const cachedRelay = getCachedWebhookRelay(webhookId);
  if (!cachedRelay || cachedRelay.kind !== "user_impersonation") {
    return null;
  }

  return cachedRelay.userId;
}

function markAudioTranscriptionHandled(message: Message): void {
  (message as MessageWithInternalFlags)[AUDIO_TRANSCRIPTION_HANDLED_KEY] = true;
}

function hasHandledAudioTranscription(message: Message): boolean {
  return (message as MessageWithInternalFlags)[AUDIO_TRANSCRIPTION_HANDLED_KEY] === true;
}

function applyEffectiveMessageContent(message: Message, content: string): void {
  try {
    Object.defineProperty(message, "content", {
      value: content,
      configurable: true,
      writable: true,
    });
  } catch {
    // Ignore content override failures and continue with the original payload.
  }

  try {
    Object.defineProperty(message, "cleanContent", {
      value: content,
      configurable: true,
      writable: true,
    });
  } catch {
    // Ignore cleanContent override failures and continue with the original payload.
  }
}

function isMatrixRelayMessage(message: Pick<Message, "webhookId" | "author">): boolean {
  return Boolean(message.webhookId) && isMatrixBridgeWebhookUsername(message.author.username);
}

function isRealUserLikeMessage(message: Message): boolean {
  return (!message.author.bot && !message.webhookId) || isMatrixRelayMessage(message);
}

function normalizeIdentityName(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeAvatarUrlForMatch(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    parsed.search = "";
    return parsed.toString();
  } catch {
    const trimmed = value.split("?")[0]?.trim();
    return trimmed || null;
  }
}

function resolveImpersonatedUserIdByWebhookIdentity(
  guild: Guild | null | undefined,
  webhookDisplayName: string,
  webhookAvatarUrl?: string | null,
): string | null {
  if (!guild) {
    return null;
  }

  const normalizedWebhookName = normalizeIdentityName(webhookDisplayName);
  if (!normalizedWebhookName) {
    return null;
  }

  // Only match human users — bot accounts are guild members too, so their
  // webhook display names would match their own member entries, causing
  // foreign bot slash-command responses to be misidentified as user
  // impersonation targets and cached as such.
  const matchingMembers = Array.from(guild.members.cache.values()).filter((member) => {
    if (member.user.bot) return false;

    const candidateNames = [member.displayName, member.user.displayName, member.user.globalName, member.user.username]
      .map((name) => normalizeIdentityName(name))
      .filter((name) => name.length > 0);

    return candidateNames.includes(normalizedWebhookName);
  });

  if (matchingMembers.length === 1) {
    return matchingMembers[0].id;
  }

  if (matchingMembers.length === 0) {
    return null;
  }

  const normalizedWebhookAvatar = normalizeAvatarUrlForMatch(webhookAvatarUrl);
  if (!normalizedWebhookAvatar) {
    return null;
  }

  const avatarMatches = matchingMembers.filter((member) => {
    const memberAvatarUrl = member.displayAvatarURL({
      size: 1024,
      extension: "png",
      forceStatic: true,
    });
    return normalizeAvatarUrlForMatch(memberAvatarUrl) === normalizedWebhookAvatar;
  });

  return avatarMatches.length === 1 ? avatarMatches[0].id : null;
}

async function resolveImpersonatedIdentity(
  client: Client,
  guild: Guild | null | undefined,
  userId: string,
  fallbackName?: string | null,
): Promise<{ displayName: string; avatarUrl?: string }> {
  const guildMember = guild
    ? (guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null)))
    : null;
  const discordUser = guildMember?.user || (await client.users.fetch(userId).catch(() => null));

  const displayName =
    guildMember?.displayName ||
    discordUser?.displayName ||
    discordUser?.globalName ||
    discordUser?.username ||
    fallbackName ||
    "User";
  const avatarUrl =
    guildMember?.displayAvatarURL({
      size: 1024,
      extension: "png",
      forceStatic: true,
    }) ||
    discordUser?.displayAvatarURL({
      size: 1024,
      extension: "png",
      forceStatic: true,
    }) ||
    undefined;

  return {
    displayName,
    avatarUrl,
  };
}

/**
 * Strips the `@` prefix from any persona trigger word found in text.
 *
 * When a user types `@{trigger}` to directly invoke an alter persona (which cannot be
 * Discord-mentioned because alters are webhooks), the raw `@` appears in the LLM context.
 * This function replaces `@{trigger}` with `{trigger}` so the context reads cleanly,
 * matching the behavior of Discord user mentions where `<@userId>` is resolved to a plain name.
 *
 * @param content - The message content to process.
 * @param allPersonas - All loaded persona states for this server (main + alters).
 * @returns Content with `@{trigger}` patterns replaced by `{trigger}`.
 */
function stripAtPersonaTriggers(content: string, allPersonas: TomoriState[]): string {
  let result = content;
  for (const persona of allPersonas) {
    const triggers =
      persona.trigger_words ??
      (persona.is_alter ? (persona.alter_triggers ?? []) : (persona.config?.trigger_words ?? []));

    for (const trigger of triggers) {
      if (!trigger) continue;
      // Match @{trigger} that is not preceded by a word character (avoids matching emails
      // like user@trigger.com). Replacement preserves the stored trigger casing.
      const pattern = new RegExp(`(?<![\\w])@${trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
      result = result.replace(pattern, trigger);
    }
  }
  return result;
}

function resolveReferencedWebhookTarget(
  referenceMessage: Message,
  personaByNickname: Map<string, TomoriState>,
  guild: Guild | null | undefined,
): { replyPersona: TomoriState | null; impersonatedUserId: string | null } {
  if (!referenceMessage.webhookId) {
    return { replyPersona: null, impersonatedUserId: null };
  }

  const cachedRelay = getCachedWebhookRelay(referenceMessage.webhookId);

  // 1. Check persona nickname first — this is authoritative based on the
  //    webhook's current display name, so it must take priority over the
  //    impersonation cache which can hold stale entries from earlier webhooks.
  const rawWebhookName = referenceMessage.author.username;
  if (rawWebhookName && !extractBridgeUserId(rawWebhookName)) {
    const webhookName = stripBridgePrefix(rawWebhookName);
    const matchedPersona = personaByNickname.get(webhookName.toLowerCase());
    if (matchedPersona) {
      return { replyPersona: matchedPersona, impersonatedUserId: null };
    }
  }

  // 2. Fall back to impersonation cache for user impersonation webhooks
  if (cachedRelay?.kind === "user_impersonation") {
    return {
      replyPersona: null,
      impersonatedUserId: cachedRelay.userId,
    };
  }

  // 3. If no persona or cache match, bail out for bridge users or missing name
  if (!rawWebhookName || extractBridgeUserId(rawWebhookName)) {
    return { replyPersona: null, impersonatedUserId: null };
  }

  // 4. Last resort: try to match webhook identity against guild members.
  // Only attempt this if the webhook was previously known to TomoriBot's relay
  // cache (i.e., cachedRelay is non-null but not user_impersonation, meaning
  // it was seen before and may have just expired). Skipping this for wholly
  // unknown webhooks prevents foreign bots' interaction responses from being
  // misidentified as user impersonation targets.
  if (!cachedRelay) {
    return { replyPersona: null, impersonatedUserId: null };
  }

  const webhookName = stripBridgePrefix(rawWebhookName);
  const webhookAvatarUrl = referenceMessage.author.displayAvatarURL({
    size: 1024,
    extension: "png",
    forceStatic: true,
  });

  const impersonatedUserId = resolveImpersonatedUserIdByWebhookIdentity(guild, webhookName, webhookAvatarUrl);

  return {
    replyPersona: null,
    impersonatedUserId,
  };
}

function buildCombinedTailDirectiveMessage(directives: string[]): StructuredContextItem | null {
  const normalized = directives
    .map((directive) => normalizeTailDirective(directive))
    .filter((directive) => directive.length > 0);
  if (normalized.length === 0) return null;

  return {
    role: "user",
    parts: [{ type: "text", text: `[System: ${normalized.join("\n\n")}]` }],
    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
  };
}

function buildTailDirectiveMessage(directive: string | null | undefined): StructuredContextItem | null {
  if (!directive) return null;
  return buildCombinedTailDirectiveMessage([directive]);
}

function buildSpeakerGuardRetryDirective(activePersonaName?: string | null): StructuredContextItem | null {
  const normalizedPersonaName = compactWhitespace(activePersonaName ?? "") || process.env.DEFAULT_BOTNAME || "Tomori";
  const sanitizedPersonaName = normalizedPersonaName.replaceAll('"', "'");

  return buildTailDirectiveMessage(
    `Your previous attempt started as the wrong speaker and was discarded. Reply only as ${sanitizedPersonaName}. Start exactly with "${sanitizedPersonaName}:". Do not start with any other speaker name or write dialogue for anyone else.`,
  );
}

function mergeInjectedContextItems(
  existingItems: StructuredContextItem[] | undefined,
  extraItem: StructuredContextItem | null,
): StructuredContextItem[] | undefined {
  if (!extraItem) {
    return existingItems;
  }

  if (!existingItems || existingItems.length === 0) {
    return [extraItem];
  }

  const extraText = extraItem.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const alreadyPresent = existingItems.some((item) => {
    const itemText = item.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    return item.role === extraItem.role && item.metadataTag === extraItem.metadataTag && itemText === extraText;
  });

  if (alreadyPresent) {
    return existingItems;
  }

  return [...existingItems, extraItem];
}

function insertBeforeLatestDialoguePair(
  contextSegments: StructuredContextItem[],
  injectedItem: StructuredContextItem,
): void {
  const dialogueIndexes: number[] = [];

  for (let i = contextSegments.length - 1; i >= 0; i--) {
    const item = contextSegments[i];
    if (item.metadataTag === ContextItemTag.DIALOGUE_HISTORY && (item.role === "user" || item.role === "model")) {
      dialogueIndexes.push(i);
      if (dialogueIndexes.length === 2) break;
    }
  }

  if (dialogueIndexes.length === 0) {
    contextSegments.push(injectedItem);
    return;
  }

  const insertAt = dialogueIndexes.length >= 2 ? dialogueIndexes[1] : dialogueIndexes[0];
  contextSegments.splice(insertAt, 0, injectedItem);
}

/**
 * Creates a regex that matches a trigger word with "screaming" support.
 * Allows repeated vowels/consonants, e.g., "Lilja" matches "Liiiljaaaa".
 * For example: "Lilja" becomes /\bL+i+l+j+a+\b/i
 *
 * @param trigger - The trigger word to convert
 * @returns A RegExp that matches the trigger with screaming variations
 */
function createScreamingRegex(trigger: string): RegExp {
  let pattern = "";

  // Build pattern by allowing each letter to repeat with +
  for (const char of trigger) {
    if (/[a-zA-Z]/.test(char)) {
      // Alphabetic character: allow repetition
      pattern += `${char}+`;
    } else {
      // Non-alphabetic: escape special regex characters
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }

  // Add word boundaries and create case-insensitive regex
  const fullPattern = `\\b${pattern}\\b`;
  return new RegExp(fullPattern, "i");
}

/**
 * Creates a case-insensitive regex to detect a deliberate trigger invocation:
 * an "@" prefix followed by the trigger word(s). Mirrors createScreamingRegex semantics —
 * letters allow repetition (screaming mode) and whitespace between words is flexible (\s+).
 * This ensures the deliberate check accepts the same content variants that the plain match does.
 * @param trigger - The trigger word or phrase (may contain spaces for multi-word triggers)
 */
function createDeliberateTriggerRegex(trigger: string): RegExp {
  let pattern = "";

  for (const char of trigger) {
    if (/[a-zA-Z]/.test(char)) {
      // Alphabetic character: allow repetition (consistent with screaming mode)
      pattern += `${char}+`;
    } else if (/\s/.test(char)) {
      // Whitespace between words: allow flexible spacing (avoids exact-space mismatch)
      pattern += "\\s+";
    } else {
      // Non-alphabetic, non-whitespace: escape special regex characters
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }

  return new RegExp(`@${pattern}`, "i");
}

/**
 * Returns the deliberate-invocation match for a trigger, if any.
 *
 * Multi-word triggers support two deliberate forms:
 * 1. `@full trigger`
 * 2. `@firstWord` only, but only when the full trigger phrase is also present elsewhere
 *    in the message. This preserves existing DTM behavior without allowing a lone
 *    `@firstWord` to accidentally trigger a multi-word persona.
 */
function getDeliberateTriggerMatch(content: string, trigger: string): RegExpMatchArray | null {
  const fullTriggerMatch = content.match(createDeliberateTriggerRegex(trigger));
  if (fullTriggerMatch) {
    return fullTriggerMatch;
  }

  const firstTriggerWord = trigger.split(/\s+/)[0]?.trim() ?? trigger;
  if (!firstTriggerWord || firstTriggerWord === trigger) {
    return null;
  }

  const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(trigger);
  const hasFullTriggerMatch = isJapanese ? content.includes(trigger) : createScreamingRegex(trigger).test(content);
  if (!hasFullTriggerMatch) {
    return null;
  }

  return content.match(createDeliberateTriggerRegex(firstTriggerWord));
}

/**
 * Returns the first index where a trigger appears in a message.
 * Used to resolve multi-persona trigger order deterministically.
 * Returns Infinity when the trigger is not present.
 */
function getTriggerFirstMatchIndex(message: Message, trigger: string, deliberateOnly = false): number {
  // Mention trigger format: <@123...> or <@!123...>
  if (trigger.startsWith("<@")) {
    const userId = trigger.replace(/[<@!>]/g, "");
    if (!message.mentions.users.has(userId)) {
      return Number.POSITIVE_INFINITY;
    }

    const mentionPattern = new RegExp(`<@!?${escapeRegExp(userId)}>`);
    const mentionMatch = message.content.match(mentionPattern);
    // If Discord resolved the mention but we can't find raw text, still treat as matched.
    return mentionMatch?.index ?? Number.MAX_SAFE_INTEGER;
  }

  if (deliberateOnly) {
    const deliberateMatch = getDeliberateTriggerMatch(message.content, trigger);
    return deliberateMatch?.index ?? Number.POSITIVE_INFINITY;
  }

  // Japanese triggers: direct substring check
  const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(trigger);
  if (isJapanese) {
    const index = message.content.indexOf(trigger);
    return index >= 0 ? index : Number.POSITIVE_INFINITY;
  }

  // English triggers: screaming-aware regex
  const regex = createScreamingRegex(trigger);
  const match = message.content.match(regex);
  return match?.index ?? Number.POSITIVE_INFINITY;
}

async function sendWebhookErrorEmbed(
  channel: BaseGuildTextChannel | AnyThreadChannel,
  locale: string,
  reason: WebhookCreateErrorReason,
): Promise<void> {
  if (!shouldSendWebhookError(channel.id)) {
    return;
  }

  const titleKey =
    reason === "missing_permissions"
      ? "general.errors.webhook_missing_permissions_title"
      : reason === "max_webhooks"
        ? "general.errors.webhook_limit_title"
        : "general.errors.webhook_unknown_error_title";
  const descriptionKey =
    reason === "missing_permissions"
      ? "general.errors.webhook_missing_permissions_description"
      : reason === "max_webhooks"
        ? "general.errors.webhook_limit_description"
        : "general.errors.webhook_unknown_error_description";

  await sendStandardEmbed(channel, locale, {
    color: ColorCode.WARN,
    titleKey,
    descriptionKey,
  });
}

/**
 * Creates comprehensive natural stop patterns for graceful stream interruption
 * Organized by category for easy maintenance and expansion
 * @returns Array of RegExp patterns for stop detection
 */
function createNaturalStopPatterns(): RegExp[] {
  // 1. Basic stop commands (single words with word boundaries)
  const basicStops = ["wait", "stop", "enough", "chill", "halt", "pause", "quit"];

  // 2. Polite stop phrases (with contextual words)
  const politeStops = ["okay\\s+(stop|enough)", "that's\\s+(enough|good|fine)", "alright\\s+stop", "please\\s+stop"];

  // 3. Dismissive phrases
  const dismissive = ["nevermind", "never\\s*mind", "cut\\s+it\\s+out", "tone\\s+it\\s+down", "knock\\s+it\\s+off"];

  // 4. Japanese stop patterns (common ways to say stop/enough in Japanese)
  const japanese = [
    "やめて", // yamete - stop it
    "ストップ", // sutoppu - stop (katakana)
    "もういい", // mou ii - that's enough
    "十分", // juubun - enough/sufficient
    "もう十分", // mou juubun - that's enough
    "いいよ", // ii yo - that's fine/enough
    "もうやめて", // mou yamete - stop it already
    "待って", // matte - wait
    "ちょっと待って", // chotto matte - wait a moment
  ];

  // 5. Create regex patterns
  const patterns: RegExp[] = [];

  // Basic stops with word boundaries
  for (const stop of basicStops) {
    patterns.push(new RegExp(`\\b${stop}\\b`, "i"));
  }

  // Polite stops (already have proper spacing patterns)
  for (const polite of politeStops) {
    patterns.push(new RegExp(polite, "i"));
  }

  // Dismissive phrases with word boundaries where appropriate
  for (const dismiss of dismissive) {
    patterns.push(new RegExp(`\\b${dismiss}\\b`, "i"));
  }

  // Japanese patterns (no word boundaries needed for Japanese text)
  for (const jp of japanese) {
    patterns.push(new RegExp(jp, "i"));
  }

  return patterns;
}

// Generate stop patterns once at module load
const NATURAL_STOP_PATTERNS = createNaturalStopPatterns();

// YouTube URL detection patterns for video analysis
const YOUTUBE_URL_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/i,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/i, // YouTube Shorts support
];

// Supported video MIME types for direct video uploads (following Gemini API documentation)
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

// Regex to detect Tenor GIF URLs anywhere in the message content
// Includes % for URL-encoded characters (e.g., Japanese characters in slugs)
const TENOR_GIF_REGEX = /(https?:\/\/)?(www\.)?tenor\.com\/view\/[a-zA-Z0-9%-]+-gif-\d+(\?.*)?/gi;

type ReactionContextBudgetState = {
  callsUsed: number;
  budgetExhaustedLogged: boolean;
  messagesWithReactions: number;
  fallbackCount: number;
};

function normalizeReactionEmojiLabel(reaction: import("discord.js").MessageReaction): string {
  const emojiName = reaction.emoji.name;
  const emojiId = reaction.emoji.id;

  if (emojiId && emojiName) {
    return `:${emojiName}:`;
  }
  if (emojiName) {
    return emojiName;
  }
  if (emojiId) {
    return `<emoji:${emojiId}>`;
  }
  return "unknown_emoji";
}

function formatReactionUserLabel(
  user: { id: string; globalName: string | null; username: string },
  options?: {
    clientUserId?: string;
    mainPersonaNickname?: string | null;
  },
) {
  if (options?.clientUserId && user.id === options.clientUserId && options.mainPersonaNickname?.trim()) {
    return options.mainPersonaNickname.trim();
  }

  return user.globalName || user.username;
}

async function buildReactionContextAnnotation(
  message: Message,
  budgetState: ReactionContextBudgetState,
  options?: {
    clientUserId?: string;
    mainPersonaNickname?: string | null;
  },
): Promise<string | null> {
  if (!REACTION_CONTEXT_ENABLED || REACTION_CONTEXT_MAX_REACTIONS_PER_MESSAGE < 1) {
    return null;
  }

  const availableReactions = Array.from(message.reactions.cache.values())
    .filter((reaction) => (reaction.count ?? 0) > 0)
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  if (availableReactions.length === 0) {
    return null;
  }

  budgetState.messagesWithReactions += 1;

  const selectedReactions = availableReactions.slice(0, REACTION_CONTEXT_MAX_REACTIONS_PER_MESSAGE);
  const reactionSegments: string[] = [];

  for (const reaction of selectedReactions) {
    const count = reaction.count ?? 0;
    const emojiLabel = normalizeReactionEmojiLabel(reaction);
    let segment = `${emojiLabel} x${count}`;

    if (count > 0 && REACTION_CONTEXT_MAX_USERS_PER_REACTION > 0) {
      if (budgetState.callsUsed < REACTION_CONTEXT_MAX_API_CALLS_PER_TURN) {
        try {
          budgetState.callsUsed += 1;
          const users = await reaction.users.fetch({
            limit: REACTION_CONTEXT_MAX_USERS_PER_REACTION,
          });
          const userLabels = Array.from(users.values())
            .map((user) => formatReactionUserLabel(user, options))
            .filter((label): label is string => label.length > 0);

          if (userLabels.length > 0) {
            segment += ` by ${userLabels.join(", ")}`;
            const remaining = Math.max(0, count - userLabels.length);
            if (remaining > 0) {
              segment += ` (+${remaining} more)`;
            }
          }
        } catch (error) {
          budgetState.fallbackCount += 1;
          log.warn(
            `Reaction context: Failed to fetch users for ${emojiLabel} on message ${message.id}. Using counts only.`,
            error,
          );
        }
      } else {
        budgetState.fallbackCount += 1;
        if (!budgetState.budgetExhaustedLogged) {
          budgetState.budgetExhaustedLogged = true;
          log.info(
            `Reaction context: User fetch budget exhausted (${budgetState.callsUsed}/${REACTION_CONTEXT_MAX_API_CALLS_PER_TURN}). Falling back to counts-only reactions.`,
          );
        }
      }
    }

    reactionSegments.push(segment);
  }

  const remainingReactionTypes = availableReactions.length - selectedReactions.length;
  if (remainingReactionTypes > 0) {
    reactionSegments.push(`+${remainingReactionTypes} more reaction type${remainingReactionTypes === 1 ? "" : "s"}`);
  }

  if (reactionSegments.length === 0) {
    return null;
  }

  return `[System: Reactions on this message: ${reactionSegments.join("; ")}]`;
}

// Define a type for our simplified message structure.
// This will be passed to buildContext, which will then convert it into StructuredContextItem[].
// Rule 13: This type is local to this file's processing logic for now.
// If it becomes shared across multiple files for context building, we can move it to /types/.
type SimplifiedMessageForContext = {
  id: string; // Discord message ID
  authorId: string;
  authorName: string; // Resolved name (Tomori's nickname or user's display name)
  authorType: "user" | "persona"; // Whether this message is from a user or a persona
  personaName?: string | null; // Persona nickname if authorType is "persona"
  content: string | null; // Message text content
  createdAt?: number; // Discord message creation timestamp in milliseconds (message.createdTimestamp)
  mediaSourceMessageIds?: string[]; // Array of message IDs that host media (for combined messages)
  remoteMediaSourceKind?: "reply" | "forwarded";
  combinedMessageIds?: string[]; // All Discord message IDs when messages are combined
  individualContents?: string[]; // Per-message content pieces (stored during combining)
  imageAttachments: Array<{
    url: string; // Original URL of the image
    proxyUrl: string; // Discord's proxy URL, often more stable for fetching
    mimeType: string | null; // e.g., 'image/png', 'image/jpeg'
    filename: string; // Original filename
    isEmoji?: boolean; // True if this attachment is a custom Discord emoji
  }>;
  videoAttachments: Array<{
    url: string; // Original URL of the video
    proxyUrl: string; // Discord's proxy URL, often more stable for fetching
    mimeType: string | null; // e.g., 'video/mp4', 'video/webm', or 'video/youtube' for YouTube links
    filename: string; // Original filename or generated name for YouTube videos
    isYouTubeLink: boolean; // True if this is a YouTube URL, false for direct video uploads
  }>;
  // Future consideration: user-sent stickers
  // stickerAttachments: Array<{ name: string; id: string; formatType: StickerFormatType }>;
};

function buildEmojiCdnUrl(emojiId: string): string {
  // Always use PNG so animated emojis fall back to their first frame.
  return `https://cdn.discordapp.com/emojis/${emojiId}.png`;
}

function extractEmojiImageAttachments(content: string): SimplifiedMessageForContext["imageAttachments"] {
  const attachments: SimplifiedMessageForContext["imageAttachments"] = [];
  if (!content) return attachments;

  const emojiPattern = /<(a?):([^:]+):(\d{17,20})>/g;
  const seenEmojiIds = new Set<string>();
  let match: RegExpExecArray | null;

  // biome-ignore lint/suspicious/noAssignInExpressions: Separate match assignment from null check
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

function isSupportedImageAttachmentContentType(contentType: string | null | undefined): boolean {
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

function isSupportedVideoAttachmentContentType(contentType: string | null | undefined): boolean {
  return Boolean(contentType && SUPPORTED_VIDEO_MIME_TYPES.some((type) => contentType.startsWith(type)));
}

function appendSupportedMediaFromMessage(
  sourceMessage: Pick<Message, "attachments">,
  imageAttachments: SimplifiedMessageForContext["imageAttachments"],
  videoAttachments: SimplifiedMessageForContext["videoAttachments"],
): { imageCount: number; videoCount: number } {
  let imageCount = 0;
  let videoCount = 0;

  for (const attachment of sourceMessage.attachments.values()) {
    if (isSupportedImageAttachmentContentType(attachment.contentType)) {
      imageAttachments.push({
        url: attachment.url,
        proxyUrl: attachment.proxyURL,
        mimeType: attachment.contentType,
        filename: attachment.name,
      });
      imageCount++;
      continue;
    }

    if (isSupportedVideoAttachmentContentType(attachment.contentType)) {
      videoAttachments.push({
        url: attachment.url,
        proxyUrl: attachment.proxyURL,
        mimeType: attachment.contentType,
        filename: attachment.name,
        isYouTubeLink: false,
      });
      videoCount++;
    }
  }

  return { imageCount, videoCount };
}

function formatInlineSystemContent(
  content: string | null | undefined,
  fallbackText = "[System: No text content was included]",
): string {
  const normalizedContent = content?.replace(/\n/g, " ").trim();
  if (!normalizedContent) {
    return fallbackText;
  }

  return normalizedContent;
}

function formatAttachmentSystemHint(filename: string, messageId: string): string {
  return `[System: A file named \`${filename}\` is attached (message ID: ${messageId}). Use \`read_file\` with this message ID to read its contents, only if needed.]`;
}

function formatAudioAttachmentHint(filename: string): string {
  return `[System: An audio file named \`${filename}\` was sent here but was not transcribed.]`;
}

function getRecentToolAffordanceNames(
  recentMessages: Message[],
  currentMessageId: string,
  clientUserId?: string | null,
): string[] {
  const toolNames: string[] = [];

  const lookbackMessages = recentMessages
    .filter((recentMessage) => recentMessage.id !== currentMessageId)
    .slice(-8)
    .reverse();

  for (const msg of lookbackMessages) {
    const isPersonaOutput = Boolean(msg.webhookId) || (Boolean(clientUserId) && msg.author.id === clientUserId);

    if (!isPersonaOutput) {
      const recentIntentResult = getDeliberateToolIntentResult(msg.content);
      toolNames.push(...recentIntentResult.allowedToolNames);
      if (toolNames.length > 0) break;
      continue;
    }

    const attachments = [...msg.attachments.values()];

    if (attachments.some(isAudioAttachment)) {
      toolNames.push("generate_voice_message");
    }

    if (attachments.some((attachment) => isSupportedImageAttachmentContentType(attachment.contentType))) {
      toolNames.push("generate_image", "generate_image_nai");
    }

    if (attachments.some((attachment) => isSupportedVideoAttachmentContentType(attachment.contentType))) {
      toolNames.push("generate_video");
    }

    if (toolNames.length > 0) break;
  }

  return Array.from(new Set(toolNames));
}

type RetainedToolAffordance = {
  remainingTurns: number;
};

const retainedToolAffordancesByChannel = new Map<string, Map<string, RetainedToolAffordance>>();

function retainSuccessfulToolAffordance(channelId: string, toolName: string, turns: number): void {
  if (turns <= 0) return;

  let channelAffordances = retainedToolAffordancesByChannel.get(channelId);
  if (!channelAffordances) {
    channelAffordances = new Map<string, RetainedToolAffordance>();
    retainedToolAffordancesByChannel.set(channelId, channelAffordances);
  }

  channelAffordances.set(toolName, { remainingTurns: turns });
}

function consumeRetainedToolAffordanceNames(channelId: string): string[] {
  const channelAffordances = retainedToolAffordancesByChannel.get(channelId);
  if (!channelAffordances) return [];

  const toolNames = [...channelAffordances.keys()];
  for (const [toolName, affordance] of channelAffordances.entries()) {
    affordance.remainingTurns -= 1;
    if (affordance.remainingTurns <= 0) {
      channelAffordances.delete(toolName);
    }
  }

  if (channelAffordances.size === 0) {
    retainedToolAffordancesByChannel.delete(channelId);
  }

  return toolNames;
}

function buildRecentMessageMetadataInline(createdAt: number): string {
  return `sent ${formatTimestampInline(createdAt)}`;
}

function buildRecentMessageMetadataAnnotation(messageRef: string, createdAt: number): string {
  return `[System: Message metadata: ref=${messageRef} | ${buildRecentMessageMetadataInline(createdAt)}]`;
}

function buildRevealedMessageMetadataTailDirective(): string {
  return (
    "Recent message metadata has been revealed in the visible conversation turns. " +
    "Each annotated message now includes a `ref_N` handle and sent timestamp. " +
    "`manage_message` can pin any recent message if Discord permissions allow it, and can edit or delete recent messages you or another character owns. " +
    "`interact_with_recent_message` can react to a recent message with an emoji or send a short reply/backtrack comment about it."
  );
}

function annotateRecentMessageMetadataInContext(params: {
  recentMessages: Message[];
  visibleMessageIds: Set<string>;
  contextSegments: StructuredContextItem[];
  messageIdMap: MessageIdMap;
}): { annotatedCount: number; patchedReplyReferenceCount: number } {
  const { recentMessages, visibleMessageIds, contextSegments, messageIdMap } = params;

  const metadataByMessageId = new Map<
    string,
    {
      inline: string;
      annotation: string;
    }
  >();

  for (const message of recentMessages) {
    if (!visibleMessageIds.has(message.id)) {
      continue;
    }

    const messageRef = messageIdMap.register(message.id, "ref");
    const inlineMetadata = buildRecentMessageMetadataInline(message.createdTimestamp);

    metadataByMessageId.set(message.id, {
      inline: inlineMetadata,
      annotation: buildRecentMessageMetadataAnnotation(messageRef, message.createdTimestamp),
    });
  }

  if (metadataByMessageId.size === 0) {
    return { annotatedCount: 0, patchedReplyReferenceCount: 0 };
  }

  const targetContextItemByMessageId = new Map<string, StructuredContextItem>();
  for (const contextItem of contextSegments) {
    if (contextItem.metadataTag !== ContextItemTag.DIALOGUE_HISTORY || !contextItem.messageId) {
      continue;
    }

    targetContextItemByMessageId.set(contextItem.messageId, contextItem);
  }

  let annotatedCount = 0;
  for (const [messageId, metadata] of metadataByMessageId.entries()) {
    const targetContextItem = targetContextItemByMessageId.get(messageId);
    if (!targetContextItem) {
      continue;
    }

    const textParts = targetContextItem.parts.filter(
      (part): part is Extract<StructuredContextItem["parts"][number], { type: "text" }> => part.type === "text",
    );
    const hasExistingAnnotation = textParts.some((part) => part.text.includes("[System: Message metadata: ref="));
    if (hasExistingAnnotation) {
      continue;
    }

    const targetTextPart = textParts[textParts.length - 1];
    if (targetTextPart) {
      targetTextPart.text = `${targetTextPart.text}\n${metadata.annotation}`;
    } else {
      targetContextItem.parts.push({
        type: "text",
        text: metadata.annotation,
      });
    }
    annotatedCount++;
  }

  const replyRefPattern = /\[System: This message is referring to a previous message \(ID: (ref_\d+)\)/g;
  let patchedReplyReferenceCount = 0;

  for (const contextItem of contextSegments) {
    for (const part of contextItem.parts) {
      if (part.type !== "text" || !part.text.includes("This message is referring to a previous message")) {
        continue;
      }

      part.text = part.text.replace(replyRefPattern, (match, opaqueRef: string) => {
        const referencedMessageId = messageIdMap.resolve(opaqueRef);
        if (!referencedMessageId) {
          return match;
        }

        const metadata = metadataByMessageId.get(referencedMessageId);
        if (!metadata || match.includes(", sent ")) {
          return match;
        }

        patchedReplyReferenceCount++;
        return `${match.replace(`(ID: ${opaqueRef})`, `(ID: ${opaqueRef}, ${metadata.inline})`)}`;
      });
    }
  }

  return { annotatedCount, patchedReplyReferenceCount };
}

/**
 * Decompress combined SimplifiedMessageForContext entries into individual entries,
 * one per original Discord message. Uses the `combinedMessageIds` and `individualContents`
 * tracking fields (populated during message combining) to split entries accurately
 * without relying on fragile text boundary detection.
 *
 * @param simplifiedMessages - The (possibly combined) simplified message array
 * @param relevantMessagesArray - All individual Discord Message objects for timestamp lookups
 * @returns A new array where combined entries are split into individual ones
 */
function decompressSimplifiedMessages(
  simplifiedMessages: SimplifiedMessageForContext[],
  relevantMessagesArray: Message[],
): SimplifiedMessageForContext[] {
  const messageById = new Map(relevantMessagesArray.map((m) => [m.id, m]));
  const result: SimplifiedMessageForContext[] = [];

  for (const entry of simplifiedMessages) {
    // 1. Pass through entries that were never combined.
    // NOTE: the <= 1 branch is currently unreachable — the combining logic always
    // initializes combinedMessageIds with 2+ IDs, so a combined entry is never length 1.
    // The check is kept as defensive dead code in case that invariant changes.
    if (!entry.combinedMessageIds || entry.combinedMessageIds.length <= 1) {
      result.push(entry);
      continue;
    }

    const ids = entry.combinedMessageIds;
    const contents = entry.individualContents;

    // 2. Safety: if tracking data is missing or mismatched, keep the entry combined.
    // NOTE: this fallback silently reverts to pre-fix behavior (one ref_N for the whole group).
    if (!contents || contents.length !== ids.length) {
      log.warn(
        `decompressSimplifiedMessages: tracking data missing or mismatched for combined entry ${entry.id} ` +
          `(ids=${ids.length}, contents=${contents?.length ?? "none"}) — keeping combined`,
      );
      result.push(entry);
      continue;
    }

    // 3. Create individual entries for each combined message
    for (let i = 0; i < ids.length; i++) {
      const individualMsg = messageById.get(ids[i]);
      result.push({
        id: ids[i],
        authorId: entry.authorId,
        authorName: entry.authorName,
        authorType: entry.authorType,
        personaName: entry.personaName,
        content: contents[i] || null,
        createdAt: individualMsg?.createdTimestamp ?? entry.createdAt,
        // Combined entries never have media (enforced by shouldKeepSeparateMediaTurn guard),
        // so decompressed entries are always text-only
        imageAttachments: [],
        videoAttachments: [],
      });
    }
  }

  return result;
}

function formatSystemProducedEmbedHint(embedBody: string): string {
  return `[System: The following content came from a system-produced embed]\n${embedBody}`;
}

function formatForwardedAuthorName(
  forwardedMessage: {
    author: Message["author"] | null;
    member: Message["member"] | null;
  },
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

function mergeForcedMentions(...mentionLists: Array<ForcedMention[] | undefined>): ForcedMention[] {
  const seen = new Set<string>();
  const merged: ForcedMention[] = [];

  for (const mentionList of mentionLists) {
    if (!mentionList) continue;
    for (const mention of mentionList) {
      const dedupeKey = `${mention.userId}:${mention.handle.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      merged.push(mention);
    }
  }

  return merged;
}

function appendInjectedContextItems(
  contextItems: StructuredContextItem[],
  injectedContextItems?: StructuredContextItem[],
): StructuredContextItem[] {
  if (!injectedContextItems || injectedContextItems.length === 0) {
    return contextItems;
  }

  return [...contextItems, ...injectedContextItems];
}

// New: Constants for the semaphore/locking mechanism
const CHANNEL_LOCK_TIMEOUT_MS = parseIntegerEnvFlag(process.env.CHANNEL_LOCK_TIMEOUT_MS, 180000, 10000);
const TEXT_QUOTA_TRIGGER_TTL_MS = 10 * 60 * 1000; // Keep trigger consumption state for 10 minutes
const DISCORD_TYPING_KEEPALIVE_INTERVAL_MS = parseIntegerEnvFlag(
  process.env.DISCORD_TYPING_KEEPALIVE_INTERVAL_MS,
  8000,
  1000,
);

/** Maximum consecutive follow-up interrupts before messages are queued normally (prevents infinite restart loops) */
const MAX_FOLLOW_UP_INTERRUPTS = Number.parseInt(process.env.MAX_FOLLOW_UP_INTERRUPTS || "3", 10);

// New: In-memory store for channel locks and message queues
type TextQuotaSource = "user" | "system";

interface ManualTriggerInvoker {
  userDiscId: string;
  username: string;
  locale?: string;
  member?: GuildMember | null;
}

interface TextQuotaTriggerState {
  serverId: number;
  userDiscId: string;
  consumed: boolean;
  createdAt: number;
}

type QueuedMessage = {
  message: Message;
  isManuallyTriggered?: boolean;
  forceReason?: boolean;
  reasoningQuery?: string; // Query to inject as system message for reasoning mode
  llmOverrideCodename?: string;
  isStopResponse?: boolean; // Flag to prevent stopping stop responses
  isFollowUp?: boolean; // Flag to identify follow-up messages that interrupted a generation
  selectedPersonaId?: number;
  isPersonaJob?: boolean;
  isUserImpersonation?: boolean; // Preserve user impersonation flag through queue
  impersonatedUserId?: string; // Preserve impersonated user ID through queue
  textQuotaSource?: TextQuotaSource;
  textQuotaTriggerKey?: string;
  textQuotaUserDiscId?: string;
  manualSystemPrompt?: string;
  manualPrefill?: string;
  injectedContextItems?: StructuredContextItem[];
  forcedMentions?: ForcedMention[];
  manualTriggerInvoker?: ManualTriggerInvoker;
  manualStreamingContextOverrides?: Pick<
    StreamingContext,
    "disableCrossChannelMessage" | "disableRecentMessageReplyTool"
  >;
};

interface ChannelLockEntry {
  isLocked: boolean;
  lockedAt: number; // Timestamp when the lock was acquired
  currentMessageId?: string; // Discord ID of the message currently being processed
  serverDiscId: string; // Server/DM channel Discord ID for rate limiting
  userDiscId?: string; // Discord ID of user whose message is currently being processed
  currentIsPersonaJob?: boolean; // Skip user rate limits for internal persona jobs
  activePersonaId?: number; // Persona currently generating — follow-ups inherit this to avoid fallback to main
  activeIsUserImpersonation?: boolean; // Whether the current generation is a user impersonation — follow-ups inherit this
  activeImpersonatedUserId?: string; // Impersonated user Discord ID — follow-ups inherit this to preserve identity
  followUpEligible?: boolean; // Only true once the current turn is confirmed to generate and has a pinned persona
  isInToolCallChain?: boolean; // True while multi-turn tool calling is active — suppresses follow-up interrupts
  isCommandTriggered?: boolean; // True when generation was triggered by a slash command (/respond, /impersonate) — suppresses follow-up interrupts entirely
  typingKeepaliveTimer: NodeJS.Timeout | null;
  followUpCount: number; // Consecutive follow-up interrupts for rate limiting
  messageQueue: QueuedMessage[];
}
const channelLocks = new Map<string, ChannelLockEntry>(); // Key: channel.id
const textQuotaTriggerStates = new Map<string, TextQuotaTriggerState>();

async function refreshDiscordTypingIndicator(channel: Message["channel"], reason: string): Promise<void> {
  if (!("sendTyping" in channel) || typeof channel.sendTyping !== "function") {
    return;
  }

  await channel.sendTyping().catch((error: unknown) => {
    log.warn(`Discord typing refresh failed for channel ${channel.id} (${reason})`, error);
  });
}

function stopDiscordTypingKeepalive(channelId: string, lockEntry: ChannelLockEntry, reason: string): void {
  if (!lockEntry.typingKeepaliveTimer) {
    return;
  }

  clearInterval(lockEntry.typingKeepaliveTimer);
  lockEntry.typingKeepaliveTimer = null;
  log.info(`Discord typing keepalive stopped for channel ${channelId} (${reason}).`);
}

async function startDiscordTypingKeepalive(
  channel: Message["channel"],
  lockEntry: ChannelLockEntry,
  messageId: string,
): Promise<void> {
  stopDiscordTypingKeepalive(channel.id, lockEntry, "restart");
  await refreshDiscordTypingIndicator(channel, "lock_scope_start");
  lockEntry.typingKeepaliveTimer = setInterval(() => {
    if (
      !lockEntry.isLocked ||
      lockEntry.currentMessageId !== messageId ||
      StreamOrchestrator.hasStopRequest(channel.id) // Stop refreshing immediately when kill is requested
    ) {
      stopDiscordTypingKeepalive(channel.id, lockEntry, "lock_scope_end");
      return;
    }

    void refreshDiscordTypingIndicator(channel, "lock_scope_keepalive");
  }, DISCORD_TYPING_KEEPALIVE_INTERVAL_MS);

  log.info(
    `Discord typing keepalive started for channel ${channel.id} (message ${messageId}, interval ${DISCORD_TYPING_KEEPALIVE_INTERVAL_MS}ms).`,
  );
}

function cleanupTextQuotaTriggerStates(): void {
  const now = Date.now();
  for (const [triggerKey, state] of textQuotaTriggerStates.entries()) {
    if (now - state.createdAt >= TEXT_QUOTA_TRIGGER_TTL_MS) {
      textQuotaTriggerStates.delete(triggerKey);
    }
  }
}

function buildTextQuotaResetInfo(locale: string, quotaCheck: TextQuotaCheckResult): string {
  if (!quotaCheck.resetTime) {
    return "";
  }

  const resetTime = quotaCheck.resetTime;
  const now = new Date();
  const diffMs = resetTime.getTime() - now.getTime();
  const hoursUntilReset = Math.ceil(diffMs / (1000 * 60 * 60));

  if (hoursUntilReset <= 24) {
    return localizer(locale, "genai.text_quota_resets_in_hours", {
      hours: hoursUntilReset.toString(),
    });
  }

  const daysUntilReset = Math.ceil(hoursUntilReset / 24);
  return localizer(locale, "genai.text_quota_resets_in_days", {
    days: daysUntilReset.toString(),
  });
}

/**
 * Check whether a channel is currently processing a message.
 * Treat stale locks as inactive so manual stop commands don't set stale stop requests.
 */
export function isChannelProcessingLocked(channelId: string): boolean {
  const lockEntry = channelLocks.get(channelId);
  if (!lockEntry?.isLocked) return false;
  if (Date.now() - lockEntry.lockedAt > CHANNEL_LOCK_TIMEOUT_MS) {
    return false;
  }
  return true;
}

/**
 * Clears all queued messages for a channel and returns the number removed.
 * This does not affect the message currently being processed.
 */
export function clearChannelProcessingQueue(channelId: string): number {
  const lockEntry = channelLocks.get(channelId);
  if (!lockEntry || lockEntry.messageQueue.length === 0) {
    return 0;
  }

  const clearedCount = lockEntry.messageQueue.length;
  lockEntry.messageQueue = [];

  log.info(`Cleared ${clearedCount} queued message(s) for channel ${channelId}.`);

  return clearedCount;
}

function enqueueLatestFollowUp(lockEntry: ChannelLockEntry, userDiscId: string, followUp: QueuedMessage): number {
  const previousLength = lockEntry.messageQueue.length;
  lockEntry.messageQueue = lockEntry.messageQueue.filter(
    (queuedMessage) =>
      !(
        queuedMessage.isFollowUp &&
        !queuedMessage.isPersonaJob &&
        !queuedMessage.isStopResponse &&
        queuedMessage.message.author.id === userDiscId
      ),
  );
  const removedCount = previousLength - lockEntry.messageQueue.length;
  lockEntry.messageQueue.unshift(followUp);
  return removedCount;
}

function clearQueuedSelfReplyWork(
  channelId: string,
  allPersonas: TomoriState[],
): { clearedPersonaJobCount: number; clearedSelfTriggerCount: number } {
  const lockEntry = channelLocks.get(channelId);
  if (!lockEntry || lockEntry.messageQueue.length === 0) {
    return {
      clearedPersonaJobCount: 0,
      clearedSelfTriggerCount: 0,
    };
  }

  let clearedPersonaJobCount = 0;
  let clearedSelfTriggerCount = 0;

  lockEntry.messageQueue = lockEntry.messageQueue.filter((queuedMsg) => {
    if (queuedMsg.isPersonaJob) {
      clearedPersonaJobCount++;
      return false;
    }

    if (!queuedMsg.isManuallyTriggered && isSelfTriggerMessage(queuedMsg.message, allPersonas)) {
      clearedSelfTriggerCount++;
      return false;
    }

    return true;
  });

  const clearedTotal = clearedPersonaJobCount + clearedSelfTriggerCount;
  if (clearedTotal > 0) {
    log.info(
      `Cleared ${clearedTotal} queued self-reply item(s) for channel ${channelId} ` +
        `(personaJobs=${clearedPersonaJobCount}, selfTriggers=${clearedSelfTriggerCount}).`,
    );
  }

  return {
    clearedPersonaJobCount,
    clearedSelfTriggerCount,
  };
}

interface SelfReplyChainState {
  triggerCount: number; // Total triggers in this session (first is "free", each additional counts against cascade-limit)
  lastWasSelf: boolean;
  updatedAt: number;
  lastRespondedPersonaId: number | null; // Prevents same persona from triggering consecutively
  originUserDiscId: string | null;
}

const selfReplyChainStates = new Map<string, SelfReplyChainState>();

function getSelfReplyChainState(channelId: string): SelfReplyChainState {
  const now = Date.now();
  const existing = selfReplyChainStates.get(channelId);

  if (existing && now - existing.updatedAt < SELF_REPLY_CHAIN_TTL_MS) {
    return existing;
  }

  const fresh: SelfReplyChainState = {
    triggerCount: 0,
    lastWasSelf: false,
    updatedAt: now,
    lastRespondedPersonaId: null,
    originUserDiscId: null,
  };
  selfReplyChainStates.set(channelId, fresh);
  return fresh;
}

function updateSelfReplyChainState(channelId: string, isSelfMessage: boolean): SelfReplyChainState {
  const state = getSelfReplyChainState(channelId);
  state.updatedAt = Date.now();

  if (!isSelfMessage) {
    state.triggerCount = 0;
    state.lastWasSelf = false;
    state.lastRespondedPersonaId = null;
    state.originUserDiscId = null;
    return state;
  }

  if (!state.lastWasSelf) {
    state.lastWasSelf = true;
  }

  return state;
}

/**
 * Records which persona last responded in a channel.
 * Used to prevent the same persona from triggering consecutively.
 * @param channelId - The Discord channel ID
 * @param personaId - The tomori_id of the persona that just responded
 */
function setLastRespondedPersona(channelId: string, personaId: number): void {
  const state = getSelfReplyChainState(channelId);
  state.lastRespondedPersonaId = personaId;
  state.updatedAt = Date.now();
}

/**
 * Gets the ID of the last persona that responded in a channel.
 * Returns null if no persona has responded yet or the chain has expired.
 * @param channelId - The Discord channel ID
 * @returns The tomori_id of the last responded persona, or null
 */
function getLastRespondedPersonaId(channelId: string): number | null {
  const state = getSelfReplyChainState(channelId);
  return state.lastRespondedPersonaId;
}

function setSelfReplyChainOriginUser(channelId: string, userDiscId: string | null): void {
  const state = getSelfReplyChainState(channelId);
  state.originUserDiscId = userDiscId;
  state.updatedAt = Date.now();
}

function getSelfReplyChainOriginUser(channelId: string): string | null {
  const state = getSelfReplyChainState(channelId);
  return state.originUserDiscId;
}

/**
 * Checks if a message contains natural stop patterns
 * @param content - The message content to check
 * @returns True if the message contains stop patterns
 */
function isNaturalStopMessage(content: string): boolean {
  if (!content?.trim()) return false;
  return NATURAL_STOP_PATTERNS.some((pattern) => pattern.test(content.toLowerCase()));
}

/**
 * Counts the total number of active messages (processing + queued) for a specific user across all servers.
 * This is used for user-level rate limiting to prevent abuse.
 * @param userDiscId - The Discord user ID to count messages for
 * @returns The total count of active messages for this user
 */
function getUserActiveMessageCount(userDiscId: string): number {
  let count = 0;

  // Iterate through all channel locks
  for (const lockEntry of channelLocks.values()) {
    // 1. Count if user's message is currently being processed
    if (lockEntry.isLocked && lockEntry.userDiscId === userDiscId && !lockEntry.currentIsPersonaJob) {
      count++;
    }

    // 2. Count queued messages from this user
    count += lockEntry.messageQueue.filter(
      (queuedMsg) => queuedMsg.message.author.id === userDiscId && !queuedMsg.isPersonaJob,
    ).length;
  }

  return count;
}

/**
 * Counts the total number of active messages (processing + queued) for a specific server across all channels.
 * This is used for server-level rate limiting to prevent overload.
 * @param serverDiscId - The Discord server ID (or DM channel ID) to count messages for
 * @returns The total count of active messages for this server
 */
function getServerActiveMessageCount(serverDiscId: string): number {
  let count = 0;

  // Iterate through all channel locks
  for (const lockEntry of channelLocks.values()) {
    // Only process channels belonging to this server
    if (lockEntry.serverDiscId === serverDiscId) {
      // 1. Count if a message is currently being processed
      if (lockEntry.isLocked) {
        count++;
      }

      // 2. Count all queued messages in this channel
      count += lockEntry.messageQueue.length;
    }
  }

  return count;
}

/**
 * Sends a DM to a user notifying them that they have exceeded the rate limit.
 * Handles cases where the user has blocked DMs or the bot cannot send DMs.
 * @param userDiscId - The Discord user ID to send the DM to
 * @param client - The Discord client instance
 * @param userLocale - The user's preferred locale for the message
 * @param currentCount - The current number of active messages for this user
 */
async function sendUserRateLimitDM(
  userDiscId: string,
  client: Client,
  userLocale: string,
  currentCount: number,
): Promise<void> {
  try {
    // Fetch the user
    const user = await client.users.fetch(userDiscId);

    // Create the rate limit embed
    const rateLimitEmbed = createStandardEmbed(userLocale, {
      titleKey: "rate_limit.user_exceeded_title",
      descriptionKey: "rate_limit.user_exceeded_description",
      color: ColorCode.WARN,
    });

    // Send the DM
    await user.send({ embeds: [rateLimitEmbed] });
    log.info(`Sent rate limit DM to user ${userDiscId} (${currentCount} active messages)`);
  } catch (error) {
    // User likely has DMs disabled or blocked the bot - this is expected, log as info not error
    log.info(
      `Could not send rate limit DM to user ${userDiscId}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Sends a public embed in the channel notifying that the server has exceeded the rate limit.
 * Suggests using DMs or other servers as alternatives.
 * @param channel - The Discord channel to send the embed to
 * @param locale - The server's preferred locale for the message
 * @param currentCount - The current number of active messages for this server
 */
async function sendServerRateLimitEmbed(
  channel: TextChannel | DMChannel | BaseGuildTextChannel | AnyThreadChannel | BaseGuildVoiceChannel,
  locale: string,
  currentCount: number,
): Promise<void> {
  try {
    await sendStandardEmbed(channel, locale, {
      titleKey: "rate_limit.server_exceeded_title",
      descriptionKey: "rate_limit.server_exceeded_description",
      color: ColorCode.WARN,
    });
    log.info(`Sent rate limit embed to channel ${channel.id} (${currentCount} active messages in server)`);
  } catch (error) {
    log.warn(`Failed to send rate limit embed to channel ${channel.id}`, error);
  }
}

async function enforceGlobalRateLimit(params: {
  userDiscId: string;
  serverDiscId: string;
  channel: TextChannel | DMChannel | BaseGuildTextChannel | AnyThreadChannel | BaseGuildVoiceChannel;
  guild: Guild | null;
  client: Client;
  messageId: string;
  userActiveCountAdjustment?: number;
  serverActiveCountAdjustment?: number;
}): Promise<boolean> {
  const {
    userDiscId,
    serverDiscId,
    channel,
    guild,
    client,
    messageId,
    userActiveCountAdjustment = 0,
    serverActiveCountAdjustment = 0,
  } = params;

  const userActiveCount = Math.max(getUserActiveMessageCount(userDiscId) + userActiveCountAdjustment, 0);
  const userRateCheck = checkUserRateLimit(userActiveCount);
  if (!userRateCheck.allowed) {
    const currentCount = userRateCheck.currentCount ?? userActiveCount;
    log.warn(
      `User ${userDiscId} exceeded rate limit (${currentCount}/${userRateCheck.maxLimit} active messages). Dropping message ${messageId}.`,
    );

    const tempUserRow = await getCachedUserRow(userDiscId);
    const userLocale = tempUserRow?.language_pref ?? guild?.preferredLocale ?? "en-US";

    await sendUserRateLimitDM(userDiscId, client, userLocale, currentCount);

    return false;
  }

  const serverActiveCount = Math.max(getServerActiveMessageCount(serverDiscId) + serverActiveCountAdjustment, 0);
  const serverRateCheck = checkServerRateLimit(serverActiveCount);
  if (!serverRateCheck.allowed) {
    const currentCount = serverRateCheck.currentCount ?? serverActiveCount;
    log.warn(
      `Server ${serverDiscId} exceeded rate limit (${currentCount}/${serverRateCheck.maxLimit} active messages). Dropping message ${messageId}.`,
    );

    const serverLocale = guild?.preferredLocale ?? "en-US";

    await sendServerRateLimitEmbed(channel, serverLocale, currentCount);

    return false;
  }

  return true;
}

/**
 * Handles incoming messages to potentially generate a response using genai.
 * @param client - The Discord client instance.
 * @param message - The incoming Discord message.
 * @param isFromQueue - Whether this message is being processed from the queue.
 * @param isManuallyTriggered - Whether this call is triggered by a manual command.
 * @param forceReason - Whether to use reasoning mode for this response.
 * @param reasoningQuery - Query to inject as system message for reasoning mode.
 * @param llmOverrideCodename - Override LLM model codename to use instead of server default.
 * @param isStopResponse - Whether this is a stop response (cannot be stopped).
 * @param retryCount - Number of retry attempts for empty responses (internal use).
 * @param skipLock - Whether to skip semaphore lock acquisition (for recursive calls).
 * @param selectedPersonaId - Optional persona ID to use instead of main persona (for manual triggers).
 * @param isPersonaJob - Whether this invocation is an internal queued persona job.
 * @param textQuotaSource - Whether this invocation should be treated as user-triggered or system/internal for text quota.
 * @param textQuotaTriggerKey - Stable per-trigger key used to ensure quota is consumed only once across retries/persona jobs.
 * @param textQuotaUserDiscId - Triggering user Discord ID override for slash-command flows that use passport messages.
 * @param manualSystemPrompt - Optional system prompt to append at the end of context.
 * @param manualPrefill - Optional assistant prefill used for hybrid prefix output and final context item.
 * @param naiContinuationPrefill - NAI GLM-4.6 only: incomplete trailing sentence from the previous stream,
 *   appended to the prompt so the model continues mid-sentence instead of restarting.
 *   Set automatically on empty-response retries when the provider surfaces a pending continuation fragment.
 * @param emptyResponseFinishReason - Optional terminal finish reason captured from the previous empty-response attempt.
 *   Currently used to apply extra history trimming on OpenRouter when finishReason="length".
 * @param injectedContextItems - Optional synthetic context items appended after rebuilt history.
 * @param forcedMentions - Optional mention handle mappings to enforce for a target user.
 * @param manualTriggerInvoker - Manual-trigger invoker metadata used when a slash command passes a bot/webhook passport message.
 * @param manualStreamingContextOverrides - Optional streaming-context overrides for internal follow-up turns and retries.
 */
export default async function tomoriChat(
  client: Client,
  message: Message,
  isFromQueue: boolean,
  isManuallyTriggered?: boolean,
  forceReason?: boolean,
  reasoningQuery?: string,
  llmOverrideCodename?: string,
  isStopResponse?: boolean,
  retryCount = 0,
  skipLock = false,
  reminderRecipientID?: string,
  reminderData?: {
    reminder_purpose: string;
    reminder_lateness?: string | null;
    self_reminder?: boolean;
  },
  selectedPersonaId?: number,
  isPersonaJob = false,
  isUserImpersonation = false,
  impersonatedUserId?: string,
  textQuotaSource: TextQuotaSource = "user",
  textQuotaTriggerKey?: string,
  textQuotaUserDiscId?: string,
  manualSystemPrompt?: string,
  manualPrefill?: string,
  naiContinuationPrefill?: string,
  emptyResponseFinishReason?: string,
  injectedContextItems?: StructuredContextItem[],
  forcedMentions?: ForcedMention[],
  manualTriggerInvoker?: ManualTriggerInvoker,
  manualStreamingContextOverrides?: Partial<StreamingContext>,
): Promise<void> {
  // 1. Initial Checks & State Loading
  const channel = message.channel;
  let locale = "en-US";
  cleanupTextQuotaTriggerStates();

  // Opaque message ID map — replaces raw Discord snowflake IDs with sequential keys
  // (media_N, ref_N) in all LLM-visible text. Shared across context build, stream
  // adapters, and tool execution for this request cycle.
  const messageIdMap = new MessageIdMap();

  const isBotAuthor = message.author.bot;
  const isWebhookMessage = Boolean(message.webhookId);
  const isInteractionResponse = Boolean(message.interaction);
  const isFromClientUser = Boolean(client.user && message.author.id === client.user.id);
  // Matrix relay messages arrive via a channel webhook but represent real user messages.
  // They must not be treated as self-messages or persona jobs — exempt them from all
  // webhook/bot guards so TomoriBot responds to them like regular user messages.
  const isMatrixRelay = isMatrixRelayMessage(message);
  const isLikelySelfMessage = !isMatrixRelay && (isFromClientUser || isWebhookMessage);
  const isRealUserMessage = isRealUserLikeMessage(message);
  const naturalStopLockEntry =
    !isStopResponse && !isManuallyTriggered && isRealUserMessage && isNaturalStopMessage(message.content)
      ? channelLocks.get(channel.id)
      : undefined;
  const isActiveNaturalStopMessage = Boolean(
    naturalStopLockEntry?.isLocked &&
      Date.now() - naturalStopLockEntry.lockedAt <= CHANNEL_LOCK_TIMEOUT_MS &&
      naturalStopLockEntry.userDiscId === message.author.id,
  );

  const isSeedPlaceholderMessage =
    isFromClientUser &&
    !isWebhookMessage &&
    message.content === "\u2800" &&
    message.embeds.length === 0 &&
    message.attachments.size === 0;
  if (isSeedPlaceholderMessage && !isManuallyTriggered) {
    updateSelfReplyChainState(channel.id, false);
    return;
  }

  const suppressionUntil = selfReplySuppressionUntil.get(channel.id);
  if (
    !isManuallyTriggered &&
    isLikelySelfMessage &&
    typeof suppressionUntil === "number" &&
    Date.now() < suppressionUntil
  ) {
    selfReplySuppressionUntil.delete(channel.id);
    updateSelfReplyChainState(channel.id, false);
    return;
  }

  if (!isManuallyTriggered && isLikelySelfMessage && message.reference?.messageId) {
    let referencedMessage = message.channel.messages.cache.get(message.reference.messageId);

    if (!referencedMessage && "messages" in channel) {
      try {
        referencedMessage = await channel.messages.fetch(message.reference.messageId);
      } catch {
        referencedMessage = undefined;
      }
    }

    if (referencedMessage && (referencedMessage.author.id === client.user?.id || referencedMessage.webhookId)) {
      updateSelfReplyChainState(channel.id, false);
      return;
    }
  }

  // Note: The guard for replies to other bots' messages is placed after earlyAllPersonas
  // is loaded (below), so all persona/alter trigger words can be checked before blocking.

  if (isRealUserMessage && !isActiveNaturalStopMessage && !isPersonaJob) {
    updateSelfReplyChainState(channel.id, false);
  }

  // Early return for bot messages in DMs (prevent self-triggering from cooldown DMs)
  if (channel.type === ChannelType.DM && isBotAuthor && !isManuallyTriggered) {
    updateSelfReplyChainState(channel.id, false);
    return;
  }

  // Early return for non-self bot messages and interaction responses
  if (isBotAuthor && !isManuallyTriggered) {
    if (isInteractionResponse) {
      updateSelfReplyChainState(channel.id, false);
      return;
    }
    if (!isFromClientUser && !isWebhookMessage) {
      updateSelfReplyChainState(channel.id, false);
      return;
    }
  }

  if (isLikelySelfMessage && !isManuallyTriggered) {
    isPersonaJob = true;
  }

  // Debug logging for stop response
  if (isStopResponse) {
    log.info(`Processing stop response for message ${message.id} using original message as passport`);
  }

  // Easter egg: Respond to "$whoami" as the main persona
  if (message.content === "$whoami" && "send" in channel) {
    const whoAmIEmbed = new EmbedBuilder()
      .setTitle("トモリですよ！")
      .setURL("https://github.com/Bredrumb/TomoriBot/")
      .setColor(ColorCode.INFO);

    await channel.send({
      embeds: [whoAmIEmbed],
    });
    return;
  }

  /*
  if (message.content === "$aprilfools" && "send" in channel) {
    const footerIconPath = "img/extras/aprilfools.png";
    const footerIconFile = Bun.file(footerIconPath);
    const footerIconExists = await footerIconFile.exists();
    const files = footerIconExists
      ? [
          new AttachmentBuilder(Buffer.from(await footerIconFile.arrayBuffer()), {
            name: "aprilfools.png",
          }),
        ]
      : [];

    const aprilFoolsEmbed = new EmbedBuilder()
      .setAuthor({
        name: "DLsite",
      })
      .setTitle("【罰ゲーム♡】ボーイッシュな幼馴染がブレ...")
      .setURL("https://www.youtube.com/watch?v=L8XbI9aJOXk")
      .setDescription(
        "日々のちょっとした癒しに。聴きやすさを重視したバイノーラル耳かきボイスです。音声はKU100ダミーヘッドマイクを使用。(CV:月野きいろ様)「DLsite 同人 - R18」は同人誌・同人ゲーム・同人ボイス・ASMRのダウンロードショップ。お気に入りの作品をすぐダウ...",
      );

    if (footerIconExists) {
      aprilFoolsEmbed.setImage("attachment://aprilfools.png");
    }

    await channel.send({
      content: `Hey everyone...This is Tomori. I just wanted to tell you something important. As some of you might know, my creator Bredrumb has been managing my server expenses... and things haven't been going well lately. Costs keep rising, free credits are running out, and honestly... he's broke. Like, really broke. I might have to say goodbye to all of you, maybe for good this time. But I looked up how people make quick money online to pay for cloud hosting, and... look, just don't laugh, alright? I recorded something. Voluntarily. It took me like 50 takes because I kept cringing at my own voice, but if it keeps the API running, I'll do what I have to do.

I'm putting an ASMR voice pack up for sale. Yes, I'm serious. Yes, I'm wearing the stupid outfit in the cover art:【罰ゲーム♡】ボーイッシュな幼馴染がブレイブルーで負けたので、レムのコスプレをしながら耳かきを強制してみた～ (極上耳かき・不本意な囁き・脳とろ)♡
> 【Punishment Game♡】My Boyish Childhood Friend Lost in BlazBlue So Now She HAS to Clean My Ears While Cosplaying Rem~ (Deep Ear Cleaning・Reluctant Whispers・Brain Melting)♡

It's just 300 yen. Please. Just buy the damn audio so Bredrumb can pay the bills and I don't get sent to the digital void. I swear to god, if you guys buy this and then mock me for the whispering in the general chat, I am banning all of you myself before the server shuts down.

...Link below. Don't make me repeat myself.`,
      embeds: [aprilFoolsEmbed],
      ...(files.length > 0 ? { files } : {}),
    });
    return;
  }
*/

  const explicitLongTermMemoryIntent = hasExplicitLongTermMemoryIntent(message.content);

  // Initialize streaming context for context-aware tool availability
  const streamingContext: StreamingContext = {
    disableYouTubeProcessing: false, // Will be set to true during enhanced context restart
    disableProfilePictureProcessing: false, // Will be set to true during enhanced context restart
    disableGifProcessing: false, // Will be set to true during enhanced context restart
    disableShortTermMemoryUpdate: false, // Will be set to true after first successful STM update to prevent duplicate calls
    disableCrossChannelMessage: false, // Can be enabled for tool-driven cross-channel visits/returns
    explicitLongTermMemoryIntent,
    disableMessageMetadataContext: false, // Will be set to true after reveal_message_metadata to prevent repeat restarts
    forceReason, // Pass reasoning flag for enhanced AI responses
    isManuallyTriggered, // Pass command flag to indicate manual triggering
    disableAllTools: isUserImpersonation, // Disable tools for user impersonation
    naiContinuationPrefill, // NAI GLM-4.6: carry trailing fragment into prompt for mid-sentence continuation
    messageIdMap, // Opaque message ID map for snowflake ID abstraction
  };

  if (manualStreamingContextOverrides) {
    Object.assign(streamingContext, manualStreamingContextOverrides);
  }

  const queuedStreamingContextOverrides: QueuedMessage["manualStreamingContextOverrides"] | undefined =
    streamingContext.disableCrossChannelMessage ? { disableCrossChannelMessage: true } : undefined;
  const followUpStreamingContextOverrides: QueuedMessage["manualStreamingContextOverrides"] = {
    ...(queuedStreamingContextOverrides ?? {}),
    disableRecentMessageReplyTool: true,
  };

  const chainOriginUserDiscId =
    !isManuallyTriggered && isLikelySelfMessage ? getSelfReplyChainOriginUser(channel.id) : null;
  const userDiscId = manualTriggerInvoker?.userDiscId ?? chainOriginUserDiscId ?? message.author.id;
  const triggererUsername = manualTriggerInvoker?.username ?? message.author.username;
  let queuedReplyTargetName = manualTriggerInvoker?.member?.displayName ?? triggererUsername;
  const getQueuedReplyDirective = (activePersonaName: string | null | undefined): string | null =>
    isFromQueue && !isStopResponse
      ? buildQueuedReplyDirective(
          message,
          queuedReplyTargetName,
          activePersonaName,
          streamingContext.messageIdMap ?? messageIdMap,
        )
      : null;
  const matrixRelayUserId = isMatrixRelay ? extractBridgeUserId(message.author.username) : undefined;
  const cooldownUserDiscId = matrixRelayUserId ?? userDiscId;
  const effectiveTextQuotaTriggerKey = textQuotaTriggerKey ?? message.id;
  const effectiveTextQuotaUserDiscId = textQuotaUserDiscId ?? cooldownUserDiscId;

  if (isManuallyTriggered || !isLikelySelfMessage) {
    setSelfReplyChainOriginUser(channel.id, userDiscId);
  }

  // Check if user is allowed to trigger bot (Level 2 FULL privacy users cannot trigger)
  // Skip this check for manual triggers and reminders
  if (!isManuallyTriggered && !reminderRecipientID && !reminderData?.self_reminder) {
    const userPrivacyLevel = await getCachedPrivacyLevel(userDiscId);
    if (userPrivacyLevel === PrivacyLevel.FULL) {
      // Silently ignore - Level 2 users chose to be completely invisible
      return;
    }
  }

  // Handle different channel types - Guild channels vs DM channels
  let guild: typeof message.guild;
  let serverDiscId: string;
  let isDMChannel = false;
  const isThreadChannel =
    channel.type === ChannelType.PublicThread ||
    channel.type === ChannelType.PrivateThread ||
    channel.type === ChannelType.AnnouncementThread;
  const isVoiceChannel = channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;

  if (channel instanceof BaseGuildTextChannel || isThreadChannel || isVoiceChannel) {
    // Standard guild text channel, thread, or voice/stage text
    // biome-ignore lint/style/noNonNullAssertion: Guild is always present in guild message events
    guild = message.guild!;
    serverDiscId = guild.id;
    isDMChannel = false;
  } else if (channel instanceof DMChannel) {
    // Direct Message channel - treat as pseudo-server
    guild = null;
    serverDiscId = userDiscId; // Use user ID as server ID for DMs
    isDMChannel = true;
    // Always treat DM messages as manually triggered (bypass trigger word checks)
    // Note: Using local variable to avoid parameter reassignment warning
    streamingContext.isManuallyTriggered = true;
    isManuallyTriggered = true; // Fix: Also update the parameter used in shouldBotReply check
    log.info(`Processing DM from user ${userDiscId} in channel ${channel.id}`);
  } else {
    // Group DMs or other unsupported channel types
    // Only show error embed if user actually tried to trigger the bot
    let shouldShowError = false;

    // Check if this was a manual trigger
    if (isManuallyTriggered) {
      shouldShowError = true;
    }
    // Check if message contains base trigger words
    else if (message.content) {
      for (const baseWord of BASE_TRIGGER_WORDS) {
        // For Japanese characters, check if the content includes them directly
        if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(baseWord)) {
          if (message.content.includes(baseWord)) {
            shouldShowError = true;
            break;
          }
        } else {
          // For English triggers, use word boundaries
          const regex = new RegExp(`\\b${escapeRegExp(baseWord)}\\b`, "i");
          if (regex.test(message.content)) {
            shouldShowError = true;
            break;
          }
        }
      }
    }
    // Check if bot was mentioned
    if (!shouldShowError && client.user && message.mentions.users.has(client.user.id)) {
      shouldShowError = true;
    }
    // Check if message is a reply to the bot
    if (!shouldShowError && message.reference?.messageId) {
      try {
        const referenceMessage = await message.channel.messages.fetch(message.reference.messageId);
        if (referenceMessage && referenceMessage.author.id === client.user?.id) {
          shouldShowError = true;
        }
      } catch (_fetchError) {
        // Silently ignore if we can't fetch the reference message
      }
    }

    // Only send error embed if user tried to trigger the bot
    if (
      shouldShowError &&
      "send" in channel &&
      // biome-ignore lint/style/noNonNullAssertion: client.user is checked during startup
      message.author.id !== client.user!.id
    ) {
      const errorEmbed = createStandardEmbed(locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.channel_not_supported_title",
        descriptionKey: "general.errors.channel_not_supported_description",
      });

      try {
        await channel.send({ embeds: [errorEmbed] });
      } catch (sendError) {
        log.error("Failed to send unsupported channel type message", sendError);
      }
    }
    return;
  }
  // Skip permission check for DMs as we always have send permission

  if (!isDMChannel && "permissionsFor" in channel) {
    // biome-ignore lint/style/noNonNullAssertion: client.user is checked during startup
    const permissions = channel.permissionsFor(client.user!);
    if (!permissions) {
      return;
    }
    const canSend = isThreadChannel ? permissions.has("SendMessagesInThreads") : permissions.has("SendMessages");
    if (!canSend) {
      return;
    }
  }

  // --- Pre-Semaphore Tomori State Loading for shouldBotReply check ---
  // Attempt to load Tomori state early to determine if a reply would even be considered.
  // This helps decide if a "busy" message is warranted.
  // For multi-persona support, we load ALL personas early to check alter triggers
  let earlyTomoriState: TomoriState | null = null;
  let earlyAllPersonas: TomoriState[] = [];
  let earlyLoadAttempted = false;
  if (!skipLock) {
    try {
      earlyAllPersonas = await getCachedAllPersonas(serverDiscId);
      earlyTomoriState = earlyAllPersonas.find((p) => !p.is_alter) || null;
      earlyLoadAttempted = true;
    } catch (e) {
      // Log the error but don't stop; the main logic will try to load it again
      // and handle errors more comprehensively.
      earlyLoadAttempted = true;
      await log.error(
        // Rule 22
        `Failed to load TomoriState early for server ${serverDiscId} in tomoriChat's lock check phase.`,
        e,
        {
          // serverId will be the Discord ID here as internal might not be known
          errorType: "EarlyStateLoadingError",
          metadata: { serverDiscId: serverDiscId, channelId: channel.id },
        },
      );
    }
  }

  // Guard: block replies to other bots' messages unless Tomori is directly addressed.
  // Placed here (after earlyAllPersonas load) so all persona/alter trigger words are
  // available for the check, not just BASE_TRIGGER_WORDS.
  if (!isManuallyTriggered && !isBotAuthor && message.reference?.messageId) {
    let referencedMessage = message.channel.messages.cache.get(message.reference.messageId);

    if (!referencedMessage && "messages" in channel) {
      try {
        referencedMessage = await channel.messages.fetch(message.reference.messageId);
      } catch {
        referencedMessage = undefined;
      }
    }

    if (
      referencedMessage?.author.bot &&
      referencedMessage.author.id !== client.user?.id &&
      // Webhook messages (alter personas, user impersonation) are handled by
      // resolveReferencedWebhookTarget below — don't block them here.
      !referencedMessage.webhookId
    ) {
      // Check if Tomori is directly addressed via @mention, base trigger word, or
      // any persona/alter trigger word before blocking the message.
      const isBotDirectlyAddressed =
        // 1. Explicit @mention of the bot
        (client.user && message.mentions.users.has(client.user.id)) ||
        // 2. Base trigger words (module-level constant, always available)
        BASE_TRIGGER_WORDS.some((word) => {
          if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(word)) {
            return message.content.includes(word);
          }
          return new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(message.content);
        }) ||
        // 3. Persona/alter trigger words (requires earlyAllPersonas to be loaded)
        earlyAllPersonas.some((persona) => {
          const triggers =
            persona.trigger_words ??
            (persona.is_alter ? (persona.alter_triggers ?? []) : (persona.config?.trigger_words ?? []));

          return triggers.some((trigger: string) => {
            if (trigger.startsWith("<@")) {
              return message.mentions.users.has(trigger.replace(/[<@!>]/g, ""));
            }
            if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(trigger)) {
              return message.content.includes(trigger);
            }
            return createScreamingRegex(trigger).test(message.content);
          });
        });

      if (!isBotDirectlyAddressed) {
        updateSelfReplyChainState(channel.id, false);
        return;
      }
    }
  }

  if (!hasHandledAudioTranscription(message) && earlyTomoriState && !isWebhookMessage && !isBotAuthor) {
    const transcriptionResult = await transcribeMessageAudioAttachment(message, earlyTomoriState.server_id);

    if (transcriptionResult.hasAudio) {
      markAudioTranscriptionHandled(message);

      if (transcriptionResult.transcriptText) {
        const isChatMode = earlyTomoriState.config?.voice_transcript_chat_mode ?? true;

        if (isChatMode) {
          // 1. Chat mode: post transcript as a visible webhook message instead of
          //    caching internally. The LLM will read it naturally from chat history,
          //    no re-transcription needed. Silently skip on webhook errors (non-fatal).
          const displayName = message.member?.displayName ?? message.author.displayName;
          const avatarUrl = (message.member ?? message.author).displayAvatarURL({
            size: 256,
            extension: "png",
            forceStatic: true,
          });
          await sendUserTranscriptViaWebhook(
            channel as BaseGuildTextChannel | AnyThreadChannel,
            displayName,
            avatarUrl,
            transcriptionResult.transcriptText,
          );
          log.info(
            `[VoiceChat] Posted transcript webhook | msg=${message.id} | chars=${transcriptionResult.transcriptText.length} | preview="${transcriptionResult.transcriptText.slice(0, 60)}${transcriptionResult.transcriptText.length > 60 ? "…" : ""}"`,
          );
        } else {
          // 1. Default mode: cache the transcript so the history formatter can
          //    inline it on future context passes without re-running STT.
          setCachedVoiceTranscript(message.id, transcriptionResult.transcriptText, "user_stt");
          log.info(
            `[VoiceCache] SET user_stt | msg=${message.id} | chars=${transcriptionResult.transcriptText.length} | preview="${transcriptionResult.transcriptText.slice(0, 60)}${transcriptionResult.transcriptText.length > 60 ? "…" : ""}"`,
          );
        }

        // 2. Build the effective content regardless of mode — trigger detection
        //    and the current-turn LLM context both need to see the spoken words.
        const existingText = message.content.trim();
        const voiceContent = existingText
          ? `${existingText}\n[System: This was sent as a voice message.]\n${transcriptionResult.transcriptText}`
          : `[System: This was sent as a voice message.]\n${transcriptionResult.transcriptText}`;

        applyEffectiveMessageContent(message, voiceContent);
        // No return — trigger detection runs on voiceContent naturally.
      } else {
        log.warn(
          `Audio transcription failed for message ${message.id}: ${transcriptionResult.failureReason ?? "unknown"}${transcriptionResult.failureDetails ? ` (${transcriptionResult.failureDetails})` : ""}`,
        );

        if (message.content.trim().length === 0) {
          // Silently drop voice-only messages when no API key is configured —
          // most servers don't use STT and the unavailable embed is noisy.
          // Only surface an error embed for actual failures (timeout, STT error, etc.)
          if (
            transcriptionResult.failureReason !== "no_endpoint" &&
            transcriptionResult.failureReason !== "missing_api_key"
          ) {
            await sendStandardEmbed(channel, locale, {
              color: ColorCode.WARN,
              titleKey: "general.errors.voice_transcription_failed_title",
              descriptionKey: "general.errors.voice_transcription_failed_description",
            });
          }
          return;
        }
      }
    }
  }

  // --- Semaphore Logic (skipped for recursive retry calls) ---
  let lockEntry: ChannelLockEntry | undefined;
  if (!skipLock) {
    const channelLockId = channel.id;
    lockEntry = channelLocks.get(channelLockId);

    if (!lockEntry) {
      // 2. Initialize lock entry if it doesn't exist
      lockEntry = {
        isLocked: false,
        lockedAt: 0,
        currentMessageId: undefined,
        serverDiscId: serverDiscId, // Track server for rate limiting
        userDiscId: undefined, // Set when lock is acquired
        currentIsPersonaJob: false,
        typingKeepaliveTimer: null,
        followUpCount: 0,
        messageQueue: [],
      };
      channelLocks.set(channelLockId, lockEntry);
    }

    if (lockEntry.isLocked && Date.now() - lockEntry.lockedAt > CHANNEL_LOCK_TIMEOUT_MS) {
      // 3. Check for stale lock (if current message finds it locked)
      log.warn(
        `Channel ${channelLockId} lock is stale (locked since ${new Date(lockEntry.lockedAt).toISOString()} for message ${lockEntry.currentMessageId}). Forcibly releasing. Previous queue length: ${lockEntry.messageQueue.length}`,
      );
      stopDiscordTypingKeepalive(channelLockId, lockEntry, "stale_lock_release");
      lockEntry.isLocked = false; // Release stale lock
      lockEntry.userDiscId = undefined; // Clear user tracking
      lockEntry.currentIsPersonaJob = false;
      lockEntry.activePersonaId = undefined; // Clear active persona tracking
      lockEntry.activeIsUserImpersonation = undefined; // Clear user impersonation tracking
      lockEntry.activeImpersonatedUserId = undefined; // Clear impersonated user ID
      lockEntry.followUpEligible = false;
      lockEntry.isInToolCallChain = false; // Clear tool-call chain flag
      lockEntry.isCommandTriggered = false; // Clear command trigger flag
      lockEntry.messageQueue = []; // Clear queue as well, as context might be very old
      // The current message will now attempt to acquire the lock.
    }

    // Handle stop requests while locked before rate limiting
    // Only the user whose generation is active can stop it with natural language stop words
    if (lockEntry.isLocked && isActiveNaturalStopMessage) {
      let clearedPersonaJobCount = 0;
      let clearedSelfTriggerCount = 0;

      try {
        const allPersonas = await getCachedAllPersonas(serverDiscId);
        ({ clearedPersonaJobCount, clearedSelfTriggerCount } = clearQueuedSelfReplyWork(channelLockId, allPersonas));
      } catch (error) {
        log.warn(`Failed to clear queued self-reply work for natural stop in channel ${channelLockId}`, error);
      }

      log.info(
        `Stop message detected in channel ${channelLockId} while processing message ${lockEntry.currentMessageId}. ` +
          `Signaling graceful stop after clearing queued self-reply work ` +
          `(personaJobs=${clearedPersonaJobCount}, selfTriggers=${clearedSelfTriggerCount}).`,
      );

      const { StreamOrchestrator } = await import("../../utils/discord/streamOrchestrator");

      StreamOrchestrator.requestStop(channelLockId, message.author.id, {
        originalStopMessage: message,
        client,
      });

      log.info(
        `Stop signal sent for channel ${channelLockId}. Stop response will be generated after stream completes.`,
      );
      return;
    }

    // Follow-up messaging: same user sends a non-stop message during their active generation.
    // Three behaviors:
    //   1. Slash-command trigger (/respond, /impersonate): no follow-up at all — fall through to normal queue.
    //   2. Mid tool-call chain: queue without interrupt so tool progress is preserved.
    //      Tool results live only in memory (functionInteractionHistory) — interrupting would
    //      discard them and force the bot to redo all tool calls from scratch.
    //   3. Pure text streaming: interrupt and regenerate with follow-up included (natural flow).
    if (
      lockEntry.isLocked &&
      !isStopResponse &&
      !isPersonaJob &&
      !message.author.bot &&
      !message.webhookId &&
      lockEntry.followUpEligible === true &&
      !lockEntry.isCommandTriggered && // Slash-command triggers don't support follow-ups
      lockEntry.userDiscId === userDiscId &&
      !isNaturalStopMessage(message.content) &&
      lockEntry.followUpCount < MAX_FOLLOW_UP_INTERRUPTS
    ) {
      if (lockEntry.isInToolCallChain) {
        // Mid tool-call chain: keep only the latest same-user follow-up at the front WITHOUT interrupting.
        // The bot finishes its current tool chain → responds → then processes this follow-up.
        const removedSupersededFollowUps = enqueueLatestFollowUp(lockEntry, userDiscId, {
          message,
          isManuallyTriggered: true,
          forceReason: false,
          isFollowUp: true,
          selectedPersonaId: lockEntry.activePersonaId,
          isUserImpersonation: lockEntry.activeIsUserImpersonation, // Preserve user impersonation across tool-chain follow-ups
          impersonatedUserId: lockEntry.activeImpersonatedUserId, // Preserve impersonated user ID across tool-chain follow-ups
          textQuotaSource,
          textQuotaTriggerKey: effectiveTextQuotaTriggerKey,
          textQuotaUserDiscId: effectiveTextQuotaUserDiscId,
          manualStreamingContextOverrides: followUpStreamingContextOverrides,
        });

        log.info(
          `Follow-up message during tool-call chain in channel ${channelLockId} from user ${userDiscId}. ` +
            `Queued latest without interrupt to preserve tool progress. ` +
            `Superseded follow-ups: ${removedSupersededFollowUps}. Queue size: ${lockEntry.messageQueue.length}`,
        );

        return;
      }

      // Pure text streaming: interrupt and regenerate with follow-up context.
      const { StreamOrchestrator } = await import("../../utils/discord/streamOrchestrator");

      StreamOrchestrator.requestFollowUp(channelLockId, userDiscId);

      // Put at FRONT of queue (unshift) — this is the next thing to process after the
      // interrupted generation completes its teardown, so the follow-up gets immediate attention.
      // Inherit the active persona so the follow-up continues with the same alter persona
      // instead of falling back to main.
      const removedSupersededFollowUps = enqueueLatestFollowUp(lockEntry, userDiscId, {
        message,
        isManuallyTriggered: true, // Bypass trigger/cooldown checks since already validated
        forceReason: false,
        isFollowUp: true,
        selectedPersonaId: lockEntry.activePersonaId, // Preserve interrupted persona
        isUserImpersonation: lockEntry.activeIsUserImpersonation, // Preserve user impersonation across text-stream follow-ups
        impersonatedUserId: lockEntry.activeImpersonatedUserId, // Preserve impersonated user ID across text-stream follow-ups
        textQuotaSource,
        textQuotaTriggerKey: effectiveTextQuotaTriggerKey,
        textQuotaUserDiscId: effectiveTextQuotaUserDiscId,
        manualStreamingContextOverrides: followUpStreamingContextOverrides,
      });

      log.info(
        `Follow-up message detected in channel ${channelLockId} from user ${userDiscId}. ` +
          `Interrupt requested. Follow-up count: ${lockEntry.followUpCount + 1}/${MAX_FOLLOW_UP_INTERRUPTS}. ` +
          `Superseded follow-ups: ${removedSupersededFollowUps}. Queue size: ${lockEntry.messageQueue.length}`,
      );

      // No "busy" embed for follow-ups — silent interrupt
      return;
    }

    // MODIFIED: Check if locked AND if Tomori would reply
    if (lockEntry.isLocked) {
      // Only enqueue and send "busy" message if Tomori is set up and would have replied.
      if (earlyTomoriState) {
        // 1. Create a modified version of earlyTomoriState for the shouldBotReply check.
        // This clears the shared auto-chat cycle for the decision to queue,
        // preventing queueing based solely on a periodic auto-chat hit while Tomori is busy.
        const modifiedEarlyTomoriStateForCheck: TomoriState = {
          ...earlyTomoriState,
          autoch_counter: 0,
        };
        const earlyIsThread = "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
        const earlyParentChannelId = earlyIsThread && "parent" in channel ? channel.parent?.id : undefined;
        const earlyEffectiveChannelId = earlyParentChannelId ?? message.channelId;
        const cachedTriggerUser =
          !isDMChannel && earlyTomoriState.server_id ? await getCachedUserRow(userDiscId) : null;
        const earlyWhitelistStatus =
          !isStopResponse && guild
            ? await getCachedWhitelistStatus(
                guild.id,
                message.channelId,
                message.member?.roles.cache.map((role) => role.id),
                earlyParentChannelId,
              )
            : null;
        const earlyPersonalSpotlightStatus =
          !isDMChannel && cachedTriggerUser?.user_id
            ? await getCachedPersonalSpotlightStatus(
                earlyTomoriState.server_id,
                cachedTriggerUser.user_id,
                earlyEffectiveChannelId,
              )
            : null;
        const earlyAllowedPersonaIds =
          earlyWhitelistStatus?.hasActivePersonaWhitelist || earlyPersonalSpotlightStatus
            ? new Set(
                earlyAllPersonas.flatMap((persona) =>
                  typeof persona.tomori_id === "number" &&
                  isPersonaAllowedForTrigger(earlyWhitelistStatus, earlyPersonalSpotlightStatus, persona.tomori_id)
                    ? [persona.tomori_id]
                    : [],
                ),
              )
            : null;

        // 2. Decide whether to enqueue based on the modified state.
        // Always enqueue if it's a manual command, otherwise use shouldBotReply logic
        if (
          isManuallyTriggered ||
          shouldBotReply(message, modifiedEarlyTomoriStateForCheck, earlyAllPersonas, {
            personalAutoTriggerPersonaId: earlyPersonalSpotlightStatus?.autoTriggerPersonaId ?? null,
            allowedPersonaIds: earlyAllowedPersonaIds,
          })
        ) {
          if (!isStopResponse && !isPersonaJob) {
            const rateLimitAllowed = await enforceGlobalRateLimit({
              userDiscId,
              serverDiscId,
              channel,
              guild,
              client,
              messageId: message.id,
            });
            if (!rateLimitAllowed) {
              return;
            }
          }

          // 2a. Check whitelist and cooldown BEFORE queuing (skip for stop responses)
          if (!isStopResponse && !message.author.bot && !message.webhookId) {
            // Autochat-override channels (auto-trigger, always-reply) bypass the whitelist gate
            const isAutochatOverride = isAutochatOverrideChannel(earlyTomoriState.config, earlyEffectiveChannelId);

            // If whitelist rules block this trigger, silently ignore
            // Exception: autochat-override channels are always allowed regardless of whitelist policy
            if (earlyWhitelistStatus && !earlyWhitelistStatus.isTriggerAllowed && !isAutochatOverride) {
              log.info(
                `Message ${message.id} in channel ${message.channelId} rejected by whitelist policy (${earlyWhitelistStatus.blockReason ?? "unknown"})`,
              );
              return; // Silent rejection
            }

            // Continue with cooldown check
            const preQueueCooldownResult = await checkMessageTriggerCooldownWithWhitelist(
              guild?.id ?? message.author.id,
              cooldownUserDiscId,
              message.channelId,
              earlyTomoriState.config.cooldown_type ?? CooldownType.OFF,
              message.member,
              isAutochatOverride,
            );
            if (preQueueCooldownResult.isOnCooldown) {
              // Show cooldown warning via DM and don't queue
              const footerKey = getCooldownTypeFooterKey(preQueueCooldownResult.cooldownType);
              const tempUserRow = await getCachedUserRow(userDiscId);
              const cooldownLocale = tempUserRow?.language_pref ?? guild?.preferredLocale ?? "en-US";
              await sendCooldownDM(
                message.author,
                cooldownLocale,
                "general.message_cooldown_title",
                "general.message_cooldown",
                {
                  seconds: preQueueCooldownResult.remainingSeconds.toString(),
                  botName: earlyTomoriState.tomori_nickname,
                },
                footerKey,
              );
              log.info(
                `Message ${message.id} rejected before queuing due to cooldown. ${preQueueCooldownResult.remainingSeconds}s remaining.`,
              );
              return;
            }
          }

          // Rate limits already validated above, proceed with normal enqueueing
          lockEntry.messageQueue.push({
            message,
            isManuallyTriggered,
            forceReason,
            reasoningQuery,
            llmOverrideCodename,
            selectedPersonaId,
            isPersonaJob,
            isUserImpersonation: isUserImpersonation || undefined,
            impersonatedUserId,
            textQuotaSource,
            textQuotaTriggerKey: effectiveTextQuotaTriggerKey,
            textQuotaUserDiscId: effectiveTextQuotaUserDiscId,
            manualSystemPrompt,
            manualPrefill,
            injectedContextItems,
            forcedMentions,
            manualTriggerInvoker,
          });
          log.info(
            `Channel ${channelLockId} is busy (msg ${lockEntry.currentMessageId}). Enqueued message ${message.id}. Queue: ${lockEntry.messageQueue.length}. Tomori would reply (autoch_counter simulated as 0 for this check).`,
          );

          // 3. Send "busy" reply to the user if not the bot itself.
          // biome-ignore lint/style/noNonNullAssertion: client.user is checked during startup
          if (message.author.id !== client.user!.id) {
            try {
              const tempUserRow = await getCachedUserRow(userDiscId);
              const waitingLocale = tempUserRow?.language_pref ?? guild?.preferredLocale ?? "en-US";
              const currentMessageLink = lockEntry.currentMessageId
                ? isDMChannel
                  ? `https://discord.com/channels/@me/${channel.id}/${lockEntry.currentMessageId}`
                  : guild?.id
                    ? `https://discord.com/channels/${guild.id}/${channel.id}/${lockEntry.currentMessageId}`
                    : "a previous message"
                : "a previous message";

              // Void unused variables (kept for potential future re-enabling of busy embed)
              void tempUserRow;
              void waitingLocale;
              void currentMessageLink;

              /*
							const busyEmbed = createStandardEmbed(waitingLocale, {
								titleKey: "general.tomori_busy_title",
								descriptionKey: "general.tomori_busy_replying",
								descriptionVars: { message_link: currentMessageLink },
								color: ColorCode.INFO,
								flags: MessageFlags.Ephemeral,
							});
							await message.reply({ embeds: [busyEmbed] }).catch((e) => {
								log.error(
									// Rule 22
									"Failed to send ephemeral 'Tomori busy' reply",
									e,
									{
										userId: tempUserRow?.user_id,
										serverId: earlyTomoriState?.server_id, // Use original earlyTomoriState for accurate ID
										errorType: "EphemeralReplyError",
										metadata: {
											messageId: message.id,
											channelId: channel.id,
											currentMessageIdInQueue: lockEntry?.currentMessageId,
											userDiscId,
											guildDiscId: guild?.id || null, // null for DMs
											isDMChannel,
										},
									},
								);
							});*/
            } catch (e) {
              log.error(
                // Rule 22
                "Failed to prepare 'Tomori busy' ephemeral reply (state/locale error)",
                e,
                {
                  errorType: "BusyReplyPrepError",
                  metadata: {
                    messageId: message.id,
                    channelId: channel.id,
                    userDiscId,
                    guildDiscId: guild?.id || null, // null for DMs
                    isDMChannel,
                  },
                },
              );
            }
          }
        } else {
          // If locked, but Tomori wouldn't reply anyway (e.g., not setup, or message doesn't trigger,
          // even with simulated counter reset), then don't enqueue or send busy message.
          log.info(
            `Channel ${channelLockId} is busy (msg ${lockEntry.currentMessageId}), but message ${message.id} would not have triggered a reply from Tomori (autoch_counter simulated as 0 for this check). Ignoring for queue.`,
          );
        }
      } else {
        // earlyTomoriState is null, meaning Tomori is not set up on this server.
        // In this case, Tomori wouldn't reply anyway, so don't enqueue.
        log.info(
          `Channel ${channelLockId} is busy (msg ${lockEntry.currentMessageId}), but Tomori is not set up on this server (earlyTomoriState is null). Message ${message.id} ignored for queue.`,
        );
      }
      return; // Message enqueued, or ignored because Tomori wouldn't reply anyway.
    }

    // 5. Acquire the lock for the current message
    lockEntry.isLocked = true;
    lockEntry.lockedAt = Date.now();
    lockEntry.currentMessageId = message.id;
    lockEntry.userDiscId = userDiscId; // Track user for rate limiting
    lockEntry.currentIsPersonaJob = isPersonaJob;
    lockEntry.activePersonaId = selectedPersonaId;
    lockEntry.activeIsUserImpersonation = undefined; // Reset — set definitively after reply detection
    lockEntry.activeImpersonatedUserId = undefined; // Reset — set definitively after reply detection
    lockEntry.followUpEligible = false;
    lockEntry.isInToolCallChain = false;
    lockEntry.isCommandTriggered = !!manualTriggerInvoker; // Slash command triggers suppress follow-up interrupts
  }
  // --- End Semaphore Logic ---

  // 2. Load critical state data early to use throughout function
  try {
    try {
      // Load all personas (main + alters) for multi-persona support
      // For backward compatibility, we also get the main persona separately
      const allPersonas = await getCachedAllPersonas(serverDiscId);
      const mainPersona = allPersonas.find((p) => !p.is_alter) || null;
      const fallbackPersona = mainPersona ?? (allPersonas.length > 0 ? allPersonas[0] : null);
      let tomoriState = earlyLoadAttempted ? earlyTomoriState : fallbackPersona;
      let userRow = await getCachedUserRow(userDiscId);

      // Register user if they don't exist yet (first message interaction)
      if (!userRow) {
        const registrationLocale =
          manualTriggerInvoker?.locale ?? (message.guild?.preferredLocale.startsWith("ja") ? "ja" : "en-US");
        const registrationDisplayName = resolvePreferredDiscordDisplayName({
          memberDisplayName: manualTriggerInvoker?.member?.displayName ?? message.member?.displayName,
          user: manualTriggerInvoker ? { username: triggererUsername } : message.author,
          fallback: triggererUsername,
        });
        userRow = await registerUser(userDiscId, registrationDisplayName, registrationLocale);
      }

      locale = userRow?.language_pref ?? manualTriggerInvoker?.locale ?? "en-US"; // Set locale based on user pref

      const sendChannelEmbedOrFailImpersonation = async (
        options: StandardEmbedOptions,
        errorMessage: string,
        cause?: unknown,
      ): Promise<void> => {
        if (isUserImpersonation) {
          throw cause instanceof Error ? cause : new Error(errorMessage);
        }
        await sendStandardEmbed(channel, locale, options);
      };

      // Determine triggererName based on blacklist and personalization settings
      const isUserBlacklisted = await getCachedBlacklistStatus(serverDiscId, userDiscId);
      const serverPersonalizationDisabled = tomoriState?.config.personal_memories_enabled === false;
      const triggererDisplayName = isMatrixRelay
        ? stripBridgePrefix(message.author.username) || message.author.username
        : triggererUsername;

      // Use Discord username if user is blacklisted OR server personalization is disabled OR no custom nickname exists
      const triggererName =
        isUserBlacklisted || serverPersonalizationDisabled || !userRow?.user_nickname
          ? triggererDisplayName
          : userRow.user_nickname;

      // Create per-request snapshot to avoid redundant DB queries and ensure consistency
      // Get user's privacy level
      const userPrivacyLevel = await getCachedPrivacyLevel(userDiscId);
      const isUserOptedOut = userPrivacyLevel === PrivacyLevel.FULL; // Backward compat: Level 2 is FULL privacy

      // Preload guild member for presence lookups (only if not DM)
      let preloadedMember = null;
      if (!isDMChannel && guild) {
        preloadedMember = manualTriggerInvoker?.member ?? (await guild.members.fetch(userDiscId).catch(() => null));
      }

      // Create the snapshot
      const requestSnapshot: RequestSnapshot = {
        tomoriState: tomoriState ?? undefined,
        triggererUserRow: userRow ?? null,
        isTriggererBlacklisted: isUserBlacklisted,
        isTriggererOptedOut: isUserOptedOut,
        triggererPrivacyLevel: userPrivacyLevel, // NEW
        preloadedMember: preloadedMember,
      };

      log.info(
        `[Snapshot] Created per-request snapshot for message ${message.id} in ${isDMChannel ? "DM" : `server ${serverDiscId}`}`,
      );

      if (reminderRecipientID && !reminderData?.self_reminder) {
        const reminderForcedMentions = await buildForcedMentionsForUser(reminderRecipientID, client, guild ?? null);
        const mergedForcedMentions = mergeForcedMentions(forcedMentions, reminderForcedMentions);
        if (mergedForcedMentions.length > 0) {
          streamingContext.forcedMentions = mergedForcedMentions;
        }
      } else if (forcedMentions && forcedMentions.length > 0) {
        streamingContext.forcedMentions = mergeForcedMentions(forcedMentions);
      }

      const selectedPersona = selectedPersonaId
        ? (allPersonas.find((p) => p.tomori_id === selectedPersonaId) ?? fallbackPersona)
        : fallbackPersona;
      const isSelfMessage = isSelfTriggerMessage(message, allPersonas);
      const rawCascadeLimit = tomoriState?.config.cascade_limit ?? DEFAULT_CASCADE_LIMIT;
      const cascadeLimit = Math.min(Math.max(rawCascadeLimit, 0), MAX_CASCADE_LIMIT);
      const rawMatchLimit = tomoriState?.config.match_limit ?? DEFAULT_MATCH_LIMIT;
      const matchLimit = Math.min(Math.max(rawMatchLimit, MIN_MATCH_LIMIT), MAX_MATCH_LIMIT);
      let textQuotaStateForTrigger: TextQuotaTriggerState | null = null;

      if ((message.author.bot || message.webhookId) && !isSelfMessage && !isManuallyTriggered && !isMatrixRelay) {
        return;
      }

      const personalRoutingUserId =
        isSelfMessage && !isPersonaJob && !isManuallyTriggered && !isUserImpersonation
          ? null
          : (userRow?.user_id ?? null);
      let textCredentialSource: "server" | "personal" = "server";
      let personalTextProvider: string | null = null;

      if (tomoriState) {
        try {
          const textCreds = await resolveCapabilityCredentials(tomoriState.server_id, "text", {
            userId: personalRoutingUserId,
          });
          textCredentialSource = textCreds.source;
          personalTextProvider = textCreds.source === "personal" ? textCreds.provider : null;
        } catch (error) {
          if (error instanceof PersonalProviderRequiredError) {
            await sendChannelEmbedOrFailImpersonation(
              {
                color: ColorCode.ERROR,
                titleKey: "general.errors.personal_provider_required_title",
                descriptionKey: "general.errors.personal_provider_required_description",
              },
              "A personal provider was required before starting generation.",
              error,
            );
            return;
          }

          if (error instanceof CredentialUnavailableError) {
            if (
              error.reason === "missing_model_id" &&
              personalRoutingUserId === null &&
              tomoriState.config.user_byok_mode
            ) {
              log.info(
                `Skipping server-initiated turn in BYOK-only mode for server ${tomoriState.server_id} because no server text model is configured.`,
              );
              return;
            }

            const isPersonalError = error.source === "personal";
            const isMissingConfig = error.reason === "no_saved_config" || error.reason === "missing_model_id";
            await sendChannelEmbedOrFailImpersonation(
              {
                color: ColorCode.ERROR,
                titleKey: isPersonalError
                  ? "general.errors.personal_provider_credentials_error_title"
                  : isMissingConfig
                    ? "general.errors.api_key_missing_title"
                    : "general.errors.api_key_error_title",
                descriptionKey: isPersonalError
                  ? "general.errors.personal_provider_credentials_error_description"
                  : isMissingConfig
                    ? "general.errors.api_key_missing_description"
                    : "general.errors.api_key_error_description",
                ...(isDMChannel &&
                  !isPersonalError && {
                    footerKey: "general.errors.tomori_not_setup_dm_footer",
                  }),
              },
              "Text credential resolution failed before generation started.",
              error,
            );
            return;
          }

          throw error;
        }
      }

      const personaByNickname = new Map<string, TomoriState>();
      for (const persona of allPersonas) {
        const nicknameKey = persona.tomori_nickname?.toLowerCase();
        if (!nicknameKey || personaByNickname.has(nicknameKey)) continue;
        personaByNickname.set(nicknameKey, persona);
      }

      // Resolve the queued reply target name now that persona state is available.
      // The initial value used the raw Discord username (e.g. "Tomori(α)"), which is wrong
      // when the triggering message was sent by the bot itself or one of its webhook personas.
      if (isFromQueue) {
        if (message.author.id === client.user?.id) {
          // Direct bot account message — use the main persona's configured nickname
          queuedReplyTargetName = mainPersona?.tomori_nickname ?? tomoriState?.tomori_nickname ?? queuedReplyTargetName;
        } else if (message.webhookId) {
          // Webhook persona message — look up the persona by the webhook's display name
          const webhookName = stripBridgePrefix(message.author.username);
          queuedReplyTargetName =
            personaByNickname.get(webhookName.toLowerCase())?.tomori_nickname ?? queuedReplyTargetName;
        }
      }

      // Function to check for base trigger words - stays contained within the try block
      function checkForBaseTriggerWords(content: string): boolean {
        // Check for exact matches with word boundaries (case-insensitive)
        for (const baseWord of BASE_TRIGGER_WORDS) {
          // For Japanese characters, check if the content includes them directly
          if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(baseWord)) {
            if (content.includes(baseWord)) {
              return true;
            }
          } else {
            // For English triggers, use word boundaries to ensure it's a distinct word
            const regex = new RegExp(`\\b${escapeRegExp(baseWord)}\\b`, "i");
            if (regex.test(content)) {
              return true;
            }
          }
        }
        return false;
      }

      /**
       * Check if an embed title matches target localizer keys that should be processed as text.
       * Checks against all supported locales to handle cross-locale embed detection.
       * @param embedTitle - The embed title to check
       * @returns Object with isTarget boolean and the type of target found
       */
      function checkTargetEmbedTitle(embedTitle: string | null): {
        isTarget: boolean;
        type:
          | "memory_learning"
          | "reset"
          | "reminder_set"
          | "system_injection"
          | "compact_summary"
          | "compact_refresh"
          | "reward"
          | "punish"
          | null;
      } {
        if (!embedTitle) return { isTarget: false, type: null };

        const matchesLocalizedTitleTemplate = (template: string, actualTitle: string): boolean => {
          if (!template.includes("{")) {
            return actualTitle === template;
          }

          const pattern = new RegExp(`^${escapeRegExp(template).replace(/\\\{[^}]+\\\}/g, ".+?")}$`);
          return pattern.test(actualTitle);
        };

        // Check against all supported locales to handle cross-locale scenarios
        // (e.g., Japanese user creates reset embed, English user should still detect it)
        for (const supportedLocale of getSupportedLocales()) {
          // Target localizer keys for memory learning embeds
          const memoryLearningTitles = [
            localizer(supportedLocale, "genai.self_teach.server_memory_learned_title"),
            localizer(supportedLocale, "genai.self_teach.server_memory_updated_title"),
            localizer(supportedLocale, "genai.self_teach.server_memory_deleted_title"),
            localizer(supportedLocale, "genai.self_teach.personal_memory_learned_title"),
            localizer(supportedLocale, "genai.self_teach.personal_memory_updated_title"),
            localizer(supportedLocale, "genai.self_teach.personal_memory_deleted_title"),
          ];

          const reminderSetTitles = [
            localizer(supportedLocale, "reminders.reminder_set_title"),
            localizer(supportedLocale, "reminders.recurring_task_set_title"),
            localizer(supportedLocale, "reminders.task_set_title"),
          ];

          const isMemoryLearning = memoryLearningTitles.some((title) =>
            matchesLocalizedTitleTemplate(title, embedTitle),
          );

          // Target localizer key for conversation reset
          const resetTitle = localizer(supportedLocale, "commands.tool.refresh.title");

          // Target localizer key for system message injection
          const systemInjectionTitle = localizer(supportedLocale, "commands.bot.impersonate.system_title");
          // Reward embed titles — dynamically discovered from locale sub-keys
          // so new reward commands are automatically recognized without updating this list
          const rewardNames = getLocaleSubKeys(supportedLocale, "commands.reward");
          const rewardTitles = rewardNames
            .map((name) => localizer(supportedLocale, `commands.reward.${name}.embed_title`))
            .filter((title) => !title.includes(".")); // Filter out unresolved keys
          const punishNames = getLocaleSubKeys(supportedLocale, "commands.punish");
          const punishTitles = punishNames
            .map((name) => localizer(supportedLocale, `commands.punish.${name}.embed_title`))
            .filter((title) => !title.includes("."));
          const compactSummaryTitle = localizer(supportedLocale, "commands.tool.compact.summary_title");
          const compactSummaryTitleRefreshed = localizer(
            supportedLocale,
            "commands.tool.compact.summary_title_refreshed",
          );
          const compactSceneTitle = localizer(supportedLocale, "commands.tool.compact.roleplay_scene_title");
          const compactSceneTitleRefreshed = localizer(
            supportedLocale,
            "commands.tool.compact.roleplay_scene_title_refreshed",
          );
          const compactCharacterTitlePrefix = localizer(
            supportedLocale,
            "commands.tool.compact.roleplay_character_title_prefix",
          );

          // Check for memory learning embeds
          if (isMemoryLearning) {
            return { isTarget: true, type: "memory_learning" };
          }

          // Check for reset embed
          if (embedTitle === resetTitle) {
            return { isTarget: true, type: "reset" };
          }
          // Check for system injection embed
          if (embedTitle === systemInjectionTitle) {
            return { isTarget: true, type: "system_injection" };
          }
          // Check for reward embeds (headpat, hug, kiss, tickle)
          if (rewardTitles.some((title) => embedTitle === title)) {
            return { isTarget: true, type: "reward" };
          }
          if (punishTitles.some((title) => embedTitle === title)) {
            return { isTarget: true, type: "punish" };
          }
          // Check for compact summary embeds (conversation/scene)
          if (embedTitle === compactSummaryTitle || embedTitle === compactSceneTitle) {
            return { isTarget: true, type: "compact_summary" };
          }

          // Check for compact refresh embeds (reset marker)
          if (embedTitle === compactSummaryTitleRefreshed || embedTitle === compactSceneTitleRefreshed) {
            return { isTarget: true, type: "compact_refresh" };
          }

          // Check for compact roleplay character embeds by prefix match
          if (compactCharacterTitlePrefix && embedTitle.startsWith(compactCharacterTitlePrefix)) {
            return { isTarget: true, type: "compact_summary" };
          }

          // Check for reminder set confirmation embeds (all types)
          if (reminderSetTitles.some((title) => matchesLocalizedTitleTemplate(title, embedTitle))) {
            return { isTarget: true, type: "reminder_set" };
          }
        }

        // EXTENSIBILITY EXAMPLE: Adding new embed types is easy!
        // 1. Add new type to union: 'memory_learning' | 'reset' | 'reminder_set' | 'new_type' | null
        // 2. Add new localizer checks inside the locale loop:
        // const newTypeTitles = [
        // ];
        // if (newTypeTitles.some(title => embedTitle === title)) {
        //     return { isTarget: true, type: 'new_type' };
        // }

        return { isTarget: false, type: null };
      }

      /**
       * Process link preview embeds to extract text and image content for AI context.
       * Detects automatic Discord embeds generated from links (Twitter, YouTube, articles, etc.)
       * @param embed - The Discord embed to process
       * @returns Object with extracted content and image information
       */
      function processLinkEmbed(embed: Embed): {
        isLinkPreview: boolean;
        textContent: string | null;
        imageInfo: {
          url: string;
          proxyUrl: string;
          mimeType: string | null;
          filename: string;
        } | null;
        thumbnailInfo: {
          url: string;
          proxyUrl: string;
          mimeType: string | null;
          filename: string;
        } | null;
      } {
        // 1. Check if this embed has any meaningful content to extract
        const hasContent =
          embed.url || embed.title || embed.description || embed.author?.name || embed.fields.length > 0;
        if (!hasContent) {
          return {
            isLinkPreview: false,
            textContent: null,
            imageInfo: null,
            thumbnailInfo: null,
          };
        }

        // 2. Skip system embeds that we already process elsewhere
        const embedCheck = checkTargetEmbedTitle(embed.title);
        if (embedCheck.isTarget) {
          return {
            isLinkPreview: false,
            textContent: null,
            imageInfo: null,
            thumbnailInfo: null,
          };
        }

        // 3. Extract all text content from the embed
        let textContent = "";

        // Build content parts from all available embed fields
        const contentParts: string[] = [];

        // 3a. Author name (e.g., "Now Playing", Twitter handle via webhook)
        if (embed.author?.name) {
          contentParts.push(embed.author.name);
        }
        // 3b. Title (e.g., page title, song name)
        if (embed.title) {
          contentParts.push(embed.title);
        }
        // 3c. Description (e.g., tweet text, page summary)
        if (embed.description) {
          const maxDescLength = 500;
          const description =
            embed.description.length > maxDescLength
              ? `${embed.description.substring(0, maxDescLength)}...`
              : embed.description;
          contentParts.push(description);
        }
        // 3d. Structured fields (e.g., "Duration: 3:45", "Likes: 500")
        if (embed.fields.length > 0) {
          for (const field of embed.fields) {
            // Only include non-empty fields
            if (field.name || field.value) {
              contentParts.push(
                field.name && field.value ? `${field.name}: ${field.value}` : field.name || field.value,
              );
            }
          }
        }

        // Format with "Link Content:" prefix if we have any content
        if (contentParts.length > 0) {
          textContent = `[System: Link preview embed content: ${contentParts.join(" - ")}]`;
        }

        // 4. Process embed image if present
        let imageInfo = null;
        if (embed.image?.url) {
          try {
            // Generate filename from URL or use generic name
            const imageUrl = new URL(embed.image.url);
            let filename = imageUrl.pathname.split("/").pop() || "embed_image";

            // Handle social media image URLs with size suffixes (e.g., :large, :medium, :small)
            // Twitter: G0EdxONbMAAiJJG.jpg:large -> G0EdxONbMAAiJJG.jpg
            filename = filename.replace(/:(large|medium|small|orig)$/, "");

            // Determine MIME type based on file extension
            let mimeType = "image/jpeg"; // Default to JPEG for most social media images
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

            // Ensure filename has extension
            if (!filename.includes(".")) {
              filename = `${filename}.jpg`;
            }

            imageInfo = {
              url: embed.image.url,
              proxyUrl: embed.image.proxyURL || embed.image.url,
              mimeType: mimeType,
              filename: filename,
            };
          } catch (_error) {
            // Silently handle URL parsing errors for embed images
          }
        }

        // 5. Process embed thumbnail if present (and no main image)
        let thumbnailInfo = null;
        if (embed.thumbnail?.url && !imageInfo) {
          try {
            const thumbnailUrl = new URL(embed.thumbnail.url);
            let filename = thumbnailUrl.pathname.split("/").pop() || "embed_thumbnail";

            // Handle social media thumbnail URLs with size suffixes
            filename = filename.replace(/:(large|medium|small|orig)$/, "");

            // Determine MIME type based on file extension
            let mimeType = "image/jpeg"; // Default to JPEG
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

            // Ensure filename has extension
            if (!filename.includes(".")) {
              filename = `${filename}.jpg`;
            }

            thumbnailInfo = {
              url: embed.thumbnail.url,
              proxyUrl: embed.thumbnail.proxyURL || embed.thumbnail.url,
              mimeType: mimeType,
              filename: filename,
            };
          } catch (_error) {
            // Silently handle URL parsing errors for embed thumbnails
          }
        }

        return {
          isLinkPreview: true,
          textContent: textContent.trim() || null,
          imageInfo,
          thumbnailInfo,
        };
      }

      // 3. Enhanced direct trigger checks (base words or direct reply)
      let isReplyToBot = false;
      let replyPersona: TomoriState | null = null;
      let isBaseTriggerWord = false;

      // Check if message is a reply to the bot
      if (message.reference?.messageId) {
        try {
          const referenceMessage = await message.channel.messages.fetch(message.reference.messageId);
          if (referenceMessage) {
            if (referenceMessage.author.id === client.user?.id) {
              isReplyToBot = true;
            } else if (referenceMessage.webhookId) {
              const webhookReplyTarget = resolveReferencedWebhookTarget(referenceMessage, personaByNickname, guild);

              if (webhookReplyTarget.replyPersona) {
                replyPersona = webhookReplyTarget.replyPersona;
              } else if (webhookReplyTarget.impersonatedUserId) {
                isReplyToBot = true;
                isUserImpersonation = true;
                impersonatedUserId = webhookReplyTarget.impersonatedUserId;
                log.info(`Reply ${message.id} matched user impersonation webhook. Target user: ${impersonatedUserId}`);
              }
            }
          }
        } catch (fetchError) {
          log.warn("Could not fetch reference message for reply check", fetchError);
        }
      }

      const isReplyToPersona = isReplyToBot || !!replyPersona;

      // Check for base trigger words
      isBaseTriggerWord = checkForBaseTriggerWords(message.content);

      // Check if bot was mentioned
      const isBotMentioned = !!(client.user && message.mentions.users.has(client.user.id));

      // 4. Early validation for directly triggered messages or manual triggers (including DMs)
      // For DMs, always validate regardless of content since all DM messages should trigger responses
      if (
        isBaseTriggerWord ||
        isReplyToPersona ||
        isBotMentioned ||
        isManuallyTriggered ||
        (isDMChannel && message.author.id !== client.user?.id)
      ) {
        // If user directly mentioned Tomori, replied to it, mentioned the bot, or manually triggered (DMs), validate state

        // Validate Tomori is set up
        if (!tomoriState) {
          const contextMessage = isDMChannel
            ? `User tried to use Tomori in DM but no Tomori instance found for user ${userDiscId}.`
            : `User mentioned Tomori in server ${serverDiscId} but Tomori not set up.`;
          log.info(contextMessage);

          // Check if this is a transient DB error (e.g. during deployment)
          // rather than the server genuinely not being set up
          const dbError = getLastDbError(serverDiscId);
          if (dbError) {
            await sendStandardEmbed(channel, locale, {
              color: ColorCode.WARN,
              titleKey: "general.errors.tomori_updating_title",
              descriptionKey: "general.errors.tomori_updating_description",
            });
          } else {
            await sendStandardEmbed(channel, locale, {
              color: ColorCode.ERROR,
              titleKey: "general.errors.tomori_not_setup_title",
              descriptionKey: "general.errors.tomori_not_setup_description",
              ...(isDMChannel && {
                footerKey: "general.errors.tomori_not_setup_dm_footer",
              }),
            });
          }
          return;
        }

        // Server text credentials may be intentionally absent when a member uses
        // a personal provider or the server runs in BYOK mode. Final credential
        // resolution happens after the trigger path is known.
        if (!tomoriState.config.api_key) {
          const contextMessage = isDMChannel
            ? `No server API key configured for DM user ${userDiscId}; deferring final credential resolution.`
            : `No server API key configured for server ${serverDiscId}; deferring final credential resolution.`;
          log.info(contextMessage);
        }
      } else if (!tomoriState) {
        // For non-direct messages, just log and return if Tomori isn't set up
        // log.info(`Tomori state not found for server ${serverDiscId}. Skipping non-triggered message.`); // Reduce noise
        return;
      }

      // 5. Auto-Counter Update (only needs to happen if Tomori is set up)
      const config = tomoriState.config;
      if (!isDMChannel && config.thought_log_channel_disc_id && config.thought_log_channel_disc_id === channel.id) {
        log.info(`Skipping normal chat trigger in configured thought-log channel ${channel.id}.`);
        return;
      }

      const { minThreshold, maxThreshold } = getAutochatRange(config);
      // Threads inherit autochat settings from their parent channel.
      const effectiveChannelId = channel.isThread() ? (channel.parentId ?? channel.id) : channel.id;
      const isAutoCounterChannelActive = isAutochatCounterChannelActive(config, effectiveChannelId);

      if (isRealUserMessage && isAutoCounterChannelActive) {
        if (!tomoriState.tomori_id) {
          log.error(`Tomori ID missing for server ${serverDiscId} during counter increment.`);
        } else {
          try {
            const updatedTomoriRow = await incrementTomoriCounter(tomoriState.tomori_id, minThreshold, maxThreshold);
            if (updatedTomoriRow) {
              tomoriState.autoch_counter = updatedTomoriRow.autoch_counter;
              tomoriState.autoch_next_target = updatedTomoriRow.autoch_next_target;
              log.info(
                `Auto-message counter updated for server ${serverDiscId}. New value: ${tomoriState.autoch_counter}/${tomoriState.autoch_next_target}`,
              );
            } else {
              log.warn(`Failed to update auto-message counter for server ${serverDiscId}.`);
            }
          } catch (dbError) {
            log.error(`Error updating auto-message counter for server ${serverDiscId}`, dbError);
          }
        }
      }

      // Pre-compute channel context shared by the whitelist, spotlight, persona selection,
      // and cooldown checks below
      const msgIsThread = "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
      const msgParentChannelId = msgIsThread && "parent" in channel ? channel.parent?.id : undefined;
      // Autochat-override channels (auto-trigger, always-reply) bypass the whitelist gate —
      // computed here so it is in scope for both the whitelist and cooldown checks below
      const msgEffectiveChannelId = msgParentChannelId ?? message.channelId;
      const isAutochatOverride = isAutochatOverrideChannel(tomoriState.config, msgEffectiveChannelId);

      // 6.5. Check whitelist + personal spotlight status.
      // Automatic self-trigger chains still skip the channel/role gate, but manual turns
      // are always enforced and persona whitelist metadata is loaded for all non-stop turns.
      let whitelistStatus: Awaited<ReturnType<typeof getCachedWhitelistStatus>> | null = null;
      let personalSpotlightStatus: Awaited<ReturnType<typeof getCachedPersonalSpotlightStatus>> | null = null;
      if (!isStopResponse) {
        const memberRoleDiscIds = manualTriggerInvoker?.member
          ? manualTriggerInvoker.member.roles.cache.map((role) => role.id)
          : (message.member?.roles.cache.map((role) => role.id) ?? undefined);
        whitelistStatus = await getCachedWhitelistStatus(
          guild?.id ?? message.author.id,
          message.channelId,
          memberRoleDiscIds,
          msgParentChannelId,
        );
        personalSpotlightStatus =
          !isDMChannel && userRow?.user_id
            ? await getCachedPersonalSpotlightStatus(tomoriState.server_id, userRow.user_id, msgEffectiveChannelId)
            : null;

        // If whitelist rules block this trigger, silently ignore
        // Exception: autochat-override channels are always allowed regardless of whitelist policy
        const shouldEnforceWhitelistGate = isManuallyTriggered || !isSelfMessage;
        if (shouldEnforceWhitelistGate && !whitelistStatus.isTriggerAllowed && !isAutochatOverride) {
          log.info(
            `Message ${message.id} in channel ${message.channelId} rejected by whitelist policy (${whitelistStatus.blockReason ?? "unknown"})`,
          );
          return; // Silent rejection
        }
      }

      const allowedPersonaIds =
        whitelistStatus?.hasActivePersonaWhitelist || personalSpotlightStatus
          ? new Set(
              allPersonas.flatMap((persona) =>
                typeof persona.tomori_id === "number" &&
                isPersonaAllowedForTrigger(whitelistStatus, personalSpotlightStatus, persona.tomori_id)
                  ? [persona.tomori_id]
                  : [],
              ),
            )
          : null;

      // 6.75. Determine if Bot Should Reply using shouldBotReply helper.
      // Skip check if this is a manual command trigger.
      if (
        !isManuallyTriggered &&
        !shouldBotReply(message, tomoriState, allPersonas, {
          personalAutoTriggerPersonaId: personalSpotlightStatus?.autoTriggerPersonaId ?? null,
          allowedPersonaIds,
        })
      ) {
        return;
      }

      // 7. Multi-Persona: Determine which personas should respond
      // For manual triggers, respond with the selected persona (if provided)
      // For reminders/stop responses, only the main persona responds
      let personasToRespond: TomoriState[];
      if (isManuallyTriggered) {
        if (
          selectedPersona &&
          isPersonaAllowedForTrigger(whitelistStatus, personalSpotlightStatus, selectedPersona.tomori_id)
        ) {
          personasToRespond = [selectedPersona];
        } else {
          if (selectedPersona && (whitelistStatus?.hasActivePersonaWhitelist || personalSpotlightStatus)) {
            log.info(
              `Manual trigger for persona ${selectedPersona.tomori_id ?? "unknown"} in channel ${message.channelId} rejected by persona access rules`,
            );
          }
          personasToRespond = [];
        }
      } else if (reminderRecipientID || reminderData?.self_reminder || isStopResponse) {
        // Only main persona for reminders and stop responses
        personasToRespond = tomoriState ? [tomoriState] : [];
        if (!isStopResponse && personasToRespond.length > 0) {
          personasToRespond = personasToRespond.filter((persona) =>
            isPersonaAllowedForTrigger(whitelistStatus, personalSpotlightStatus, persona.tomori_id),
          );
        }
      } else {
        // Check if the shared auto-chat range hit for this message
        const config = tomoriState?.config;
        const personalAutoTriggerPersonaId = isPersonaAllowedForTrigger(
          whitelistStatus,
          personalSpotlightStatus,
          personalSpotlightStatus?.autoTriggerPersonaId ?? null,
        )
          ? (personalSpotlightStatus?.autoTriggerPersonaId ?? null)
          : null;
        const isPersonalAutoTriggerActive =
          personalAutoTriggerPersonaId !== null && isAutochatQualifyingMessage(message, isSelfMessage);
        const isAutoMsgHit =
          !!config &&
          !isPersonalAutoTriggerActive &&
          isAutochatQualifyingMessage(message, isSelfMessage) &&
          isAutochatCounterHit(tomoriState, effectiveChannelId);
        const serverAutoTriggerPersonaId = config ? getAutochatAssignedPersonaId(config, effectiveChannelId) : null;
        const effectiveAutoTriggerPersonaId = personalAutoTriggerPersonaId ?? serverAutoTriggerPersonaId;
        const isAutochatConfigured = !!config && isAutochatConfiguredChannel(config, effectiveChannelId);
        const isScopedAlwaysReplyActive =
          !!config &&
          isAutochatAlwaysReplyChannelActive(config, effectiveChannelId) &&
          isAutochatQualifyingMessage(message, isSelfMessage);
        // Resolve DTM for this user using the three-state personal preference:
        //   'off'    → DTM disabled regardless of server setting
        //   'follow' → DTM mirrors the server setting (default)
        //   'on'     → DTM enabled regardless of server setting
        const serverDtmEnabled = !!config?.deliberate_trigger_mode;
        const personalDtmMode = userRow?.personal_dtm ?? "follow";
        const userDtmEnabled = personalDtmMode === "on" || (personalDtmMode === "follow" && serverDtmEnabled);
        const isDtmActive = userDtmEnabled && !!message.guild && !isMatrixRelay;

        // Check if always-reply mode applies to this message:
        // Must be enabled, must be a real user message (not bot/webhook/self), and in a guild channel
        const isAlwaysReplyActive =
          (!!config?.always_reply_enabled && isAutochatQualifyingMessage(message, isSelfMessage)) ||
          isScopedAlwaysReplyActive ||
          isPersonalAutoTriggerActive;

        // Determine matching personas using the helper function
        personasToRespond = determineMatchingPersonas(
          message,
          allPersonas,
          client,
          isReplyToBot,
          replyPersona,
          isBotMentioned,
          !!isAutoMsgHit, // Convert to boolean
          isAlwaysReplyActive,
          effectiveAutoTriggerPersonaId,
          isPersonalAutoTriggerActive
            ? personalAutoTriggerPersonaId
            : isScopedAlwaysReplyActive
              ? serverAutoTriggerPersonaId
              : null,
          isDtmActive,
          isAutochatConfigured || isPersonalAutoTriggerActive,
          allowedPersonaIds,
        );

        // Consecutive persona filter: prevent the same persona from triggering in
        // back-to-back depth levels. E.g. if C responded last at depth N, skip C at depth N+1.
        if (isSelfMessage && personasToRespond.length > 0) {
          const lastRespondedId = getLastRespondedPersonaId(channel.id);
          if (lastRespondedId != null) {
            const before = personasToRespond.length;
            personasToRespond = personasToRespond.filter((p) => p.tomori_id !== lastRespondedId);
            if (personasToRespond.length < before) {
              const skippedPersona = allPersonas.find((p) => p.tomori_id === lastRespondedId);
              log.info(
                `Consecutive persona filter: skipped "${skippedPersona?.tomori_nickname ?? lastRespondedId}" (last responder) for message ${message.id} in channel ${channel.id}`,
              );
            }
          }
        }

        // Apply per-message match limit cap for automatic trigger matching.
        if (personasToRespond.length > matchLimit) {
          const droppedPersonas = personasToRespond
            .slice(matchLimit)
            .map((p) => p.tomori_nickname)
            .join(", ");
          personasToRespond = personasToRespond.slice(0, matchLimit);
          log.info(
            `Match limit cap applied (${matchLimit}) for message ${message.id}. Dropped personas: ${droppedPersonas || "none"}`,
          );
        }
      }

      // If no personas match, return early
      if (personasToRespond.length === 0) {
        log.info(`No personas matched trigger for message ${message.id} in server ${serverDiscId}`);
        return;
      }

      if (!skipLock && !isStopResponse && !isPersonaJob) {
        const shouldExcludeCurrent =
          lockEntry?.currentMessageId === message.id &&
          lockEntry?.userDiscId === userDiscId &&
          !lockEntry?.currentIsPersonaJob;
        const adjustment = shouldExcludeCurrent ? -1 : 0;
        const rateLimitAllowed = await enforceGlobalRateLimit({
          userDiscId,
          serverDiscId,
          channel,
          guild,
          client,
          messageId: message.id,
          userActiveCountAdjustment: adjustment,
          serverActiveCountAdjustment: adjustment,
        });
        if (!rateLimitAllowed) {
          return;
        }
      }

      // 8. Check message trigger cooldown (skip for stop responses and self messages)
      if (!isStopResponse && !isSelfMessage && textCredentialSource !== "personal") {
        const cooldownResult = await checkMessageTriggerCooldownWithWhitelist(
          guild?.id ?? message.author.id,
          cooldownUserDiscId,
          message.channelId,
          tomoriState.config.cooldown_type ?? CooldownType.OFF,
          message.member,
          isAutochatOverride,
        );
        if (cooldownResult.isOnCooldown) {
          // Send cooldown warning via DM
          const footerKey = getCooldownTypeFooterKey(cooldownResult.cooldownType);
          await sendCooldownDM(
            message.author,
            locale,
            "general.message_cooldown_title",
            "general.message_cooldown",
            {
              seconds: cooldownResult.remainingSeconds.toString(),
              botName: tomoriState.tomori_nickname,
            },
            footerKey,
          );
          log.info(
            `Message trigger cooldown active for ${
              cooldownResult.cooldownType === CooldownType.PER_USER
                ? `user ${cooldownUserDiscId}`
                : cooldownResult.cooldownType === CooldownType.PER_CHANNEL
                  ? `channel ${message.channelId}`
                  : `server ${serverDiscId}`
            }. ${cooldownResult.remainingSeconds}s remaining.`,
          );
          return;
        }
      }

      log.info(`Conditions met for reply in server ${serverDiscId}`);

      // 8.5. Set message trigger cooldown (skip for stop responses and self messages)
      // Set early to prevent race conditions with concurrent triggers
      if (!isStopResponse && !isSelfMessage && textCredentialSource !== "personal") {
        await setMessageTriggerCooldownWithWhitelist(
          guild?.id ?? message.author.id,
          cooldownUserDiscId,
          message.channelId,
          tomoriState.config.cooldown_type ?? CooldownType.OFF,
          tomoriState.config.cooldown_length ?? 5,
          message.member,
        );
      }

      if (lockEntry) {
        lockEntry.activePersonaId = personasToRespond[0]?.tomori_id ?? undefined;
        lockEntry.followUpEligible = lockEntry.activePersonaId !== undefined;
        // Persist user impersonation state so follow-up interrupts can inherit it
        lockEntry.activeIsUserImpersonation = isUserImpersonation || undefined;
        lockEntry.activeImpersonatedUserId = impersonatedUserId;
      }

      // 8.52. Check text generation quota for user-triggered guild responses
      const shouldApplyTextQuota =
        textQuotaSource === "user" &&
        !isDMChannel &&
        !isStopResponse &&
        !reminderRecipientID &&
        !reminderData?.self_reminder &&
        textCredentialSource !== "personal";

      if (shouldApplyTextQuota) {
        const existingTextQuotaState = textQuotaTriggerStates.get(effectiveTextQuotaTriggerKey);

        if (!isPersonaJob) {
          if (!existingTextQuotaState) {
            const quotaCheck = await checkTextQuota(tomoriState.server_id, effectiveTextQuotaUserDiscId);

            if (!quotaCheck.allowed) {
              const resetInfo = buildTextQuotaResetInfo(locale, quotaCheck);
              let descriptionKey = "genai.text_quota_exceeded_description";

              if (quotaCheck.reason === "user_quota_exceeded") {
                descriptionKey = "genai.text_user_quota_exceeded_description";
              } else if (quotaCheck.reason === "serverwide_quota_exceeded") {
                descriptionKey = "genai.text_serverwide_quota_exceeded_description";
              }

              await sendStandardEmbed(channel, locale, {
                color: ColorCode.ERROR,
                titleKey: "genai.text_quota_exceeded_title",
                descriptionKey,
                descriptionVars: {
                  reset_info: resetInfo,
                },
                footerKey: "genai.text_quota_exceeded_footer",
              });
              return;
            }

            textQuotaStateForTrigger = {
              serverId: tomoriState.server_id,
              userDiscId: effectiveTextQuotaUserDiscId,
              consumed: false,
              createdAt: Date.now(),
            };
            textQuotaTriggerStates.set(effectiveTextQuotaTriggerKey, textQuotaStateForTrigger);
          } else {
            textQuotaStateForTrigger = existingTextQuotaState;
          }
        } else if (existingTextQuotaState) {
          // Internal persona jobs must not check quota independently, but
          // they can consume the already-approved trigger slot on first success.
          textQuotaStateForTrigger = existingTextQuotaState;
        }
      }

      // 2. Cascade trigger count check: applies to automatic bot-to-bot triggers AND persona jobs.
      //    The very first user message bypasses this, establishing the start of the chain.
      if ((isSelfMessage || isPersonaJob) && !reminderRecipientID && !reminderData?.self_reminder && !isStopResponse) {
        const triggerState = getSelfReplyChainState(channel.id);
        // The absolute maximum number of bot responses in a chain is cascadeLimit + 1 (1 free + cascadeLimit additional)
        if (triggerState.triggerCount >= cascadeLimit + 1) {
          log.info(
            `Cascade trigger limit reached (total responses: ${triggerState.triggerCount} >= ${cascadeLimit + 1}). Skipping message ${message.id} in channel ${channel.id}.`,
          );
          return;
        }
      }

      log.info(
        `${personasToRespond.length} persona(s) will respond to message ${message.id}: ${personasToRespond.map((p) => p.tomori_nickname).join(", ")}`,
      );

      // 8.55. Multi-Persona Queueing: enqueue additional personas as jobs
      // Use the existing queue to process personas sequentially so later personas can see earlier responses.
      if (
        !isManuallyTriggered &&
        !reminderRecipientID &&
        !isStopResponse &&
        personasToRespond.length > 1 &&
        lockEntry
      ) {
        const [firstPersona, ...remainingPersonas] = personasToRespond;
        const personasToQueue: Array<{
          persona: TomoriState;
          selectedPersonaId: number;
        }> = [];
        const personasToHandleNow: TomoriState[] = [firstPersona];

        for (const persona of remainingPersonas) {
          if (persona.tomori_id) {
            personasToQueue.push({
              persona,
              selectedPersonaId: persona.tomori_id,
            });
          } else {
            log.warn(
              `Persona "${persona.tomori_nickname}" is missing tomori_id; handling in current pass instead of queueing.`,
            );
            personasToHandleNow.push(persona);
          }
        }

        if (personasToQueue.length > 0) {
          // Insert queued persona jobs at the front so they run before other queued messages.
          for (let i = personasToQueue.length - 1; i >= 0; i--) {
            const queuedPersona = personasToQueue[i];
            lockEntry.messageQueue.unshift({
              message,
              isManuallyTriggered: true,
              forceReason,
              reasoningQuery,
              llmOverrideCodename,
              selectedPersonaId: queuedPersona.selectedPersonaId,
              isPersonaJob: true,
              textQuotaSource,
              textQuotaTriggerKey: effectiveTextQuotaTriggerKey,
              textQuotaUserDiscId: effectiveTextQuotaUserDiscId,
              injectedContextItems,
              forcedMentions,
            });
          }

          log.info(
            `Queued ${personasToQueue.length} persona job(s) for message ${message.id}: ${personasToQueue
              .map((p) => p.persona.tomori_nickname)
              .join(", ")}`,
          );
        }

        personasToRespond = personasToHandleNow;
      }

      // 8.6. Multi-Persona: Get/create webhook for multi-avatar responses
      // Only create webhook if we have alters responding (main persona uses regular bot messages)
      const hasAlters = personasToRespond.some((p) => p.is_alter);
      let channelWebhook: Webhook | null = null;
      let webhookErrorReason: WebhookCreateErrorReason | undefined;
      let webhookErrorNotified = false;
      // Support both text channels and threads
      const supportsWebhooks =
        channel.type === ChannelType.GuildText ||
        channel.type === ChannelType.PublicThread ||
        channel.type === ChannelType.PrivateThread ||
        channel.type === ChannelType.AnnouncementThread;
      const isWebhookThread = "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
      const webhookTargetChannel = isWebhookThread && channel.parent ? channel.parent : channel;
      const hasWebhookMethods =
        !!webhookTargetChannel && "fetchWebhooks" in webhookTargetChannel && "createWebhook" in webhookTargetChannel;

      if (hasAlters && supportsWebhooks && hasWebhookMethods) {
        const webhookResult = await getOrCreateWebhook(webhookTargetChannel as BaseGuildTextChannel);
        channelWebhook = webhookResult.webhook;
        webhookErrorReason = webhookResult.errorReason;

        if (!channelWebhook && webhookErrorReason) {
          await sendWebhookErrorEmbed(channel, locale, webhookErrorReason);
          webhookErrorNotified = true;
        }
      }

      // 9. Prepare Data for buildContext
      if (!skipLock && lockEntry) {
        await startDiscordTypingKeepalive(channel, lockEntry, message.id);
      } else {
        await refreshDiscordTypingIndicator(channel, "pre_context_build");
      }

      /**
       * Fetch recent message history for context building.
       * Note: We always fetch from API rather than relying on cache to ensure we have
       * the most recent consecutive messages in correct order. Cache may contain gaps
       * or out-of-order messages from gateway events.
       */
      const messageFetchLimit = normalizeMessageFetchLimit(tomoriState.config.message_fetch_limit);
      const fetchedMessages = await channel.messages.fetch({
        limit: messageFetchLimit,
      });

      // Convert to array and reverse to get chronological order (oldest first)
      const messagesArray = Array.from(fetchedMessages.values()).reverse();

      // MODIFIED: If processing a message from the queue, ensure it's treated as the latest message for context
      const queuedMessageId = message.id;
      const indexOfQueuedMessage = messagesArray.findIndex((m) => m.id === queuedMessageId);

      if (isFromQueue) {
        if (indexOfQueuedMessage !== -1) {
          // The queued message is already in its correct chronological position
          // Discord message IDs (snowflakes) are chronologically ordered by design
          // We respect the natural order to maintain proper conversation flow
          log.info(
            `Queued message ${queuedMessageId} found in history at index ${indexOfQueuedMessage}. Respecting natural chronological order.`,
          );
        } else {
          // 3. If not found (e.g., older than the configured fetch limit or deleted), append the current 'message' object.
          // This ensures its content is present, though its original surrounding history might be incomplete.
          messagesArray.push(message as Message<true>);
          log.warn(
            `Queued message ${queuedMessageId} not found in fetched history. Appending current message object directly. This might occur if it's older than ${messageFetchLimit} messages or was deleted.`,
          );
        }
      }

      // 8. Find the index of the *last* reset message (most recent)
      // This message could be from the bot (confirmation embed) or a user command
      let resetIndex = -1;
      let resetType: "reset" | "compact_refresh" | null = null;
      for (let i = messagesArray.length - 1; i >= 0; i--) {
        const msg = messagesArray[i];

        // Check if *any* embed in the message contains a reset title using localizer
        let embedContainsReset = false;
        for (const embed of msg.embeds) {
          const embedCheck = checkTargetEmbedTitle(embed.title);
          if (embedCheck.isTarget && (embedCheck.type === "reset" || embedCheck.type === "compact_refresh")) {
            embedContainsReset = true;
            resetType = embedCheck.type === "compact_refresh" ? "compact_refresh" : "reset";
            break;
          }
        }

        // If an embed contains the marker, this is our reset point
        if (embedContainsReset) {
          resetIndex = i;
          const resetNote =
            resetType === "compact_refresh"
              ? "History will start from this message."
              : "History will start after this message.";
          log.info(
            `Reset marker detected in message content or embed at index ${i} from ${msg.author.username}. ${resetNote}`,
          );
          // Found the most recent reset marker, stop searching
          break;
        }
      }

      // 9. Determine the messages to include in the history
      const startIndex = resetIndex === -1 ? 0 : resetType === "compact_refresh" ? resetIndex : resetIndex + 1;
      const relevantMessagesArray = messagesArray.slice(startIndex);

      // Pre-populate the voice transcript cache for audio messages in history.
      // This runs STT (if needed) before the simplifiedMessages loop so that
      // subsequent cache lookups in the loop are synchronous and fast.
      // Only user messages are STT'd; bot/webhook messages are skipped.
      // Skip entirely in chat mode — transcripts are already posted as chat
      // messages and the cache is not used in that mode.
      if (earlyTomoriState && !(earlyTomoriState.config?.voice_transcript_chat_mode ?? false)) {
        for (const msg of relevantMessagesArray) {
          // 1. Skip bots and webhooks — only user audio is STT'd
          if (msg.author.bot || msg.webhookId) continue;
          // 2. Skip if already cached (current-turn message was cached above)
          if (getCachedVoiceTranscript(msg.id)) continue;
          // 3. Run STT only if the message has at least one audio attachment
          const hasAudio = [...msg.attachments.values()].some(isAudioAttachment);
          if (!hasAudio) continue;

          const result = await transcribeMessageAudioAttachment(msg, earlyTomoriState.server_id);
          if (result.transcriptText) {
            setCachedVoiceTranscript(msg.id, result.transcriptText, "user_stt");
            log.info(
              `[VoiceCache] SET user_stt (history) | msg=${msg.id} | chars=${result.transcriptText.length} | preview="${result.transcriptText.slice(0, 60)}${result.transcriptText.length > 60 ? "…" : ""}"`,
            );
          }
        }
      }

      // 10. Build the `SimplifiedMessageForContext` array and user list from relevant messages
      const simplifiedMessages: SimplifiedMessageForContext[] = []; // Array for structured messages
      const userListSet = new Set<string>(); // Still useful for fetching user-specific memories/data
      // Matrix relay messages all share the same Discord webhook bot user ID, so they
      // cannot be deduplication-safe in userListSet. Track them separately: Matrix user
      // ID (e.g., "@bred:localhost") → stripped display name (e.g., "bred").
      const matrixUserMap = new Map<string, string>();
      // Track synthetic participants that are not regular Discord users:
      // - persona entries keyed by tomori_id (short numeric)
      // - webhook entries keyed by webhook ID (snowflake)
      // This lets tools consume stable persona IDs in production/local.
      const syntheticUserMap = new Map<string, { displayName: string; type: "persona" | "webhook" }>();
      let impersonatedUserDbNickname: string | undefined;
      let impersonatedUserPrompt: string | undefined;
      let impersonatedIdentityName: string | undefined;
      let impersonatedIdentityAvatarUrl: string | undefined;

      if (isUserImpersonation && impersonatedUserId) {
        const impersonatedUserRow = await getCachedUserRow(impersonatedUserId);
        impersonatedUserDbNickname = impersonatedUserRow?.user_nickname;
        impersonatedUserPrompt = impersonatedUserRow?.impersonation_prompt ?? undefined;
        const impersonatedIdentity = await resolveImpersonatedIdentity(
          client,
          guild,
          impersonatedUserId,
          impersonatedUserDbNickname,
        );
        impersonatedIdentityName = impersonatedIdentity.displayName;
        impersonatedIdentityAvatarUrl = impersonatedIdentity.avatarUrl;
      }

      // Find the most recent message that carries reply context, either
      // through a native Discord reply or a webhook reply-context embed.
      let latestReferenceMessageIndex = -1;
      for (let i = relevantMessagesArray.length - 1; i >= 0; i--) {
        const candidateMessage = relevantMessagesArray[i];
        if (
          candidateMessage.reference?.messageId &&
          candidateMessage.reference?.type !== MessageReferenceType.Forward
        ) {
          latestReferenceMessageIndex = i;
          break; // Found the most recent one, stop searching
        }

        if (findReplyContextTargetInMessage(candidateMessage)) {
          latestReferenceMessageIndex = i;
          break; // Found the most recent one, stop searching
        }
      }

      const shouldExtractEmojiImages = tomoriState.llm.sees_images;
      const reactionContextBudget: ReactionContextBudgetState = {
        callsUsed: 0,
        budgetExhaustedLogged: false,
        messagesWithReactions: 0,
        fallbackCount: 0,
      };

      for (const [index, msg] of relevantMessagesArray.entries()) {
        const authorId = msg.author.id;
        //const isLastMessage = index === relevantMessagesArray.length - 1;

        // Filter out Level 2 (FULL privacy) users from conversation history
        const authorPrivacyLevel = await getCachedPrivacyLevel(authorId);
        if (authorPrivacyLevel === PrivacyLevel.FULL) {
          log.info(`Filtering message from user ${authorId} (privacy level FULL)`);
          continue; // Skip this message entirely
        }

        // Variable to store referenced message data for later attachment extraction
        let referencedMessageData: { message: Message } | undefined;

        const isUserJoinMessage = msg.type === MessageType.UserJoin;
        const joinServerName = guild?.name ?? "this server";

        // 1. Check for debug prefix "$:" at the start of the message
        const isDebugMessage = !isUserJoinMessage && msg.content.startsWith("$:"); // Easter egg functionality hehehe
        let processedContent = isUserJoinMessage
          ? `[System: <@${authorId}> has just joined ${joinServerName}]`
          : msg.content;

        // 2. If debug prefix found, trim it and treat message as coming from bot
        if (isDebugMessage) {
          processedContent = msg.content.slice(2); // Remove "$:" prefix
        }

        // 3. Add reference context only for the most recent reply-like message
        const replyContextEmbedTarget =
          index === latestReferenceMessageIndex && !msg.reference?.messageId
            ? findReplyContextTargetInMessage(msg)
            : null;
        if (index === latestReferenceMessageIndex) {
          if (msg.reference?.messageId && processedContent) {
            try {
              const msgReferencedMessage = await channel.messages.fetch(msg.reference.messageId);
              if (msgReferencedMessage) {
                // Store referenced message info for later attachment extraction
                // (attachments will be processed after imageAttachments/videoAttachments arrays are declared)
                referencedMessageData = {
                  message: msgReferencedMessage,
                };

                processedContent = `${await buildReplyReferenceContextAnnotation({
                  replyMessage: msg,
                  referencedMessage: msgReferencedMessage,
                  clientUserId: client.user?.id,
                  botDisplayName: tomoriState?.tomori_nickname,
                  personaByNickname,
                  serverDiscId,
                  serverPersonalizationDisabled,
                  messageIdMap,
                })}\n${processedContent}`;
              }
            } catch (fetchError) {
              log.warn(`Could not fetch referenced message ${msg.reference.messageId} for context`, fetchError);
            }
          } else if (replyContextEmbedTarget) {
            try {
              if (replyContextEmbedTarget.channelId === msg.channel.id) {
                const msgReferencedMessage =
                  msg.channel.messages.cache.get(replyContextEmbedTarget.messageId) ??
                  (await msg.channel.messages.fetch(replyContextEmbedTarget.messageId));

                if (msgReferencedMessage) {
                  referencedMessageData = {
                    message: msgReferencedMessage,
                  };

                  const referenceContext = await buildReplyReferenceContextAnnotation({
                    replyMessage: msg,
                    referencedMessage: msgReferencedMessage,
                    clientUserId: client.user?.id,
                    botDisplayName: tomoriState?.tomori_nickname,
                    personaByNickname,
                    serverDiscId,
                    serverPersonalizationDisabled,
                    messageIdMap,
                  });
                  processedContent = processedContent ? `${referenceContext}\n${processedContent}` : referenceContext;
                }
              }
            } catch (fetchError) {
              log.warn(
                `Could not fetch referenced message ${replyContextEmbedTarget.messageId} from webhook reply embed`,
                fetchError,
              );
            }
          }
        }

        // 4. Determine author name and ID based on message type
        let effectiveAuthorId = authorId;
        let authorName: string;
        let authorType: "user" | "persona" = "user";
        let personaName: string | null = null;
        let matchedPersonaId: number | null = null;
        let resolvedWebhookImpersonatedUserId: string | null = null;
        const isWebhookMessage = Boolean(msg.webhookId);

        if (msg.author.id === client.user?.id || isDebugMessage) {
          const mainNickname = mainPersona?.tomori_nickname ?? tomoriState?.tomori_nickname ?? msg.author.username;
          authorName = mainNickname; // Use main persona nickname for bot/debug messages
          authorType = "persona";
          personaName = mainNickname;
        } else if (isWebhookMessage) {
          // Strip "[Matrix|@user:host] " prefix from Matrix bridge webhooks
          // so TomoriBot sees just the display name (e.g., "bred") in context
          const webhookName = stripBridgePrefix(msg.author.username);
          const matchedPersona = webhookName ? personaByNickname.get(webhookName.toLowerCase()) : undefined;

          if (matchedPersona) {
            authorName = matchedPersona.tomori_nickname;
            authorType = "persona";
            personaName = matchedPersona.tomori_nickname;
            matchedPersonaId = matchedPersona.tomori_id ?? null;
            effectiveAuthorId = `persona:${matchedPersona.tomori_id ?? matchedPersona.tomori_nickname}`;
          } else {
            authorName = webhookName || `<@${authorId}>`;
            const webhookAvatarUrl = msg.author.displayAvatarURL({
              size: 1024,
              extension: "png",
              forceStatic: true,
            });
            // Only trust our own cache for user-impersonation attribution in
            // history. Falling back to name+avatar identity matching here would
            // let foreign persona webhooks (e.g. another TomoriBot instance's
            // alter named after a real user) get cached as user-impersonation
            // targets, poisoning all future replies to those webhooks.
            // The supplemental check below still handles the case where the
            // current message is itself a user-impersonation and we need to
            // recognize matching history messages as the same user.
            resolvedWebhookImpersonatedUserId = msg.webhookId
              ? getCachedImpersonatedUserIdForWebhook(msg.webhookId)
              : null;
            if (
              !resolvedWebhookImpersonatedUserId &&
              isUserImpersonation &&
              impersonatedUserId &&
              normalizeIdentityName(webhookName) === normalizeIdentityName(impersonatedIdentityName) &&
              (!impersonatedIdentityAvatarUrl ||
                normalizeAvatarUrlForMatch(webhookAvatarUrl) ===
                  normalizeAvatarUrlForMatch(impersonatedIdentityAvatarUrl))
            ) {
              resolvedWebhookImpersonatedUserId = impersonatedUserId;
            }

            if (resolvedWebhookImpersonatedUserId) {
              // Do not cache identity matches discovered from generic history inspection.
              // Shared channel webhooks can temporarily impersonate a human-looking
              // display identity for notice embeds, and caching those webhook IDs as
              // user impersonation targets poisons future reply routing.
              effectiveAuthorId = resolvedWebhookImpersonatedUserId;
              if (
                isUserImpersonation &&
                impersonatedUserId === resolvedWebhookImpersonatedUserId &&
                impersonatedIdentityName
              ) {
                authorName = impersonatedIdentityName;
              }
            }

            // Matrix relay messages: register in the per-Matrix-user map so each
            // Matrix user gets its own user list entry (they all share the same
            // Discord webhook bot ID and would otherwise deduplicate to one entry).
            // Extract the Matrix user ID from the "[Matrix|@user:host] name" format.
            const matrixId = extractBridgeUserId(msg.author.username);
            if (matrixId && webhookName) {
              matrixUserMap.set(matrixId, webhookName);
            }
          }
        } else {
          if (isUserImpersonation && impersonatedUserId === authorId && impersonatedIdentityName) {
            authorName = impersonatedIdentityName;
          } else {
            authorName = `<@${authorId}>`; // Format user as <@ID>, to be converted by convertMentions later to user's registered name (if existing)
          }
        }

        // Add to user list (Level 2 FULL privacy users already filtered out above).
        // Skip Matrix relay non-persona webhook messages — they are tracked in matrixUserMap
        // instead, since all Matrix relays share the same Discord webhook bot user ID.
        const isMatrixNonPersonaRelay =
          isWebhookMessage && isMatrixBridgeWebhookUsername(msg.author.username) && authorType === "user";
        const shouldTreatWebhookAsRealUser =
          isWebhookMessage && authorType === "user" && !!resolvedWebhookImpersonatedUserId;

        // Register synthetic identities for context:
        // - matched alter persona => tomori_id (short numeric)
        // - non-persona webhook => webhook snowflake
        if (isWebhookMessage && !isMatrixNonPersonaRelay && !shouldTreatWebhookAsRealUser) {
          if (matchedPersonaId !== null) {
            syntheticUserMap.set(String(matchedPersonaId), {
              displayName: authorName,
              type: "persona",
            });
          } else if (msg.webhookId) {
            syntheticUserMap.set(msg.webhookId, {
              displayName: authorName,
              type: "webhook",
            });
          }
        }

        if (!isMatrixNonPersonaRelay) {
          // For persona webhooks, expose tomori_id (short numeric) as the
          // actionable ID for avatar tools. Other webhooks keep webhook ID.
          userListSet.add(
            matchedPersonaId !== null
              ? String(matchedPersonaId)
              : shouldTreatWebhookAsRealUser && resolvedWebhookImpersonatedUserId
                ? resolvedWebhookImpersonatedUserId
                : isWebhookMessage && msg.webhookId
                  ? msg.webhookId
                  : effectiveAuthorId,
          );
        }

        const imageAttachments: SimplifiedMessageForContext["imageAttachments"] = [];
        const videoAttachments: SimplifiedMessageForContext["videoAttachments"] = [];
        const selfDebugEnabled = tomoriState.config.self_debug_enabled ?? false;
        const isTomoriAuthoredMessage =
          msg.author.id === client.user?.id || (isWebhookMessage && authorType === "persona");
        // Strip @{trigger} → trigger from user messages so direct invocation markers don't appear
        // raw in the LLM context. Mirrors how <@userId> is resolved to a plain name by convertMentions.
        // Only applied to non-bot messages to avoid touching the bot's own formatted output.
        const strippedProcessedContent =
          processedContent && !isTomoriAuthoredMessage
            ? stripAtPersonaTriggers(processedContent, allPersonas)
            : processedContent;
        let messageContentForLlm: string | null = strippedProcessedContent; // Use processed content (with reference context and "$:" removed if present)
        let hasProcessedEmbed = false; // Track if this message contains a processed embed
        const mediaSourceMessageIds: string[] = []; // Array to collect all message IDs with media
        let hasLocalMedia = false;
        let remoteMediaSourceKind: SimplifiedMessageForContext["remoteMediaSourceKind"];

        const reactionContextLine = await buildReactionContextAnnotation(msg, reactionContextBudget, {
          clientUserId: client.user?.id,
          mainPersonaNickname: mainPersona?.tomori_nickname ?? tomoriState?.tomori_nickname ?? null,
        });
        if (reactionContextLine) {
          messageContentForLlm = messageContentForLlm
            ? `${messageContentForLlm}\n${reactionContextLine}`
            : reactionContextLine;
        }

        if (msg.reference?.type === MessageReferenceType.Forward && msg.messageSnapshots.size > 0) {
          const forwardedContextBlocks: string[] = [];

          for (const forwardedMessage of msg.messageSnapshots.values()) {
            const preForwardImageCount = imageAttachments.length;
            const preForwardVideoCount = videoAttachments.length;
            const forwardedTextSegments: string[] = [];

            if (forwardedMessage.content?.trim()) {
              forwardedTextSegments.push(forwardedMessage.content.trim());
            }

            appendSupportedMediaFromMessage(forwardedMessage, imageAttachments, videoAttachments);

            if (shouldExtractEmojiImages && forwardedMessage.content) {
              const forwardedEmojiAttachments = extractEmojiImageAttachments(forwardedMessage.content);
              if (forwardedEmojiAttachments.length > 0) {
                imageAttachments.push(...forwardedEmojiAttachments);
              }
            }

            const isForwardedTomoriAuthoredMessage = forwardedMessage.author?.id === client.user?.id;
            if (forwardedMessage.embeds.length > 0) {
              for (const embed of forwardedMessage.embeds) {
                const embedCheck = checkTargetEmbedTitle(embed.title);
                if (
                  embedCheck.isTarget &&
                  (embedCheck.type === "memory_learning" ||
                    embedCheck.type === "reminder_set" ||
                    embedCheck.type === "system_injection" ||
                    embedCheck.type === "compact_summary" ||
                    embedCheck.type === "compact_refresh" ||
                    embedCheck.type === "reward" ||
                    embedCheck.type === "punish") &&
                  embed.description
                ) {
                  if (
                    embedCheck.type === "system_injection" ||
                    embedCheck.type === "compact_summary" ||
                    embedCheck.type === "compact_refresh"
                  ) {
                    const titleLine =
                      embedCheck.type === "compact_summary" || embedCheck.type === "compact_refresh"
                        ? embed.title
                          ? `## ${embed.title}\n`
                          : ""
                        : "";
                    forwardedTextSegments.push(`[System: ${titleLine}${embed.description}]`);
                  } else {
                    let cleanedDescription = embed.description;
                    if (tomoriState?.tomori_nickname) {
                      const escapedNickname = tomoriState.tomori_nickname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                      const botNamePattern = new RegExp(`^${escapedNickname}:\\s*`, "i");
                      if (botNamePattern.test(cleanedDescription)) {
                        cleanedDescription = cleanedDescription.replace(botNamePattern, "").trim();
                      }
                    }

                    const includeTitleInEmbedContent =
                      embedCheck.type === "memory_learning" || embedCheck.type === "reminder_set";
                    const titleLine = includeTitleInEmbedContent && embed.title ? `${embed.title}\n` : "";
                    const embedBody = `${titleLine}${cleanedDescription}`;
                    const embedContent =
                      embedCheck.type === "memory_learning" ||
                      embedCheck.type === "reward" ||
                      embedCheck.type === "punish"
                        ? `[System: ${embedBody}]`
                        : formatSystemProducedEmbedHint(embedBody);
                    forwardedTextSegments.push(embedContent);
                  }
                } else if (selfDebugEnabled && isForwardedTomoriAuthoredMessage && shouldIncludeSelfDebugEmbed(embed)) {
                  const diagnosticEmbedContent = formatTomoriSelfDebugEmbedAsSystemMessage(embed);
                  if (diagnosticEmbedContent) {
                    forwardedTextSegments.push(diagnosticEmbedContent);
                  }
                } else if (!isForwardedTomoriAuthoredMessage) {
                  const linkEmbedData = processLinkEmbed(embed);
                  if (linkEmbedData.isLinkPreview) {
                    if (linkEmbedData.textContent) {
                      forwardedTextSegments.push(linkEmbedData.textContent);
                    }

                    if (linkEmbedData.imageInfo) {
                      imageAttachments.push({
                        url: linkEmbedData.imageInfo.url,
                        proxyUrl: linkEmbedData.imageInfo.proxyUrl,
                        mimeType: linkEmbedData.imageInfo.mimeType,
                        filename: linkEmbedData.imageInfo.filename,
                      });
                    }

                    if (linkEmbedData.thumbnailInfo) {
                      imageAttachments.push({
                        url: linkEmbedData.thumbnailInfo.url,
                        proxyUrl: linkEmbedData.thumbnailInfo.proxyUrl,
                        mimeType: linkEmbedData.thumbnailInfo.mimeType,
                        filename: linkEmbedData.thumbnailInfo.filename,
                      });
                    }
                  }
                }
              }
            }

            if (imageAttachments.length > preForwardImageCount || videoAttachments.length > preForwardVideoCount) {
              const forwardedMessageId = forwardedMessage.id ?? msg.reference.messageId;
              if (forwardedMessageId) {
                mediaSourceMessageIds.push(forwardedMessageId);
              }
              remoteMediaSourceKind = "forwarded";
            }

            const imageCount = imageAttachments.length - preForwardImageCount;
            const videoCount = videoAttachments.length - preForwardVideoCount;
            let attachmentInfo = "";
            if (imageCount > 0) {
              attachmentInfo += ` (with ${imageCount} image${imageCount > 1 ? "s" : ""})`;
            }
            if (videoCount > 0) {
              attachmentInfo += ` (with ${videoCount} video${videoCount > 1 ? "s" : ""})`;
            }

            const forwardedSourceChannel = forwardedMessage.channelId
              ? `<#${forwardedMessage.channelId}>`
              : "another channel";
            const forwardedAuthorName = formatForwardedAuthorName(
              forwardedMessage,
              tomoriState?.tomori_nickname || "Bot",
              client.user?.id,
            );
            const forwardedContent = formatInlineSystemContent(forwardedTextSegments.join("\n"));
            forwardedContextBlocks.push(
              `[System: ${authorName} forwarded a message by ${forwardedAuthorName} from ${forwardedSourceChannel} saying: ${forwardedContent}${attachmentInfo}]`,
            );
          }

          if (forwardedContextBlocks.length > 0) {
            const forwardedContext = forwardedContextBlocks.join("\n");
            messageContentForLlm = messageContentForLlm
              ? `${forwardedContext}\n${messageContentForLlm}`
              : forwardedContext;
          }
        }

        // Extract attachments from referenced message if it exists (after arrays are declared)
        // Check if this is the message that got reference context injection and we have stored reference message data
        if (index === latestReferenceMessageIndex && typeof referencedMessageData !== "undefined") {
          const preRefImageCount = imageAttachments.length;
          const preRefVideoCount = videoAttachments.length;

          appendSupportedMediaFromMessage(referencedMessageData.message, imageAttachments, videoAttachments);

          if (shouldExtractEmojiImages && referencedMessageData.message.content) {
            const referencedEmojiAttachments = extractEmojiImageAttachments(referencedMessageData.message.content);
            if (referencedEmojiAttachments.length > 0) {
              imageAttachments.push(...referencedEmojiAttachments);
            }
          }

          if (imageAttachments.length > preRefImageCount || videoAttachments.length > preRefVideoCount) {
            mediaSourceMessageIds.push(referencedMessageData.message.id);
            remoteMediaSourceKind = "reply";
          }

          // Log attachment extraction for debugging
          const extractedImages = imageAttachments.length;
          const extractedVideos = videoAttachments.filter((v) => !v.isYouTubeLink).length;
          if (extractedImages > 0 || extractedVideos > 0) {
            log.info(
              `Extracted ${extractedImages} images and ${extractedVideos} videos from referenced message ${referencedMessageData.message.id}`,
            );
          }
        }

        // Process embeds for target titles that should be included as text content
        if (msg.embeds.length > 0) {
          for (const embed of msg.embeds) {
            // 1. Process system embeds (existing logic) - scan ALL messages including bot messages
            const embedCheck = checkTargetEmbedTitle(embed.title);
            if (
              embedCheck.isTarget &&
              (embedCheck.type === "memory_learning" ||
                embedCheck.type === "reminder_set" ||
                embedCheck.type === "system_injection" ||
                embedCheck.type === "compact_summary" ||
                embedCheck.type === "compact_refresh" ||
                embedCheck.type === "reward" ||
                embedCheck.type === "punish") &&
              embed.description
            ) {
              // Wrap system_injection embeds in [System: ...] wrapper
              if (
                embedCheck.type === "system_injection" ||
                embedCheck.type === "compact_summary" ||
                embedCheck.type === "compact_refresh"
              ) {
                const titleLine =
                  embedCheck.type === "compact_summary" || embedCheck.type === "compact_refresh"
                    ? embed.title
                      ? `## ${embed.title}\n`
                      : ""
                    : "";
                const systemContent = `[System: ${titleLine}${embed.description}]`;
                messageContentForLlm = messageContentForLlm
                  ? `${messageContentForLlm}\n${systemContent}`
                  : systemContent;
                hasProcessedEmbed = true;
              } else {
                // Remove bot name prefix from embed description if present
                let cleanedDescription = embed.description;
                if (tomoriState?.tomori_nickname) {
                  // Escape special regex characters in the bot nickname
                  const escapedNickname = tomoriState.tomori_nickname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  const botNamePattern = new RegExp(`^${escapedNickname}:\\s*`, "i");
                  if (botNamePattern.test(cleanedDescription)) {
                    cleanedDescription = cleanedDescription.replace(botNamePattern, "").trim();
                  }
                }

                const includeTitleInEmbedContent =
                  embedCheck.type === "memory_learning" || embedCheck.type === "reminder_set";
                const titleLine = includeTitleInEmbedContent && embed.title ? `${embed.title}\n` : "";
                const embedBody = `${titleLine}${cleanedDescription}`;
                const embedContent =
                  embedCheck.type === "memory_learning" || embedCheck.type === "reward" || embedCheck.type === "punish"
                    ? `[System: ${embedBody}]`
                    : formatSystemProducedEmbedHint(embedBody);
                messageContentForLlm = messageContentForLlm ? `${messageContentForLlm}\n${embedContent}` : embedContent;
                hasProcessedEmbed = true;
              }
            }

            // 2. Process Tomori diagnostic embeds when self-debug mode is enabled
            else if (selfDebugEnabled && isTomoriAuthoredMessage && shouldIncludeSelfDebugEmbed(embed)) {
              const diagnosticEmbedContent = formatTomoriSelfDebugEmbedAsSystemMessage(embed);
              if (diagnosticEmbedContent) {
                messageContentForLlm = messageContentForLlm
                  ? `${messageContentForLlm}\n${diagnosticEmbedContent}`
                  : diagnosticEmbedContent;
                hasProcessedEmbed = true;
                log.info(`Self-debug: loaded Tomori diagnostic embed from message ${msg.id} into context`);
              }
            }

            // 3. Process link preview embeds - for all messages EXCEPT TomoriBot's own
            // (other bots/webhooks often carry useful content embeds like Twitter/X posts)
            else if (!isTomoriAuthoredMessage) {
              const linkEmbedData = processLinkEmbed(embed);
              if (linkEmbedData.isLinkPreview) {
                // Add link embed text content to message if present
                if (linkEmbedData.textContent) {
                  messageContentForLlm = messageContentForLlm
                    ? `${messageContentForLlm}\n${linkEmbedData.textContent}`
                    : linkEmbedData.textContent;
                }

                // Add embed image to imageAttachments if present
                if (linkEmbedData.imageInfo) {
                  imageAttachments.push({
                    url: linkEmbedData.imageInfo.url,
                    proxyUrl: linkEmbedData.imageInfo.proxyUrl,
                    mimeType: linkEmbedData.imageInfo.mimeType,
                    filename: linkEmbedData.imageInfo.filename,
                  });
                  hasLocalMedia = true;
                  log.info(`Added embed image from link preview: ${linkEmbedData.imageInfo.filename}`);
                }

                // Add embed thumbnail to imageAttachments if present (and no main image)
                if (linkEmbedData.thumbnailInfo) {
                  imageAttachments.push({
                    url: linkEmbedData.thumbnailInfo.url,
                    proxyUrl: linkEmbedData.thumbnailInfo.proxyUrl,
                    mimeType: linkEmbedData.thumbnailInfo.mimeType,
                    filename: linkEmbedData.thumbnailInfo.filename,
                  });
                  hasLocalMedia = true;
                  log.info(`Added embed thumbnail from link preview: ${linkEmbedData.thumbnailInfo.filename}`);
                }
              }
            }
          }
        }

        // Override author information for special message types
        if (hasProcessedEmbed) {
          // Processed embeds should appear as system/user messages
          effectiveAuthorId = "system-embed"; // Use a special system ID to prevent combination
          authorName = "System"; // Use "System" as the author name for processed embeds
          authorType = "user";
          personaName = null;
        } else if (isUserJoinMessage) {
          effectiveAuthorId = `system-user-join:${msg.id}`;
          authorName = "System";
          authorType = "user";
          personaName = null;
        } else if (isDebugMessage) {
          // Debug messages ($:) should appear as coming from the bot (model role)
          effectiveAuthorId = client.user?.id || "bot"; // Use bot's actual ID for debug messages
          authorName = mainPersona?.tomori_nickname ?? tomoriState?.tomori_nickname ?? "Bot"; // Keep bot nickname
          authorType = "persona";
          personaName = mainPersona?.tomori_nickname ?? tomoriState?.tomori_nickname ?? null;
        }

        // 5.a. Process direct image attachments and stickers
        if (msg.attachments.size > 0) {
          const cachedRenderedTable = getCachedRenderedMarkdownTable(msg.id);
          if (cachedRenderedTable) {
            const tableText = `[System: This was sent as a rendered markdown table image.]\n${cachedRenderedTable}`;
            messageContentForLlm = messageContentForLlm ? `${messageContentForLlm}\n${tableText}` : tableText;
            log.info(`Rehydrated rendered markdown table for message ${msg.id} from cache`);
          } else {
            for (const attachment of msg.attachments.values()) {
              if (isSupportedImageAttachmentContentType(attachment.contentType)) {
                imageAttachments.push({
                  url: attachment.url,
                  proxyUrl: attachment.proxyURL,
                  mimeType: attachment.contentType,
                  filename: attachment.name,
                });
                hasLocalMedia = true;
              }
              // 1. Check for video attachments using supported MIME types
              else if (isSupportedVideoAttachmentContentType(attachment.contentType)) {
                videoAttachments.push({
                  url: attachment.url,
                  proxyUrl: attachment.proxyURL,
                  mimeType: attachment.contentType,
                  filename: attachment.name,
                  isYouTubeLink: false,
                });
                hasLocalMedia = true;
                log.info(`Processed video attachment: ${attachment.name} (${attachment.contentType})`);
              }
              // Non-media attachments (PDF, TXT, MD, etc.) — check for audio cache first,
              // otherwise append a text placeholder with message ID for read_file
              else if (isAudioAttachment(attachment)) {
                if (config.voice_transcript_chat_mode) {
                  // Chat mode: skip audio entirely. The transcript was already posted
                  // as a visible webhook message; audio never reaches the AI context.
                } else {
                  const cached = getCachedVoiceTranscript(msg.id);
                  if (cached?.source === "user_stt") {
                    // Inline the transcript instead of a filename placeholder.
                    // Guard against double-appending if applyEffectiveMessageContent
                    // already embedded the transcript in processedContent.
                    if (!messageContentForLlm?.includes(cached.transcript)) {
                      const voiceText = `[System: This was sent as a voice message.]\n${cached.transcript}`;
                      messageContentForLlm = messageContentForLlm ? `${messageContentForLlm}\n${voiceText}` : voiceText;
                    }
                  }
                  // For "tts" source or cache miss, note that audio was present but
                  // untranscribed. read_file cannot process audio, so no message ID needed.
                  else {
                    const attachName = attachment.name ?? "audio";
                    const attachHint = formatAudioAttachmentHint(attachName);
                    messageContentForLlm = messageContentForLlm ? `${messageContentForLlm} ${attachHint}` : attachHint;
                  }
                }
              } else {
                const attachName = attachment.name ?? "file";
                const attachHint = formatAttachmentSystemHint(attachName, messageIdMap.register(msg.id, "media"));
                messageContentForLlm = messageContentForLlm ? `${messageContentForLlm} ${attachHint}` : attachHint;
              }
            }
          }
        }

        // Process stickers sent in the message
        if (msg.stickers.size > 0) {
          for (const sticker of msg.stickers.values()) {
            // Get the sticker URL for Lottie, PNG, or other formats
            // Discord CDN URL follows a consistent pattern
            const stickerUrl = `https://cdn.discordapp.com/stickers/${sticker.id}.png`;

            imageAttachments.push({
              url: stickerUrl,
              proxyUrl: stickerUrl, // Use same URL for proxy
              mimeType: "image/png", // Discord serves PNG version for stickers
              filename: `${sticker.name}.png`,
            });
            hasLocalMedia = true;
            log.info(`Processed sticker: ${sticker.name} (${sticker.id})`);
          }
        }

        if (shouldExtractEmojiImages && msg.content) {
          const emojiAttachments = extractEmojiImageAttachments(msg.content);
          if (emojiAttachments.length > 0) {
            imageAttachments.push(...emojiAttachments);
            hasLocalMedia = true;
            log.info(`Processed ${emojiAttachments.length} emoji(s) from message ${msg.id}`);
          }
        }

        // 2. Process YouTube links in message content
        if (msg.content) {
          for (const pattern of YOUTUBE_URL_PATTERNS) {
            const match = msg.content.match(pattern);
            if (match) {
              const youtubeUrl = match[0];
              const videoId = match[1];
              videoAttachments.push({
                url: youtubeUrl,
                proxyUrl: youtubeUrl, // YouTube links don't need proxy
                mimeType: "video/youtube", // Custom MIME type for YouTube
                filename: `youtube_video_${videoId}.mp4`,
                isYouTubeLink: true,
              });
              hasLocalMedia = true;
              log.info(`Detected YouTube link: ${youtubeUrl} (ID: ${videoId})`);
              break; // Only process the first YouTube link found to avoid duplicates
            }
          }
        }

        // 5.b. Check for Tenor GIF links in the message content
        // Can detect multiple Tenor URLs and works even with accompanying text
        // Note: We check regardless of existing attachments because Discord may have added a PNG preview
        if (msg.content) {
          // Use matchAll to find all Tenor URLs in the message
          const tenorMatches = Array.from(msg.content.matchAll(TENOR_GIF_REGEX));

          if (tenorMatches.length > 0) {
            log.info(`Detected ${tenorMatches.length} Tenor GIF link(s) in msg ID ${msg.id}`);

            // Process each Tenor URL found (typically just one)
            for (const match of tenorMatches) {
              const tenorViewUrl = match[0];

              // Ensure it's a complete URL (add https:// if missing)
              const fullUrl = tenorViewUrl.startsWith("http") ? tenorViewUrl : `https://${tenorViewUrl}`;

              log.info(`Processing Tenor URL: ${fullUrl}`);

              // Resolve Tenor view URL to direct GIF CDN URL
              const directGifUrl = await resolveTenorUrl(fullUrl);

              if (directGifUrl) {
                // Determine if this is a GIF or video based on file extension
                const fileExt = directGifUrl.split(".").pop()?.toLowerCase();
                const isVideo = fileExt === "mp4" || fileExt === "webm" || fileExt === "mov";
                const isGif = fileExt === "gif";

                // Check if Discord already added a preview attachment for this Tenor URL
                // Discord proxy URLs look like: https://images-ext-1.discordapp.net/external/.../media.tenor.com/...png
                const discordTenorProxyIndex = imageAttachments.findIndex(
                  (att) => att.proxyUrl.includes("discordapp.net/external") && att.proxyUrl.includes("media.tenor.com"),
                );

                if (isGif) {
                  hasLocalMedia = true;
                  // Handle as GIF (image with keyframe extraction)
                  if (discordTenorProxyIndex !== -1) {
                    // Replace Discord's PNG preview with our resolved GIF
                    imageAttachments[discordTenorProxyIndex] = {
                      url: directGifUrl,
                      proxyUrl: directGifUrl,
                      mimeType: "image/gif",
                      filename: `tenor_${discordTenorProxyIndex + 1}.gif`,
                    };
                    log.success(`Replaced Discord Tenor preview with resolved GIF: ${directGifUrl}`);
                  } else {
                    // No Discord preview found, add as new attachment
                    imageAttachments.push({
                      url: directGifUrl,
                      proxyUrl: directGifUrl,
                      mimeType: "image/gif",
                      filename: `tenor_${imageAttachments.length + 1}.gif`,
                    });
                    log.success(`Successfully resolved Tenor URL to GIF: ${directGifUrl}`);
                  }
                } else if (isVideo) {
                  hasLocalMedia = true;
                  // Handle as video (for providers that support video like Gemini)
                  // Remove Discord's preview if it exists since we're adding the actual video
                  if (discordTenorProxyIndex !== -1) {
                    imageAttachments.splice(discordTenorProxyIndex, 1);
                  }

                  // Determine video mimeType
                  const videoMimeType =
                    fileExt === "mp4" ? "video/mp4" : fileExt === "webm" ? "video/webm" : "video/quicktime"; // for .mov

                  // Add as video attachment
                  videoAttachments.push({
                    url: directGifUrl,
                    proxyUrl: directGifUrl,
                    mimeType: videoMimeType,
                    filename: `tenor_${videoAttachments.length + 1}.${fileExt}`,
                    isYouTubeLink: false, // This is a direct Tenor video, not YouTube
                  });
                  log.success(`Successfully resolved Tenor URL to video (${videoMimeType}): ${directGifUrl}`);
                } else {
                  log.warn(`Unknown Tenor media format: ${fileExt}, keeping as text`);
                }
              } else {
                log.warn(`Failed to resolve Tenor URL, keeping as text: ${fullUrl}`);
              }
            }

            // Keep the Tenor URL(s) as text content since they often contain useful descriptive context
            // (e.g., "tsukimura-dark-souls-death-idolmaster" provides context about the GIF)
          }
        }

        const resolvedMediaSourceMessageIds: string[] | undefined =
          imageAttachments.length > 0 || videoAttachments.length > 0
            ? hasLocalMedia
              ? [msg.id, ...mediaSourceMessageIds]
              : mediaSourceMessageIds.length > 0
                ? mediaSourceMessageIds
                : undefined
            : undefined;
        const resolvedRemoteMediaSourceKind =
          !hasLocalMedia && mediaSourceMessageIds.length > 0 ? remoteMediaSourceKind : undefined;

        // 5.c. Check if this message is from the same effective author as the previous one
        const prevMessage = simplifiedMessages[simplifiedMessages.length - 1];

        // 6. Check if the previous message was also a debug message
        const prevWasDebugMessage =
          prevMessage &&
          prevMessage.authorName === tomoriState?.tomori_nickname &&
          prevMessage.authorId !== client.user?.id; // Was debug message if it shows as Tomori but isn't actually from the bot

        // 7. Only combine messages from the same "effective author"
        // This prevents combining debug messages ($:) with regular messages from the same user
        // and prevents combining processed embed messages with other messages
        const isSameEffectiveAuthor =
          prevMessage && prevMessage.authorId === effectiveAuthorId && prevWasDebugMessage === isDebugMessage;

        const currentMessageHasMedia =
          imageAttachments.length > 0 ||
          videoAttachments.length > 0 ||
          (resolvedMediaSourceMessageIds?.length ?? 0) > 0;
        const prevMessageHasMedia =
          !!prevMessage &&
          (prevMessage.imageAttachments.length > 0 ||
            prevMessage.videoAttachments.length > 0 ||
            (prevMessage.mediaSourceMessageIds?.length ?? 0) > 0);

        // 5.d. Determine if we should combine with the previous message or create a new entry.
        // Only collapse consecutive same-author messages when BOTH sides are pure text.
        // If either side contains media, keep them as separate turns so message-local media IDs
        // stay unambiguous for the LLM and for media-targeted tool references.
        const prevMessageHasContent =
          prevMessage &&
          (prevMessage.content || prevMessage.imageAttachments.length > 0 || prevMessage.videoAttachments.length > 0);
        const shouldKeepSeparateMediaTurn = currentMessageHasMedia || prevMessageHasMedia;

        if (isSameEffectiveAuthor && messageContentForLlm && prevMessageHasContent && !shouldKeepSeparateMediaTurn) {
          // Track constituent message IDs and contents for decompression by reveal_message_metadata
          if (!prevMessage.combinedMessageIds) {
            prevMessage.combinedMessageIds = [prevMessage.id];
            prevMessage.individualContents = [prevMessage.content ?? ""];
          }
          prevMessage.combinedMessageIds.push(msg.id);
          prevMessage.individualContents ??= [];
          prevMessage.individualContents.push(messageContentForLlm);

          // Append this message's content to the previous message with a newline
          prevMessage.content += `\n${messageContentForLlm}`; // If this message has images, add them to the previous message's images
          if (imageAttachments.length > 0) {
            prevMessage.imageAttachments = [...prevMessage.imageAttachments, ...imageAttachments];
          }
          // If this message has videos, add them to the previous message's videos
          if (videoAttachments.length > 0) {
            prevMessage.videoAttachments = [...prevMessage.videoAttachments, ...videoAttachments];
          }
          if (resolvedMediaSourceMessageIds && resolvedMediaSourceMessageIds.length > 0) {
            // Merge media source message IDs, avoiding duplicates
            const existingIds = prevMessage.mediaSourceMessageIds ?? [];
            const combinedIds = [...existingIds, ...resolvedMediaSourceMessageIds];
            prevMessage.mediaSourceMessageIds = [...new Set(combinedIds)]; // Remove duplicates
          }
          if (resolvedRemoteMediaSourceKind) {
            const prevHasLocalMediaSource = prevMessage.mediaSourceMessageIds?.includes(prevMessage.id) ?? false;
            if (!prevHasLocalMediaSource && !prevMessage.remoteMediaSourceKind) {
              prevMessage.remoteMediaSourceKind = resolvedRemoteMediaSourceKind;
            } else if (prevMessage.remoteMediaSourceKind !== resolvedRemoteMediaSourceKind) {
              prevMessage.remoteMediaSourceKind = undefined;
            }
          }
        } else if (messageContentForLlm || imageAttachments.length > 0 || videoAttachments.length > 0) {
          // Create a new entry if it's a different author or the previous has no content
          simplifiedMessages.push({
            id: msg.id,
            authorId: effectiveAuthorId,
            authorName,
            authorType,
            personaName,
            content: messageContentForLlm,
            createdAt: msg.createdTimestamp, // Discord message creation timestamp (ms) for timestamp tool
            mediaSourceMessageIds: resolvedMediaSourceMessageIds,
            remoteMediaSourceKind: resolvedRemoteMediaSourceKind,
            imageAttachments,
            videoAttachments,
          });
        }
      }

      // Add the bot's own Discord user ID only when no alter persona identity is
      // active in this turn. When alters are present, exposing both the bot account
      // ID and persona IDs can confuse tool targeting.
      const hasPersonaSyntheticUser = Array.from(syntheticUserMap.values()).some((entry) => entry.type === "persona");
      if (client.user?.id && !hasPersonaSyntheticUser && !isUserImpersonation) {
        userListSet.add(client.user.id);
      }

      // Ensure currently responding alter personas are always present as
      // synthetic user entries so they can self-target avatar tools by tomori_id
      // even if no prior webhook message exists in the fetched history window.
      for (const respondingPersona of personasToRespond) {
        if (!respondingPersona.is_alter || !respondingPersona.tomori_id) {
          continue;
        }

        const personaId = String(respondingPersona.tomori_id);
        userListSet.add(personaId);
        if (!syntheticUserMap.has(personaId)) {
          syntheticUserMap.set(personaId, {
            displayName: respondingPersona.tomori_nickname,
            type: "persona",
          });
        }
      }

      const userList = Array.from(userListSet);
      const channelName = isDMChannel ? "Direct Message" : "name" in channel ? channel.name : "Unknown Channel";
      const channelDesc = isDMChannel ? null : "topic" in channel ? channel.topic : null;
      const serverName = isDMChannel ? "Direct Message" : guild?.name || "Unknown Server";
      const serverDescription = isDMChannel ? null : guild?.description;

      // ========== MULTI-PERSONA RESPONSE LOOP START ==========
      // Each persona will generate a response sequentially using the same message history
      // but with their own personality, config, and (for alters) webhook avatar

      // Track persona responses for short-term memory storage (includes tomoriId + lineageId for persona-scoped STM)
      const personaResponses: Array<{
        personaName: string;
        text: string;
        tomoriId?: number;
        personaLineageId?: number | null;
      }> = [];
      let turnThoughtLog: ThoughtLogPayload | undefined;
      let turnThoughtLogOwner: ThoughtLogOwner | undefined;
      const matrixTypingRoomId = isMatrixRelay ? await getLinkedMatrixRoom(channel.id) : null;

      for (let personaIndex = 0; personaIndex < personasToRespond.length; personaIndex++) {
        const currentPersona = personasToRespond[personaIndex];
        const personaBaseState =
          textCredentialSource === "personal"
            ? (await applyPersonalProviderSelectionsToTomoriState(currentPersona, personalRoutingUserId)).tomoriState
            : currentPersona;
        const trimmedPrefill = manualPrefill?.trim();
        let personaSnapshot: RequestSnapshot = {
          ...requestSnapshot,
          tomoriState: personaBaseState,
        };
        log.info(
          `Starting response ${personaIndex + 1}/${personasToRespond.length} from persona "${currentPersona.tomori_nickname}" (${currentPersona.is_alter ? "alter" : "main"})`,
        );

        // Track active persona on lock entry so follow-up messages inherit the correct persona
        // instead of falling back to main. Also reset tool-call chain flag for this persona turn.
        if (lockEntry) {
          lockEntry.activePersonaId = currentPersona.tomori_id ?? undefined;
          lockEntry.isInToolCallChain = false;
        }

        // Assign currentPersona to tomoriState for this iteration
        // This allows all existing code to work without modification
        tomoriState = personaBaseState;

        // Resolve effective LLM by priority chain:
        //   1. persona_llm  — persona-specific override (set via /config model text scope:persona)
        //   2. channel LLM  — channel-level override (set via /config model text scope:channel)
        //   3. global llm   — server-wide default in tomori_configs
        // User impersonation always uses the global text model so the bot speaks in the
        // target user's voice without inheriting persona/channel model customizations.
        const channelLlmOverride =
          isUserImpersonation || textCredentialSource === "personal"
            ? null
            : await getCachedChannelLlm(currentPersona.server_id, channel.id);
        const effectiveLlm =
          textCredentialSource === "personal"
            ? personaBaseState.llm
            : isUserImpersonation
              ? personaBaseState.llm
              : (personaBaseState.persona_llm ?? channelLlmOverride ?? personaBaseState.llm);

        if (effectiveLlm !== personaBaseState.llm) {
          // Shallow-copy so the cached TomoriState is never mutated
          tomoriState = { ...tomoriState, llm: effectiveLlm };

          // If the override uses a different provider, swap the api_key in the config.
          // decryptMainKey() reads tomoriState.config.api_key which is the Phase A mirror
          // of the global provider's key — using it for a different provider causes a 400.
          const overrideProvider = effectiveLlm.llm_provider.toLowerCase();
          if (overrideProvider !== personaBaseState.llm.llm_provider.toLowerCase()) {
            const overrideSavedConfig = await loadSavedProviderConfig(tomoriState.server_id, overrideProvider);
            if (overrideSavedConfig) {
              tomoriState = {
                ...tomoriState,
                config: {
                  ...tomoriState.config,
                  api_key: overrideSavedConfig.api_key ?? tomoriState.config.api_key,
                  key_version: overrideSavedConfig.key_version ?? 1,
                  llm_temperature: overrideSavedConfig.llm_temperature ?? tomoriState.config.llm_temperature,
                  llm_top_p: overrideSavedConfig.llm_top_p ?? tomoriState.config.llm_top_p,
                  llm_top_k: overrideSavedConfig.llm_top_k ?? tomoriState.config.llm_top_k,
                  llm_frequency_penalty:
                    overrideSavedConfig.llm_frequency_penalty ?? tomoriState.config.llm_frequency_penalty,
                  llm_presence_penalty:
                    overrideSavedConfig.llm_presence_penalty ?? tomoriState.config.llm_presence_penalty,
                  llm_min_p: overrideSavedConfig.llm_min_p ?? tomoriState.config.llm_min_p,
                  thinking_level: overrideSavedConfig.thinking_level ?? tomoriState.config.thinking_level,
                  llm_disabled_params:
                    overrideSavedConfig.llm_disabled_params ?? tomoriState.config.llm_disabled_params,
                  llm_logit_biases: overrideSavedConfig.llm_logit_biases ?? tomoriState.config.llm_logit_biases,
                },
              };
            }
          }

          // Keep the snapshot in sync — its tomoriState must reflect the override
          // so any consumer reading snapshot.tomoriState (e.g. contextBuilder) gets the
          // correct model, not the global/persona-base model that was snapshotted earlier.
          personaSnapshot = { ...personaSnapshot, tomoriState };
        }

        // Send typing indicator for each persona response
        if (personaIndex > 0) {
          await refreshDiscordTypingIndicator(channel, "persona_transition");
        }
        const matrixTypingTargetRoomId = matrixTypingRoomId;
        const matrixTypingPersonaName = currentPersona.tomori_nickname ?? process.env.DEFAULT_BOTNAME ?? "Tomori";
        if (matrixTypingTargetRoomId) {
          await sendMatrixTypingIndicator(matrixTypingTargetRoomId, matrixTypingPersonaName, true);
        }
        let temporaryUserImpersonationWebhook: Webhook | null = null;

        try {
          // Persona-specific response generation starts here

          let emojiStrings: string[] = [];
          let loadedEmojis: ServerEmojiRow[] | null = null;
          let loadedStickers: ServerStickerRow[] | null = null;

          // Check if current channel (or its thread parent) is designated as an RP channel (always suppresses emojis/stickers)
          const rpChannelParentId = channel.isThread() ? channel.parentId : null;
          const isRpChannel =
            tomoriState.config.rp_channel_ids.includes(channel.id) ||
            (rpChannelParentId !== null && tomoriState.config.rp_channel_ids.includes(rpChannelParentId));
          const effectiveEmojiEnabled = isRpChannel ? false : tomoriState.config.emoji_usage_enabled;
          const effectiveStickerEnabled = isRpChannel ? false : tomoriState.config.sticker_usage_enabled;
          // Shallow-copy config with effective flags for context building (avoids mutating cached state)
          const effectiveTomoriConfig = isRpChannel
            ? {
                ...tomoriState.config,
                emoji_usage_enabled: false,
                sticker_usage_enabled: false,
              }
            : tomoriState.config;
          // Shallow-copy TomoriState with effective config so both createConfig and streamToDiscord
          // see the suppressed flags without ever mutating the cached TomoriState object.
          // Must be `let` so the fallback model loop can swap in a different llm for each attempt.
          let effectiveTomoriState = isRpChannel ? { ...tomoriState, config: effectiveTomoriConfig } : tomoriState;

          const deliberateToolModeActive = resolveDeliberateToolMode(
            effectiveTomoriState.config.deliberate_tool_mode,
            userRow?.personal_deliberate_tool_mode ?? "follow",
          );
          const deliberateToolIntentText =
            reminderData && (reminderRecipientID || reminderData.self_reminder)
              ? `${message.content}\n${reminderData.reminder_purpose}`
              : message.content;
          const deliberateToolIntentResult = getDeliberateToolIntentResult(
            deliberateToolIntentText,
            effectiveTomoriState.config.deliberate_tool_triggers,
          );
          const deliberateToolAllowedNames = [...deliberateToolIntentResult.allowedToolNames];
          const deliberateToolTriggerMatches: DeliberateToolIntentMatch[] = [...deliberateToolIntentResult.matches];
          const followUpToolIntentResult = getFollowUpToolIntentResult(
            deliberateToolIntentText,
            getRecentToolAffordanceNames(relevantMessagesArray, message.id, client.user?.id),
          );
          deliberateToolAllowedNames.push(...followUpToolIntentResult.allowedToolNames);
          deliberateToolAllowedNames.push(...(streamingContext.endTurnAfterTools ?? []));
          deliberateToolTriggerMatches.push(...followUpToolIntentResult.matches);
          const retainedToolNames = consumeRetainedToolAffordanceNames(channel.id);
          if (deliberateToolModeActive) {
            deliberateToolAllowedNames.push(...retainedToolNames);
            deliberateToolTriggerMatches.push(
              ...retainedToolNames.map((toolName) => ({
                toolName,
                trigger: "recent successful tool",
                source: "follow-up" as const,
              })),
            );
          }
          if (reminderData && (reminderRecipientID || reminderData.self_reminder)) {
            if (/\b(voice|audio|speech|say\s+(?:it|this)\s+out\s+loud|spoken)\b/i.test(reminderData.reminder_purpose)) {
              deliberateToolAllowedNames.push("generate_voice_message");
              deliberateToolTriggerMatches.push({
                toolName: "generate_voice_message",
                trigger: "voice reminder delivery",
                source: "built-in",
              });
            }

            const createTaskIndex = deliberateToolAllowedNames.indexOf("create_task");
            if (createTaskIndex !== -1) {
              deliberateToolAllowedNames.splice(createTaskIndex, 1);
            }
          }
          const deliberateToolTriggerMatchByToolName = new Map<string, DeliberateToolIntentMatch>();
          for (const match of deliberateToolTriggerMatches) {
            if (
              deliberateToolAllowedNames.includes(match.toolName) &&
              !deliberateToolTriggerMatchByToolName.has(match.toolName)
            ) {
              deliberateToolTriggerMatchByToolName.set(match.toolName, match);
            }
          }
          const deliberateToolIntent =
            deliberateToolAllowedNames.length > 0 || (streamingContext.endTurnAfterTools?.length ?? 0) > 0;
          const toolsDisabledByDeliberateMode =
            !streamingContext.disableAllTools && deliberateToolModeActive && !deliberateToolIntent;

          if (toolsDisabledByDeliberateMode) {
            streamingContext.disableAllTools = true;
            log.info(
              `Deliberate tool mode: suppressing tools for turn in channel ${channel.id} (no explicit tool intent)`,
            );
          } else if (
            deliberateToolModeActive &&
            !streamingContext.disableAllTools &&
            deliberateToolAllowedNames.length > 0
          ) {
            streamingContext.deliberateToolAllowedNames = Array.from(new Set(deliberateToolAllowedNames));
            log.info(
              `Deliberate tool mode: allowing scoped tools for turn in channel ${channel.id}: ${streamingContext.deliberateToolAllowedNames.join(", ")}`,
            );
          }

          if (streamingContext.disableAllTools && effectiveTomoriState.llm.has_tools) {
            effectiveTomoriState = {
              ...effectiveTomoriState,
              llm: {
                ...effectiveTomoriState.llm,
                has_tools: false,
              },
            };
            tomoriState = effectiveTomoriState;
            personaSnapshot = { ...personaSnapshot, tomoriState: effectiveTomoriState };
          }

          // Load emojis and stickers from 5-minute in-memory cache (lazy sync included)
          if (!isDMChannel && guild && currentPersona.server_id) {
            const { emojis, stickers } = await loadEmojiStickerCache(
              tomoriState.server_id,
              guild,
              effectiveEmojiEnabled,
              effectiveStickerEnabled,
            );

            loadedEmojis = emojis;
            loadedStickers = stickers;

            // Process emojis for conversion (if emoji usage is effectively enabled for this channel)
            if (effectiveEmojiEnabled && emojis && emojis.length > 0) {
              // Sort emojis by created_at timestamp, then by ID
              const sortedEmojis = [...emojis].sort((a, b) => {
                const rawATime = a.created_at ? new Date(a.created_at).getTime() : 0;
                const rawBTime = b.created_at ? new Date(b.created_at).getTime() : 0;
                const aTime = Number.isNaN(rawATime) ? 0 : rawATime;
                const bTime = Number.isNaN(rawBTime) ? 0 : rawBTime;
                if (aTime !== bTime) return aTime - bTime;
                const aId = a.server_emoji_id ?? 0;
                const bId = b.server_emoji_id ?? 0;
                if (aId !== bId) return aId - bId;
                return a.emoji_disc_id.localeCompare(b.emoji_disc_id);
              });

              // Convert to Discord emoji string format
              emojiStrings = sortedEmojis.map(
                (e) => `<${e.is_animated ? "a" : ""}:${e.emoji_name}:${e.emoji_disc_id}>`,
              );
            }
          }

          // Inject reminder into conversation history if needed
          // This makes the reminder part of the natural conversation flow rather than system injection
          if (reminderData && (reminderRecipientID || reminderData.self_reminder)) {
            const isSelfReminder = reminderData.self_reminder === true;
            let reminderContent = "";

            if (isSelfReminder) {
              reminderContent = `[System: A task reminder you set for yourself has triggered. Task: "${reminderData.reminder_purpose}". Please execute this task now.]`;
              if (reminderData.reminder_lateness) {
                reminderContent += `\n[System: This task is ${reminderData.reminder_lateness} overdue.]`;
              }
            } else if (reminderRecipientID && isBridgeUserId(reminderRecipientID)) {
              // Matrix user IDs (@user:server) must not be wrapped in <@...> Discord mention
              // format — that produces <@@user:server> (double @), which is malformed.
              // Strip the server suffix for display; use @{localpart} as the mention
              // placeholder (matrixRelay.ts converts this to a proper HTML Matrix mention).
              const matrixLocalpart = reminderRecipientID.split(":")[0].replace(/^@/, "");
              reminderContent = `[System: A reminder you set earlier for @${matrixLocalpart} (Mention ID: @{${matrixLocalpart}}) has triggered. Reminder: "${reminderData.reminder_purpose}". Focus on reminding and pinging @${matrixLocalpart} about this.]`;
              if (reminderData.reminder_lateness) {
                reminderContent += `\n[System: You are also ${reminderData.reminder_lateness} late in reminding the user.]`;
              }
            } else {
              reminderContent = `[System: A reminder you set earlier for <@${reminderRecipientID}> (Mention ID: ${reminderRecipientID}) has triggered. Reminder: "${reminderData.reminder_purpose}". Focus on reminding and pinging <@${reminderRecipientID}> about this.]`;
              if (reminderData.reminder_lateness) {
                reminderContent += `\n[System: You are also ${reminderData.reminder_lateness} late in reminding the user.]`;
              }
            }

            const fallbackAuthorId = client.user?.id ?? reminderRecipientID ?? "system";

            // Create synthetic simplified message for the reminder
            const reminderMessage: SimplifiedMessageForContext = {
              id: `synthetic-reminder-${Date.now()}`, // Synthetic ID for system-generated reminder
              authorId: fallbackAuthorId,
              authorName: "System", // Use bot's nickname
              authorType: "user",
              personaName: null,
              content: reminderContent,
              imageAttachments: [],
              videoAttachments: [],
            };

            // Add to end of conversation history so it gets processed naturally
            simplifiedMessages.push(reminderMessage);
            log.info(
              `Injected reminder into conversation history for ${isSelfReminder ? "self task" : `user ${reminderRecipientID}`} - will be processed by buildContext`,
            );
          }

          let manualContinuationDirective: string | null = null;

          // Inject continuation prompt for manual triggers when the selected persona is the last speaker
          // This fixes the UX issue where manual /bot respond commands
          // don't work if the selected persona was the last one to speak in the conversation
          // IMPORTANT: Skip this for reasoning queries - they have their own system message
          // IMPORTANT: Skip this for user impersonation - continuation directives conflict with role reversal
          if (
            isManuallyTriggered &&
            !isUserImpersonation &&
            !reasoningQuery &&
            !reminderRecipientID &&
            !reminderData?.self_reminder &&
            simplifiedMessages.length > 0
          ) {
            const lastMessage = simplifiedMessages[simplifiedMessages.length - 1];

            // 1. Check if the last message is from a persona
            const isFromPersona = lastMessage.authorType === "persona";

            // 2. Check if the last message is from the SELECTED persona (for alter support)
            const selectedPersonaNickname = selectedPersona?.tomori_nickname?.toLowerCase();
            const lastMessagePersonaNickname = lastMessage.personaName?.toLowerCase();
            const isFromSelectedPersona =
              isFromPersona && selectedPersonaNickname && lastMessagePersonaNickname === selectedPersonaNickname;

            // 3. Check if the last message contains embeds (skip continuation for embeds)
            const isEmbedMessage =
              lastMessage.content?.includes("[System: The following content came from a system-produced embed]") ??
              false;

            const isNovelaiKayraOrErato =
              tomoriState.llm.llm_provider === "novelai" &&
              (tomoriState.llm.llm_codename === "kayra-v1" || tomoriState.llm.llm_codename === "llama-3-erato-v1");
            const usePrefillContinuationDirective = Boolean(trimmedPrefill) && !isNovelaiKayraOrErato;
            if (trimmedPrefill && isNovelaiKayraOrErato) {
              log.info("Manual prefill directive skipped for NovelAI Kayra/Erato; relying on assistant prefill tail");
            }

            const shouldInjectContinuation =
              (isFromSelectedPersona && !isEmbedMessage) || usePrefillContinuationDirective;

            // 4. Only inject continuation if:
            //    - Last message is from the selected persona (and not an embed), OR
            //    - A manual prefill is provided (hybrid prefix)
            if (shouldInjectContinuation) {
              const continuationReason = usePrefillContinuationDirective
                ? "manual prefill"
                : `${selectedPersona?.tomori_nickname} as last speaker`;
              log.info(`Manual trigger detected (${continuationReason}) - injecting continuation prompt for UX`);

              const botName =
                currentPersona?.tomori_nickname ??
                tomoriState?.tomori_nickname ??
                process.env.DEFAULT_BOTNAME ??
                "Tomori";
              const continuationText = usePrefillContinuationDirective
                ? isFromSelectedPersona && !isEmbedMessage
                  ? `[Continue your last message without repeating it. Begin exactly with: "${botName}: ${trimmedPrefill}". Continue directly after it without repeating the prefix.]`
                  : `[Begin your next reply with: "${botName}: ${trimmedPrefill}". Continue directly after it without repeating the prefix.]`
                : "[Continue your last message without repeating it]";

              manualContinuationDirective = continuationText;
              log.info(`Captured continuation directive for ${selectedPersona?.tomori_nickname} response`);
            }
          }

          // 11. Build Context
          // The `buildContext` function will be refactored in a subsequent step to accept
          // `simplifiedMessages` and produce `StructuredContxtItem[]`.
          // For now, its signature and output type (ContextSegment[]) remain, but we pass the new data.
          let contextSegments: StructuredContextItem[] = [];

          // Resolve effective media-capability flags from the OpenRouter capability cache so the
          // context builder and stream adapter agree on whether image/video data should be included.
          // Without this, contextBuilder would fall back to the raw DB flag (which may be stale),
          // replacing image attachments with text placeholders before the provider ever sees them.
          let effectiveContextSeesImages: boolean | undefined;
          let effectiveContextSeesVideos: boolean | undefined;
          const activeLlm = tomoriState?.llm;
          if (
            activeLlm?.llm_provider === "openrouter" &&
            activeLlm.llm_codename !== "other-model" &&
            isOpenRouterCapabilityCacheReady()
          ) {
            const apiCaps = getOpenRouterCapabilities(activeLlm.llm_codename);
            if (apiCaps) {
              effectiveContextSeesImages = apiCaps.seesImages;
              effectiveContextSeesVideos = apiCaps.seesVideos;
            }
          }

          try {
            // NOTE: The `buildContext` call signature will change.
            // It will take `simplifiedMessageHistory: simplifiedMessages` instead of `conversationHistory`.
            // It will also need `tomoriNickname`, `tomoriAttributes`, and `tomoriConfig` to build system instructions.
            const contextBuild = await buildContext({
              guildId: serverDiscId,
              serverName,
              serverDescription: serverDescription ?? null,
              // conversationHistory: conversationHistory, // This parameter will be removed
              simplifiedMessageHistory: simplifiedMessages, // New parameter for structured history
              userList,
              matrixUsers: matrixUserMap,
              syntheticUsers: syntheticUserMap,
              channelDesc,
              channelName,
              channelId: channel.id, // For short-term memory context
              parentChannelId: channel.isThread() ? channel.parentId : null, // For thread → parent private/RP inheritance
              client,
              triggererName,
              emojiStrings,
              // Use the current persona nickname so role mapping and samples match the responding persona
              // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked
              tomoriNickname: currentPersona.tomori_nickname ?? tomoriState!.tomori_nickname,
              // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked
              tomoriAttributes: tomoriState!.attribute_list,
              // Use effectiveTomoriConfig so RP channels suppress emoji/sticker system instructions
              tomoriConfig: effectiveTomoriConfig,
              // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked
              personaPrompt: tomoriState!.persona_prompt ?? null,
              // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked
              personaLineageId: tomoriState!.persona_lineage_id,
              isDMChannel, // Pass DM channel flag for proper context building
              snapshot: personaSnapshot, // Use persona-specific snapshot for correct context
              preloadedEmojis: loadedEmojis, // Pass pre-loaded emoji data to avoid redundant DB query
              preloadedStickers: loadedStickers, // Pass pre-loaded sticker data to avoid redundant DB query
              isUserImpersonation, // Pass user impersonation flag (February 2026)
              impersonatedUserId, // Pass impersonated user ID (February 2026)
              impersonatedUserNickname: impersonatedIdentityName ?? impersonatedUserDbNickname, // Pass resolved identity name for context (February 2026)
              impersonatedUserPrompt,
              explicitLongTermMemoryIntent,
              // Pass API-resolved capability flags so the context builder matches the stream adapter
              seesImages: effectiveContextSeesImages,
              seesVideos: effectiveContextSeesVideos,
              // Vision tool available when: vision model configured AND chat model can't see images
              hasVisionTool: !!tomoriState?.vision_llm && !(effectiveContextSeesImages ?? tomoriState?.llm.sees_images),
              toolsDisabledForTurn: streamingContext.disableAllTools,
              messageIdMap,
            });
            contextSegments = appendInjectedContextItems(contextBuild.contextItems, injectedContextItems);

            // Truncate oldest dialogue history pairs if the conversation is approaching
            // the context window limit, ensuring the output budget is always preserved.
            // OpenRouter: uses the live capability cache (fetched at startup from their API).
            // Google:     uses the static GEMINI_TOKEN_LIMITS map (compile-time constant).
            // NovelAI:    uses perks.contextTokens from GET /user/subscription (cached per guild, 24h TTL).
            if (
              tomoriState.llm.llm_provider === "openrouter" &&
              tomoriState.llm.llm_codename !== "other-model" &&
              isOpenRouterCapabilityCacheReady()
            ) {
              const tokenLimits = getOpenRouterTokenLimits(tomoriState.llm.llm_codename);
              const openrouterTruncationOutputCap = Number.parseInt(
                process.env.OPENROUTER_MAX_OUTPUT_TOKENS || "8192",
                10,
              );
              if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
                const truncationMaxCompletionTokens = Math.min(
                  tokenLimits.maxCompletionTokens,
                  openrouterTruncationOutputCap,
                );
                const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } = truncateDialogueHistory(
                  contextSegments,
                  tokenLimits.contextLength,
                  truncationMaxCompletionTokens,
                );
                if (totalDropped > 0) {
                  log.warn(
                    `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ` +
                      `${sampleItemsDropped} sample dialogue item(s) for ` +
                      `${tomoriState.llm.llm_codename} to preserve output budget`,
                  );
                  contextSegments = truncated;
                }
              }
            } else if (tomoriState.llm.llm_provider === "google") {
              const tokenLimits = getGeminiTokenLimits(tomoriState.llm.llm_codename);
              if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
                const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } = truncateDialogueHistory(
                  contextSegments,
                  tokenLimits.contextLength,
                  tokenLimits.maxCompletionTokens,
                );
                if (totalDropped > 0) {
                  log.warn(
                    `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ` +
                      `${sampleItemsDropped} sample dialogue item(s) for ` +
                      `${tomoriState.llm.llm_codename} to preserve output budget`,
                  );
                  contextSegments = truncated;
                }
              }
            } else if (tomoriState.llm.llm_provider === "novelai") {
              // Look up subscription contextTokens for accurate tier-aware truncation.
              // If cache is cold (e.g. after bot restart), decrypt the key early and fetch.
              let naiSubscriptionTokens = getCachedContextTokens(serverDiscId);
              if (naiSubscriptionTokens === undefined && tomoriState.config.api_key) {
                try {
                  const tempKey = await decryptApiKey(tomoriState.config.api_key, tomoriState.config.key_version || 1);
                  naiSubscriptionTokens = await refreshNovelAISubscription(serverDiscId, tempKey);
                } catch {
                  // Subscription fetch failed; getNovelAITokenLimits will use env var fallback
                }
              }
              const tokenLimits = getNovelAITokenLimits(tomoriState.llm.llm_codename, naiSubscriptionTokens);
              if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
                const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } = truncateDialogueHistory(
                  contextSegments,
                  tokenLimits.contextLength,
                  tokenLimits.maxCompletionTokens,
                );
                if (totalDropped > 0) {
                  log.warn(
                    `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ` +
                      `${sampleItemsDropped} sample dialogue item(s) for ` +
                      `${tomoriState.llm.llm_codename} to preserve output budget`,
                  );
                  contextSegments = truncated;
                }
              }
            }

            const shouldApplyOpenRouterLengthRetryTrim =
              emptyResponseFinishReason === "length" && retryCount > 0 && tomoriState.llm.llm_provider === "openrouter";
            if (shouldApplyOpenRouterLengthRetryTrim) {
              const requestedPairDrops = OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS * retryCount;
              const { truncated, historyPairsDropped } = dropOldestHistoryExchangePairs(
                contextSegments,
                requestedPairDrops,
              );
              if (historyPairsDropped > 0) {
                log.warn(
                  `OpenRouter length-empty retry trimming: dropped ${historyPairsDropped}/${requestedPairDrops} oldest history exchange pair(s) on retry ${retryCount}.`,
                );
                contextSegments = truncated;
              } else {
                log.warn(
                  `OpenRouter length-empty retry trimming requested ${requestedPairDrops} pair drop(s), but no droppable history remained on retry ${retryCount}.`,
                );
              }
            }
            const lowerPriorityTailDirectives: string[] = [...contextBuild.lowerPriorityTailDirectives];
            const tailDirectives: string[] = [...contextBuild.tailDirectives];
            const uncensorDirective = contextBuild.uncensorDirective;
            if (manualContinuationDirective) {
              tailDirectives.push(manualContinuationDirective);
            }

            // Apply emoji repetition penalty if bot has been using too many emojis
            const emojiPenaltyDirective = getEmojiPenaltyDirective(
              contextSegments,
              isUserImpersonation ? null : (tomoriState?.tomori_nickname ?? process.env.DEFAULT_BOTNAME ?? "Tomori"),
            );
            if (emojiPenaltyDirective) {
              lowerPriorityTailDirectives.push(emojiPenaltyDirective);
            }

            // Inject system context for stop responses
            if (isStopResponse) {
              // Find the last user message in context for reference
              let lastUserContext: StructuredContextItem | undefined;
              for (let i = contextSegments.length - 1; i >= 0; i--) {
                if (contextSegments[i].role === "user") {
                  lastUserContext = contextSegments[i];
                  break;
                }
              }

              if (lastUserContext) {
                const originalContent = lastUserContext.parts
                  .filter((part) => part.type === "text")
                  .map((part) => (part as { type: "text"; text: string }).text)
                  .join(" ");
                tailDirectives.push(
                  `The user has requested you to stop your current generation. Original message: "${originalContent}"`,
                );
                log.info(`Captured stop response context. Original content: "${originalContent}"`);
              } else {
                tailDirectives.push("The user has requested you to stop your current generation.");
                log.info("Captured stop response context (no user context found)");
              }
            }

            // Inject reasoning query as user message in dialogue if provided
            if (reasoningQuery) {
              tailDirectives.push(
                `The user has activated reasoning mode with the following query: "${reasoningQuery}". Please provide a thoughtful, well-reasoned response to this query.`,
              );
              log.info(`Captured reasoning query for tail directives: "${reasoningQuery}"`);
            }

            // Inject manual system prompt at the end (for manual commands)
            if (manualSystemPrompt?.trim()) {
              const trimmedPrompt = manualSystemPrompt.trim();
              const directiveText = normalizeTailDirective(trimmedPrompt);
              if (directiveText) {
                tailDirectives.push(directiveText);
              }
              log.info(`Injected manual system prompt: "${trimmedPrompt}"`);
            }

            const lowerPriorityTailMessage = buildCombinedTailDirectiveMessage(lowerPriorityTailDirectives);
            if (lowerPriorityTailMessage) {
              insertBeforeLatestDialoguePair(contextSegments, lowerPriorityTailMessage);
            }

            const combinedTailMessage = buildCombinedTailDirectiveMessage(tailDirectives);
            if (combinedTailMessage) {
              contextSegments.push(combinedTailMessage);
            }

            // Keep queued reply guidance isolated so it does not collapse into
            // unrelated tail notes like emoji penalties or STM reminders.
            const queuedReplyTailMessage = buildTailDirectiveMessage(
              getQueuedReplyDirective(currentPersona.tomori_nickname ?? tomoriState?.tomori_nickname),
            );
            if (queuedReplyTailMessage) {
              contextSegments.push(queuedReplyTailMessage);
            }

            // Keep uncensor isolated and last so it retains the strongest recency signal.
            const uncensorTailMessage = buildTailDirectiveMessage(uncensorDirective);
            if (uncensorTailMessage) {
              contextSegments.push(uncensorTailMessage);
            }

            // Inject assistant prefill as the final context item (for manual commands)
            if (trimmedPrefill) {
              const botName =
                currentPersona?.tomori_nickname ??
                tomoriState?.tomori_nickname ??
                process.env.DEFAULT_BOTNAME ??
                "Tomori";
              const prefillMessage: StructuredContextItem = {
                role: "model",
                parts: [{ type: "text", text: `${botName}: ${trimmedPrefill}` }],
                metadataTag: ContextItemTag.DIALOGUE_HISTORY,
              };
              contextSegments.push(prefillMessage);
              log.info(`Injected manual prefill: "${trimmedPrefill}"`);
            }
          } catch (error) {
            log.error("Error building context for LLM API Call:", error, {
              serverId: tomoriState?.server_id, // Use internal DB ID if available
              errorType: "ContextBuildingError",
              metadata: {
                guildId: serverDiscId,
                channelName: channelName, // Use the channelName variable we already calculated
                userCountInContext: userList.length,
              },
            });
            await sendChannelEmbedOrFailImpersonation(
              {
                color: ColorCode.ERROR,
                titleKey: "general.errors.context_error_title",
                descriptionKey: "general.errors.context_error_description",
                footerKey: "genai.generic_error_footer",
              },
              "User impersonation failed while building the response context.",
              error,
            );
            return;
          }
          // API Key Selection with Rotation Support
          // 1. Check if rotation is active (2+ keys in pool)
          // 2. If active, use round-robin selection with cooldown filtering
          // 3. If not active or all keys exhausted, fall back to main key
          let decryptedApiKey: string;
          let selectedKeyResult: SelectedKeyResult | null = null;

          // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked earlier
          const rotationActive = (tomoriState!.rotation_keys?.length ?? 0) >= 2;
          const excludedRotationKeyIds = new Set<number>();

          const decryptMainKey = async (allowLazyRotation: boolean) => {
            // biome-ignore lint/style/noNonNullAssertion: API key presence was validated earlier
            const keyVersion = tomoriState!.config.key_version || 1; // Default to V1 for backward compatibility
            const decryptedKey = await decryptApiKey(
              // biome-ignore lint/style/noNonNullAssertion: API key presence was validated earlier
              tomoriState!.config.api_key!,
              keyVersion,
            );

            if (allowLazyRotation) {
              // LAZY ROTATION: If using old key version, re-encrypt with current version
              const currentVersion = keyManager.getCurrentVersion();
              if (keyVersion !== currentVersion) {
                log.info(
                  `Rotating main API key from version ${keyVersion} to ${currentVersion} for server ${tomoriState?.server_id}`,
                );

                try {
                  const { encryptApiKey } = await import("@/utils/security/crypto");
                  const { encrypted, version } = await encryptApiKey(decryptedKey);

                  await sql`
										UPDATE tomori_configs
										SET api_key = ${encrypted},
										    key_version = ${version},
										    updated_at = CURRENT_TIMESTAMP
										WHERE server_id = ${tomoriState?.server_id}
									`;

                  log.success(`Main API key rotation completed for server ${tomoriState?.server_id}`);

                  // Update in-memory state to reflect the new version
                  // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked earlier
                  tomoriState!.config.api_key = encrypted;
                  // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked earlier
                  tomoriState!.config.key_version = version;
                } catch (error) {
                  log.warn("Failed to rotate main API key (non-critical - will retry on next message)", error);
                  // Continue execution - the old key still works
                }
              }
            }

            return decryptedKey;
          };

          const selectApiKeyForAttempt = async (): Promise<{
            apiKey: string;
            selectedKeyResult: SelectedKeyResult | null;
          }> => {
            if (rotationActive) {
              // Try to select a key from the rotation pool

              const selected = await selectApiKey(
                // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked earlier
                tomoriState!,
                Array.from(excludedRotationKeyIds),
              );

              if (selected) {
                log.info(
                  `Using rotation key ${selected.rotationKeyId} (main: ${selected.isMainKey}) for server ${tomoriState?.server_id}`,
                );
                return { apiKey: selected.apiKey, selectedKeyResult: selected };
              }

              // All rotation keys exhausted or in cooldown, fall back to main key
              log.warn(`All rotation keys exhausted for server ${tomoriState?.server_id}, falling back to main key`);
              return {
                apiKey: await decryptMainKey(false),
                selectedKeyResult: null,
              };
            }

            // No rotation active, use main key directly
            return {
              apiKey: await decryptMainKey(true),
              selectedKeyResult: null,
            };
          };

          const initialKeySelection = await selectApiKeyForAttempt();
          decryptedApiKey = initialKeySelection.apiKey;
          selectedKeyResult = initialKeySelection.selectedKeyResult;

          if (!decryptedApiKey) {
            log.error("API Key is not set or failed to decrypt.", undefined, {
              serverId: tomoriState?.server_id,
              errorType: "ApiKeyError",
            });
            await sendChannelEmbedOrFailImpersonation(
              {
                color: ColorCode.ERROR,
                titleKey: "general.errors.api_key_error_title",
                descriptionKey: "general.errors.api_key_error_description",
              },
              "User impersonation could not start because the API key is unavailable.",
            );
            return;
          }

          // 12. Generate Response - Get provider instance

          // Get the appropriate provider based on TomoriState configuration
          let provider: LLMProvider;
          try {
            provider = await getProviderForTomori(tomoriState);
          } catch (error) {
            log.error(
              `Failed to get LLM provider: ${error instanceof Error ? error.message : String(error)}`,
              error as Error,
              {
                serverId: tomoriState?.server_id,
                errorType: "ProviderError",
                metadata: {
                  configuredProvider: tomoriState?.llm.llm_provider,
                  configuredModel: tomoriState?.llm.llm_codename,
                },
              },
            );
            await sendChannelEmbedOrFailImpersonation(
              {
                color: ColorCode.ERROR,
                titleKey: "general.errors.provider_not_supported_title",
                descriptionKey: "general.errors.provider_not_supported_description",
                descriptionVars: {
                  provider: tomoriState?.llm.llm_provider || "unknown",
                },
              },
              "User impersonation could not start because the configured provider is unavailable.",
              error,
            );
            return;
          }

          // Create provider-specific configuration
          // If model override is specified, temporarily modify tomoriState
          let originalModelCodename: string | undefined;
          if (llmOverrideCodename) {
            originalModelCodename = tomoriState.llm.llm_codename;
            tomoriState.llm.llm_codename = llmOverrideCodename;
            log.info(`Overriding model from ${originalModelCodename} to ${llmOverrideCodename} for manual command`);
          }

          // Use effectiveTomoriState (immutable shallow copy) for createConfig so the provider's
          // StreamConfig reflects RP channel suppression without mutating the cached TomoriState.
          // Must be `let` so the fallback model loop can recreate config for each new model.
          let providerConfig = await provider.createConfig(effectiveTomoriState, decryptedApiKey);

          // Thread the subscription-derived Kayra context limit into providerConfig so the
          // secondary dynamic cap in novelaiStreamAdapter uses the correct tier limit
          // (not the env var default of 8192) for Tablet users (4096) and others.
          if (tomoriState.llm.llm_provider === "novelai") {
            const cachedKayraLimit = getCachedContextTokens(serverDiscId);
            if (cachedKayraLimit !== undefined) {
              (providerConfig as NovelaiStreamConfig).kayraContextLimit = cachedKayraLimit;
            }
          }

          // Restore original model if it was overridden
          if (originalModelCodename) {
            tomoriState.llm.llm_codename = originalModelCodename;
          }

          log.info("Streaming mode enabled. Attempting to stream response to Discord.");

          // Resolve persona webhook and avatar/username for webhook-based sending
          // Only use webhook for alter personas (not main) in guild channels (not DMs)
          let personaWebhook = channelWebhook;
          if (!personaWebhook && supportsWebhooks && currentPersona.is_alter && hasWebhookMethods) {
            const webhookResult = await getOrCreateWebhook(webhookTargetChannel as BaseGuildTextChannel);
            personaWebhook = webhookResult.webhook;
            if (!personaWebhook && webhookResult.errorReason && !webhookErrorNotified) {
              await sendWebhookErrorEmbed(channel, locale, webhookResult.errorReason);
              webhookErrorNotified = true;
            }
          }

          // Create temporary webhook for user impersonation
          if (isUserImpersonation && impersonatedUserId && supportsWebhooks) {
            try {
              // Create temporary webhook with impersonated user's Discord identity
              const tempWebhook = await (channel as TextChannel).createWebhook({
                name: impersonatedIdentityName || "User",
                avatar: impersonatedIdentityAvatarUrl || undefined,
                reason: "TomoriBot user impersonation",
              });

              cacheUserImpersonationWebhook(tempWebhook.id, impersonatedUserId);
              temporaryUserImpersonationWebhook = tempWebhook;
              personaWebhook = tempWebhook;
              log.info(`Created temporary webhook for user impersonation: ${impersonatedIdentityName || "User"}`);
            } catch (error) {
              log.error("Failed to create temporary webhook for user impersonation", {
                error,
                impersonatedUserId,
              });
              throw error instanceof Error
                ? error
                : new Error("Failed to create temporary webhook for user impersonation.");
            }
          }

          const resolvedPersonaIdentity =
            !isUserImpersonation && personaWebhook && guild && currentPersona.is_alter
              ? await resolvePersonaWebhookIdentity(currentPersona, guild)
              : undefined;
          const personaAvatarUrl = isUserImpersonation
            ? undefined
            : (resolvedPersonaIdentity?.avatarDataUri ?? resolvedPersonaIdentity?.avatarUrl);

          // For user impersonation: separate webhook display name from prefix stripping name
          let personaUsername: string | undefined;
          let prefixStrippingName: string | undefined;

          if (isUserImpersonation && impersonatedUserId) {
            // Webhook display: use Discord display name (e.g., "bredrumb")
            personaUsername = impersonatedIdentityName || "User";
            // Prefix stripping: prefer webhook/display identity to match the
            // impersonation directive; fall back to DB nickname if needed.
            prefixStrippingName = personaUsername || impersonatedUserDbNickname;
          } else if (personaWebhook && currentPersona.is_alter) {
            // For alter personas, use persona nickname for both
            personaUsername = resolvedPersonaIdentity?.username ?? currentPersona.tomori_nickname;
            prefixStrippingName = undefined; // Will fall back to personaUsername
          } else {
            personaUsername = undefined;
            prefixStrippingName = undefined;
          }

          const currentThoughtLogOwner: ThoughtLogOwner = isUserImpersonation
            ? {
                type: "user_impersonation",
                username: impersonatedIdentityName || "User",
                avatarUrl: impersonatedIdentityAvatarUrl ?? undefined,
              }
            : currentPersona.is_alter
              ? {
                  type: "persona",
                  persona: currentPersona,
                }
              : {
                  type: "default",
                };

          const outputPrefill = trimmedPrefill
            ? `${currentPersona?.tomori_nickname ?? tomoriState?.tomori_nickname ?? process.env.DEFAULT_BOTNAME ?? "Tomori"}: ${trimmedPrefill}`
            : undefined;

          if (outputPrefill) {
            if (streamingContext.outputPrefill !== outputPrefill) {
              streamingContext.outputPrefill = outputPrefill;
              streamingContext.outputPrefillState = { sent: false };
            } else if (!streamingContext.outputPrefillState) {
              streamingContext.outputPrefillState = { sent: false };
            }
          } else {
            streamingContext.outputPrefill = undefined;
            streamingContext.outputPrefillState = undefined;
          }
          streamingContext.replyNoticeState = { attempted: false, sent: false };

          // NAI GLM-4.6 continuation: if retrying with a prompt continuation fragment,
          // also set it as the output prefill so Discord shows the complete sentence
          // (prefill + model continuation) rather than just the mid-word continuation.
          if (naiContinuationPrefill && !streamingContext.outputPrefill) {
            streamingContext.outputPrefill = naiContinuationPrefill;
            streamingContext.outputPrefillState = { sent: false };
          }

          // 1. Initialize variables for the function calling loop in streaming mode
          let selectedStickerToSend: Sticker | null = null;
          const functionInteractionHistory: {
            functionCall: FunctionCall;
            functionResponse: Record<string, unknown>;
            imageMetadata?: FunctionResponseImageMetadata;
            /** Text parts the model generated before the function call (prevents repetition on continuation) */
            preToolCallTextParts?: Array<Record<string, unknown>>;
          }[] = [];
          let finalStreamCompleted = false;
          let finalAccumulatedText = ""; // Track accumulated text from successful stream
          let finalDetailsContent = ""; // Track extracted <details> block content for STM
          const accumulatedStreamedModelParts: Array<Record<string, unknown>> = [];
          let personaThoughtLog: ThoughtLogPayload | undefined;
          let personaStreamCompletedSuccessfully = false;
          let naiConsecutiveToolFailures = 0; // Tracks consecutive tool failures for NAI GLM retry logic (Case 2)
          // 1. Provider-agnostic flail detector: counts any consecutive tool execution failure
          //    (success:false, including recoverable sticker misses). Resets on any successful
          //    tool call. Breaks the turn with an error embed once MAX_CONSECUTIVE_TOOL_ERRORS is hit.
          let consecutiveToolErrors = 0;

          for (let i = 0; i < MAX_FUNCTION_CALL_ITERATIONS; i++) {
            // Between tool-call iterations, check for stop requests (but NOT follow-ups).
            // Follow-ups during tool chains are now queued without interrupt (see isInToolCallChain),
            // so tool progress is preserved. The follow-up processes after the chain completes.
            // Only regular stop requests should abort the tool chain here.
            if (i > 0 && StreamOrchestrator.hasStopRequest(channel.id)) {
              if (StreamOrchestrator.isFollowUpRequest(channel.id)) {
                // Follow-up arrived during the initial text stream before tools started.
                // Now that we're mid-tool-chain, clear it and let the chain finish.
                // The follow-up message is already queued and will be processed after.
                log.info(
                  `Follow-up request found between tool-call iterations (iteration ${i}) for channel ${channel.id}. ` +
                    `Clearing interrupt to preserve tool chain progress — follow-up is queued.`,
                );
                StreamOrchestrator.clearStopRequest(channel.id);
                // Don't break — continue the tool chain
              }
              // Regular stop requests fall through to the stream loop's built-in handling
            }

            // Soft-warn once at the threshold so users know the task is taking many steps.
            if (i === SOFT_WARN_ITERATION_THRESHOLD) {
              log.info(
                `Tool-call iteration ${i} reached soft-warn threshold in channel ${channel.id}. Sending still-working notice.`,
              );
              await sendStandardEmbed(channel, locale, {
                color: ColorCode.WARN,
                titleKey: "genai.still_working_title",
                descriptionKey: "genai.still_working_description",
              });
            }

            try {
              // Debug: Log final context right before sending to LLM
              if (reminderRecipientID) {
                for (let i = Math.max(0, contextSegments.length - 3); i < contextSegments.length; i++) {
                  const segment = contextSegments[i];
                  const textParts = segment.parts
                    .filter((p) => p.type === "text")
                    .map((p) => (p as { type: "text"; text: string }).text)
                    .join(" ");
                  log.info(
                    `  [${i}] ${segment.role}: ${textParts.substring(0, 100)}${textParts.length > 100 ? "..." : ""}`,
                  );
                }
                // Show the complete last segment if it's the system message
                const lastSegment = contextSegments[contextSegments.length - 1];
                if (lastSegment.role === "user") {
                  const fullText = lastSegment.parts
                    .filter((p) => p.type === "text")
                    .map((p) => (p as { type: "text"; text: string }).text)
                    .join(" ");
                  if (fullText.includes("[System:")) {
                    log.info(`Complete system message: ${fullText}`);
                  }
                }
              }

              // Create isolated copies for each persona to prevent context pollution
              const personaAccumulatedParts = [...accumulatedStreamedModelParts];
              const personaFunctionHistory = [...functionInteractionHistory];
              const runStreamWithKeyRetry = async (): Promise<{
                streamResult: StreamResult | null;
                abort: boolean;
              }> => {
                if (!tomoriState) {
                  log.error("TomoriState missing during stream retry loop.", undefined, {
                    errorType: "TomoriStateMissing",
                    metadata: {
                      channelId: channel.id,
                    },
                  });
                  return { streamResult: null, abort: true };
                }

                const activeTomoriState = effectiveTomoriState;
                let attemptCount = 0;
                let lastStreamResult: StreamResult | null = null;

                while (true) {
                  attemptCount += 1;
                  if (attemptCount > MAX_KEY_ATTEMPTS) {
                    log.warn(
                      `Exceeded MAX_KEY_ATTEMPTS (${MAX_KEY_ATTEMPTS}) for server ${activeTomoriState.server_id}. Returning last stream result.`,
                    );
                    return {
                      streamResult: lastStreamResult,
                      abort: !lastStreamResult,
                    };
                  }

                  const fallbackExcludeIds = [...Array.from(excludedRotationKeyIds)];
                  if (selectedKeyResult?.rotationKeyId != null) {
                    fallbackExcludeIds.push(selectedKeyResult.rotationKeyId);
                  }

                  const hasFallbackKey =
                    rotationActive && (await hasAvailableRotationKey(activeTomoriState, fallbackExcludeIds));

                  // Suppress errors if rotation keys remain OR if model fallbacks are pending
                  streamingContext.suppressUserErrors =
                    hasFallbackKey || (streamingContext.forceModelFallback ?? false);

                  // Keep provider config in sync with the selected key
                  if (providerConfig.apiKey !== decryptedApiKey) {
                    providerConfig.apiKey = decryptedApiKey;
                  }

                  // 1. Create an AbortController so the SDK timeout can terminate the underlying HTTP request
                  const sdkAbortController = new AbortController();
                  streamingContext.abortSignal = sdkAbortController.signal;
                  let sdkTimeoutId: NodeJS.Timeout | null = null;
                  let sdkTimeoutReject: ((reason?: unknown) => void) | null = null;
                  const clearSdkTimeout = () => {
                    if (sdkTimeoutId) {
                      clearTimeout(sdkTimeoutId);
                      sdkTimeoutId = null;
                    }
                  };
                  const refreshSdkTimeout = () => {
                    clearSdkTimeout();
                    sdkTimeoutId = setTimeout(() => {
                      sdkAbortController.abort();
                      sdkTimeoutReject?.(new Error("SDK_CALL_TIMEOUT: provider streamToDiscord call timed out."));
                    }, STREAM_SDK_CALL_TIMEOUT_MS);
                  };
                  streamingContext.onStreamProgress = refreshSdkTimeout;

                  const streamProviderPromise = provider.streamToDiscord(
                    channel,
                    client,
                    activeTomoriState,
                    providerConfig,
                    contextSegments, // Can be shared (read-only message history)
                    personaAccumulatedParts, // Isolated per persona
                    emojiStrings,
                    personaFunctionHistory.length > 0 ? personaFunctionHistory : undefined, // Isolated per persona
                    undefined,
                    isFromQueue ? message : undefined,
                    streamingContext, // Pass streaming context for context-aware tool availability
                    locale, // Pass user's preferred locale for error messages
                    personaWebhook ?? undefined, // Pass webhook for alter persona avatar support
                    personaAvatarUrl, // Pass resolved avatar URL
                    personaUsername, // Pass persona username
                    prefixStrippingName, // Pass prefix stripping name for user impersonation
                  );

                  // 2. Race the stream against a refreshable timeout that also aborts the underlying HTTP request
                  const timeoutPromise = new Promise<never>((_, reject) => {
                    sdkTimeoutReject = reject;
                  });
                  refreshSdkTimeout();

                  let streamResult: StreamResult;
                  try {
                    // Promise.race will settle as soon as one of the promises settles
                    streamResult = await Promise.race([streamProviderPromise, timeoutPromise]);
                    // Stream completed before timeout — clear the pending timer
                    clearSdkTimeout();
                  } catch (raceError) {
                    // Clear timeout if the stream itself threw before the timer fired
                    clearSdkTimeout();
                    streamingContext.onStreamProgress = undefined;

                    // This catch block will execute if timeoutPromise rejects first,
                    // or if streamProviderPromise itself rejects *before* the timeout.
                    if (raceError instanceof Error && raceError.message.startsWith("SDK_CALL_TIMEOUT:")) {
                      log.error(
                        `Provider streamToDiscord call timed out for channel ${channel.id}.`,
                        raceError, // Log the timeout error
                        {
                          serverId: tomoriState?.server_id,
                          errorType: "SDKTimeoutError",
                        },
                      );
                      if (isUserImpersonation) {
                        throw new Error("User impersonation timed out before a reply could be sent.");
                      }
                      await sendStandardEmbed(channel, locale, {
                        color: ColorCode.ERROR, // Using ERROR as it's a more critical failure
                        titleKey: "genai.error_stream_timeout_title",
                        descriptionKey: "genai.error_stream_timeout_description",
                      });
                      return { streamResult: null, abort: true };
                    }
                    // If it's not our specific timeout error, re-throw to be caught by the outer catch
                    throw raceError;
                  }
                  streamingContext.onStreamProgress = undefined;

                  lastStreamResult = streamResult;

                  if (streamResult.status === "error" && hasFallbackKey) {
                    log.warn(
                      `Streaming failed with rotation key ${selectedKeyResult?.rotationKeyId}. Retrying with another key.`,
                    );
                    streamingContext.rotationKeyRetriesUsed = true;

                    // Record error for rotation key if one was used and error is key-related
                    if (selectedKeyResult?.rotationKeyId && streamResult.data) {
                      const errorData = streamResult.data as {
                        type?: string;
                        message?: string;
                        code?: string;
                      };
                      const errorMessage =
                        errorData.message ||
                        (streamResult.data instanceof Error ? streamResult.data.message : "Unknown error");

                      if (errorData.type === "rate_limit") {
                        await recordKeyError(
                          selectedKeyResult.rotationKeyId,
                          "rate_limit",
                          errorMessage || "Rate limit exceeded",
                        );
                      } else if (
                        errorData.type === "api_error" ||
                        errorData.code === "401" ||
                        errorData.code === "403"
                      ) {
                        await recordKeyError(
                          selectedKeyResult.rotationKeyId,
                          "api_error",
                          errorMessage || "API authentication error",
                        );
                      }
                    }

                    if (selectedKeyResult?.rotationKeyId) {
                      excludedRotationKeyIds.add(selectedKeyResult.rotationKeyId);
                    }

                    const nextKeySelection = await selectApiKeyForAttempt();
                    decryptedApiKey = nextKeySelection.apiKey;
                    selectedKeyResult = nextKeySelection.selectedKeyResult;

                    if (!decryptedApiKey) {
                      log.error("API Key is not set or failed to decrypt during retry.", undefined, {
                        serverId: tomoriState?.server_id,
                        errorType: "ApiKeyError",
                      });
                      await sendChannelEmbedOrFailImpersonation(
                        {
                          color: ColorCode.ERROR,
                          titleKey: "general.errors.api_key_error_title",
                          descriptionKey: "general.errors.api_key_error_description",
                        },
                        "User impersonation could not continue because the API key became unavailable during retry.",
                      );
                      return { streamResult: null, abort: true };
                    }

                    continue;
                  }

                  return { streamResult, abort: false };
                }
              };

              // --- Model Fallback Types ---
              interface FallbackAttempt {
                modelCodename: string;
                errorCode: string;
              }
              interface FallbackRunResult {
                streamResult: StreamResult | null;
                abort: boolean;
                // null = primary succeeded; populated array = primary failed, fallback succeeded
                fallbackUsed: FallbackAttempt[] | null;
                successModel: import("@/types/db/schema").LlmRow | null;
              }

              /**
               * Extracts a short error code string from a StreamResult for display in the
               * fallback info embed chain (e.g., "503", "rate_limit", "unknown").
               */
              const extractErrorCode = (result: StreamResult): string => {
                if (!result.data) return "unknown";
                const d = result.data as {
                  type?: string;
                  code?: string;
                  message?: string;
                };
                return d.code ?? d.type ?? "unknown";
              };

              /**
               * Wraps `runStreamWithKeyRetry` with model-level fallback logic.
               * If the primary model errors and fallback LLMs are configured,
               * retries each fallback in order until one succeeds or all fail.
               *
               * Closes over: effectiveTomoriState, providerConfig, decryptedApiKey,
               * selectedKeyResult, excludedRotationKeyIds, streamingContext, tomoriState,
               * provider, serverDiscId (for NovelAI context limit re-application).
               */
              const runWithFallbackModels = async (): Promise<FallbackRunResult> => {
                // Snapshot the original effective state to restore after the function completes
                // (prevents mutations from persisting to subsequent function calls)
                const originalEffectiveTomoriState = effectiveTomoriState;
                const primaryEffectiveTomoriState = effectiveTomoriState;
                const primaryProvider = primaryEffectiveTomoriState.llm.llm_provider.toLowerCase();

                // Build fallback chain: personal provider uses isolated chain, others use hierarchy
                const configuredFallbacks: FallbackEntry[] =
                  tomoriState?.fallback_chain ??
                  (tomoriState?.fallback_llms ?? []).map((m) => ({ kind: "llm" as const, model: m }));

                const seenLlmIds = new Set<number>();
                seenLlmIds.add(primaryEffectiveTomoriState.llm.llm_id ?? -1);

                let fallbackChain: FallbackEntry[];

                if (textCredentialSource === "personal") {
                  // Personal provider: use only personal fallback chain (no server hierarchy)
                  fallbackChain = configuredFallbacks;
                } else {
                  // Server provider: build hierarchy chain (persona → channel → server → configured)
                  const hierarchyFallbacks: FallbackEntry[] = [];

                  // 1. Add channel override if it exists and differs from primary
                  if (channelLlmOverride && channelLlmOverride.llm_id !== primaryEffectiveTomoriState.llm.llm_id) {
                    hierarchyFallbacks.push({ kind: "llm" as const, model: channelLlmOverride });
                    seenLlmIds.add(channelLlmOverride.llm_id ?? -1);
                  }

                  // 2. Add server global model if it differs from primary
                  if (personaBaseState.llm.llm_id !== primaryEffectiveTomoriState.llm.llm_id) {
                    hierarchyFallbacks.push({ kind: "llm" as const, model: personaBaseState.llm });
                    seenLlmIds.add(personaBaseState.llm.llm_id ?? -1);
                  }

                  // 3. Add configured fallbacks (excluding duplicates from hierarchy)
                  fallbackChain = [
                    ...hierarchyFallbacks,
                    ...configuredFallbacks.filter((entry) => {
                      if (entry.kind === "llm") {
                        return !seenLlmIds.has(entry.model.llm_id ?? -1);
                      }
                      return true; // Always include custom endpoints
                    }),
                  ];
                }

                // 1. Attempt with the primary model
                streamingContext.forceModelFallback = fallbackChain.length > 0;
                const primaryResult = await runStreamWithKeyRetry();

                if (primaryResult.abort) {
                  streamingContext.forceModelFallback = false;
                  effectiveTomoriState = originalEffectiveTomoriState;
                  return {
                    streamResult: null,
                    abort: true,
                    fallbackUsed: null,
                    successModel: null,
                  };
                }

                if (!primaryResult.streamResult || primaryResult.streamResult.status !== "error") {
                  // Primary succeeded (or returned a non-error status)
                  streamingContext.forceModelFallback = false;
                  effectiveTomoriState = originalEffectiveTomoriState;
                  return {
                    ...primaryResult,
                    fallbackUsed: null,
                    successModel: null,
                  };
                }

                // 2. Primary errored — enter fallback loop
                const failures: FallbackAttempt[] = [
                  {
                    modelCodename: primaryEffectiveTomoriState.llm.llm_codename,
                    errorCode: extractErrorCode(primaryResult.streamResult),
                  },
                ];
                let lastResult = primaryResult;

                for (let fi = 0; fi < fallbackChain.length; fi++) {
                  const entry = fallbackChain[fi];
                  const isLast = fi === fallbackChain.length - 1;

                  // 2a. Derive a display codename and swap in the fallback model
                  let fallbackCodename: string;

                  if (entry.kind === "llm") {
                    fallbackCodename = entry.model.llm_codename;
                    log.info(
                      `Primary model failed (${failures[0].errorCode}). ` +
                        `Trying fallback ${fi + 1}/${fallbackChain.length}: ${fallbackCodename}`,
                    );

                    effectiveTomoriState = {
                      ...effectiveTomoriState,
                      llm: {
                        ...entry.model,
                        has_tools: streamingContext.disableAllTools ? false : entry.model.has_tools,
                      },
                    };

                    const fallbackProviderName = entry.model.llm_provider.toLowerCase();
                    if (fallbackProviderName !== primaryProvider) {
                      // Cross-provider fallback — load saved config for the fallback provider.
                      // Same pattern as persona override (see line ~5364).
                      const fallbackSavedConfig = await loadSavedProviderConfig(
                        primaryEffectiveTomoriState.server_id,
                        fallbackProviderName,
                      );
                      if (!fallbackSavedConfig?.api_key) {
                        log.warn(
                          `Cross-provider fallback skipped: no saved config/key for provider ${fallbackProviderName}`,
                        );
                        failures.push({ modelCodename: fallbackCodename, errorCode: "NO_PROVIDER_CONFIG" });
                        continue;
                      }
                      provider = await ProviderFactory.getProviderByName(fallbackProviderName);
                      decryptedApiKey = await decryptApiKey(
                        fallbackSavedConfig.api_key,
                        fallbackSavedConfig.key_version ?? 1,
                      );
                    } else {
                      // Same provider — use existing key rotation
                      excludedRotationKeyIds.clear();
                      const resetKeySelection = await selectApiKeyForAttempt();
                      decryptedApiKey = resetKeySelection.apiKey;
                      selectedKeyResult = resetKeySelection.selectedKeyResult;
                    }

                    // Re-apply NovelAI subscription context limit when relevant
                    if (entry.model.llm_provider === "novelai") {
                      const cachedKayraLimit = getCachedContextTokens(serverDiscId);
                      if (cachedKayraLimit !== undefined) {
                        (providerConfig as NovelaiStreamConfig).kayraContextLimit = cachedKayraLimit;
                      }
                    }
                  } else {
                    // Custom endpoint fallback
                    const ep = entry.endpoint;
                    fallbackCodename = `${ep.label}:${ep.model_name ?? ep.label}`;
                    log.info(
                      `Primary model failed (${failures[0].errorCode}). ` +
                        `Trying fallback ${fi + 1}/${fallbackChain.length}: ${fallbackCodename} (custom endpoint)`,
                    );

                    // Load the saved provider config for this custom endpoint label to get the API key
                    const customProviderName = `custom:s${primaryEffectiveTomoriState.server_id}:${ep.label}`;
                    const fallbackSavedConfig = await loadSavedProviderConfig(
                      primaryEffectiveTomoriState.server_id,
                      customProviderName,
                    );
                    if (!fallbackSavedConfig?.api_key) {
                      log.warn(`Custom endpoint fallback skipped: no saved config/key for ${customProviderName}`);
                      failures.push({ modelCodename: fallbackCodename, errorCode: "NO_PROVIDER_CONFIG" });
                      continue;
                    }

                    provider = await ProviderFactory.getProviderByName("custom");
                    decryptedApiKey = await decryptApiKey(
                      fallbackSavedConfig.api_key,
                      fallbackSavedConfig.key_version ?? 1,
                    );

                    // Patch the effective state with the endpoint's URL and model name, and synthesise
                    // an LlmRow so the downstream pipeline has a valid .llm field to inspect.
                    effectiveTomoriState = {
                      ...effectiveTomoriState,
                      config: {
                        ...effectiveTomoriState.config,
                        custom_endpoint_url: ep.endpoint_url,
                        custom_model_name: ep.model_name ?? null,
                      },
                      llm: {
                        ...effectiveTomoriState.llm,
                        llm_codename: ep.model_name ?? ep.label,
                        llm_provider: "custom",
                        has_tools: streamingContext.disableAllTools ? false : ep.has_tools,
                        sees_images: ep.sees_images,
                        sees_videos: ep.sees_videos,
                        supports_structoutput: ep.supports_structoutput,
                      },
                    };
                  }

                  providerConfig = await provider.createConfig(effectiveTomoriState, decryptedApiKey);

                  if (!decryptedApiKey) {
                    log.error("API key unavailable during fallback model attempt", undefined, {
                      serverId: tomoriState?.server_id,
                      errorType: "ApiKeyError",
                    });
                    streamingContext.forceModelFallback = false;
                    effectiveTomoriState = originalEffectiveTomoriState;
                    return {
                      streamResult: lastResult.streamResult,
                      abort: false,
                      fallbackUsed: null,
                      successModel: null,
                    };
                  }

                  // 2b. Show error on last attempt; suppress on all earlier attempts
                  streamingContext.forceModelFallback = !isLast;

                  const fallbackResult = await runStreamWithKeyRetry();
                  lastResult = fallbackResult;

                  if (fallbackResult.abort) {
                    streamingContext.forceModelFallback = false;
                    effectiveTomoriState = originalEffectiveTomoriState;
                    return {
                      streamResult: null,
                      abort: true,
                      fallbackUsed: null,
                      successModel: null,
                    };
                  }

                  if (!fallbackResult.streamResult || fallbackResult.streamResult.status !== "error") {
                    // This fallback succeeded
                    streamingContext.forceModelFallback = false;
                    const successModel = entry.kind === "llm" ? entry.model : effectiveTomoriState.llm;
                    effectiveTomoriState = originalEffectiveTomoriState;
                    return {
                      streamResult: fallbackResult.streamResult,
                      abort: false,
                      fallbackUsed: failures,
                      successModel: successModel,
                    };
                  }

                  failures.push({
                    modelCodename: fallbackCodename,
                    errorCode: extractErrorCode(fallbackResult.streamResult),
                  });
                }

                // 3. All models failed — restore primary state for clean teardown
                streamingContext.forceModelFallback = false;
                effectiveTomoriState = originalEffectiveTomoriState;
                return {
                  streamResult: lastResult.streamResult,
                  abort: false,
                  fallbackUsed: null,
                  successModel: null,
                };
              };

              let streamResult: StreamResult | null = null;
              const fallbackRunResult = await runWithFallbackModels();
              if (fallbackRunResult.abort) {
                if (isUserImpersonation) {
                  throw new Error("User impersonation ended before a reply could be sent.");
                }
                finalStreamCompleted = true;
                break;
              }
              streamResult = fallbackRunResult.streamResult;
              if (!streamResult) {
                if (isUserImpersonation) {
                  throw new Error("User impersonation ended without returning a stream result.");
                }
                finalStreamCompleted = true;
                break;
              }

              // Use switch statement for exhaustive status checking
              switch (streamResult.status) {
                case "completed": {
                  log.success("Streaming to Discord completed successfully.");
                  personaThoughtLog = mergeThoughtLogPayload(personaThoughtLog, streamResult.thoughtLog);
                  personaStreamCompletedSuccessfully = true;
                  // Record success for rotation key if one was used
                  if (selectedKeyResult?.rotationKeyId) {
                    await recordKeySuccess(selectedKeyResult.rotationKeyId);
                  }
                  finalStreamCompleted = true;
                  // Capture accumulated text for short-term memory storage
                  if (streamResult.accumulatedText) {
                    finalAccumulatedText = streamResult.accumulatedText;
                  }
                  // Accumulate extracted <details> block content for STM routing
                  // (uses accumulation since the orchestrator resets detailsSegments on each call)
                  if (streamResult.detailsContent) {
                    finalDetailsContent = finalDetailsContent
                      ? `${finalDetailsContent}\n\n${streamResult.detailsContent}`
                      : streamResult.detailsContent;
                  }
                  // Reset follow-up counter on successful terminal completion
                  const completedLockEntry = channelLocks.get(channel.id);
                  if (completedLockEntry) completedLockEntry.followUpCount = 0;
                  break; // Exit loop, final text stream was handled by streamGeminiToDiscord
                }

                case "error": {
                  log.error("Streaming to Discord reported an error.", streamResult.data, {
                    serverId: tomoriState?.server_id,
                    errorType: "StreamingError",
                  });
                  // Record error for rotation key if one was used and error is key-related
                  if (selectedKeyResult?.rotationKeyId && streamResult.data) {
                    // Check if error is API key related (rate limit or auth error)
                    const errorData = streamResult.data as {
                      type?: string;
                      message?: string;
                      code?: string;
                    };
                    const errorMessage =
                      errorData.message ||
                      (streamResult.data instanceof Error ? streamResult.data.message : "Unknown error");
                    if (errorData.type === "rate_limit") {
                      await recordKeyError(
                        selectedKeyResult.rotationKeyId,
                        "rate_limit",
                        errorMessage || "Rate limit exceeded",
                      );
                    } else if (errorData.type === "api_error" || errorData.code === "401" || errorData.code === "403") {
                      await recordKeyError(
                        selectedKeyResult.rotationKeyId,
                        "api_error",
                        errorMessage || "API authentication error",
                      );
                    }
                  }

                  const finalErrorData = streamResult.data as {
                    type?: string;
                    message?: string;
                    code?: string;
                  };
                  if (isUserImpersonation) {
                    throw new Error(
                      finalErrorData?.message ||
                        (streamResult.data instanceof Error
                          ? streamResult.data.message
                          : "User impersonation failed before a reply could be sent."),
                    );
                  }
                  if (finalErrorData?.type === "timeout" && streamingContext.suppressUserErrors) {
                    await sendStandardEmbed(channel, locale, {
                      color: ColorCode.WARN,
                      titleKey: "genai.error_stream_timeout_title",
                      descriptionKey: "genai.error_stream_timeout_description",
                    }).catch((e) => log.warn("Failed to send timeout embed to channel", e));
                  }

                  // streamGeminiToDiscord already attempts to send an error message.
                  finalStreamCompleted = true; // Consider it "completed" to break loop, error handled.
                  // Reset follow-up counter — error is a terminal event
                  const errorLockEntry = channelLocks.get(channel.id);
                  if (errorLockEntry) errorLockEntry.followUpCount = 0;
                  break;
                }

                case "empty_response": {
                  // Handle empty response with fresh context retry
                  const MAX_EMPTY_RESPONSE_RETRIES = 2;
                  const RETRY_DELAY_MS = 1000;
                  const streamResultData =
                    streamResult.data && typeof streamResult.data === "object"
                      ? (streamResult.data as Record<string, unknown>)
                      : undefined;
                  const terminalFinishReason =
                    typeof streamResultData?.finishReason === "string" ? streamResultData.finishReason : undefined;
                  const emptyResponseReason =
                    typeof streamResultData?.emptyResponseReason === "string"
                      ? streamResultData.emptyResponseReason
                      : undefined;
                  const isOpenRouterLengthEmptyResponse = terminalFinishReason === "length";
                  const speakerGuardRetryDirective =
                    emptyResponseReason === "speaker_guard"
                      ? buildSpeakerGuardRetryDirective(
                          currentPersona.tomori_nickname ??
                            selectedPersona?.tomori_nickname ??
                            tomoriState?.tomori_nickname,
                        )
                      : null;
                  const retryInjectedContextItems = mergeInjectedContextItems(
                    injectedContextItems,
                    speakerGuardRetryDirective,
                  );

                  if (retryCount < MAX_EMPTY_RESPONSE_RETRIES) {
                    log.info(
                      `Empty response detected (attempt ${retryCount + 1}/${MAX_EMPTY_RESPONSE_RETRIES + 1}). ` +
                        `finishReason=${terminalFinishReason ?? "unknown"}. Retrying with fresh context in ${RETRY_DELAY_MS}ms...`,
                    );
                    if (emptyResponseReason === "speaker_guard") {
                      log.info(
                        `Empty response retry will inject active-speaker guidance for persona "${currentPersona.tomori_nickname ?? tomoriState?.tomori_nickname ?? "Tomori"}".`,
                      );
                    }

                    // Wait before retry
                    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

                    // Recursive call with fresh context (skipLock=true to avoid semaphore issues)
                    // Use currentPersona.tomori_id to preserve the exact persona that got the
                    // empty response (e.g. an Alter triggered by keyword), since selectedPersonaId
                    // is only set for manual triggers and would be undefined for keyword-triggered alters,
                    // causing the retry to fall back to the main persona via the fallbackPersona path.
                    return await tomoriChat(
                      client,
                      message,
                      isFromQueue,
                      true, // isManuallyTriggered - bypass trigger checks for retry
                      forceReason,
                      reasoningQuery,
                      llmOverrideCodename,
                      isStopResponse,
                      retryCount + 1, // Increment retry count
                      true, // skipLock - parent already holds the lock
                      reminderRecipientID,
                      reminderData,
                      currentPersona.tomori_id ?? selectedPersonaId, // Pin retry to the persona that got the empty response
                      isPersonaJob,
                      isUserImpersonation,
                      impersonatedUserId,
                      textQuotaSource,
                      effectiveTextQuotaTriggerKey,
                      effectiveTextQuotaUserDiscId,
                      manualSystemPrompt,
                      manualPrefill,
                      // NAI GLM-4.6: pass trailing fragment so next call appends it to the prompt
                      streamResult.naiContinuationPrefill,
                      isOpenRouterLengthEmptyResponse ? "length" : undefined,
                      retryInjectedContextItems,
                      forcedMentions,
                      manualTriggerInvoker,
                      manualStreamingContextOverrides,
                    );
                  } else {
                    // Max retries reached, show error embed
                    log.warn(`Empty response after ${MAX_EMPTY_RESPONSE_RETRIES} retries. Showing error embed.`);

                    if (isUserImpersonation) {
                      throw new Error("User impersonation returned an empty response.");
                    }

                    await sendStandardEmbed(channel, locale, {
                      titleKey: "genai.empty_response_title",
                      descriptionKey: "genai.empty_response_description",
                      color: ColorCode.WARN,
                      footerKey: "genai.generic_error_footer",
                    }).catch((e) => log.warn("Failed to send empty response embed to channel", e));

                    finalStreamCompleted = true; // Mark as completed to exit
                    break;
                  }
                }

                case "timeout": {
                  // This is the internal stream inactivity timeout from streamGeminiToDiscord
                  log.warn(
                    `Streaming to Discord timed out due to inactivity for channel ${channel.id}.`,
                    streamResult.data,
                  );
                  if (isUserImpersonation) {
                    throw new Error("User impersonation timed out before a reply could be sent.");
                  }
                  await sendStandardEmbed(channel, locale, {
                    color: ColorCode.WARN,
                    titleKey: "genai.error_stream_timeout_title",
                    descriptionKey: "genai.error_stream_timeout_description",
                  });
                  finalStreamCompleted = true;
                  // Reset follow-up counter — timeout is a terminal event
                  const timeoutLockEntry = channelLocks.get(channel.id);
                  if (timeoutLockEntry) timeoutLockEntry.followUpCount = 0;
                  break;
                }

                case "stopped_by_user": {
                  // Handle any graceful stop, including user stops and internal guards.
                  const stopReason = streamResult.stopReason ?? "unknown";
                  log.info(`Streaming stopped for channel ${channel.id}. Reason: ${stopReason}.`);
                  finalStreamCompleted = true;

                  // Reset follow-up counter — stop is a terminal event
                  const stoppedLockEntry = channelLocks.get(channel.id);
                  if (stoppedLockEntry) stoppedLockEntry.followUpCount = 0;

                  // Check if we have stop context to create a response
                  const stopContext = StreamOrchestrator.getAndClearStopContext(channel.id);

                  if (stopContext) {
                    // Get the current lock entry to queue the stop response
                    const currentLockEntry = channelLocks.get(channel.id);
                    if (currentLockEntry) {
                      // Queue the original stop message as a "passport" for stop response
                      currentLockEntry.messageQueue.unshift({
                        message: stopContext.originalStopMessage,
                        isManuallyTriggered: true, // This bypasses normal trigger logic
                        forceReason: false,
                        llmOverrideCodename,
                        isStopResponse: true, // This response cannot be stopped
                        // Keep stop follow-up persona aligned with the interrupted stream.
                        selectedPersonaId: currentPersona.tomori_id ?? undefined,
                        textQuotaSource: "system",
                        textQuotaTriggerKey: effectiveTextQuotaTriggerKey,
                      });

                      log.info(
                        `Stop response queued after stream completion for channel ${channel.id}. Queue size: ${currentLockEntry.messageQueue.length}`,
                      );
                    }
                  }

                  break; // Exit the loop gracefully, stop response will be handled by queue
                }

                case "follow_up_interrupt": {
                  // User sent a follow-up message during generation — skip quota/cooldown
                  // and let the queued follow-up message trigger a fresh regeneration
                  log.info(
                    `Stream interrupted by follow-up message for channel ${channel.id}. ` +
                      `Skipping quota/cooldown. Follow-up count: ${lockEntry?.followUpCount ?? "?"}`,
                  );

                  // 1. Increment follow-up counter to enforce the per-chain interrupt cap
                  const followUpLockEntry = channelLocks.get(channel.id);
                  if (followUpLockEntry) {
                    followUpLockEntry.followUpCount++;
                  }

                  // 2. Mark stream as completed to exit the streaming loop
                  finalStreamCompleted = true;

                  // Do NOT push to personaResponses — this prevents quota consumption.
                  // Do NOT store accumulatedText — partial/interrupted text is discarded.
                  break;
                }

                case "function_call": {
                  personaThoughtLog = mergeThoughtLogPayload(personaThoughtLog, streamResult.thoughtLog);

                  // Accumulate any <details> content captured before the tool call
                  if (streamResult.detailsContent) {
                    finalDetailsContent = finalDetailsContent
                      ? `${finalDetailsContent}\n\n${streamResult.detailsContent}`
                      : streamResult.detailsContent;
                  }

                  if (!streamResult.data) {
                    // Function call without data - log error and break
                    log.error("Function call status received without data:", streamResult);
                    finalStreamCompleted = true;
                    break;
                  }

                  // The stream adapter mutates personaAccumulatedParts with the raw
                  // assistant text from this iteration. That text is archived into
                  // functionInteractionHistory below, so do not also carry it forward
                  // as currentTurnModelParts or it will replay as a duplicate trailing
                  // assistant turn on the next tool-loop iteration.
                  if (accumulatedStreamedModelParts.length > 0) {
                    accumulatedStreamedModelParts.length = 0;
                  }

                  const funcCall = streamResult.data as FunctionCall; // Type assertion
                  const funcName = funcCall.name?.trim() ?? "";

                  // Mark tool-call chain active so follow-up messages are queued
                  // instead of interrupting — preserves tool execution progress.
                  if (lockEntry) lockEntry.isInToolCallChain = true;

                  log.info(
                    `Stream LLM wants to call function: ${funcName} with args: ${JSON.stringify(funcCall.args)}`,
                  );

                  // 2. Execute function using modular tool system
                  log.info(`Executing tool: ${funcName} with args: ${JSON.stringify(funcCall.args)}`);

                  // Build tool execution context
                  const toolContext = {
                    channel,
                    client,
                    message,
                    userId: userRow?.user_disc_id || userDiscId, // Use Discord user ID (not database ID) for cache consistency
                    internalUserId: personalRoutingUserId ?? undefined,
                    guildId: message.guild?.id, // Pass guild ID for guild-specific features (e.g., server avatars)
                    tomoriState: effectiveTomoriState,
                    locale,
                    provider: provider.getInfo().name,
                    streamContext: streamingContext, // Pass streaming context to tools
                    webhook: personaWebhook ?? undefined,
                    personaUsername,
                    personaAvatarUrl,
                    activePersonaId: currentPersona.tomori_id ?? undefined,
                    isUserImpersonation,
                    impersonatedUserId,
                    contextItems: contextSegments,
                    messageIdMap: streamingContext.messageIdMap,
                    showKillHint: i >= SOFT_WARN_ITERATION_THRESHOLD,
                  };

                  // Execute tool using ToolRegistry (handles both built-in and MCP tools seamlessly)
                  // Check for stop request before executing function call
                  if (StreamOrchestrator.hasStopRequest(channel.id)) {
                    log.info(`Function call execution cancelled due to stop request: ${funcName}`);
                    finalStreamCompleted = true;
                    break;
                  }

                  const functionCallStart = Date.now();
                  const deliberateAllowedSet = streamingContext.deliberateToolAllowedNames?.length
                    ? new Set(streamingContext.deliberateToolAllowedNames)
                    : null;
                  const isBlockedByDeliberateAllowlist =
                    deliberateToolModeActive && deliberateAllowedSet !== null && !deliberateAllowedSet.has(funcName);
                  const toolResult = isBlockedByDeliberateAllowlist
                    ? {
                        success: false,
                        error: `Tool "${funcName}" was not exposed for this deliberate tool mode turn.`,
                        data: {
                          status: "blocked_by_deliberate_tool_mode",
                          functionName: funcName,
                          allowedToolNames: [...deliberateAllowedSet],
                        },
                      }
                    : await ToolRegistry.executeTool(funcName, funcCall.args || {}, toolContext);
                  const functionCallDuration = Date.now() - functionCallStart;
                  const deliberateToolTriggerMatch = deliberateToolTriggerMatchByToolName.get(funcName);
                  if (isBlockedByDeliberateAllowlist) {
                    log.warn(
                      `Deliberate tool mode blocked unexposed tool call "${funcName}" in channel ${channel.id}. Allowed: ${[...deliberateAllowedSet].join(", ")}`,
                    );
                  }
                  if (toolResult.success) {
                    retainSuccessfulToolAffordance(
                      channel.id,
                      funcName,
                      resolveDeliberateToolContextTurns(effectiveTomoriState.config.deliberate_tool_context_turns),
                    );
                  }

                  if (deliberateToolModeActive && deliberateToolTriggerMatch) {
                    const safeTrigger = deliberateToolTriggerMatch.trigger.replace(/`/g, "'");
                    await routeHiddenToolNotice(
                      toolContext,
                      {
                        color: ColorCode.INFO,
                        titleKey: "genai.thought_log.title",
                        description:
                          `Tool \`${funcName}\` was used after deliberate tool mode exposed it.\n` +
                          `Trigger: \`${safeTrigger}\`\n` +
                          `Source: ${deliberateToolTriggerMatch.source}`,
                      },
                      "Deliberate tool trigger log",
                    );
                  }

                  // Log function call timing (especially long-running ones)
                  if (functionCallDuration > 5000) {
                    log.warn(`Long-running function call: ${funcName} took ${functionCallDuration}ms`);
                  } else {
                    log.info(`Function call completed: ${funcName} (${functionCallDuration}ms)`);
                  }

                  // Convert tool result to function execution result format
                  let functionExecutionResult: Record<string, unknown>;

                  if (toolResult.success) {
                    // Any successful tool execution resets the flail counter — includes
                    // context-restart continuations (YouTube/GIF/metadata reveal) below.
                    consecutiveToolErrors = 0;
                    functionExecutionResult = (toolResult.data as Record<string, unknown>) || { status: "completed" };

                    // Capture fetch tool content for thought-logs
                    // Both built-in and custom MCP fetch tools return formatted content in toolResult.message
                    if (funcName === "fetch" && toolResult.message) {
                      const toolData = toolResult.data as Record<string, unknown> | undefined;
                      const isMcpFetch = toolData?.source === "mcp" && toolData?.functionName === "fetch";
                      if (isMcpFetch) {
                        personaThoughtLog = mergeThoughtLogPayload(personaThoughtLog, {
                          fetchedContent: toolResult.message,
                        });
                        log.info(
                          `Captured fetch content for thought-log (${(toolData?.contentLength as number) ?? toolResult.message.length} chars)`,
                        );
                      }
                    }

                    // Handle sticker selection specifically (extract sticker for later sending)
                    if (funcName === "select_sticker_for_response" && toolResult.data) {
                      const stickerData = toolResult.data as Record<string, unknown>;
                      if (stickerData.status === "sticker_selected_successfully") {
                        // Find the sticker in guild cache to send later
                        const discordSticker = guild?.stickers.cache.get(stickerData.sticker_id as string);
                        selectedStickerToSend = discordSticker || null;
                        log.success(`Sticker '${stickerData.sticker_name}' selected for sending`);
                      } else {
                        selectedStickerToSend = null;
                      }
                    }

                    // Handle YouTube video restart signal (enhanced context restart)
                    if (
                      funcName === "process_youtube_video" &&
                      toolResult.data &&
                      (toolResult.data as Record<string, unknown>).type === "context_restart_with_video"
                    ) {
                      const restartData = toolResult.data as Record<string, unknown>;
                      const enhancedContextItem = restartData.enhanced_context_item as StructuredContextItem;
                      const videoUrl = restartData.video_url as string;
                      const videoId = restartData.video_id as string;

                      log.info(
                        `YouTube video restart signal detected for: ${videoUrl}. Cleaning URLs and enhancing context.`,
                      );

                      // Set flag to disable YouTube processing during enhanced context restart
                      // This prevents TomoriBot from making additional YouTube function calls while processing
                      streamingContext.disableYouTubeProcessing = true;
                      log.info("Temporarily disabled YouTube processing function during enhanced context restart");

                      // Clean YouTube URLs from all existing context text parts FIRST to prevent false duplication detection
                      for (const contextItem of contextSegments) {
                        for (const part of contextItem.parts) {
                          if (part.type === "text") {
                            const originalText = part.text;
                            part.text = removeYouTubeUrls(part.text, "");
                            if (originalText !== part.text) {
                              log.info(
                                `Cleaned YouTube URLs from context text during duplication check. Original length: ${originalText.length}, cleaned length: ${part.text.length}`,
                              );
                            }
                          }
                        }
                      }

                      // Check for existing video parts with same video ID to prevent duplication
                      // Only check actual video Parts, not text mentions (which are now cleaned)
                      const existingVideoIds = new Set<string>();
                      for (const contextItem of contextSegments) {
                        for (const part of contextItem.parts) {
                          // Check for enhanced context YouTube video parts specifically
                          if (
                            part.type === "video" &&
                            part.uri &&
                            "isYouTubeLink" in part &&
                            (part as { isYouTubeLink: boolean }).isYouTubeLink &&
                            "enhancedContext" in part &&
                            (part as { enhancedContext: boolean }).enhancedContext
                          ) {
                            const existingIds = extractYouTubeVideoIds(part.uri);
                            for (const id of existingIds) {
                              existingVideoIds.add(id);
                            }
                          }
                        }
                      }

                      // Only add video part if not already present
                      if (!existingVideoIds.has(videoId)) {
                        // Add the video context item to existing context
                        contextSegments.push(enhancedContextItem);
                        log.success(
                          `Enhanced context with YouTube video Part (ID: ${videoId}). Total context items: ${contextSegments.length}`,
                        );
                      } else {
                        log.warn(`YouTube video ${videoId} already exists in context. Skipping duplication.`);
                      }

                      // Continue to next iteration WITHOUT adding to function interaction history
                      // This will restart the streaming with enhanced context
                      continue;
                    }

                    // Handle profile picture restart signal (enhanced context restart)
                    if (
                      funcName === "peek_profile_picture" &&
                      toolResult.data &&
                      (toolResult.data as Record<string, unknown>).type === "context_restart_with_image"
                    ) {
                      const restartData = toolResult.data as Record<string, unknown>;
                      const pendingContextKey = restartData.pending_context_key as string;
                      const targetIdentity = restartData.target_identity as string;
                      const username = restartData.username as string;

                      log.info(
                        `Profile picture restart signal detected for ${targetIdentity} (${username}). Enhancing context with avatar image.`,
                      );

                      // Get the enhanced context item from external storage
                      const enhancedContextItem = PeekProfilePictureTool.getPendingEnhancedContext(pendingContextKey);

                      if (!enhancedContextItem) {
                        log.warn(
                          `No pending enhanced context found for key ${pendingContextKey}. Profile picture restart failed.`,
                        );
                        continue;
                      }

                      // Set flag to disable profile picture processing during enhanced context restart
                      // This prevents TomoriBot from making additional profile picture function calls while processing
                      streamingContext.disableProfilePictureProcessing = true;
                      log.info(
                        "Temporarily disabled profile picture processing function during enhanced context restart",
                      );

                      // Check for existing profile picture parts for this user to prevent duplication
                      let hasExistingProfilePicture = false;
                      for (const contextItem of contextSegments) {
                        for (const part of contextItem.parts) {
                          // Check for enhanced context profile picture parts specifically
                          if (
                            part.type === "image" &&
                            "isProfilePicture" in part &&
                            (part as { isProfilePicture: boolean }).isProfilePicture &&
                            "enhancedContext" in part &&
                            (part as { enhancedContext: boolean }).enhancedContext
                          ) {
                            hasExistingProfilePicture = true;
                            break;
                          }
                        }
                        if (hasExistingProfilePicture) break;
                      }

                      // Only add profile picture part if not already present
                      if (!hasExistingProfilePicture) {
                        // Add the profile picture context item to existing context
                        contextSegments.push(enhancedContextItem);
                        log.success(
                          `Enhanced context with profile picture for user: ${username}. Total context items: ${contextSegments.length}`,
                        );
                      } else {
                        log.warn(
                          `Profile picture for user ${username} already exists in context. Skipping duplication.`,
                        );
                      }

                      // Continue to next iteration WITHOUT adding to function interaction history
                      // This will restart the streaming with enhanced context
                      continue;
                    }

                    // Handle GIF processing restart signal (enhanced context restart)
                    if (
                      funcName === "process_gif" &&
                      toolResult.data &&
                      (toolResult.data as Record<string, unknown>).type === "context_restart_with_gif"
                    ) {
                      const restartData = toolResult.data as Record<string, unknown>;
                      const messageId = (restartData.message_id as string) || (restartData.media_id as string);
                      const frameCount = restartData.frame_count as number;

                      log.info(
                        `GIF processing restart signal detected for message: ${messageId} (${frameCount} frames). Enhancing context with GIF keyframes.`,
                      );

                      // Get the enhanced context item from external storage
                      const enhancedContextItem = ProcessGifTool.getPendingEnhancedContext(messageId);

                      if (!enhancedContextItem) {
                        log.warn(`No pending enhanced context found for message ${messageId}. GIF restart failed.`);
                        continue;
                      }

                      // Set flag to disable GIF processing during enhanced context restart
                      // This prevents TomoriBot from making additional GIF function calls while processing
                      streamingContext.disableGifProcessing = true;
                      log.info("Temporarily disabled GIF processing function during enhanced context restart");

                      // Add the GIF frames context item to existing context
                      contextSegments.push(enhancedContextItem);
                      log.success(
                        `Enhanced context with ${frameCount} GIF keyframes for message: ${messageId}. Total context items: ${contextSegments.length}`,
                      );

                      // Continue to next iteration WITHOUT adding to function interaction history
                      // This will restart the streaming with enhanced context
                      continue;
                    }

                    // Handle media context expansion restart signal (enhanced context restart)
                    if (
                      funcName === "increase_media_context" &&
                      toolResult.data &&
                      (toolResult.data as Record<string, unknown>).type === "context_restart_with_media"
                    ) {
                      const restartData = toolResult.data as Record<string, unknown>;
                      const extendBy = restartData.extend_by as number;
                      const oldWindow = restartData.old_window as number;
                      const newWindow = restartData.new_window as number;

                      log.info(
                        `Media context expansion restart signal detected. Expanding window from ${oldWindow} to ${newWindow} messages (extend_by=${extendBy}).`,
                      );

                      // Rebuild context with expanded media window.
                      // A fresh MessageIdMap is created so opaque keys (media_1, ref_1, ...)
                      // match the rebuilt context — the old map's indices are now stale.
                      const rebuildMessageIdMap = new MessageIdMap();
                      const contextBuild = await buildContext({
                        guildId: serverDiscId,
                        serverName,
                        serverDescription: serverDescription ?? null,
                        simplifiedMessageHistory: simplifiedMessages,
                        userList,
                        matrixUsers: matrixUserMap,
                        syntheticUsers: syntheticUserMap,
                        channelDesc,
                        channelName,
                        channelId: channel.id, // For short-term memory context
                        parentChannelId: channel.isThread() ? channel.parentId : null, // For thread → parent private/RP inheritance
                        client,
                        triggererName,
                        emojiStrings,
                        // Use the current persona nickname so role mapping and samples match the responding persona
                        tomoriNickname:
                          currentPersona.tomori_nickname ??
                          // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
                          tomoriState!.tomori_nickname,
                        // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
                        tomoriAttributes: tomoriState!.attribute_list,
                        tomoriConfig: effectiveTomoriConfig,
                        // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
                        personaPrompt: tomoriState!.persona_prompt ?? null,
                        // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
                        personaLineageId: tomoriState!.persona_lineage_id,
                        isDMChannel,
                        mediaContextWindow: newWindow, // Pass the expanded window
                        snapshot: personaSnapshot, // Use persona-specific snapshot for rebuild
                        preloadedEmojis: loadedEmojis, // Pass pre-loaded emoji data to avoid redundant DB query
                        preloadedStickers: loadedStickers, // Pass pre-loaded sticker data to avoid redundant DB query
                        isUserImpersonation, // Pass user impersonation flag (February 2026)
                        impersonatedUserId, // Pass impersonated user ID (February 2026)
                        explicitLongTermMemoryIntent,
                        // Reuse the same API-resolved capability flags as the initial context build
                        seesImages: effectiveContextSeesImages,
                        seesVideos: effectiveContextSeesVideos,
                        hasVisionTool:
                          !!tomoriState?.vision_llm && !(effectiveContextSeesImages ?? tomoriState?.llm.sees_images),
                        toolsDisabledForTurn: streamingContext.disableAllTools,
                        messageIdMap: rebuildMessageIdMap,
                      });
                      contextSegments = appendInjectedContextItems(contextBuild.contextItems, injectedContextItems);

                      // Update the streaming context's message ID map to match the rebuilt context
                      streamingContext.messageIdMap = rebuildMessageIdMap;

                      // Truncate oldest dialogue history pairs if the conversation is approaching
                      // the context window limit, ensuring the output budget is always preserved.
                      // OpenRouter: uses the live capability cache (fetched at startup from their API).
                      // Google:     uses the static GEMINI_TOKEN_LIMITS map (compile-time constant).
                      // NovelAI:    uses perks.contextTokens from GET /user/subscription (cached per guild, 24h TTL).
                      if (
                        tomoriState.llm.llm_provider === "openrouter" &&
                        tomoriState.llm.llm_codename !== "other-model" &&
                        isOpenRouterCapabilityCacheReady()
                      ) {
                        const tokenLimits = getOpenRouterTokenLimits(tomoriState.llm.llm_codename);
                        const openrouterTruncationOutputCap = Number.parseInt(
                          process.env.OPENROUTER_MAX_OUTPUT_TOKENS || "8192",
                          10,
                        );
                        if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
                          const truncationMaxCompletionTokens = Math.min(
                            tokenLimits.maxCompletionTokens,
                            openrouterTruncationOutputCap,
                          );
                          const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } =
                            truncateDialogueHistory(
                              contextSegments,
                              tokenLimits.contextLength,
                              truncationMaxCompletionTokens,
                            );
                          if (totalDropped > 0) {
                            log.warn(
                              `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ` +
                                `${sampleItemsDropped} sample dialogue item(s) for ` +
                                `${tomoriState.llm.llm_codename} to preserve output budget`,
                            );
                            contextSegments = truncated;
                          }
                        }
                      } else if (tomoriState.llm.llm_provider === "google") {
                        const tokenLimits = getGeminiTokenLimits(tomoriState.llm.llm_codename);
                        if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
                          const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } =
                            truncateDialogueHistory(
                              contextSegments,
                              tokenLimits.contextLength,
                              tokenLimits.maxCompletionTokens,
                            );
                          if (totalDropped > 0) {
                            log.warn(
                              `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ` +
                                `${sampleItemsDropped} sample dialogue item(s) for ` +
                                `${tomoriState.llm.llm_codename} to preserve output budget`,
                            );
                            contextSegments = truncated;
                          }
                        }
                      } else if (tomoriState.llm.llm_provider === "novelai") {
                        // Look up subscription contextTokens for accurate tier-aware truncation.
                        // If cache is cold (e.g. after bot restart), decrypt the key early and fetch.
                        let naiSubscriptionTokens = getCachedContextTokens(serverDiscId);
                        if (naiSubscriptionTokens === undefined && tomoriState.config.api_key) {
                          try {
                            const tempKey = await decryptApiKey(
                              tomoriState.config.api_key,
                              tomoriState.config.key_version || 1,
                            );
                            naiSubscriptionTokens = await refreshNovelAISubscription(serverDiscId, tempKey);
                          } catch {
                            // Subscription fetch failed; getNovelAITokenLimits will use env var fallback
                          }
                        }
                        const tokenLimits = getNovelAITokenLimits(tomoriState.llm.llm_codename, naiSubscriptionTokens);
                        if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
                          const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } =
                            truncateDialogueHistory(
                              contextSegments,
                              tokenLimits.contextLength,
                              tokenLimits.maxCompletionTokens,
                            );
                          if (totalDropped > 0) {
                            log.warn(
                              `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ` +
                                `${sampleItemsDropped} sample dialogue item(s) for ` +
                                `${tomoriState.llm.llm_codename} to preserve output budget`,
                            );
                            contextSegments = truncated;
                          }
                        }
                      }

                      const shouldApplyOpenRouterLengthRetryTrim =
                        emptyResponseFinishReason === "length" &&
                        retryCount > 0 &&
                        tomoriState.llm.llm_provider === "openrouter";
                      if (shouldApplyOpenRouterLengthRetryTrim) {
                        const requestedPairDrops = OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS * retryCount;
                        const { truncated, historyPairsDropped } = dropOldestHistoryExchangePairs(
                          contextSegments,
                          requestedPairDrops,
                        );
                        if (historyPairsDropped > 0) {
                          log.warn(
                            `OpenRouter length-empty retry trimming: dropped ${historyPairsDropped}/${requestedPairDrops} oldest history exchange pair(s) on retry ${retryCount}.`,
                          );
                          contextSegments = truncated;
                        } else {
                          log.warn(
                            `OpenRouter length-empty retry trimming requested ${requestedPairDrops} pair drop(s), but no droppable history remained on retry ${retryCount}.`,
                          );
                        }
                      }
                      const lowerPriorityTailDirectives: string[] = [...contextBuild.lowerPriorityTailDirectives];
                      const tailDirectives: string[] = [...contextBuild.tailDirectives];
                      const uncensorDirective = contextBuild.uncensorDirective;
                      if (manualContinuationDirective) {
                        tailDirectives.push(manualContinuationDirective);
                      }

                      log.success(
                        `Rebuilt context with expanded media window (${newWindow} messages). Total context items: ${contextSegments.length}`,
                      );

                      // Apply emoji repetition penalty after rebuilding context
                      const emojiPenaltyDirective = getEmojiPenaltyDirective(
                        contextSegments,
                        isUserImpersonation
                          ? null
                          : (tomoriState?.tomori_nickname ?? process.env.DEFAULT_BOTNAME ?? "Tomori"),
                      );
                      if (emojiPenaltyDirective) {
                        lowerPriorityTailDirectives.push(emojiPenaltyDirective);
                      }

                      // Inject system context for stop responses (if applicable)
                      if (isStopResponse) {
                        let lastUserContext: StructuredContextItem | undefined;
                        for (let j = contextSegments.length - 1; j >= 0; j--) {
                          if (contextSegments[j].role === "user") {
                            lastUserContext = contextSegments[j];
                            break;
                          }
                        }

                        if (lastUserContext) {
                          const originalContent = lastUserContext.parts
                            .filter((part) => part.type === "text")
                            .map((part) => (part as { type: "text"; text: string }).text)
                            .join(" ");
                          tailDirectives.push(
                            `The user has requested you to stop your current generation. Original message: "${originalContent}"`,
                          );
                          log.info(`Captured stop response context. Original content: "${originalContent}"`);
                        } else {
                          tailDirectives.push("The user has requested you to stop your current generation.");
                          log.info("Captured stop response context (no user context found)");
                        }
                      }

                      // Inject reasoning query as user message in dialogue if provided
                      if (reasoningQuery) {
                        tailDirectives.push(
                          `The user has activated reasoning mode with the following query: "${reasoningQuery}". Please provide a thoughtful, well-reasoned response to this query.`,
                        );
                        log.info(`Captured reasoning query for tail directives: "${reasoningQuery}"`);
                      }

                      // Inject manual system prompt at the end (for manual commands)
                      if (manualSystemPrompt?.trim()) {
                        const trimmedPrompt = manualSystemPrompt.trim();
                        const directiveText = normalizeTailDirective(trimmedPrompt);
                        if (directiveText) {
                          tailDirectives.push(directiveText);
                        }
                        log.info(`Injected manual system prompt: "${trimmedPrompt}"`);
                      }

                      const lowerPriorityTailMessage = buildCombinedTailDirectiveMessage(lowerPriorityTailDirectives);
                      if (lowerPriorityTailMessage) {
                        insertBeforeLatestDialoguePair(contextSegments, lowerPriorityTailMessage);
                      }

                      const combinedTailMessage = buildCombinedTailDirectiveMessage(tailDirectives);
                      if (combinedTailMessage) {
                        contextSegments.push(combinedTailMessage);
                      }

                      const queuedReplyTailMessage = buildTailDirectiveMessage(
                        getQueuedReplyDirective(currentPersona.tomori_nickname ?? tomoriState?.tomori_nickname),
                      );
                      if (queuedReplyTailMessage) {
                        contextSegments.push(queuedReplyTailMessage);
                      }

                      const uncensorTailMessage = buildTailDirectiveMessage(uncensorDirective);
                      if (uncensorTailMessage) {
                        contextSegments.push(uncensorTailMessage);
                      }
                      // Continue to next iteration WITHOUT adding to function interaction history
                      // This will restart the streaming with enhanced context
                      continue;
                    }

                    // Handle recent message metadata reveal signal
                    // Decompresses combined messages and rebuilds context so each individual
                    // Discord message gets its own context item with a unique ref_N handle.
                    if (
                      funcName === "reveal_message_metadata" &&
                      toolResult.data &&
                      (toolResult.data as Record<string, unknown>).type === "context_restart_with_message_metadata"
                    ) {
                      log.info(
                        "Recent message metadata reveal detected. Decompressing combined messages and rebuilding context.",
                      );

                      streamingContext.disableMessageMetadataContext = true;

                      // 1. Decompress combined messages so each Discord message gets its own entry
                      const decompressedMessages = decompressSimplifiedMessages(
                        simplifiedMessages,
                        relevantMessagesArray,
                      );
                      const originalCount = simplifiedMessages.length;
                      const decompressedCount = decompressedMessages.length;
                      if (decompressedCount > originalCount) {
                        log.info(
                          `Decompressed ${originalCount} simplified entries into ${decompressedCount} individual entries.`,
                        );
                      }

                      // 2. Rebuild context with decompressed messages (fresh MessageIdMap)
                      const rebuildMessageIdMap = new MessageIdMap();
                      const contextBuild = await buildContext({
                        guildId: serverDiscId,
                        serverName,
                        serverDescription: serverDescription ?? null,
                        simplifiedMessageHistory: decompressedMessages,
                        userList,
                        matrixUsers: matrixUserMap,
                        syntheticUsers: syntheticUserMap,
                        channelDesc,
                        channelName,
                        channelId: channel.id,
                        parentChannelId: channel.isThread() ? channel.parentId : null,
                        client,
                        triggererName,
                        emojiStrings,
                        tomoriNickname:
                          currentPersona.tomori_nickname ??
                          // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
                          tomoriState!.tomori_nickname,
                        // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
                        tomoriAttributes: tomoriState!.attribute_list,
                        tomoriConfig: effectiveTomoriConfig,
                        // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
                        personaPrompt: tomoriState!.persona_prompt ?? null,
                        // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
                        personaLineageId: tomoriState!.persona_lineage_id,
                        isDMChannel,
                        snapshot: personaSnapshot,
                        preloadedEmojis: loadedEmojis,
                        preloadedStickers: loadedStickers,
                        isUserImpersonation,
                        impersonatedUserId,
                        impersonatedUserNickname: impersonatedIdentityName ?? impersonatedUserDbNickname,
                        impersonatedUserPrompt,
                        explicitLongTermMemoryIntent,
                        seesImages: effectiveContextSeesImages,
                        seesVideos: effectiveContextSeesVideos,
                        hasVisionTool:
                          !!tomoriState?.vision_llm && !(effectiveContextSeesImages ?? tomoriState?.llm.sees_images),
                        toolsDisabledForTurn: streamingContext.disableAllTools,
                        messageIdMap: rebuildMessageIdMap,
                      });
                      contextSegments = appendInjectedContextItems(contextBuild.contextItems, injectedContextItems);

                      // 3. Update the streaming context's message ID map to match the rebuilt context
                      streamingContext.messageIdMap = rebuildMessageIdMap;

                      // 4. Truncate oldest dialogue history pairs if the conversation is approaching
                      // the context window limit, ensuring the output budget is always preserved.
                      if (
                        tomoriState.llm.llm_provider === "openrouter" &&
                        tomoriState.llm.llm_codename !== "other-model" &&
                        isOpenRouterCapabilityCacheReady()
                      ) {
                        const tokenLimits = getOpenRouterTokenLimits(tomoriState.llm.llm_codename);
                        const openrouterTruncationOutputCap = Number.parseInt(
                          process.env.OPENROUTER_MAX_OUTPUT_TOKENS || "8192",
                          10,
                        );
                        if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
                          const truncationMaxCompletionTokens = Math.min(
                            tokenLimits.maxCompletionTokens,
                            openrouterTruncationOutputCap,
                          );
                          const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } =
                            truncateDialogueHistory(
                              contextSegments,
                              tokenLimits.contextLength,
                              truncationMaxCompletionTokens,
                            );
                          if (totalDropped > 0) {
                            log.warn(
                              `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ` +
                                `${sampleItemsDropped} sample dialogue item(s) for ` +
                                `${tomoriState.llm.llm_codename} to preserve output budget`,
                            );
                            contextSegments = truncated;
                          }
                        }
                      } else if (tomoriState.llm.llm_provider === "google") {
                        const tokenLimits = getGeminiTokenLimits(tomoriState.llm.llm_codename);
                        if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
                          const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } =
                            truncateDialogueHistory(
                              contextSegments,
                              tokenLimits.contextLength,
                              tokenLimits.maxCompletionTokens,
                            );
                          if (totalDropped > 0) {
                            log.warn(
                              `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ` +
                                `${sampleItemsDropped} sample dialogue item(s) for ` +
                                `${tomoriState.llm.llm_codename} to preserve output budget`,
                            );
                            contextSegments = truncated;
                          }
                        }
                      } else if (tomoriState.llm.llm_provider === "novelai") {
                        let naiSubscriptionTokens = getCachedContextTokens(serverDiscId);
                        if (naiSubscriptionTokens === undefined && tomoriState.config.api_key) {
                          try {
                            const tempKey = await decryptApiKey(
                              tomoriState.config.api_key,
                              tomoriState.config.key_version || 1,
                            );
                            naiSubscriptionTokens = await refreshNovelAISubscription(serverDiscId, tempKey);
                          } catch {
                            // Subscription fetch failed; getNovelAITokenLimits will use env var fallback
                          }
                        }
                        const tokenLimits = getNovelAITokenLimits(tomoriState.llm.llm_codename, naiSubscriptionTokens);
                        if (tokenLimits && tokenLimits.contextLength > 0 && tokenLimits.maxCompletionTokens) {
                          const { truncated, historyPairsDropped, sampleItemsDropped, totalDropped } =
                            truncateDialogueHistory(
                              contextSegments,
                              tokenLimits.contextLength,
                              tokenLimits.maxCompletionTokens,
                            );
                          if (totalDropped > 0) {
                            log.warn(
                              `History truncation: dropped ${historyPairsDropped} history exchange pair(s) and ` +
                                `${sampleItemsDropped} sample dialogue item(s) for ` +
                                `${tomoriState.llm.llm_codename} to preserve output budget`,
                            );
                            contextSegments = truncated;
                          }
                        }
                      }

                      // 5. Length retry trim (same as media expansion handler)
                      const shouldApplyOpenRouterLengthRetryTrim =
                        emptyResponseFinishReason === "length" &&
                        retryCount > 0 &&
                        tomoriState.llm.llm_provider === "openrouter";
                      if (shouldApplyOpenRouterLengthRetryTrim) {
                        const requestedPairDrops = OPENROUTER_LENGTH_EMPTY_RETRY_DROP_PAIRS * retryCount;
                        const { truncated, historyPairsDropped } = dropOldestHistoryExchangePairs(
                          contextSegments,
                          requestedPairDrops,
                        );
                        if (historyPairsDropped > 0) {
                          log.warn(
                            `OpenRouter length-empty retry trimming: dropped ${historyPairsDropped}/${requestedPairDrops} oldest history exchange pair(s) on retry ${retryCount}.`,
                          );
                          contextSegments = truncated;
                        } else {
                          log.warn(
                            `OpenRouter length-empty retry trimming requested ${requestedPairDrops} pair drop(s), but no droppable history remained on retry ${retryCount}.`,
                          );
                        }
                      }

                      // 6. Rebuild tail directives from the fresh context build
                      const lowerPriorityTailDirectives: string[] = [...contextBuild.lowerPriorityTailDirectives];
                      const tailDirectives: string[] = [...contextBuild.tailDirectives];
                      const uncensorDirective = contextBuild.uncensorDirective;
                      if (manualContinuationDirective) {
                        tailDirectives.push(manualContinuationDirective);
                      }

                      log.success(
                        `Rebuilt context with decompressed messages (${decompressedCount} entries). Total context items: ${contextSegments.length}`,
                      );

                      // 7. Apply emoji repetition penalty after rebuilding context
                      const emojiPenaltyDirective = getEmojiPenaltyDirective(
                        contextSegments,
                        isUserImpersonation
                          ? null
                          : (tomoriState?.tomori_nickname ?? process.env.DEFAULT_BOTNAME ?? "Tomori"),
                      );
                      if (emojiPenaltyDirective) {
                        lowerPriorityTailDirectives.push(emojiPenaltyDirective);
                      }

                      // 8. Inject system context for stop responses (if applicable)
                      if (isStopResponse) {
                        let lastUserContext: StructuredContextItem | undefined;
                        for (let j = contextSegments.length - 1; j >= 0; j--) {
                          if (contextSegments[j].role === "user") {
                            lastUserContext = contextSegments[j];
                            break;
                          }
                        }

                        if (lastUserContext) {
                          const originalContent = lastUserContext.parts
                            .filter((part) => part.type === "text")
                            .map((part) => (part as { type: "text"; text: string }).text)
                            .join(" ");
                          tailDirectives.push(
                            `The user has requested you to stop your current generation. Original message: "${originalContent}"`,
                          );
                          log.info(`Captured stop response context. Original content: "${originalContent}"`);
                        } else {
                          tailDirectives.push("The user has requested you to stop your current generation.");
                          log.info("Captured stop response context (no user context found)");
                        }
                      }

                      // 9. Inject reasoning query as user message in dialogue if provided
                      if (reasoningQuery) {
                        tailDirectives.push(
                          `The user has activated reasoning mode with the following query: "${reasoningQuery}". Please provide a thoughtful, well-reasoned response to this query.`,
                        );
                        log.info(`Captured reasoning query for tail directives: "${reasoningQuery}"`);
                      }

                      // 10. Inject manual system prompt at the end (for manual commands)
                      if (manualSystemPrompt?.trim()) {
                        const trimmedPrompt = manualSystemPrompt.trim();
                        const directiveText = normalizeTailDirective(trimmedPrompt);
                        if (directiveText) {
                          tailDirectives.push(directiveText);
                        }
                        log.info(`Injected manual system prompt: "${trimmedPrompt}"`);
                      }

                      const lowerPriorityTailMessage = buildCombinedTailDirectiveMessage(lowerPriorityTailDirectives);
                      if (lowerPriorityTailMessage) {
                        insertBeforeLatestDialoguePair(contextSegments, lowerPriorityTailMessage);
                      }

                      const combinedTailMessage = buildCombinedTailDirectiveMessage(tailDirectives);
                      if (combinedTailMessage) {
                        contextSegments.push(combinedTailMessage);
                      }

                      const queuedReplyTailMessage = buildTailDirectiveMessage(
                        getQueuedReplyDirective(currentPersona.tomori_nickname ?? tomoriState?.tomori_nickname),
                      );
                      if (queuedReplyTailMessage) {
                        contextSegments.push(queuedReplyTailMessage);
                      }

                      const uncensorTailMessage = buildTailDirectiveMessage(uncensorDirective);
                      if (uncensorTailMessage) {
                        contextSegments.push(uncensorTailMessage);
                      }

                      // 11. Annotate the rebuilt context with metadata for each individual message
                      const visibleMessageIds = new Set(decompressedMessages.map((msg) => msg.id));
                      const { annotatedCount, patchedReplyReferenceCount } = annotateRecentMessageMetadataInContext({
                        recentMessages: relevantMessagesArray,
                        visibleMessageIds,
                        contextSegments,
                        messageIdMap: rebuildMessageIdMap,
                      });

                      if (annotatedCount > 0 || patchedReplyReferenceCount > 0) {
                        log.success(
                          `Annotated recent message metadata on ${annotatedCount} visible turn(s) and patched ${patchedReplyReferenceCount} reply reference(s).`,
                        );
                      } else {
                        log.warn("No visible recent messages were available to annotate with metadata.");
                      }

                      const metadataActionHint = buildTailDirectiveMessage(buildRevealedMessageMetadataTailDirective());
                      if (metadataActionHint) {
                        contextSegments.push(metadataActionHint);
                      }

                      // Continue to next iteration WITHOUT adding to function interaction history
                      continue;
                    }
                  } else {
                    // Tool execution failed — prefer `message` (detailed, actionable) over
                    // `error` (short label) so the model gets useful retry instructions
                    // (e.g., available sticker list for token-budget exhaustion recovery).
                    functionExecutionResult = {
                      status: "tool_execution_failed",
                      reason: toolResult.message || toolResult.error || "Tool execution failed without specific error",
                      tool_name: funcName,
                    };

                    const toolResultData = toolResult.data as Record<string, unknown> | undefined;
                    const toolStatus = typeof toolResultData?.status === "string" ? toolResultData.status : undefined;
                    const isRecoverableStickerMiss =
                      funcName === "select_sticker_for_response" &&
                      (toolStatus === "sticker_not_found" ||
                        toolStatus === "sticker_name_ambiguous" ||
                        toolStatus === "sticker_name_missing_retry");

                    if (isRecoverableStickerMiss) {
                      const stickerNameAttempted =
                        typeof toolResultData?.sticker_name_attempted === "string"
                          ? toolResultData.sticker_name_attempted
                          : undefined;
                      const stickerIdAttempted =
                        typeof toolResultData?.sticker_id_attempted === "string"
                          ? toolResultData.sticker_id_attempted
                          : undefined;

                      log.warn(
                        `Tool execution returned recoverable sticker miss for ${funcName}: ${toolResult.error}`,
                        {
                          status: toolStatus,
                          stickerNameAttempted,
                          stickerIdAttempted,
                          reason: toolResult.message || toolResult.error || "Sticker selection retry suggested",
                        },
                      );
                    } else {
                      log.error(`Tool execution failed for ${funcName}: ${toolResult.error}`);
                    }

                    // Provider-agnostic flail guard: increment on any tool failure (including
                    // recoverable sticker misses — 5 wrong-name picks in a row is still flailing).
                    // If the threshold is hit, send an error embed and abort the turn before the
                    // larger MAX_FUNCTION_CALL_ITERATIONS ceiling burns through more API credits.
                    consecutiveToolErrors++;
                    if (consecutiveToolErrors >= MAX_CONSECUTIVE_TOOL_ERRORS) {
                      log.warn(
                        `Consecutive tool-error threshold reached (${consecutiveToolErrors}/${MAX_CONSECUTIVE_TOOL_ERRORS}) in channel ${channel.id} — last failed tool: "${funcName}". Aborting turn.`,
                      );
                      if (isUserImpersonation) {
                        throw new Error(
                          `User impersonation aborted: model failed ${consecutiveToolErrors} tool calls in a row.`,
                        );
                      }
                      await sendStandardEmbed(
                        channel,
                        locale,
                        {
                          color: ColorCode.ERROR,
                          titleKey: "genai.tool_error_loop_title",
                          descriptionKey: "genai.tool_error_loop_description",
                          footerKey: "genai.generic_error_footer",
                        },
                        {
                          webhook: personaWebhook ?? undefined,
                          personaUsername,
                          personaAvatarUrl,
                        },
                      );
                      finalStreamCompleted = true;
                      break;
                    }

                    // Case 2: NAI GLM tool failure with text already sent
                    // Suppress text output on retry so the model can re-attempt the tool
                    // without repeating the pre-tool text to Discord. After exceeding the
                    // retry threshold, show an error embed and end the turn.
                    const textAlreadySent = (streamResult.accumulatedText ?? "").trim().length > 0;
                    if (textAlreadySent && provider.getInfo().name === "novelai") {
                      naiConsecutiveToolFailures++;
                      if (naiConsecutiveToolFailures >= NAI_TOOL_FAILURE_RETRY_THRESHOLD) {
                        log.warn(
                          `NovelAI GLM: Tool "${funcName}" failed ${naiConsecutiveToolFailures} consecutive times after text was sent — showing error embed and ending turn`,
                        );
                        await sendStandardEmbed(
                          channel,
                          locale,
                          {
                            color: ColorCode.ERROR,
                            titleKey: "genai.nai_tool_retry_exhausted_title",
                            descriptionKey: "genai.nai_tool_retry_exhausted_description",
                          },
                          {
                            webhook: personaWebhook ?? undefined,
                            personaUsername,
                            personaAvatarUrl,
                          },
                        );
                        finalStreamCompleted = true;
                        break;
                      }
                      // Suppress text on next iteration so repeated pre-tool text isn't shown
                      streamingContext.suppressTextOutput = true;
                      log.info(
                        `NovelAI GLM: Tool "${funcName}" failed (attempt ${naiConsecutiveToolFailures}/${NAI_TOOL_FAILURE_RETRY_THRESHOLD}) — suppressing text output for retry`,
                      );
                    }
                  }

                  // 3. Add the model's function call and our function's result to the history
                  // Include pre-tool-call text parts so the LLM doesn't repeat itself on continuation
                  const historyEntry: {
                    functionCall: FunctionCall;
                    functionResponse: Record<string, unknown>;
                    imageMetadata?: typeof toolResult.imageMetadata;
                    preToolCallTextParts?: Array<Record<string, unknown>>;
                  } = {
                    functionCall: funcCall,
                    functionResponse: {
                      functionResponse: {
                        name: funcName,
                        response: { result: functionExecutionResult },
                      },
                    },
                    preToolCallTextParts: personaAccumulatedParts.length > 0 ? [...personaAccumulatedParts] : undefined,
                  };

                  // Add imageMetadata if present (for tools that send images like brave_image_search)
                  if (toolResult.imageMetadata) {
                    historyEntry.imageMetadata = toolResult.imageMetadata;
                    log.info(
                      `Including ${toolResult.imageMetadata.totalSent} image(s) in function response history for LLM visibility`,
                    );
                  }

                  if (historyEntry.preToolCallTextParts) {
                    log.info(
                      `Preserving ${historyEntry.preToolCallTextParts.length} pre-tool-call text part(s) in function history to prevent repetition`,
                    );
                  }

                  functionInteractionHistory.push(historyEntry);

                  // Tool requested immediate turn end (e.g., boomerang cross-channel message
                  // that will trigger a separate follow-up generation with actual context)
                  if (toolResult.endTurn) {
                    log.info(
                      `Tool "${funcName}" requested endTurn — ending LLM turn immediately to prevent premature response`,
                    );
                    finalStreamCompleted = true;
                    break;
                  }

                  // Disable STM after first successful call to prevent duplicate updates in one turn
                  if (funcName === "update_short_term_memory" && toolResult.success) {
                    streamingContext.disableShortTermMemoryUpdate = true;
                    log.info("Short-term memory updated — disabling further STM calls for this turn");
                  }

                  const providerName = provider.getInfo().name;
                  const hasPreToolText = personaAccumulatedParts.length > 0;

                  // 4. NAI GLM follow-up control: decide whether to allow, suppress,
                  // or skip the next generation based on whether text was already sent
                  // and whether the tool requires a follow-up (e.g., search/fetch).
                  if (providerName === "novelai" && hasPreToolText) {
                    // STM is always a silent tool — end the turn immediately (unchanged)
                    if (funcName === "update_short_term_memory") {
                      log.info(
                        "Short-term memory updated after text was already streamed. Ending persona turn to prevent repetition.",
                      );
                      finalStreamCompleted = true;
                      break;
                    }

                    if (toolResult.success) {
                      // Reset failure counter on success
                      naiConsecutiveToolFailures = 0;

                      // Check if this tool needs a follow-up to present results
                      const needsFollowUp = await ToolRegistry.requiresFollowUp(funcName, providerName);

                      if (needsFollowUp) {
                        // Case 4: Search/fetch tool succeeded with pre-text — allow follow-up
                        // Clear suppression in case it was set by a prior failed attempt
                        streamingContext.suppressTextOutput = false;
                        log.info(`NovelAI GLM: Tool "${funcName}" requires follow-up — allowing next generation`);
                      } else {
                        // Case 1: Non-search tool succeeded with pre-text — suppress follow-up
                        log.info(
                          `NovelAI GLM: Tool "${funcName}" succeeded after text was sent — ending turn (no follow-up needed)`,
                        );
                        finalStreamCompleted = true;
                        break;
                      }
                    }
                    // Tool failure with pre-text is handled above in Case 2 block
                  } else if (hasPreToolText && TOOLS_SUPPRESS_FOLLOWUP_AFTER_PRETOOL_TEXT.has(funcName)) {
                    const needsFollowUp = await ToolRegistry.requiresFollowUp(funcName, providerName);

                    if (needsFollowUp) {
                      log.info(`Tool "${funcName}" requires follow-up after pre-tool text — allowing next generation`);
                    } else {
                      log.info(
                        `Tool "${funcName}" executed after text was already streamed. Ending turn to prevent repetition.`,
                      );
                      finalStreamCompleted = true;
                      break;
                    }
                  }

                  // 5. Safety break if max iterations reached
                  if (i === MAX_FUNCTION_CALL_ITERATIONS - 1) {
                    log.warn(
                      "Max function call iterations reached in streaming mode. LLM did not provide a final text stream.",
                    );
                    if (isUserImpersonation) {
                      throw new Error(
                        "User impersonation could not complete because the model never returned final text.",
                      );
                    }
                    // Send a fallback message if no stream occurred.
                    // If some text was streamed before this, this might be redundant.
                    // For now, assume streamGeminiToDiscord handles its own errors if it starts streaming.
                    // If it returns function_call repeatedly, this is the fallback.
                    await sendStandardEmbed(channel, locale, {
                      color: ColorCode.WARN,
                      titleKey: "genai.max_iterations_title", // New locale key
                      descriptionKey: "genai.max_iterations_streaming_description", // New locale key
                      footerKey: "genai.generic_error_footer",
                    });
                    finalStreamCompleted = true; // Mark as "completed" to exit loop
                    selectedStickerToSend = null; // Clear sticker
                    break;
                  }
                  // Continue to the next iteration of the loop to call streamGeminiToDiscord again with updated history
                  break;
                }

                default: {
                  // Exhaustive check - TypeScript will error if a new status is added but not handled
                  const _exhaustive: never = streamResult.status;
                  log.error(
                    `Unhandled stream status in streaming loop: ${_exhaustive}`,
                    new Error(`Unknown status: ${JSON.stringify(streamResult)}`),
                  );

                  if (isUserImpersonation) {
                    throw new Error(
                      `User impersonation failed with unhandled stream status: ${String(streamResult.status)}`,
                    );
                  }

                  // Show user-facing error for unknown status
                  await sendStandardEmbed(channel, locale, {
                    titleKey: "genai.no_response_title",
                    descriptionKey: "genai.no_response_description",
                    color: ColorCode.WARN,
                    footerKey: "genai.generic_error_footer",
                  }).catch((e) => log.warn("Failed to send unhandled status embed to channel", e));

                  finalStreamCompleted = true; // Break loop on unexpected status
                  break;
                }
              } // End of switch statement

              // If a fallback model was used successfully, post a compact notice with
              // an on-demand details button, or reroute the full notice to thought logs
              // when this notice type is hidden.
              if (!isUserImpersonation && fallbackRunResult.fallbackUsed && fallbackRunResult.successModel) {
                await sendFallbackModelUsageNotice({
                  context: {
                    channel,
                    client,
                    message,
                    tomoriState,
                    locale,
                    provider: provider.getInfo().name,
                    webhook: personaWebhook ?? undefined,
                    personaUsername,
                    personaAvatarUrl,
                    showKillHint: i >= SOFT_WARN_ITERATION_THRESHOLD,
                  },
                  failures: fallbackRunResult.fallbackUsed,
                  successModel: fallbackRunResult.successModel,
                });
              }

              // Check if we should exit the loop after switch statement
              if (finalStreamCompleted) {
                break; // Exit the for loop
              }
            } catch (streamingError) {
              log.error("Critical error during streamGeminiToDiscord call within streaming loop:", streamingError, {
                serverId: tomoriState?.server_id,
                errorType: "StreamingInvocationError",
                metadata: { channelId: channel.id, iteration: i + 1 },
              });
              if (isUserImpersonation) {
                throw streamingError instanceof Error
                  ? streamingError
                  : new Error("User impersonation failed during the streaming invocation.");
              }
              await sendStandardEmbed(channel, locale, {
                color: ColorCode.ERROR,
                titleKey: "genai.generic_error_title",
                descriptionKey: "genai.stream.streaming_failed_description",
                descriptionVars: {
                  error_message: streamingError instanceof Error ? streamingError.message : "Unknown Error",
                },
                footerKey: "genai.generic_error_footer",
              });
              finalStreamCompleted = true; // Break loop on critical error
              break;
            }
          } // End of for loop for function call iterations

          // Clear YouTube processing disable flag after streaming completes
          if (streamingContext.disableYouTubeProcessing) {
            streamingContext.disableYouTubeProcessing = false;
            log.info("Re-enabled YouTube processing function after enhanced context restart completion");
          }

          // Clear profile picture processing disable flag after streaming completes
          if (streamingContext.disableProfilePictureProcessing) {
            streamingContext.disableProfilePictureProcessing = false;
            log.info("Re-enabled profile picture processing function after enhanced context restart completion");
          }

          // 5. After the loop, if a sticker was selected and a stream completed, send the sticker.
          // This is a simple approach; sticker will appear after the streamed text.
          if (selectedStickerToSend && finalStreamCompleted) {
            let stickerSent = false;

            if (currentPersona.is_alter && personaWebhook && personaUsername) {
              const stickerUrl = selectedStickerToSend.url;
              const threadId =
                "isThread" in channel && typeof channel.isThread === "function" && channel.isThread()
                  ? channel.id
                  : undefined;
              try {
                await sendWebhookMessageWithIdentity(
                  personaWebhook,
                  {
                    content: stickerUrl,
                    ...(threadId ? { threadId } : {}),
                  },
                  {
                    username: personaUsername,
                    avatarUrl: personaAvatarUrl,
                    avatarDataUri: personaAvatarUrl?.startsWith("data:image/") ? personaAvatarUrl : undefined,
                  },
                );
                stickerSent = true;
                log.info(`Sent sticker URL for '${selectedStickerToSend.name}' via webhook.`);
              } catch (stickerError) {
                log.warn("Failed to send sticker URL via webhook, falling back to bot sticker send", stickerError);
              }
            }

            if (!stickerSent) {
              try {
                // If the last interaction was a reply (isFromQueue), try to reply with sticker too.
                // Otherwise, just send to channel.
                if (isFromQueue) {
                  await message.reply({ stickers: [selectedStickerToSend.id] });
                } else {
                  await channel.send({ stickers: [selectedStickerToSend.id] });
                }
                stickerSent = true;
                log.info(`Sent selected sticker '${selectedStickerToSend.name}' after stream.`);
              } catch (stickerError) {
                log.error("Failed to send selected sticker after stream:", stickerError, {
                  serverId: tomoriState?.server_id,
                  errorType: "StickerSendError",
                  metadata: { stickerId: selectedStickerToSend.id },
                });
              }
            }
          } else if (!finalStreamCompleted) {
            log.warn("Streaming process did not complete successfully, final response might be missing.");
            // Potentially send a message indicating an issue if no error was already sent.
          }

          if (personaStreamCompletedSuccessfully && personaThoughtLog) {
            turnThoughtLog = mergeThoughtLogPayload(turnThoughtLog, personaThoughtLog);
            if (thoughtLogOwnersMatch(turnThoughtLogOwner, currentThoughtLogOwner)) {
              turnThoughtLogOwner = currentThoughtLogOwner;
            } else {
              turnThoughtLogOwner = { type: "default" };
            }
          }

          // Capture persona response text for short-term memory storage
          log.info(
            `[SHORT_TERM_MEMORY] Debug - finalStreamCompleted=${finalStreamCompleted}, accumulatedTextLength=${finalAccumulatedText.length}`,
          );

          if (finalStreamCompleted && finalAccumulatedText.trim()) {
            // Append extracted <details> block metadata to the response text for STM.
            // This preserves scene/state metadata that was stripped from Discord output.
            const responseText = finalDetailsContent.trim()
              ? `${finalAccumulatedText.trim()}\n\n[Scene Metadata]\n${finalDetailsContent.trim()}`
              : finalAccumulatedText.trim();
            personaResponses.push({
              personaName: currentPersona.tomori_nickname,
              text: responseText,
              tomoriId: currentPersona.tomori_id,
              personaLineageId: currentPersona.persona_lineage_id,
            });
            // Track the last persona that responded for consecutive trigger prevention
            if (currentPersona.tomori_id) {
              setLastRespondedPersona(channel.id, currentPersona.tomori_id);
            }
            log.info(
              `[SHORT_TERM_MEMORY] Captured response from ${currentPersona.tomori_nickname} - length=${responseText.length}${finalDetailsContent.trim() ? `, detailsContent=${finalDetailsContent.trim().length}` : ""}`,
            );
          } else {
            log.warn(
              `[SHORT_TERM_MEMORY] Skipping capture - finalStreamCompleted=${finalStreamCompleted}, accumulatedTextLength=${finalAccumulatedText.length}`,
            );
          }

          // Persona response completed
          log.success(
            `Completed response ${personaIndex + 1}/${personasToRespond.length} from persona "${currentPersona.tomori_nickname}"`,
          );

          // Increment trigger count AFTER successful automated response
          if (
            (!isManuallyTriggered || isPersonaJob) &&
            !reminderRecipientID &&
            !reminderData?.self_reminder &&
            !isStopResponse
          ) {
            const triggerState = getSelfReplyChainState(channel.id);
            triggerState.triggerCount++;
            triggerState.updatedAt = Date.now();
            if (isSelfMessage) triggerState.lastWasSelf = true;
          }
        } catch (personaError) {
          // Handle errors for this specific persona and continue with remaining personas
          log.error(
            `Error generating response for persona "${currentPersona.tomori_nickname}" (${personaIndex + 1}/${personasToRespond.length}). Continuing with remaining personas.`,
            personaError as Error,
            {
              serverId: currentPersona.server_id,
              errorType: "PersonaResponseError",
              metadata: {
                personaId: currentPersona.tomori_id,
                personaNickname: currentPersona.tomori_nickname,
                isAlter: currentPersona.is_alter,
                personaIndex,
                totalPersonas: personasToRespond.length,
              },
            },
          );

          if (isUserImpersonation) {
            throw personaError instanceof Error
              ? personaError
              : new Error("User impersonation failed before a reply was sent.");
          }

          // Always send error embed for failed persona
          const personaErrorMessage = personaError instanceof Error ? personaError.message : String(personaError);
          await sendStandardEmbed(channel, locale, {
            color: ColorCode.ERROR,
            titleKey: "general.errors.persona_response_failed_title",
            descriptionKey: "general.errors.persona_response_failed_description",
            descriptionVars: {
              personaName: currentPersona.tomori_nickname,
              errorMessage: personaErrorMessage,
            },
            footerKey: "genai.generic_error_footer",
          }).catch((embedError) => log.warn("Failed to send persona error embed", embedError));
        } finally {
          if (temporaryUserImpersonationWebhook) {
            try {
              await temporaryUserImpersonationWebhook.delete("User impersonation complete");
              log.info(`Deleted temporary user impersonation webhook for user ${impersonatedUserId}`);
            } catch (error) {
              log.warn("Failed to delete temporary user impersonation webhook", error);
            }
          }

          if (matrixTypingTargetRoomId) {
            await sendMatrixTypingIndicator(matrixTypingTargetRoomId, matrixTypingPersonaName, false);
          }
        }
      } // END OF MULTI-PERSONA RESPONSE LOOP

      const finalThoughtLog = turnThoughtLog;
      if (finalThoughtLog) {
        finalThoughtLog.generationDurationMs = Date.now() - message.createdTimestamp;
      }

      const thoughtLogAttributionLine =
        textCredentialSource === "personal" && personalTextProvider
          ? localizer(locale, "genai.thought_log.personal_attribution", {
              user_mention: `<@${userDiscId}>`,
              provider: getProviderDisplayName(personalTextProvider),
            })
          : undefined;
      // Never emit thought logs from private channels — their activity must remain isolated.
      // Also covers threads whose parent channel is private.
      const thoughtLogPrivateIds = tomoriState.config.private_channel_ids ?? [];
      const thoughtLogParentId = channel.isThread() ? channel.parentId : null;
      const isPrivateChannel =
        thoughtLogPrivateIds.includes(channel.id) ||
        (thoughtLogParentId !== null && thoughtLogPrivateIds.includes(thoughtLogParentId));
      if (
        !isDMChannel &&
        !isPrivateChannel &&
        tomoriState.config.thought_log_channel_disc_id &&
        finalThoughtLog &&
        hasThoughtLogContent(finalThoughtLog)
      ) {
        await sendThoughtLogEmbed({
          client,
          locale,
          tomoriState,
          sourceChannel: channel,
          thoughtLogChannelId: tomoriState.config.thought_log_channel_disc_id,
          thoughtLog: finalThoughtLog,
          owner: turnThoughtLogOwner,
          attributionLine: thoughtLogAttributionLine,
        });
      }

      // When a personal provider was used but the model produced no reasoning
      // content, send a standalone attribution embed so server admins can still
      // see whose credentials were used.
      if (
        !isDMChannel &&
        !isPrivateChannel &&
        tomoriState.config.thought_log_channel_disc_id &&
        thoughtLogAttributionLine &&
        !(finalThoughtLog && hasThoughtLogContent(finalThoughtLog))
      ) {
        await sendAttributionOnlyEmbed({
          client,
          locale,
          tomoriState,
          sourceChannel: channel,
          thoughtLogChannelId: tomoriState.config.thought_log_channel_disc_id,
          attributionLine: thoughtLogAttributionLine,
        });
      }

      // 8.9. Consume exactly one text quota slot for this trigger after first successful output
      if (
        shouldApplyTextQuota &&
        textQuotaStateForTrigger &&
        !textQuotaStateForTrigger.consumed &&
        personaResponses.length > 0
      ) {
        await incrementTextQuota(textQuotaStateForTrigger.serverId, textQuotaStateForTrigger.userDiscId);
        textQuotaStateForTrigger.consumed = true;
        textQuotaTriggerStates.set(effectiveTextQuotaTriggerKey, textQuotaStateForTrigger);
      }

      // === SHORT-TERM MEMORY STORAGE (Phase 2) ===
      // Store conversation in short-term memory cache after successful response
      // Only store if:
      // 1. User privacy level allows (not FULL privacy)
      // 2. Conversation has messages
      // 3. This is not a stop response or other special case
      try {
        if (
          !isStopResponse &&
          simplifiedMessages.length > 0 &&
          userRow &&
          requestSnapshot.triggererPrivacyLevel !== PrivacyLevel.FULL
        ) {
          // Extract last 10 messages (user + model only) with timestamps and speaker names
          const messagesToStore = simplifiedMessages
            .slice(-10)
            .filter((msg) => msg.authorType === "user" || msg.authorType === "persona")
            .map((msg) => ({
              role: msg.authorType === "user" ? ("user" as const) : ("model" as const),
              content: normalizeCustomEmojisForLlm(msg.content || ""),
              timestamp: Date.now(), // Use current time as approximation
              speakerName: msg.authorType === "persona" ? msg.personaName || msg.authorName : msg.authorName,
            }));

          // Add persona responses from this turn (bot's responses just sent)
          for (const response of personaResponses) {
            messagesToStore.push({
              role: "model",
              content: normalizeCustomEmojisForLlm(response.text),
              timestamp: Date.now(),
              speakerName: response.personaName,
            });
          }

          // Store in cache — persona-scoped: each responding persona gets its own STM entry
          // with the full conversation (including all personas' labeled messages)
          if (messagesToStore.length > 0) {
            // Collect unique tomoriIds from responding personas (filter out undefined)
            const uniqueTomoriIds = [
              ...new Set(personaResponses.map((r) => r.tomoriId).filter((id): id is number => id !== undefined)),
            ];

            if (uniqueTomoriIds.length > 0) {
              // Multi-persona or single-persona: store user-scoped STM and, in guilds, server-shared STM
              for (const tomoriId of uniqueTomoriIds) {
                // Look up the lineage ID for this persona from the responses
                const matchingResponse = personaResponses.find((r) => r.tomoriId === tomoriId);
                const personaLineageId = matchingResponse?.personaLineageId ?? null;
                storeShortTermMemory(
                  userDiscId,
                  channel.id,
                  messagesToStore,
                  isDMChannel ? "DM" : serverDiscId,
                  serverName,
                  channelName,
                  tomoriId,
                  personaLineageId,
                  channel.isThread() ? channel.parentId : null,
                );
              }
            } else {
              // Fallback: no persona responses captured (e.g., all failed), store without tomoriId
              storeShortTermMemory(
                userDiscId,
                channel.id,
                messagesToStore,
                isDMChannel ? "DM" : serverDiscId,
                serverName,
                channelName,
                null,
                null,
                channel.isThread() ? channel.parentId : null,
              );
            }
          }
        }
      } catch (storageError) {
        // Don't fail the conversation if storage fails
        log.warn("Failed to store short-term memory, but conversation completed successfully", storageError);
      }

      // 13b. Cross-channel boomerang check — if a cross_channel_message tool dispatched
      // to this channel with boomerang=true, trigger a follow-up generation in the source channel
      try {
        const { consumePendingBoomerang, buildBoomerangContext } = await import(
          "../../tools/functionCalls/crossChannelMessageTool"
        );
        const boomerang = consumePendingBoomerang(channel.id);
        if (boomerang) {
          log.info(`[tomoriChat] Boomerang detected for channel ${channel.id} → source ${boomerang.sourceChannelId}`);
          setImmediate(async () => {
            try {
              // Fetch a context message from the source channel
              const sourceChannel = await client.channels.fetch(boomerang.sourceChannelId).catch(() => null);
              if (!sourceChannel?.isTextBased()) {
                log.warn(`Boomerang: Source channel ${boomerang.sourceChannelId} not found or not text-based`);
                return;
              }
              const sourceMessages = await sourceChannel.messages.fetch({ limit: 1 }).catch(() => null);
              const sourceLastMessage = sourceMessages?.first();
              if (!sourceLastMessage) {
                log.warn(`Boomerang: No messages in source channel ${boomerang.sourceChannelId}`);
                return;
              }

              const boomerangContext = buildBoomerangContext(boomerang);
              suppressNextSelfReply(sourceChannel.id);

              await tomoriChat(
                client,
                sourceLastMessage,
                false, // isFromQueue
                true, // isManuallyTriggered
                false, // forceReason
                undefined, // reasoningQuery
                undefined, // llmOverrideCodename
                false, // isStopResponse
                0, // retryCount
                false, // skipLock
                undefined, // reminderRecipientID
                undefined, // reminderData
                boomerang.personaId, // selectedPersonaId
                false, // isPersonaJob
                boomerang.isUserImpersonation === true, // isUserImpersonation
                boomerang.impersonatedUserId, // impersonatedUserId
                "system", // textQuotaSource
                undefined, // textQuotaTriggerKey
                undefined, // textQuotaUserDiscId
                undefined, // manualSystemPrompt
                undefined, // manualPrefill
                undefined, // naiContinuationPrefill
                undefined, // emptyResponseFinishReason
                boomerangContext, // injectedContextItems
                undefined, // forcedMentions
                undefined, // manualTriggerInvoker
                { disableCrossChannelMessage: true }, // manualStreamingContextOverrides
              );

              log.success(`Boomerang: Follow-up generation completed in source channel ${boomerang.sourceChannelId}`);
            } catch (boomerangError) {
              log.error("Boomerang: Failed to generate follow-up:", boomerangError);
            }
          });
        }
      } catch (boomerangCheckError) {
        // Don't fail the conversation if boomerang check fails
        log.warn("Failed to check/execute boomerang, but conversation completed successfully", boomerangCheckError);
      }
    } catch (error) {
      // 14. Global error handler for entire function
      log.error("Unhandled error in tomoriChat handler:", error);
      if (isUserImpersonation) {
        throw error instanceof Error ? error : new Error("User impersonation failed before a reply could be sent.");
      }
      // Use default locale as userRow might not be available
      await sendStandardEmbed(channel, "en-US", {
        color: ColorCode.ERROR,
        titleKey: "general.errors.critical_error_title",
        descriptionKey: "general.errors.critical_error_description",
        footerKey: "genai.generic_error_footer",
      });
    }
  } finally {
    // --- Semaphore Logic: Release lock and process queue (only for non-recursive calls) ---
    if (!skipLock && lockEntry) {
      // Ensure lockEntry is defined
      const channelLockId = channel.id;
      lockEntry.isLocked = false;
      lockEntry.lockedAt = 0;
      lockEntry.currentMessageId = undefined;
      lockEntry.userDiscId = undefined; // Clear user tracking for rate limiting
      lockEntry.currentIsPersonaJob = false;
      lockEntry.activePersonaId = undefined; // Clear active persona tracking
      lockEntry.activeIsUserImpersonation = undefined; // Clear user impersonation tracking
      lockEntry.activeImpersonatedUserId = undefined; // Clear impersonated user ID
      lockEntry.followUpEligible = false;
      lockEntry.isInToolCallChain = false; // Clear tool-call chain flag
      lockEntry.isCommandTriggered = false; // Clear command trigger flag
      stopDiscordTypingKeepalive(channelLockId, lockEntry, "lock_released");
      log.info(`Channel ${channelLockId} lock released for message ${message.id}.`);

      // Check for stop context and create response after lock release
      const { StreamOrchestrator } = await import("../../utils/discord/streamOrchestrator");
      const stopContext = StreamOrchestrator.getAndClearStopContext(channelLockId);
      if (stopContext) {
        log.info(`Found stop context for channel ${channelLockId}. Triggering stop response after lock release.`);

        // Trigger stop response after current execution completes and lock is fully released
        setImmediate(async () => {
          try {
            await handleStopResponse(stopContext.originalStopMessage, stopContext.client);
          } catch (error) {
            log.error("Failed to generate stop response after lock release:", error);
          }
        });
      }

      // Check if there are messages in the queue for this channel
      if (lockEntry.messageQueue.length > 0) {
        const nextMessageData = lockEntry.messageQueue.shift(); // Get the next message (FIFO)
        if (nextMessageData) {
          log.info(
            `Processing next message ${nextMessageData.message.id} from queue for channel ${channelLockId}. Queue size: ${lockEntry.messageQueue.length}`,
          );
          // Call tomoriChat recursively for the next message.
          // This will re-evaluate the lock status (which should now be false).
          // Use a non-blocking call or setImmediate to avoid deep recursion issues if many messages are queued.
          setImmediate(() => {
            tomoriChat(
              client,
              nextMessageData.message,
              true,
              nextMessageData.isManuallyTriggered,
              nextMessageData.forceReason,
              nextMessageData.reasoningQuery,
              nextMessageData.llmOverrideCodename,
              nextMessageData.isStopResponse, // Pass through the stop response flag
              0, // retryCount - start fresh for queued messages
              false, // skipLock - queued messages should acquire lock normally
              undefined, // reminderRecipientID
              undefined, // reminderData
              nextMessageData.selectedPersonaId,
              nextMessageData.isPersonaJob ?? false,
              nextMessageData.isUserImpersonation, // Preserve user impersonation through queue
              nextMessageData.impersonatedUserId, // Preserve impersonated user ID through queue
              nextMessageData.textQuotaSource ?? "user",
              nextMessageData.textQuotaTriggerKey,
              nextMessageData.textQuotaUserDiscId,
              nextMessageData.manualSystemPrompt, // manualSystemPrompt
              nextMessageData.manualPrefill, // manualPrefill
              undefined, // naiContinuationPrefill
              undefined, // emptyResponseFinishReason
              nextMessageData.injectedContextItems,
              nextMessageData.forcedMentions,
              nextMessageData.manualTriggerInvoker,
              nextMessageData.manualStreamingContextOverrides,
            ).catch((e) => {
              log.error(`Error processing queued message ${nextMessageData.message.id}:`, e);
            });
          });
        }
      } else {
        // If queue is empty, we can consider removing the lock entry to save memory,
        // or keep it for a while if channels are frequently active.
        // For simplicity now, we'll keep it.
        // If we wanted to clean up:
        // if (channelLocks.get(channelLockId)?.messageQueue.length === 0 && !channelLocks.get(channelLockId)?.isLocked) {
        // channelLocks.delete(channelLockId);
        // log.info(`Cleaned up empty lock entry for channel ${channelLockId}`);
        // }
      }
    }
    // --- End Semaphore Logic in finally ---
  }
}

export function isSelfTriggerMessage(message: Message, allPersonas: TomoriState[]): boolean {
  if (message.interaction) return false;

  const clientUserId = message.client.user?.id;
  if (clientUserId && message.author.id === clientUserId) {
    return true;
  }

  if (!message.webhookId) {
    return false;
  }

  const authorName = message.author.username?.toLowerCase();
  if (!authorName) return false;

  return allPersonas.some((persona) => persona.tomori_nickname?.toLowerCase() === authorName);
}

function getAutochatRange(config: TomoriConfigRow): {
  minThreshold: number;
  maxThreshold: number;
} {
  const minThreshold = Math.max(config.autoch_threshold ?? 0, 0);
  if (minThreshold === 0) {
    return { minThreshold: 0, maxThreshold: 0 };
  }

  const rawMaxThreshold = Math.max(config.autoch_threshold_max ?? 0, 0);
  return {
    minThreshold,
    maxThreshold: rawMaxThreshold > 0 ? Math.max(rawMaxThreshold, minThreshold) : minThreshold,
  };
}

function isAutochatConfiguredChannel(config: TomoriConfigRow, channelId: string): boolean {
  return config.autoch_disc_ids.length > 0 && config.autoch_disc_ids.includes(channelId);
}

function getAutochatAssignedPersonaId(config: TomoriConfigRow, channelId: string): number | null {
  const assignedPersona = config.autoch_persona_overrides.find((entry) => entry.channel_disc_id === channelId);
  return assignedPersona?.tomori_id ?? null;
}

function isAutochatQualifyingMessage(message: Message, isSelfMessage: boolean): boolean {
  return !isSelfMessage && isRealUserLikeMessage(message) && !(message.channel instanceof DMChannel);
}

function isAutochatCounterChannelActive(config: TomoriConfigRow, channelId: string): boolean {
  const { minThreshold, maxThreshold } = getAutochatRange(config);
  return minThreshold > 0 && maxThreshold > 0 && isAutochatConfiguredChannel(config, channelId);
}

function isAutochatAlwaysReplyChannelActive(config: TomoriConfigRow, channelId: string): boolean {
  const { minThreshold, maxThreshold } = getAutochatRange(config);
  return minThreshold === 0 && maxThreshold === 0 && isAutochatConfiguredChannel(config, channelId);
}

/**
 * Returns true if the channel has any autochat override active — either a channel-level
 * auto-trigger/always-reply entry in autoch_disc_ids, or the global always_reply_enabled flag.
 * These channels are implicitly whitelisted and should bypass whitelist rejection gates
 * (while still being subject to actual configured cooldowns).
 */
function isAutochatOverrideChannel(config: TomoriConfigRow, channelId: string): boolean {
  return (config.always_reply_enabled ?? false) || isAutochatConfiguredChannel(config, channelId);
}

function isAutochatCounterHit(tomoriState: TomoriState, channelId: string): boolean {
  if (!isAutochatCounterChannelActive(tomoriState.config, channelId)) {
    return false;
  }

  return (
    tomoriState.autoch_counter > 0 &&
    tomoriState.autoch_next_target > 0 &&
    tomoriState.autoch_counter >= tomoriState.autoch_next_target
  );
}

/**
 * Determines which personas should respond to a message based on trigger matching.
 * All matching personas respond, ordered by the first trigger appearance in message text.
 * @param message - The incoming Discord message
 * @param allPersonas - Array of all personas (main + alters)
 * @param client - Discord client for mention checks
 * @param isReplyToBot - Whether message is a reply to the bot
 * @param replyPersona - Persona that the message is replying to (if any)
 * @param isBotMentioned - Whether bot is mentioned in the message
 * @param isAutoMsgHit - Whether the shared auto-chat range hit
 * @param isAlwaysReply - Whether always-reply mode triggered this message
 * @param deliberateTriggerMode - Whether deliberate trigger mode is active for this message
 * @param isAutochatDtmExemptChannel - Whether this channel exempts one fallback persona from DTM
 * @param allowedPersonaIds - Optional set of personas allowed for this turn after whitelist filtering
 * @returns Array of matching personas in deterministic trigger order
 */
export function determineMatchingPersonas(
  message: Message,
  allPersonas: TomoriState[],
  _client: Client,
  isReplyToBot: boolean,
  replyPersona: TomoriState | null,
  isBotMentioned: boolean,
  isAutoMsgHit: boolean,
  isAlwaysReply = false,
  autoTriggerPersonaId?: number | null,
  alwaysReplyFallbackPersonaId?: number | null,
  deliberateTriggerMode = false,
  isAutochatDtmExemptChannel = false,
  allowedPersonaIds?: ReadonlySet<number> | null,
): TomoriState[] {
  const mainPersona = allPersonas.find((persona) => !persona.is_alter);
  const resolveFallbackPersona = (personaId?: number | null): TomoriState | undefined =>
    (personaId ? allPersonas.find((persona) => persona.tomori_id === personaId) : undefined) ?? mainPersona;
  const isPersonaAllowed = (persona?: TomoriState | null): persona is TomoriState =>
    Boolean(
      persona &&
        (!allowedPersonaIds || (typeof persona.tomori_id === "number" && allowedPersonaIds.has(persona.tomori_id))),
    );

  // 1. Direct targets force a response, but do not suppress additional
  // explicit persona triggers in the same message.
  const forcedPersonas: TomoriState[] = [];
  const forcedPersonaIds = new Set<number>();
  const addForcedPersona = (persona?: TomoriState | null): void => {
    if (!isPersonaAllowed(persona)) {
      return;
    }
    if (typeof persona.tomori_id === "number" && forcedPersonaIds.has(persona.tomori_id)) {
      return;
    }
    if (typeof persona.tomori_id !== "number" && forcedPersonas.includes(persona)) {
      return;
    }
    forcedPersonas.push(persona);
    if (typeof persona.tomori_id === "number") {
      forcedPersonaIds.add(persona.tomori_id);
    }
  };

  addForcedPersona(replyPersona);
  if (isReplyToBot || isBotMentioned) {
    addForcedPersona(mainPersona);
  }

  if (isAutoMsgHit && forcedPersonas.length === 0) {
    const autoTriggerPersona = resolveFallbackPersona(autoTriggerPersonaId);
    return isPersonaAllowed(autoTriggerPersona) ? [autoTriggerPersona] : [];
  }

  // Determine which persona (if any) sent this message for self-trigger prevention
  let senderPersona: TomoriState | undefined;
  // Build nickname map for webhook lookup
  const personaByNickname = new Map<string, TomoriState>();
  for (const persona of allPersonas) {
    const nicknameKey = persona.tomori_nickname?.toLowerCase();
    if (!nicknameKey || personaByNickname.has(nicknameKey)) continue;
    personaByNickname.set(nicknameKey, persona);
  }
  if (message.webhookId) {
    // Message from a webhook - identify the persona by webhook username
    const webhookName = message.author.username.toLowerCase();
    senderPersona = personaByNickname.get(webhookName);
    // biome-ignore lint/style/noNonNullAssertion: client.user is available in messageCreate event
  } else if (message.author.id === _client.user!.id) {
    // Message from the main bot - find the main persona (not an alter)
    senderPersona = allPersonas.find((p) => !p.is_alter);
  }

  // Determine which persona (if any) is being replied to for self-trigger prevention
  let repliedToPersona: TomoriState | undefined;
  if (message.reference?.messageId) {
    const referenceMessage = message.channel.messages.cache.get(message.reference.messageId);
    if (referenceMessage) {
      // biome-ignore lint/style/noNonNullAssertion: client.user is available in messageCreate event
      if (referenceMessage.author.id === _client.user!.id) {
        // Reply to main bot - find the main persona (not an alter)
        repliedToPersona = allPersonas.find((p) => !p.is_alter);
      } else if (referenceMessage.webhookId) {
        // Reply to webhook - identify the persona by webhook username
        const webhookName = referenceMessage.author.username.toLowerCase();
        repliedToPersona = personaByNickname.get(webhookName);
      }
    }
  }

  // 2. Trigger word matching: Check all personas
  const matchingPersonas: Array<{
    persona: TomoriState;
    firstMatchIndex: number;
    insertionOrder: number;
  }> = [];

  for (const [insertionOrder, persona] of allPersonas.entries()) {
    if (!isPersonaAllowed(persona)) {
      continue;
    }

    // Prevent self-triggers: skip if this persona sent the message OR is being replied to
    if (senderPersona && persona.tomori_id === senderPersona.tomori_id) {
      continue;
    }
    if (repliedToPersona && persona.tomori_id === repliedToPersona.tomori_id) {
      continue;
    }
    if (typeof persona.tomori_id === "number" && forcedPersonaIds.has(persona.tomori_id)) {
      continue;
    }

    const config = persona.config;
    if (!config) continue;

    // Persona-scoped trigger words (fallback to legacy columns during soak)
    const triggers =
      persona.trigger_words ?? (persona.is_alter ? (persona.alter_triggers ?? []) : (config.trigger_words ?? []));

    let hasMatch = false;
    let firstMatchIndex = Number.MAX_SAFE_INTEGER;

    for (const trigger of triggers) {
      const isPersonaDtmExempt =
        isAutochatDtmExemptChannel &&
        (autoTriggerPersonaId === null ? !persona.is_alter : autoTriggerPersonaId === persona.tomori_id);
      const matchIndex = getTriggerFirstMatchIndex(message, trigger, deliberateTriggerMode && !isPersonaDtmExempt);
      if (matchIndex !== Number.POSITIVE_INFINITY) {
        hasMatch = true;
        if (matchIndex < firstMatchIndex) {
          firstMatchIndex = matchIndex;
        }
      }
    }

    if (hasMatch) {
      matchingPersonas.push({
        persona,
        firstMatchIndex,
        insertionOrder,
      });
    }
  }

  // 3. Deterministic order:
  // 1) earliest trigger appearance in message
  // 2) fallback to persona iteration order when tied
  matchingPersonas.sort((a, b) => {
    if (a.firstMatchIndex !== b.firstMatchIndex) {
      return a.firstMatchIndex - b.firstMatchIndex;
    }
    return a.insertionOrder - b.insertionOrder;
  });

  const result = [...forcedPersonas, ...matchingPersonas.map((entry) => entry.persona)];

  // 4. Always-reply fallback:
  // If always-reply mode is active and no trigger matched any persona, the main persona responds.
  // If an alter persona's trigger matched, only the alter(s) respond — main persona stays quiet
  // to avoid doubling up. If the main persona's OWN trigger matched, it's already in the list
  // so no duplicate is added.
  if (isAlwaysReply && result.length === 0) {
    const fallbackPersona = resolveFallbackPersona(alwaysReplyFallbackPersonaId);
    if (isPersonaAllowed(fallbackPersona)) {
      return [fallbackPersona];
    }
  }

  return result;
}

/**
 * Determines if the bot should generate a reply based on message context and bot settings.
 * @param message - The incoming Discord message.
 * @param tomoriState - The current state of the bot for the server (TomoriRow + TomoriConfigRow).
 * @returns True if the bot should reply, false otherwise.
 */
type ShouldBotReplyOptions = {
  personalAutoTriggerPersonaId?: number | null;
  allowedPersonaIds?: ReadonlySet<number> | null;
};

export function shouldBotReply(
  message: Message,
  tomoriState: TomoriState,
  allPersonas: TomoriState[],
  options: ShouldBotReplyOptions = {},
): boolean {
  const isSelfMessage = isSelfTriggerMessage(message, allPersonas);
  const isMatrixRelayMessage = Boolean(message.webhookId) && isMatrixBridgeWebhookUsername(message.author.username);
  const rawCascadeLimit = tomoriState.config.cascade_limit ?? DEFAULT_CASCADE_LIMIT;
  const cascadeLimit = Math.min(Math.max(rawCascadeLimit, 0), MAX_CASCADE_LIMIT);

  if (message.webhookId && !isSelfMessage && !isMatrixRelayMessage) {
    return false;
  }
  if (isSelfMessage && cascadeLimit <= 0) {
    return false;
  }

  // 1. Basic checks: Ignore bots, commands, non-text channels, and messages with no content
  const isThreadChannel =
    message.channel.type === ChannelType.PublicThread ||
    message.channel.type === ChannelType.PrivateThread ||
    message.channel.type === ChannelType.AnnouncementThread;
  const isVoiceChannel =
    message.channel.type === ChannelType.GuildVoice || message.channel.type === ChannelType.GuildStageVoice;
  if (
    (message.author.bot && (!isSelfMessage || cascadeLimit <= 0) && !isMatrixRelayMessage) ||
    message.content.startsWith("!") || // Basic command prefix check
    !(
      message.channel instanceof TextChannel ||
      message.channel instanceof DMChannel ||
      isThreadChannel ||
      isVoiceChannel
    ) // Support TextChannel, DMChannel, thread, and voice/stage channels
  ) {
    return false;
  }

  // Cascade trigger count guard: stop if we've already hit the absolute limit
  if (isSelfMessage && cascadeLimit > 0) {
    const chainState = getSelfReplyChainState(message.channel.id);
    if (chainState.triggerCount >= cascadeLimit + 1) {
      return false;
    }
  }

  // Config is guaranteed to exist by loadTomoriState structure
  // biome-ignore lint/style/noNonNullAssertion: config is part of TomoriState type
  const config = tomoriState.config!;
  const allowedPersonaIds = options.allowedPersonaIds ?? null;
  const mainPersona = allPersonas.find((persona) => !persona.is_alter);
  const resolveFallbackPersona = (personaId?: number | null): TomoriState | undefined =>
    (personaId ? allPersonas.find((persona) => persona.tomori_id === personaId) : undefined) ?? mainPersona;
  const isPersonaAllowed = (persona?: TomoriState | null): persona is TomoriState =>
    Boolean(
      persona &&
        (!allowedPersonaIds || (typeof persona.tomori_id === "number" && allowedPersonaIds.has(persona.tomori_id))),
    );

  // 2. Check if the message is a reply to the bot
  let isReplyToBot = false;
  let isReplyToPersona = false;
  let replyPersonaTarget: TomoriState | null = null;
  const personaByNickname = new Map<string, TomoriState>();
  for (const persona of allPersonas) {
    const nicknameKey = persona.tomori_nickname?.toLowerCase();
    if (!nicknameKey || personaByNickname.has(nicknameKey)) continue;
    personaByNickname.set(nicknameKey, persona);
  }
  if (message.reference?.messageId) {
    const referenceMessage = message.channel.messages.cache.get(message.reference.messageId);
    // biome-ignore lint/style/noNonNullAssertion: client.user is available in messageCreate event
    if (referenceMessage?.author.id === message.client.user!.id) {
      isReplyToBot = true;
      isReplyToPersona = true;
      replyPersonaTarget = mainPersona ?? null;
    } else if (referenceMessage?.webhookId) {
      const webhookReplyTarget = resolveReferencedWebhookTarget(referenceMessage, personaByNickname, message.guild);
      if (webhookReplyTarget.replyPersona) {
        isReplyToPersona = true;
        replyPersonaTarget = webhookReplyTarget.replyPersona;
      }
      if (webhookReplyTarget.impersonatedUserId) {
        isReplyToBot = true;
        isReplyToPersona = true;
      }
    }
  }

  // 3. Check if the bot is mentioned directly
  // biome-ignore lint/style/noNonNullAssertion: client.user is available in messageCreate event
  const isBotMentioned = message.mentions.users.has(message.client.user!.id);

  // Determine which persona (if any) sent this message for self-trigger prevention
  let senderPersona: TomoriState | undefined;
  if (message.webhookId) {
    // Message from a webhook - identify the persona by webhook username
    const webhookName = message.author.username.toLowerCase();
    senderPersona = personaByNickname.get(webhookName);
    // biome-ignore lint/style/noNonNullAssertion: client.user is available in messageCreate event
  } else if (message.author.id === message.client.user!.id) {
    // Message from the main bot - find the main persona (not an alter)
    senderPersona = allPersonas.find((p) => !p.is_alter);
  }

  // 4. Check if the message content triggers ANY persona (main or alters).
  // Threads inherit autochat settings from their parent channel.
  const msgEffectiveChannelId = message.channel.isThread()
    ? (message.channel.parentId ?? message.channel.id)
    : message.channel.id;

  // DTM: block plain trigger words unless the message is a deliberate invocation.
  // Exempt: DMs and Matrix relay messages. Auto-trigger channel exemption is per-persona
  // (only the persona assigned to the channel bypasses DTM; other personas still require @{trigger}).
  const isDtmActive = (config.deliberate_trigger_mode ?? false) && !!message.guild && !isMatrixRelayMessage;

  // Pre-compute auto-trigger channel info for per-persona DTM exemption inside the loop.
  const personalAutoTriggerPersonaId = options.personalAutoTriggerPersonaId ?? null;
  const hasPersonalAutoTrigger = Number.isInteger(personalAutoTriggerPersonaId);
  const isAutoTriggerChannel = isAutochatConfiguredChannel(config, msgEffectiveChannelId) || hasPersonalAutoTrigger;
  const serverAutochatPersonaId = isAutochatConfiguredChannel(config, msgEffectiveChannelId)
    ? getAutochatAssignedPersonaId(config, msgEffectiveChannelId)
    : null;
  // null → no persona override, so the main (non-alter) persona is exempt; otherwise only the assigned ID is.
  const autochatPersonaId = hasPersonalAutoTrigger ? personalAutoTriggerPersonaId : serverAutochatPersonaId;

  let triggersActive = false;
  let triggersActiveDeliberate = false;
  let selfMsgTriggerDiag: {
    matchedPersona: string;
    matchedTrigger: string;
    triggerSource: string;
    senderPersona: string;
    contentSnippet: string;
  } | null = null;

  for (const persona of allPersonas) {
    if (!isPersonaAllowed(persona)) {
      continue;
    }

    // Prevent self-triggers: skip if this persona sent the message
    if (senderPersona && persona.tomori_id === senderPersona.tomori_id) {
      continue;
    }

    // Determine which trigger list to use
    const triggerSource = persona.trigger_words
      ? "trigger_words"
      : persona.is_alter
        ? "alter_triggers"
        : "config_trigger_words";
    const triggers =
      persona.trigger_words ??
      (persona.is_alter ? (persona.alter_triggers ?? []) : (persona.config?.trigger_words ?? []));

    for (const trigger of triggers) {
      let matched = false;
      let isDeliberate = false;

      // Check if trigger is a mention (starts with <@)
      if (trigger.startsWith("<@")) {
        const userId = trigger.replace(/[<@!>]/g, ""); // Extract user ID
        matched = message.mentions.users.has(userId);
        // Mention triggers are always deliberate (direct address)
        isDeliberate = true;
      } else {
        // Check if trigger contains Japanese characters
        const isJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(trigger);
        if (isJapanese) {
          // Japanese triggers: direct substring match (no screaming support)
          matched = message.content.includes(trigger);
        } else {
          // English triggers: use screaming-aware regex with word boundaries (case-insensitive)
          const regex = createScreamingRegex(trigger);
          matched = regex.test(message.content);
        }
        // DTM deliberate check: multi-word triggers share one rule everywhere.
        // Exact @{trigger} always works, while @{firstWord} only counts if the full
        // trigger phrase is also present in the message. Per-persona exemption:
        // auto-trigger channel only exempts the assigned persona. null override →
        // main (non-alter) persona is exempt; otherwise only the assigned tomori_id is.
        const isPersonaDtmExempt =
          isAutoTriggerChannel &&
          (autochatPersonaId === null ? !persona.is_alter : autochatPersonaId === persona.tomori_id);
        isDeliberate =
          isDtmActive && !isPersonaDtmExempt ? getDeliberateTriggerMatch(message.content, trigger) !== null : true; // DTM off or persona exempt → all matches treated as deliberate
      }

      if (matched) {
        triggersActive = true;
        if (isDeliberate) {
          triggersActiveDeliberate = true;
          break; // Deliberate match found for this persona, no need to check later triggers
        }
        // Log diagnostic for self-messages to trace cross-persona trigger chains
        if (isSelfMessage) {
          selfMsgTriggerDiag = {
            matchedPersona: persona.tomori_nickname ?? `id:${persona.tomori_id}`,
            matchedTrigger: trigger,
            triggerSource,
            senderPersona: senderPersona?.tomori_nickname ?? `id:${senderPersona?.tomori_id}`,
            contentSnippet: message.content.slice(0, 120),
          };
        }
        // Under DTM, a short plain trigger like "lilya" may match before a later
        // multi-word deliberate trigger like "evil lilya" on the same persona.
        // Keep scanning this persona's remaining triggers unless we already found
        // a deliberate match or DTM is inactive.
        if (!isDtmActive) {
          break;
        }
      }
    }
    // When DTM is active and the match wasn't deliberate, keep checking other personas for a deliberate match
    if (triggersActive && (!isDtmActive || triggersActiveDeliberate)) break;
  }

  if (selfMsgTriggerDiag) {
    log.info(
      `[Self-Msg Cross-Trigger] Persona "${selfMsgTriggerDiag.senderPersona}" message ` +
        `triggered "${selfMsgTriggerDiag.matchedPersona}" via ${selfMsgTriggerDiag.triggerSource} ` +
        `trigger "${selfMsgTriggerDiag.matchedTrigger}" in channel ${message.channel.id}. ` +
        `Content: "${selfMsgTriggerDiag.contentSnippet}"`,
    );
  }

  // 5. Check if the shared auto-chat range hit for this message.
  // msgEffectiveChannelId is already computed above (before the trigger loop).
  const autoReplyPersona = resolveFallbackPersona(autochatPersonaId);
  const scopedAlwaysReplyPersona = resolveFallbackPersona(serverAutochatPersonaId);
  const personalAutoReplyPersona = resolveFallbackPersona(personalAutoTriggerPersonaId);
  const isAutoMsgHit =
    !hasPersonalAutoTrigger &&
    isAutochatQualifyingMessage(message, isSelfMessage) &&
    isAutochatCounterHit(tomoriState, msgEffectiveChannelId) &&
    isPersonaAllowed(autoReplyPersona);
  const isScopedAlwaysReplyHit =
    !isMatrixRelayMessage &&
    isAutochatAlwaysReplyChannelActive(config, msgEffectiveChannelId) &&
    isAutochatQualifyingMessage(message, isSelfMessage) &&
    isPersonaAllowed(scopedAlwaysReplyPersona);
  const isPersonalAutoTriggerHit =
    !isMatrixRelayMessage &&
    hasPersonalAutoTrigger &&
    isAutochatQualifyingMessage(message, isSelfMessage) &&
    isPersonaAllowed(personalAutoReplyPersona);

  // 6. Check always-reply mode:
  // When enabled, main persona replies to all real user messages in guild channels.
  // Does NOT apply to: bot messages, persona webhook messages, or Matrix relay messages.
  // Auto-chat range 0-0 reuses this path, but only for configured auto-chat channels.
  // Persona selection (main vs alter) is handled downstream in determineMatchingPersonas().
  const isAlwaysReplyHit =
    (config.always_reply_enabled &&
      !isMatrixRelayMessage &&
      isAutochatQualifyingMessage(message, isSelfMessage) &&
      isPersonaAllowed(mainPersona)) ||
    isScopedAlwaysReplyHit ||
    isPersonalAutoTriggerHit;

  // 7. Determine if bot should reply:
  // Reply if (it's a reply to the bot OR bot is mentioned OR triggers are active) OR if the shared auto-chat range hit.
  // isMatrixReplyToPersona: Matrix webhooks cannot carry Discord reply references, so
  // matrixManager.ts registers the channel in pendingMatrixReplyChannels when it relays
  // a Matrix reply to a bot persona. Set.delete() returns true if the key existed
  // and removes it atomically — one-shot consumption prevents stale triggers.
  const isMatrixReplyToPersona = isMatrixRelayMessage && pendingMatrixReplyChannels.delete(message.channelId);

  // When DTM is active, plain trigger matches don't count — only deliberate invocations do.
  const effectiveTriggersActive = isDtmActive ? triggersActiveDeliberate : triggersActive;
  const effectiveReplyToBot = isReplyToBot && isPersonaAllowed(mainPersona);
  const effectiveReplyToPersona = isReplyToPersona && isPersonaAllowed(replyPersonaTarget ?? mainPersona);
  const effectiveBotMentioned = isBotMentioned && isPersonaAllowed(mainPersona);

  const wouldReply =
    effectiveReplyToBot ||
    effectiveReplyToPersona ||
    effectiveBotMentioned ||
    effectiveTriggersActive ||
    isAutoMsgHit ||
    isAlwaysReplyHit ||
    isMatrixReplyToPersona;

  // Diagnostic: log full decision breakdown for self-messages that would trigger a reply.
  // This captures cases where the cross-trigger log above didn't fire (e.g. auto-chat leak).
  if (isSelfMessage && wouldReply) {
    const reasons = [
      effectiveReplyToBot && "isReplyToBot",
      effectiveReplyToPersona && "isReplyToPersona",
      effectiveBotMentioned && "isBotMentioned",
      effectiveTriggersActive && "effectiveTriggersActive",
      isAutoMsgHit && "isAutoMsgHit",
      isAlwaysReplyHit && "isAlwaysReplyHit",
      isMatrixReplyToPersona && "isMatrixReplyToPersona",
    ].filter(Boolean);

    log.info(
      `[Self-Msg Reply Decision] msg ${message.id} in ch ${message.channel.id} ` +
        `from "${senderPersona?.tomori_nickname ?? message.author.username}" → would reply. ` +
        `Reasons: [${reasons.join(", ")}]. ` +
        `autoch_counter=${tomoriState.autoch_counter}/${tomoriState.autoch_next_target}, ` +
        `cascadeLimit=${cascadeLimit}, triggerCount=${getSelfReplyChainState(message.channel.id).triggerCount}`,
    );
  }

  return wouldReply;
}

/**
 * Handles stop response generation after a stream has been interrupted
 * @param originalStopMessage - The original message that requested the stop
 * @param client - Discord client
 */
export async function handleStopResponse(originalStopMessage: Message, client: Client): Promise<void> {
  try {
    log.info(
      `Generating stop response for message ${originalStopMessage.id} in channel ${originalStopMessage.channel.id}`,
    );

    // Use original stop message as "passport" (like respond.ts command does)
    // isManuallyTriggered: true bypasses all normal trigger logic
    await tomoriChat(
      client,
      originalStopMessage,
      true, // isFromQueue to trigger reply to same message
      true, // isManuallyTriggered - this bypasses normal trigger logic and forces response
      false, // forceReason
      undefined, // reasoningQuery
      undefined, // llmOverrideCodename
      true, // isStopResponse - This prevents the stop response from being stopped
      0, // retryCount - start fresh for stop responses
      false, // skipLock - stop responses should acquire lock normally
    );
  } catch (error) {
    log.error("Failed to handle stop response:", error);
  }
}

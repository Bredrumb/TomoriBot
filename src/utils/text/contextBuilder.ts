import type { Client, GuildTextBasedChannel, PresenceStatus } from "discord.js";
import { GatewayIntentBits } from "discord.js";
import { sql } from "../db/client";
import { isRagAvailable } from "../db/ragDetection";
import {
  isBlacklisted, // Import blacklist checker
  getPrivacyLevel, // Import privacy level checker
  loadTomoriState,
  loadUserRow,
  loadPersonalMemoriesForUserLineage,
  getPendingRemindersForUser,
  loadEmbeddingModelById,
} from "../db/dbRead"; // Import session helpers
import {
  ContextItemTag,
  type ContextPart, // New: For text/image parts
  type ConversationUserReference,
  type StructuredContextItem, // New: The main output type
} from "../../types/misc/context";
import { registerUser } from "../db/dbWrite";
import { resolvePreferredDiscordDisplayName } from "../discord/displayName";
import { log } from "../misc/logger";
import { replaceTemplateVariables, humanizeString, normalizeCustomEmojisForLlm } from "./stringHelper";
import { applyUncensorInputTransforms, buildUncensorInjectionText } from "./uncensor";
import { getCurrentTimeWithOffset, formatUTCOffset, getTimeOfDayPhrase } from "./timezoneHelper";
import {
  HumanizerDegree,
  PrivacyLevel,
  type ConditioningType,
  type TomoriConfigRow,
  type ServerEmojiRow,
  type ServerStickerRow,
} from "@/types/db/schema";
import { UNPAIRED_SAMPLE_DIALOGUE_SENTINEL } from "@/types/preset/presetExport";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { memoryGuard } from "../security/rateLimiter";
import { formatRetrievedChunksForPrompt, retrieveRelevantDocumentChunks } from "../documents/documentService";
import {
  getShortTermMemoriesForServer,
  getShortTermMemoriesForUser,
  getShortTermMemoryForServerChannel,
  getShortTermMemoryForUserChannel,
  getRelativeTimestamp,
} from "../cache/shortTermMemoryCache";
import { getCachedAllPersonas } from "../cache/tomoriStateCache";
import { getCachedUserRow } from "../cache/userCache";
import { formatMemoryWithId } from "../memory/memoryId";
import { hasExplicitLongTermMemoryIntent } from "@/utils/memory/explicitLongTermMemoryIntent";
import { getCachedActivePreset } from "../cache/stPresetCache";
import { reassembleWithPreset } from "./presetContextBuilder";
import { loadConditioningGroupsForPersona } from "@/utils/db/conditioningDb";
import {
  CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE,
  getConditioningContextPastParticiple,
} from "@/utils/conditioning/conditioning";
import { createToolPromptMacroResolver, type ToolPromptMacroResolver } from "@/utils/tools/toolPromptMacros";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { formatChannelReferenceLabel } from "@/utils/discord/targetResolver";
import { resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { getResolvedCapabilityModelId } from "@/utils/provider/credentialResolver";

/**
 * Maps userId -> nickname for the current mention replacement operation.
 * @remarks This cache is cleared after each text processing run to avoid stale data.
 */
const mentionCache = new Map<string, string>();
const DISCORD_CHANNEL_LINK_TEST_PATTERN =
  /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{17,19})\/\d{17,19}(?:\/\d{17,19})?/i;
const DISCORD_CHANNEL_LINK_REPLACE_PATTERN =
  /https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(?:@me|\d{17,19})\/(\d{17,19})(?:\/(\d{17,19}))?/gi;

// Environment variables for short-term memory configuration
const MIN_MESSAGES_FOR_SUMMARY = Number.parseInt(process.env.SHORT_TERM_MEMORY_MIN_MESSAGES_FOR_SUMMARY || "6", 10);
const MAX_OTHER_CHANNEL_MEMORIES = Number.parseInt(process.env.SHORT_TERM_MEMORY_MAX_OTHER_CHANNELS || "3", 10);

const DOCUMENT_QUERY_MAX_LENGTH = 1000;
const DOCUMENT_QUERY_MIN_LENGTH = 3;
const DOCUMENT_MAX_RESULTS = (() => {
  const parsed = Number.parseInt(process.env.DOCUMENT_MAX_RESULTS || "6", 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 6;
})();
const DOCUMENT_MIN_SIMILARITY = (() => {
  const parsed = Number.parseFloat(process.env.DOCUMENT_MIN_SIMILARITY || "0.5");
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.5;
})();
const MEDIA_IMAGE_MESSAGE_LIMIT = (() => {
  const parsed = Number.parseInt(process.env.MEDIA_IMAGE_MESSAGE_LIMIT || "3", 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 3;
})();

const RANDOM_CHOICE_MACRO_REGEX =
  /\{\{\s*random(?:::\s*([^{}]+)|:\s*([^{}]+))\s*\}\}|\{\s*random(?:::\s*([^{}]+)|:\s*([^{}]+))\s*\}/gi;

export const DEFAULT_SYSTEM_PROMPT =
  "\n{bot} makes sure to respond short and concisely, as {bot} is aware that no one really likes to read walls of text. {bot} only makes lengthy responses if and only if people are asking for assistance or an explanation that warrants it.";

/**
 * Simplified message structure received from tomoriChat.ts.
 * This is an internal representation before converting to StructuredContextItem.
 */
export type SimplifiedMessageForContext = {
  id: string; // Discord message ID
  authorId: string;
  authorName: string;
  authorType: "user" | "persona";
  personaName?: string | null;
  content: string | null;
  createdAt?: number; // Discord message creation timestamp in milliseconds (message.createdTimestamp)
  mediaSourceMessageIds?: string[]; // Array of message IDs that host media (for combined messages)
  remoteMediaSourceKind?: "reply" | "forwarded";
  combinedMessageIds?: string[]; // All Discord message IDs when messages are combined
  individualContents?: string[]; // Per-message content pieces (stored during combining)
  imageAttachments: Array<{
    url: string;
    proxyUrl: string;
    mimeType: string | null;
    filename: string;
    isEmoji?: boolean; // True if this attachment is a custom Discord emoji
  }>;
  videoAttachments: Array<{
    url: string;
    proxyUrl: string;
    mimeType: string | null;
    filename: string;
    isYouTubeLink: boolean;
  }>;
};

/**
 * Quick check to determine if text contains patterns that need conversion.
 * Avoids expensive processing for text without Discord mentions or template variables.
 * @param text - Text to check
 * @returns True if text needs conversion, false otherwise
 */
function needsConversion(text: string): boolean {
  // Check for Discord mentions: <@userid>, <#channelid>, <@&roleid>
  // Check for Discord channel/thread links: https://discord.com/channels/<guild>/<channel>
  // Check for template variables: {bot}, {user}, {char}, {{user}}, {{char}}, {{bot}}
  return (
    /<[@#][!&]?\d{17,19}>/.test(text) ||
    DISCORD_CHANNEL_LINK_TEST_PATTERN.test(text) ||
    /(?:\{\{(?:bot|char|user)\}\}|\{(?:bot|char|user)\})/i.test(text)
  );
}

function normalizeDiscordChannelLinks(text: string): string {
  // Message IDs are stripped from channel links to prevent snowflake ID exposure to the LLM.
  // The channel reference alone provides sufficient context.
  return text.replace(DISCORD_CHANNEL_LINK_REPLACE_PATTERN, (_match, channelId: string) => `<#${channelId}>`);
}

function formatDiscordChannelReference(channelId: string | undefined, fallbackText: string): string {
  return channelId ? `<#${channelId}>` : fallbackText;
}

function splitLeadingSystemBlocks(content: string): { leadingSystemBlocks: string[]; remainingContent: string | null } {
  const lines = content.split("\n");
  const leadingSystemBlocks: string[] = [];
  let currentIndex = 0;

  while (currentIndex < lines.length && /^\[System: .*]$/.test(lines[currentIndex])) {
    leadingSystemBlocks.push(lines[currentIndex]);
    currentIndex++;
  }

  const remainingContent = lines.slice(currentIndex).join("\n").trim();
  return {
    leadingSystemBlocks,
    remainingContent: remainingContent || null,
  };
}

/**
 * Resolves ST-style random choice macros that can appear in imported presets
 * or prompt fields. Each macro occurrence is rolled independently.
 */
export function resolveRandomChoiceMacros(text: string): string {
  return text.replace(
    RANDOM_CHOICE_MACRO_REGEX,
    (
      _match,
      doubleBraceColonOptions: string | undefined,
      doubleBraceCommaOptions: string | undefined,
      singleBraceColonOptions: string | undefined,
      singleBraceCommaOptions: string | undefined,
    ) => {
      const isColonSyntax = doubleBraceColonOptions !== undefined || singleBraceColonOptions !== undefined;
      const rawOptions =
        doubleBraceColonOptions ?? doubleBraceCommaOptions ?? singleBraceColonOptions ?? singleBraceCommaOptions ?? "";
      const separator = isColonSyntax ? "::" : ",";
      const items = rawOptions
        .split(separator)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

      if (items.length === 0) return "";
      return items[Math.floor(Math.random() * items.length)];
    },
  );
}

function resolveRandomChoiceMacrosInContextItem(item: StructuredContextItem): StructuredContextItem {
  let changed = false;
  const parts = item.parts.map((part): ContextPart => {
    if (part.type !== "text") return part;

    const resolvedText = resolveRandomChoiceMacros(part.text);
    if (resolvedText === part.text) return part;

    changed = true;
    return { ...part, text: resolvedText };
  });

  return changed ? { ...item, parts } : item;
}

function resolveRandomChoiceMacrosInBuildOutput(output: {
  contextItems: StructuredContextItem[];
  tailDirectives: string[];
  lowerPriorityTailDirectives: string[];
  uncensorDirective?: string;
}): {
  contextItems: StructuredContextItem[];
  tailDirectives: string[];
  lowerPriorityTailDirectives: string[];
  uncensorDirective?: string;
} {
  return {
    contextItems: output.contextItems.map(resolveRandomChoiceMacrosInContextItem),
    tailDirectives: output.tailDirectives.map(resolveRandomChoiceMacros),
    lowerPriorityTailDirectives: output.lowerPriorityTailDirectives.map(resolveRandomChoiceMacros),
    uncensorDirective:
      output.uncensorDirective !== undefined ? resolveRandomChoiceMacros(output.uncensorDirective) : undefined,
  };
}

/**
 * Converts Discord mention IDs to human-readable names using cached database lookups.
 * Also handles special placeholders like {user} and {bot}.
 * Checks for custom DB nicknames first, then server nicknames, then Discord usernames.
 * @param text - Text containing Discord mention strings or placeholders
 * @param client - Discord client for user/role lookups
 * @param serverId - Discord server ID for context
 * @param triggererName - Name of the user who triggered the action (for {user} replacement)
 * @param tomoriNickname - The bot's current nickname for {bot} replacement.
 * @param personalMemoriesEnabled - Whether server personalization is enabled (affects custom nickname usage)
 * @param snapshot - Optional per-request snapshot to avoid redundant DB queries
 * @returns Text with mentions and placeholders replaced by human-readable names
 */
export async function convertMentions(
  text: string,
  client: Client,
  serverId: string,
  triggererName?: string,
  tomoriNickname?: string, // Added tomoriNickname parameter
  personalMemoriesEnabled?: boolean, // Added personalMemoriesEnabled parameter
  snapshot?: import("../../types/misc/context").RequestSnapshot, // Added snapshot parameter
): Promise<string> {
  const normalizedText = normalizeDiscordChannelLinks(text);

  // Early return: if text doesn't contain mentions, Discord channel links, or placeholders, skip processing
  if (!needsConversion(text)) {
    return normalizedText;
  }

  // Clear the cache before processing new text
  mentionCache.clear();

  // 1. Determine Tomori's nickname for {bot} replacement.
  //    If not passed, load it (using snapshot if available, otherwise DB query).
  let currentTomoriNickname = tomoriNickname;
  if (!currentTomoriNickname) {
    // Use snapshot if available, otherwise load from DB
    const tomoriState = snapshot?.tomoriState ?? (await loadTomoriState(serverId));
    currentTomoriNickname = tomoriState?.tomori_nickname || process.env.DEFAULT_BOTNAME || "Tomori";
  }

  // 2. First handle Discord mentions
  const mentionPattern = /<[@#][!&]?(\d{17,19})>/g;
  const matches = Array.from(normalizedText.matchAll(mentionPattern));
  let result = normalizedText;

  // 3. Process Discord mentions
  if (matches.length > 0) {
    const mentionsData = matches.map((match) => ({
      match: match[0],
      id: match[1],
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    }));

    const replacements = await Promise.all(
      mentionsData.map(async ({ match, id }) => {
        // --- User Mentions ---
        if (match.startsWith("<@")) {
          const cachedName = mentionCache.get(id);
          if (cachedName) return `${cachedName}`;
          try {
            // Preserve the display name that Discord users actually mentioned.
            // `{bot}` still resolves to the active persona nickname later, but a
            // raw <@botId> mention may be a guild nickname like "Ren".
            if (client.user && id === client.user.id && currentTomoriNickname) {
              const guild = serverId === "DM" ? null : client.guilds.cache.get(serverId);
              const member = guild
                ? (guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null)))
                : null;
              const displayName = member?.displayName?.trim() || currentTomoriNickname;
              mentionCache.set(id, displayName);
              return `${displayName}`;
            }

            // Check if this is the triggerer and we have snapshot data
            const isTriggererId = snapshot?.triggererUserRow?.user_disc_id === id;
            const isUserBlacklisted = isTriggererId
              ? (snapshot?.isTriggererBlacklisted ?? false)
              : await isBlacklisted(serverId, id);
            const userData = isTriggererId ? snapshot?.triggererUserRow : await loadUserRow(id);
            const serverPersonalizationDisabled = personalMemoriesEnabled === false;

            // Use custom nickname only if user is not blacklisted AND personalization is enabled
            if (!isUserBlacklisted && !serverPersonalizationDisabled && userData?.user_nickname) {
              mentionCache.set(id, userData.user_nickname);
              return `${userData.user_nickname}`;
            }

            // Fallback chain for non-custom naming:
            // server nickname -> account username
            const guild = serverId === "DM" ? null : client.guilds.cache.get(serverId);
            const member = guild
              ? (guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null)))
              : null;
            const serverNickname = member?.nickname ?? null;

            if (serverNickname) {
              mentionCache.set(id, serverNickname);
              return `${serverNickname}`;
            }

            const username = member?.user.username ?? null;
            if (username) {
              mentionCache.set(id, username);
              return `${username}`;
            }

            const user = client.users.cache.get(id) || (await client.users.fetch(id).catch(() => null));
            if (user) {
              mentionCache.set(id, user.username);
              return `${user.username}`;
            }
          } catch (error) {
            log.error(`Error resolving nickname for user ${id} in convertMentions:`, error, {
              errorType: "MentionResolutionError",
              metadata: { userIdToResolve: id, guildDiscordId: serverId },
            });
          }
          log.warn(`Could not resolve user mention: ${match}`);
          return match; // Return original mention if resolution fails
        }

        // --- Channel Mentions ---
        if (match.startsWith("<#")) {
          try {
            const guild = client.guilds.cache.get(serverId);
            const channel = guild?.channels.cache.get(id) || (await client.channels.fetch(id).catch(() => null));
            if (channel?.isTextBased() && !channel.isDMBased()) {
              return await formatChannelReferenceLabel(channel as GuildTextBasedChannel);
            }
          } catch (error) {
            log.error(`Error resolving channel mention ${id} in convertMentions:`, error, {
              errorType: "MentionResolutionError",
              metadata: { channelIdToResolve: id, guildDiscordId: serverId },
            });
          }
          log.warn(`Could not resolve channel mention: ${match}`);
          return match;
        }

        // --- Role Mentions ---
        if (match.startsWith("<@&")) {
          try {
            const guild = client.guilds.cache.get(serverId);
            const role = guild?.roles.cache.get(id) || (await guild?.roles.fetch(id).catch(() => null));
            if (role) {
              return `@${role.name}`;
            }
          } catch (error) {
            log.error(`Error resolving role mention ${id} in convertMentions:`, error, {
              errorType: "MentionResolutionError",
              metadata: { roleIdToResolve: id, guildDiscordId: serverId },
            });
          }
          log.warn(`Could not resolve role mention: ${match}`);
          return match;
        }
        return match; // Should not happen if regex is correct
      }),
    );

    // 4. Apply replacements for Discord mentions (from end to start to avoid index issues)
    for (let i = mentionsData.length - 1; i >= 0; i--) {
      const { start, end } = mentionsData[i];
      // Ensure start and end are valid before attempting substring
      if (
        typeof start === "number" &&
        typeof end === "number" &&
        start < end &&
        start < result.length &&
        end <= result.length
      ) {
        result = result.substring(0, start) + replacements[i] + result.substring(end);
      } else {
        log.warn(`Invalid mention indices for replacement: start=${start}, end=${end}, match=${mentionsData[i].match}`);
      }
    }
  }

  // 5. Apply template variable replacements (like {bot} and {user})
  // Ensure triggererName is defined, default to "User" if not.
  const finalTriggererName = triggererName || "User";
  result = replaceTemplateVariables(result, {
    bot: currentTomoriNickname,
    user: finalTriggererName,
  });

  return result;
}

/**
 * Builds a human-readable description of media content in a message.
 * Handles images, videos, GIFs, and combined content.
 * @param msg - SimplifiedMessageForContext to describe
 * @returns Media description string (e.g., "1 GIF", "2 images and 1 video")
 * @example
 * buildMediaDescription({imageAttachments: [{mimeType: "image/gif"}], videoAttachments: []})
 * // Returns: "1 GIF"
 * @example
 * buildMediaDescription({imageAttachments: [{mimeType: "image/png"}, {mimeType: "image/jpeg"}], videoAttachments: [{...}]})
 * // Returns: "2 images and 1 video"
 */
function buildMediaDescription(msg: SimplifiedMessageForContext): string {
  const imageCount = msg.imageAttachments.length;
  const videoCount = msg.videoAttachments.length;
  const hasGif = msg.imageAttachments.some((att) => att.mimeType?.includes("gif"));

  const mediaParts: string[] = [];

  // Handle images (with special case for GIFs)
  if (imageCount > 0) {
    if (hasGif && imageCount === 1) {
      // Single GIF only
      mediaParts.push("1 GIF");
    } else if (hasGif) {
      // Multiple images including at least one GIF
      mediaParts.push(`${imageCount} image${imageCount > 1 ? "s" : ""} (including GIF)`);
    } else {
      // Regular images only
      mediaParts.push(`${imageCount} image${imageCount > 1 ? "s" : ""}`);
    }
  }

  // Handle videos
  if (videoCount > 0) {
    mediaParts.push(`${videoCount} video${videoCount > 1 ? "s" : ""}`);
  }

  return mediaParts.join(" and ");
}

/**
 * Builds a natural-language attribution string for a media-only message (no text content).
 * Used when a user uploads media without any accompanying text, so the model still knows
 * who sent it. Prose form is intentional — the "authorName:" prefix format is reserved
 * for actual utterances only.
 * @param msg - SimplifiedMessageForContext with at least one attachment
 * @param authorName - Resolved display name of the sender
 * @returns Attribution string (e.g., "Misuzu sent this image", "Misuzu sent these 2 images and a video")
 */
function buildMediaAttributionText(msg: SimplifiedMessageForContext, authorName: string): string {
  const imageCount = msg.imageAttachments.length;
  const videoCount = msg.videoAttachments.length;
  const hasGif = msg.imageAttachments.some((att) => att.mimeType?.includes("gif"));
  const isMixed = imageCount > 0 && videoCount > 0;

  const mediaParts: string[] = [];

  // Build image/GIF description
  if (imageCount > 0) {
    if (hasGif && imageCount === 1) {
      mediaParts.push("this GIF");
    } else if (hasGif) {
      mediaParts.push(`these ${imageCount} images (including a GIF)`);
    } else if (imageCount === 1) {
      mediaParts.push("this image");
    } else {
      mediaParts.push(`these ${imageCount} images`);
    }
  }

  // Use "a/N video(s)" when mixed with images so "sent this image and a video" reads naturally
  if (videoCount > 0) {
    if (isMixed) {
      mediaParts.push(videoCount === 1 ? "a video" : `${videoCount} videos`);
    } else {
      mediaParts.push(videoCount === 1 ? "this video" : `these ${videoCount} videos`);
    }
  }

  const mediaDescription = mediaParts.join(" and ") || "this media";
  return `[System: ${authorName} sent ${mediaDescription}]`;
}

function isStickerImageAttachment(attachment: SimplifiedMessageForContext["imageAttachments"][number]): boolean {
  return attachment.proxyUrl.includes("/stickers/") || attachment.url.includes("/stickers/");
}

function isCountedRenderedImageAttachment(
  attachment: SimplifiedMessageForContext["imageAttachments"][number],
): boolean {
  return !attachment.isEmoji && !isStickerImageAttachment(attachment);
}

function getRenderedImageMessageIdsWithinWindow(
  simplifiedMessageHistory: SimplifiedMessageForContext[],
  mediaWindowCutoff: number,
): Set<string> {
  const renderedMessageIds = new Set<string>();
  if (MEDIA_IMAGE_MESSAGE_LIMIT <= 0) {
    return renderedMessageIds;
  }

  for (let i = simplifiedMessageHistory.length - 1; i >= 0; i -= 1) {
    if (i < mediaWindowCutoff) {
      break;
    }

    const message = simplifiedMessageHistory[i];
    const hasCountedImages = message.imageAttachments.some(isCountedRenderedImageAttachment);
    if (!hasCountedImages) {
      continue;
    }

    renderedMessageIds.add(message.id);
    if (renderedMessageIds.size >= MEDIA_IMAGE_MESSAGE_LIMIT) {
      break;
    }
  }

  return renderedMessageIds;
}

/**
 * Pre-computes the last index at which each image proxyUrl appears across
 * rendered messages within the media window. When the same image appears in
 * multiple messages (e.g. the original message AND a reply that merges the
 * referenced attachments), only the latest occurrence should be rendered as
 * base64 to avoid sending duplicate payloads.
 *
 * @param simplifiedMessageHistory - Full ordered message history
 * @param renderedImageMessageIds - Set of message IDs eligible for image rendering
 * @param mediaWindowCutoff - Index threshold for the media window
 * @returns Map of proxyUrl → last history index where that image should be rendered
 */
function getLastImageOccurrenceIndices(
  simplifiedMessageHistory: SimplifiedMessageForContext[],
  renderedImageMessageIds: Set<string>,
  mediaWindowCutoff: number,
): Map<string, number> {
  // 1. Collect all proxyUrls from rendered messages and track every index they appear at
  const urlToIndices = new Map<string, number[]>();

  for (let i = simplifiedMessageHistory.length - 1; i >= 0; i -= 1) {
    if (i < mediaWindowCutoff) {
      break;
    }

    const message = simplifiedMessageHistory[i];
    if (!renderedImageMessageIds.has(message.id)) {
      continue;
    }

    for (const attachment of message.imageAttachments) {
      if (!isCountedRenderedImageAttachment(attachment)) {
        continue;
      }

      const indices = urlToIndices.get(attachment.proxyUrl);
      if (indices) {
        indices.push(i);
      } else {
        urlToIndices.set(attachment.proxyUrl, [i]);
      }
    }
  }

  // 2. For images appearing in multiple messages, record the last (highest) index
  const lastOccurrence = new Map<string, number>();
  for (const [url, indices] of urlToIndices) {
    if (indices.length > 1) {
      lastOccurrence.set(url, Math.max(...indices));
    }
  }

  return lastOccurrence;
}

function getLatestUserQuery(messages: SimplifiedMessageForContext[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.authorType !== "user") continue;
    if (!msg.content) continue;
    if (msg.authorId === "0") continue; // Skip synthetic continuation prompts
    const trimmed = msg.content.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[System:")) continue;
    return trimmed.slice(0, DOCUMENT_QUERY_MAX_LENGTH);
  }

  return null;
}

/**
 * Build short-term memory context for cross-channel and same-channel awareness
 *
 * Phase 2: Loads other-channel crude conversations or summaries (fallback to crude if no summary)
 * Phase 3: Loads same-channel summary with HINT (tool-calling models only)
 *
 * @param triggeringUserId - Discord user ID of the message author
 * @param currentChannelId - Current channel ID
 * @param currentServerId - Current server ID (or "DM")
 * @param tomoriState - Tomori configuration state
 * @param locale - User's preferred locale
 * @param triggererName - Display name of the triggering user
 * @param botName - Bot's display name
 * @param personalMemoriesEnabled - Whether personalization is enabled
 * @param client - Discord client for mention conversion
 * @returns Object with other-channel items and optional same-channel prompt
 */
async function buildShortTermMemoryContext(
  triggeringUserId: string,
  currentChannelId: string,
  currentServerId: string,
  tomoriState: import("@/types/db/schema").TomoriState | null,
  _locale: string,
  triggererName: string,
  botName: string,
  personalMemoriesEnabled: boolean,
  client: Client,
  isUserImpersonation: boolean,
  explicitLongTermMemoryIntent = false,
  toolPromptMacroResolver?: ToolPromptMacroResolver,
  currentParentChannelId?: string | null,
): Promise<{
  memoryItems: StructuredContextItem[];
  createPromptText?: string;
}> {
  const memoryItems: StructuredContextItem[] = [];
  let createPromptText: string | undefined;
  const expandPromptToolText = (macroText: string, fallbackText: string) =>
    toolPromptMacroResolver ? toolPromptMacroResolver.expand(macroText) : Promise.resolve(fallbackText);

  try {
    // 1. Check if user has cross-server opt-in enabled
    const userRow = await getCachedUserRow(triggeringUserId);
    const crossServerOptIn = userRow?.shortterm_cache_crossserver_opt_in ?? false;

    const personaLineageId = tomoriState?.persona_lineage_id;
    let otherChannelMemories =
      currentServerId === "DM"
        ? getShortTermMemoriesForUser(triggeringUserId, currentChannelId, personaLineageId).filter(
            (memory) => crossServerOptIn || memory.serverId === currentServerId,
          )
        : getShortTermMemoriesForServer(currentServerId, currentChannelId, personaLineageId);

    if (currentServerId !== "DM" && crossServerOptIn) {
      const crossServerUserMemories = getShortTermMemoriesForUser(
        triggeringUserId,
        currentChannelId,
        personaLineageId,
      ).filter((memory) => memory.serverId !== currentServerId);

      otherChannelMemories = [...otherChannelMemories, ...crossServerUserMemories];
    }

    // Filter out private-channel STMs when the current channel is not private.
    // Private channels isolate their STMs — they cannot leak into non-private channels.
    // The reverse is allowed: non-private STMs can still appear in private channels.
    // Also treat a thread as private when its parent channel is private.
    // This guard is skipped entirely when stm_privacy_bypass is enabled by the server admin.
    const privateChannelIds = tomoriState?.config.private_channel_ids ?? [];
    const stmPrivacyBypass = tomoriState?.config.stm_privacy_bypass ?? false;
    const isCurrentChannelPrivate =
      privateChannelIds.includes(currentChannelId) ||
      (currentParentChannelId != null && privateChannelIds.includes(currentParentChannelId));
    if (!stmPrivacyBypass && !isCurrentChannelPrivate && privateChannelIds.length > 0) {
      otherChannelMemories = otherChannelMemories.filter(
        (memory) =>
          !privateChannelIds.includes(memory.channelId) &&
          !(memory.parentChannelId != null && privateChannelIds.includes(memory.parentChannelId)),
      );
    }

    otherChannelMemories.sort((a, b) => b.lastUpdated - a.lastUpdated);

    // 2. Limit to max number of other-channel memories (most recent first)
    const limitedMemories = otherChannelMemories.slice(0, MAX_OTHER_CHANNEL_MEMORIES);

    // 3. Build OTHER-CHANNEL MEMORIES context (Phase 2)
    // Show summaries when available, fall back to crude conversations
    if (limitedMemories.length > 0) {
      let otherChannelText = "";

      for (const memory of limitedMemories) {
        const relativeTime = getRelativeTimestamp(memory.lastUpdated);
        const isSameServerSharedMemory = currentServerId !== "DM" && memory.serverId === currentServerId;

        // Determine channel reference (privacy-safe)
        let channelReference: string;
        if (memory.serverId === currentServerId) {
          channelReference = formatDiscordChannelReference(
            memory.channelId,
            memory.channelName ? `#${memory.channelName}` : "another channel in this server",
          );
        } else {
          channelReference = "a channel in another server";
        }

        // Show summary if available, otherwise show crude conversation
        if (memory.summary) {
          const memoryPrefix = isSameServerSharedMemory
            ? isUserImpersonation
              ? `[System: Recent conversation in ${channelReference} (${relativeTime}):\n${memory.summary}]\n\n`
              : `[System: ${botName} remembers a recent conversation in ${channelReference} (${relativeTime}):\n${memory.summary}]\n\n`
            : isUserImpersonation
              ? `[System: Recent conversation with ${triggererName} in ${channelReference} (${relativeTime}):\n${memory.summary}]\n\n`
              : `[System: ${botName} remembers a recent conversation with ${triggererName} in ${channelReference} (${relativeTime}):\n${memory.summary}]\n\n`;
          otherChannelText += memoryPrefix;
        } else {
          const memoryPrefix = isSameServerSharedMemory
            ? isUserImpersonation
              ? `[System: Recent conversation in ${channelReference} (${relativeTime}):\n`
              : `[System: ${botName} remembers a recent conversation in ${channelReference} (${relativeTime}):\n`
            : isUserImpersonation
              ? `[System: Recent conversation with ${triggererName} in ${channelReference} (${relativeTime}):\n`
              : `[System: ${botName} remembers a recent conversation with ${triggererName} in ${channelReference} (${relativeTime}):\n`;
          otherChannelText += memoryPrefix;

          for (const msg of memory.messages) {
            const speaker =
              msg.speakerName ||
              (msg.role === "user" ? (isSameServerSharedMemory ? "Someone" : triggererName) : botName);
            otherChannelText += `${speaker}: "${msg.content}"\n`;
          }

          otherChannelText += "]\n\n";
        }
      }

      if (otherChannelText) {
        memoryItems.push({
          role: "user",
          parts: [
            {
              type: "text",
              text: await convertMentions(
                otherChannelText.trim(),
                client,
                currentServerId,
                triggererName,
                botName,
                personalMemoriesEnabled,
              ),
            },
          ],
          metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
        });
      }
    }

    // 4. Build SAME-CHANNEL context (Phase 3)
    // Only shown for tool-calling models
    // - Summary (if exists): Goes with other memories (middle of context)
    // - Create prompt (if no summary): Goes at end as instruction
    // NOTE: STM tool instructions are suppressed for NovelAI — GLM 4.6's limited token
    // budget (~2800 tokens) makes the update_short_term_memory tool impractical. The
    // summary data itself is still included as context when available.
    if (tomoriState?.llm?.has_tools) {
      const isStmToolAvailable = tomoriState.llm.llm_provider !== "novelai" && !explicitLongTermMemoryIntent;

      const sameChannelMemory =
        currentServerId === "DM"
          ? getShortTermMemoryForUserChannel(triggeringUserId, currentChannelId, tomoriState?.tomori_id)
          : getShortTermMemoryForServerChannel(currentServerId, currentChannelId, tomoriState?.tomori_id);

      if (sameChannelMemory?.summary) {
        // EXISTING SUMMARY - Add to memoryItems (middle of context, with other memories)
        const summaryText = isUserImpersonation
          ? `[System: Short term memory for this ongoing conversation:\n${sameChannelMemory.summary}]`
          : `[System: ${botName}'s short term memory for this ongoing conversation:\n${sameChannelMemory.summary}]`;

        memoryItems.push({
          role: "user",
          parts: [
            {
              type: "text",
              text: await convertMentions(
                summaryText,
                client,
                currentServerId,
                triggererName,
                botName,
                personalMemoriesEnabled,
              ),
            },
          ],
          metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
        });

        // Add the HINT immediately after the summary (not at the end)
        // Only when the STM tool is available for this provider
        if (isStmToolAvailable) {
          const hintText = await expandPromptToolText(
            "[System: HINT: Use the {short_term_memory_tool} tool to update this information AFTER you respond if the conversation has greatly changed its topic. Do NOT use {short_term_memory_tool} when a user explicitly asks you to remember/save/store something for future conversations; use {memory_tool} or {memory_update_tool} instead.]",
            "[System: HINT: Use the update_short_term_memory tool to update this information AFTER you respond if the conversation has greatly changed its topic. Do NOT use update_short_term_memory when a user explicitly asks you to remember/save/store something for future conversations; use create_long_term_memory or update_long_term_memory instead.]",
          );

          memoryItems.push({
            role: "user",
            parts: [
              {
                type: "text",
                text: await convertMentions(
                  hintText,
                  client,
                  currentServerId,
                  triggererName,
                  botName,
                  personalMemoriesEnabled,
                ),
              },
            ],
            metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
          });
        }
      } else if (
        isStmToolAvailable &&
        sameChannelMemory &&
        sameChannelMemory.messages.length >= MIN_MESSAGES_FOR_SUMMARY
      ) {
        // NO SUMMARY but enough messages - Create prompt at end
        // Only when the STM tool is available for this provider
        const createText = await expandPromptToolText(
          "You currently do not have short term memory saved for this conversation. Use the {short_term_memory_tool} tool to create a short term memory about the current story or conversation's topic AFTER you respond in order to help you cross-reference this in different channels. Do NOT use {short_term_memory_tool} when a user explicitly asks you to remember/save/store something for future conversations; use {memory_tool} or {memory_update_tool} instead. Do NOT mention out loud that you are going to create a short term memory, always use the tool silently.",
          "You currently do not have short term memory saved for this conversation. Use the update_short_term_memory tool to create a short term memory about the current story or conversation's topic AFTER you respond in order to help you cross-reference this in different channels. Do NOT use update_short_term_memory when a user explicitly asks you to remember/save/store something for future conversations; use create_long_term_memory or update_long_term_memory instead. Do NOT mention out loud that you are going to create a short term memory, always use the tool silently.",
        );

        createPromptText = await convertMentions(
          createText,
          client,
          currentServerId,
          triggererName,
          botName,
          personalMemoriesEnabled,
        );
      }
      // If less than MIN_MESSAGES_FOR_SUMMARY, don't show any prompt (conversation too short)
    }

    return { memoryItems, createPromptText };
  } catch (error) {
    await log.error(
      `[buildShortTermMemoryContext] Failed to build short-term memory context - triggeringUserId=${triggeringUserId}, currentChannelId=${currentChannelId}`,
      error,
      {
        errorType: "SHORT_TERM_MEMORY_CONTEXT_ERROR",
        metadata: { userDiscId: triggeringUserId, currentChannelId },
      },
    );
    return { memoryItems: [], createPromptText: undefined };
  }
}

// Month abbreviations for timestamp formatting (avoids locale-sensitive toLocaleString)
const UTC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Format a millisecond duration as a human-readable relative time string.
 * @param diffMs - Time difference in milliseconds (positive = in the past)
 * @returns e.g. "5s ago", "3m ago", "2h ago", "4d ago", "2w ago"
 */
export function formatRelativeTime(diffMs: number): string {
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

/**
 * Format a Discord message timestamp as a short inline string suitable for
 * embedding within an existing [System: ...] block (no outer wrapper).
 * @param createdAt - Unix timestamp in milliseconds (message.createdTimestamp)
 * @returns e.g. "Feb 28, 2026 14:32 UTC (3h ago)"
 */
export function formatTimestampInline(createdAt: number): string {
  const date = new Date(createdAt);
  const diffMs = Math.max(0, Date.now() - createdAt);
  const month = UTC_MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${year} ${hours}:${minutes} UTC (${formatRelativeTime(diffMs)})`;
}

/**
 * Format a Discord message timestamp as a combined absolute + relative annotation.
 * Relative time is computed at call time (i.e. when context is rebuilt), so it
 * reflects how long ago the message was sent at the moment the LLM reads it.
 * @param createdAt - Unix timestamp in milliseconds (message.createdTimestamp)
 * @returns System annotation, e.g. "[System: Sent Feb 28, 2026 14:32 UTC (3h ago)]"
 */
export function formatMessageTimestamp(createdAt: number): string {
  return `[System: Sent ${formatTimestampInline(createdAt)}]`;
}

function pushDialogueHistoryContextItem(
  contextItems: StructuredContextItem[],
  role: "user" | "model",
  parts: ContextPart[],
  messageId: string,
  metadataTag?: ContextItemTag,
): void {
  if (parts.length === 0) {
    return;
  }

  contextItems.push({
    role,
    parts,
    metadataTag: metadataTag ?? ContextItemTag.DIALOGUE_HISTORY,
    messageId,
  });
}

async function buildConditioningContextItem(params: {
  client: Client;
  guildId: string;
  serverId: number;
  personaLineageId: number;
  botName: string;
  personalMemoriesEnabled: boolean;
  rewardEnabled: boolean;
  punishEnabled: boolean;
}): Promise<StructuredContextItem | null> {
  const sections: string[] = [];

  const appendSection = async (conditioningType: ConditioningType, enabled: boolean): Promise<void> => {
    if (!enabled) {
      return;
    }

    const visibleGroups = (
      await loadConditioningGroupsForPersona(params.serverId, params.personaLineageId, conditioningType)
    )
      .filter((group) => group.reasonText.trim().length > 0)
      .slice(0, CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE);

    if (visibleGroups.length === 0) {
      return;
    }

    const heading =
      conditioningType === "reward"
        ? `## Rewarded Behaviors\nHere are past things ${params.botName} did that got rewarded for. Strive to do them again:`
        : `## Punished Behaviors\nHere are past things ${params.botName} did that got punished for. Avoid doing them again:`;

    const lines = visibleGroups.map((group) => {
      const users = group.userDiscIds.map((userDiscId) => `<@${userDiscId}>`).join(", ");
      const action = getConditioningContextPastParticiple(conditioningType, group.actionKey);
      const countSuffix = group.totalCount > 1 ? ` (${group.totalCount} times)` : "";
      const actionTextSuffix = group.actionText ? ` with \`${group.actionText}\`` : "";
      return `- [${params.botName} was ${action} by ${users}. Reason: \`${group.reasonText}\`${actionTextSuffix}]${countSuffix}`;
    });

    sections.push(`${heading}\n${lines.join("\n")}`);
  };

  await appendSection("reward", params.rewardEnabled);
  await appendSection("punish", params.punishEnabled);

  if (sections.length === 0) {
    return null;
  }

  return {
    role: "system",
    parts: [
      {
        type: "text",
        text: await convertMentions(
          sections.join("\n\n"),
          params.client,
          params.guildId,
          "User",
          params.botName,
          params.personalMemoriesEnabled,
        ),
      },
    ],
    metadataTag: ContextItemTag.KNOWLEDGE_SERVER_CONDITIONING,
  };
}

/** Shared parameter type for both the routing wrapper and native context builder. */
export interface BuildContextParams {
  guildId: string;
  serverName: string;
  serverDescription: string | null;
  simplifiedMessageHistory: SimplifiedMessageForContext[];
  userList: string[];
  channelDesc: string | null;
  channelName: string;
  channelId: string;
  /** Parent channel ID when `channelId` is a thread — used for private/RP channel inheritance. */
  parentChannelId?: string | null;
  client: Client;
  triggererName: string;
  triggererUserId?: number;
  emojiStrings?: string[];
  tomoriNickname: string;
  tomoriAttributes: string[];
  tomoriConfig: TomoriConfigRow;
  personaPrompt?: string | null;
  personaLineageId?: number;
  isDMChannel?: boolean;
  mediaContextWindow?: number;
  snapshot?: import("../../types/misc/context").RequestSnapshot;
  preloadedEmojis?: ServerEmojiRow[] | null;
  preloadedStickers?: ServerStickerRow[] | null;
  isUserImpersonation?: boolean;
  impersonatedUserId?: string;
  impersonatedUserNickname?: string;
  impersonatedUserPrompt?: string | null;
  /** Matrix bridge users: Matrix user ID → stripped display name. */
  matrixUsers?: Map<string, string>;
  /** Synthetic participants surfaced as user-like entries. */
  syntheticUsers?: Map<string, { displayName: string; type: "persona" | "webhook" }>;
  includeTimestamps?: boolean;
  seesImages?: boolean;
  seesVideos?: boolean;
  hasVisionTool?: boolean;
  explicitLongTermMemoryIntent?: boolean;
  toolsDisabledForTurn?: boolean;
  /**
   * When `true`, skips the `DEFAULT_SYSTEM_PROMPT` fallback in the humanizer block.
   * Set by the routing wrapper when a SillyTavern preset is active and no custom
   * `/sysprompt` has been configured — the preset fully controls the system prompt.
   */
  suppressDefaultSystemPrompt?: boolean;
  /** Opaque message ID map — caller creates, context builder populates. */
  messageIdMap?: MessageIdMap;
}

/** Return type for both buildContext variants. */
type BuildContextResult = {
  contextItems: StructuredContextItem[];
  tailDirectives: string[];
  lowerPriorityTailDirectives: string[];
  uncensorDirective?: string;
  /** Populated map of opaque keys → real Discord message IDs. */
  messageIdMap: MessageIdMap;
};

/**
 * Build context with optional SillyTavern preset rearrangement.
 *
 * Routing logic:
 *   1. If user impersonation is active → always use native assembly (presets are character-centric)
 *   2. If an active ST preset exists for this server → build native, then rearrange via preset
 *   3. Otherwise → use native fixed 9-block assembly
 *
 * All callers use this function; the preset check is transparent.
 */
export async function buildContext(params: BuildContextParams): Promise<BuildContextResult> {
  // Create or reuse the opaque message ID map for this request cycle
  const messageIdMap = params.messageIdMap ?? new MessageIdMap();
  const paramsWithMap = { ...params, messageIdMap };

  // Skip preset routing for user impersonation
  if (!paramsWithMap.isUserImpersonation) {
    const rawTomoriStateForPreset = params.snapshot?.tomoriState ?? (await loadTomoriState(params.guildId));
    const tomoriStateForPreset =
      params.toolsDisabledForTurn && rawTomoriStateForPreset
        ? { ...rawTomoriStateForPreset, llm: { ...rawTomoriStateForPreset.llm, has_tools: false } }
        : rawTomoriStateForPreset;
    const serverId = tomoriStateForPreset?.server_id;
    if (serverId) {
      const presetData = await getCachedActivePreset(serverId);
      if (presetData) {
        // 1. Build native context (produces tagged items in fixed order).
        // Suppress the DEFAULT_SYSTEM_PROMPT fallback when the preset is active
        // and the user has NOT set a custom /sysprompt — the preset owns the system prompt.
        const suppressDefaultSystemPrompt = !params.tomoriConfig.system_prompt?.trim();
        const nativeOutput = await buildContextNative({
          ...paramsWithMap,
          suppressDefaultSystemPrompt,
        });

        // 2. Extract macro context from params
        const lastUserMsg =
          params.simplifiedMessageHistory.filter((m) => m.authorType === "user").at(-1)?.content ?? "";

        const presetToolPromptMacroResolver = createToolPromptMacroResolver({
          provider: tomoriStateForPreset?.llm?.llm_provider,
          stateForContext:
            tomoriStateForPreset?.server_id && tomoriStateForPreset.llm
              ? {
                  server_id: tomoriStateForPreset.server_id.toString(),
                  activePersonaHasElevenlabsVoice: false,
                  llm: tomoriStateForPreset.llm,
                  diffusion_model_id: tomoriStateForPreset.config.diffusion_model_id,
                  nai_diffusion_model_id: tomoriStateForPreset.config.nai_diffusion_model_id,
                  video_model_id: tomoriStateForPreset.config.video_model_id,
                  config: {
                    sticker_usage_enabled: params.tomoriConfig.sticker_usage_enabled,
                    web_search_enabled: params.tomoriConfig.web_search_enabled,
                    self_teaching_enabled: params.tomoriConfig.self_teaching_enabled,
                    manage_message_enabled: params.tomoriConfig.manage_message_enabled,
                    imagegen_enabled: params.tomoriConfig.imagegen_enabled,
                    videogen_enabled: params.tomoriConfig.videogen_enabled,
                    nai_exclusive_imggen: params.tomoriConfig.nai_exclusive_imggen,
                    voice_message_enabled: params.tomoriConfig.voice_message_enabled,
                    thread_creation_enabled: params.tomoriConfig.thread_creation_enabled,
                  },
                }
              : undefined,
        });

        // 3. Rearrange native output according to preset node order
        const presetResult = await reassembleWithPreset(
          nativeOutput,
          presetData,
          {
            triggererName: params.triggererName,
            tomoriNickname: params.tomoriNickname,
            tomoriAttributes: params.tomoriAttributes,
            personaPrompt: params.personaPrompt,
            sampleDialoguesIn: tomoriStateForPreset?.sample_dialogues_in ?? [],
            sampleDialoguesOut: tomoriStateForPreset?.sample_dialogues_out ?? [],
            lastUserMessage: lastUserMsg,
          },
          {
            client: params.client,
            guildId: params.guildId,
            triggererName: params.triggererName,
            botName: params.tomoriNickname,
            personalMemoriesEnabled: params.tomoriConfig.personal_memories_enabled ?? true,
            toolPromptMacroResolver: presetToolPromptMacroResolver,
          },
        );
        return { ...resolveRandomChoiceMacrosInBuildOutput(presetResult), messageIdMap };
      }
    }
  }

  // No active preset (or user impersonation) — use native assembly
  const nativeResult = await buildContextNative(paramsWithMap);
  return { ...resolveRandomChoiceMacrosInBuildOutput(nativeResult), messageIdMap };
}

/**
 * Native context assembly — fixed 9-block sequence.
 * This is the original buildContext() implementation, now called internally.
 * When a ST preset is active, the routing wrapper in buildContext() calls this
 * to get tagged items, then rearranges them via reassembleWithPreset().
 */
async function buildContextNative({
  guildId,
  serverName,
  serverDescription,
  simplifiedMessageHistory,
  userList,
  channelDesc: _channelDesc,
  channelName,
  channelId,
  parentChannelId,
  client,
  triggererName,
  emojiStrings: _emojiStrings,
  tomoriNickname,
  tomoriAttributes,
  tomoriConfig,
  personaPrompt,
  personaLineageId,
  triggererUserId,
  isDMChannel = false,
  mediaContextWindow,
  snapshot,
  preloadedEmojis,
  preloadedStickers,
  isUserImpersonation = false,
  impersonatedUserId,
  impersonatedUserNickname,
  impersonatedUserPrompt,
  matrixUsers,
  syntheticUsers,
  includeTimestamps = false,
  seesImages: seesImagesOverride,
  seesVideos: seesVideosOverride,
  hasVisionTool = false,
  explicitLongTermMemoryIntent: explicitLongTermMemoryIntentOverride,
  toolsDisabledForTurn = false,
  suppressDefaultSystemPrompt = false,
  messageIdMap,
}: BuildContextParams): Promise<{
  contextItems: StructuredContextItem[];
  tailDirectives: string[];
  lowerPriorityTailDirectives: string[];
  uncensorDirective?: string;
}> {
  const contextItems: StructuredContextItem[] = [];
  const tailDirectives: string[] = [];
  const lowerPriorityTailDirectives: string[] = [];
  let sameChannelMemoryDirective: string | undefined;
  let uncensorDirective: string | undefined;
  const botName = tomoriNickname;
  const impersonatedMember =
    isUserImpersonation && impersonatedUserId
      ? client.guilds.cache.get(guildId)?.members.cache.get(impersonatedUserId)
      : null;
  const impersonatedIdentityName =
    impersonatedMember?.displayName || impersonatedMember?.user.displayName || impersonatedUserNickname || null;
  const uncensorInputOptions = {
    unicodeSpacesEnabled: tomoriConfig.uncensor_unicode_space_enabled,
    sanitizeEnabled: tomoriConfig.uncensor_sanitize_enabled,
  };
  const rawTomoriState = snapshot?.tomoriState ?? (await loadTomoriState(guildId));
  const tomoriState =
    toolsDisabledForTurn && rawTomoriState
      ? { ...rawTomoriState, llm: { ...rawTomoriState.llm, has_tools: false } }
      : rawTomoriState;
  const toolPromptMacroResolver = createToolPromptMacroResolver({
    provider: tomoriState?.llm?.llm_provider,
    stateForContext:
      tomoriState?.server_id && tomoriState.llm
        ? {
            server_id: tomoriState.server_id.toString(),
            activePersonaHasElevenlabsVoice: false,
            llm: tomoriState.llm,
            diffusion_model_id: tomoriState.config.diffusion_model_id,
            nai_diffusion_model_id: tomoriState.config.nai_diffusion_model_id,
            video_model_id: tomoriState.config.video_model_id,
            config: {
              sticker_usage_enabled: tomoriConfig.sticker_usage_enabled,
              web_search_enabled: tomoriConfig.web_search_enabled,
              self_teaching_enabled: tomoriConfig.self_teaching_enabled,
              manage_message_enabled: tomoriConfig.manage_message_enabled,
              imagegen_enabled: tomoriConfig.imagegen_enabled,
              videogen_enabled: tomoriConfig.videogen_enabled,
              nai_exclusive_imggen: tomoriConfig.nai_exclusive_imggen,
              voice_message_enabled: tomoriConfig.voice_message_enabled,
              thread_creation_enabled: tomoriConfig.thread_creation_enabled,
            },
          }
        : undefined,
  });
  const explicitLongTermMemoryIntent =
    explicitLongTermMemoryIntentOverride ??
    hasExplicitLongTermMemoryIntent(
      simplifiedMessageHistory.filter((message) => message.authorType === "user").at(-1)?.content,
    );

  // 1. System prompt + Humanizer rules (comes FIRST for prompt optimization)
  // Skip system prompt for user impersonation (bot-specific personality should not leak)
  if (!isUserImpersonation) {
    // When a SillyTavern preset is active and no custom /sysprompt is set,
    // skip the DEFAULT_SYSTEM_PROMPT fallback — the preset fully owns the system prompt.
    const systemPrompt =
      tomoriConfig.system_prompt?.trim() || (suppressDefaultSystemPrompt ? null : DEFAULT_SYSTEM_PROMPT);

    if (systemPrompt) {
      let humanizerText = await toolPromptMacroResolver.expand(systemPrompt);

      // CRITICAL: Use stable "User" placeholder for system instruction to prevent cache invalidation across different users
      humanizerText = await convertMentions(
        humanizerText,
        client,
        guildId,
        "User", // Stable placeholder instead of triggererName
        botName,
        tomoriConfig.personal_memories_enabled,
        snapshot,
      );

      contextItems.push({
        role: "system",
        parts: [{ type: "text", text: humanizerText }],
        metadataTag: ContextItemTag.SYSTEM_HUMANIZER_RULES,
      });
    }
  }

  // 1.5. Persona-specific prompt (appended in addition to system prompt when set)
  // Skip persona prompt for user impersonation (bot-specific personality should not leak)
  if (!isUserImpersonation && personaPrompt?.trim()) {
    const promptText = await convertMentions(
      await toolPromptMacroResolver.expand(personaPrompt.trim()),
      client,
      guildId,
      "User",
      botName,
      tomoriConfig.personal_memories_enabled,
      snapshot,
    );
    contextItems.push({
      role: "system",
      parts: [{ type: "text", text: promptText }],
      metadataTag: ContextItemTag.SYSTEM_HUMANIZER_RULES,
    });
  }

  // 1.6. User-owned impersonation prompt
  if (isUserImpersonation && impersonatedUserPrompt?.trim()) {
    const promptText = await convertMentions(
      await toolPromptMacroResolver.expand(impersonatedUserPrompt.trim()),
      client,
      guildId,
      impersonatedIdentityName || "User",
      botName,
      tomoriConfig.personal_memories_enabled,
      snapshot,
    );
    contextItems.push({
      role: "system",
      parts: [{ type: "text", text: promptText }],
      metadataTag: ContextItemTag.SYSTEM_HUMANIZER_RULES,
    });
  }

  // 2. Personality attributes (SECOND - separated from humanizer for better organization)
  // Skip personality attributes for user impersonation (bot-specific traits should not leak)
  if (!isUserImpersonation) {
    let personalityText = await toolPromptMacroResolver.expand(tomoriAttributes.join("\n"));

    // CRITICAL: Use stable "User" placeholder for system instruction to prevent cache invalidation across different users
    personalityText = await convertMentions(
      personalityText,
      client,
      guildId,
      "User", // Stable placeholder instead of triggererName
      botName,
      tomoriConfig.personal_memories_enabled,
      snapshot,
    );

    contextItems.push({
      role: "system",
      parts: [{ type: "text", text: personalityText }],
      metadataTag: ContextItemTag.SYSTEM_PERSONALITY,
    });
  }

  // --- Preamble/Knowledge Base Segments ---
  // These will be consolidated into the system prompt in Phase 2.
  // For now, they are tagged individually.

  // 3. Server/DM Context
  let serverInfoContent = "";
  if (isDMChannel) {
    // For DMs, indicate the bot is in a direct message (user name will be in dialogue section)
    if (isUserImpersonation && impersonatedIdentityName) {
      serverInfoContent = `# Knowledge Base\nYou are ${impersonatedIdentityName}, currently in a Direct Message with User.\n`;
    } else {
      serverInfoContent = `# Knowledge Base\n${botName} is currently in a Direct Message with User.\n`;
    }
  } else {
    // For servers, show server name and description
    if (isUserImpersonation && impersonatedIdentityName) {
      serverInfoContent = `# Knowledge Base\nYou are ${impersonatedIdentityName}, currently in the Discord server named "${serverName}".\n`;
    } else {
      serverInfoContent = `# Knowledge Base\n${botName} is currently in the Discord server named "${serverName}".\n`;
    }
    if (serverDescription) {
      serverInfoContent += `## ${serverName}'s Description\n${serverDescription}`;
    }
  }
  contextItems.push({
    role: "system",
    parts: [
      {
        type: "text",
        text: await convertMentions(
          serverInfoContent,
          client,
          guildId,
          "User", // Stable placeholder instead of triggererName
          botName,
          tomoriConfig.personal_memories_enabled,
          snapshot,
        ),
      },
    ],
    metadataTag: ContextItemTag.KNOWLEDGE_SERVER_INFO, // Tagging
  });

  // Build conversation corpus once for tag-based memory filtering (used in blocks 4 and 9)
  const conversationCorpus = tomoriConfig.memory_tagging_enabled
    ? simplifiedMessageHistory
        .map((m) => m.content ?? "")
        .join(" ")
        .toLowerCase()
    : null;

  // Returns true if the memory's channel tags (tags starting with '#') allow it in the current channel.
  // Memories with no channel tags are always allowed. Channel tags must exactly match the channel name.
  const isChannelAllowed = (tags: string[]): boolean => {
    if (!tomoriConfig.channel_memory_enabled) return true;
    const normalizedTags = tags.map((t) => t.replace(/^["']+|["']+$/g, ""));
    const channelTags = normalizedTags.filter((t) => t.startsWith("#"));
    if (channelTags.length === 0) return true;
    return channelTags.some((t) => t.slice(1).toLowerCase() === channelName.toLowerCase());
  };

  // 4. Server Memories / Conversation Memories
  // Skip server memories for user impersonation (bot-specific knowledge should not leak)
  if (
    !isUserImpersonation &&
    tomoriState?.server_memories &&
    Array.isArray(tomoriState.server_memories) &&
    tomoriState.server_memories.length > 0
  ) {
    // For DMs, label as "Conversation Memories". For servers, label as "Server Memories"
    const memoryLabel = isDMChannel
      ? `\n## ${botName}'s Memories about this conversation with User\n`
      : `\n## ${botName}'s Memories about ${serverName}\n`;

    let serverMemoryLines: string[] = [];
    try {
      const serverMemoryRows = await sql<Array<{ server_memory_id: number; content: string; tags: string[] | null }>>`
				SELECT server_memory_id, content, tags
				FROM server_memories
				WHERE server_id = ${tomoriState.server_id}
				  AND persona_lineage_id = ${tomoriState.persona_lineage_id}
				ORDER BY created_at DESC
			`;

      const filteredServerRows = serverMemoryRows.filter((row) => {
        const tags = row.tags ?? [];
        const normalizedTags = tags.map((t) => t.replace(/^["']+|["']+$/g, ""));
        const contentTags = normalizedTags.filter((t) => !t.startsWith("#"));
        const passesTagFilter = conversationCorpus
          ? contentTags.length > 0 && contentTags.some((tag) => conversationCorpus.includes(tag.toLowerCase()))
          : true;
        return passesTagFilter && isChannelAllowed(tags);
      });

      serverMemoryLines = filteredServerRows.map((row) =>
        formatMemoryWithId(row.server_memory_id, row.content, row.tags ?? []),
      );
    } catch (error) {
      log.warn("Failed to load server memories with IDs for context", error);
      serverMemoryLines = tomoriState.server_memories;
    }

    if (serverMemoryLines.length > 0) {
      const serverMemoriesText = `${memoryLabel}${serverMemoryLines.join("\n")}\n`;
      contextItems.push({
        role: "system",
        parts: [
          {
            type: "text",
            text: await convertMentions(
              serverMemoriesText,
              client,
              guildId,
              "User", // Stable placeholder instead of triggererName
              botName,
              tomoriConfig.personal_memories_enabled,
            ),
          },
        ],
        metadataTag: ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
      });
    }
  }

  // 5. Emojis with Semantic Metadata (only available in guild channels, not DMs)
  // CRITICAL: Text-based format with LLM-generated descriptions and emotion keys
  // Kept in system instruction for better caching (deterministic ordering prevents frequent invalidation)
  if (!isDMChannel && tomoriConfig.emoji_usage_enabled) {
    const guild = client.guilds.cache.get(guildId);
    const guildEmojisCache = guild?.emojis.cache;

    if (guildEmojisCache && guildEmojisCache.size > 0 && tomoriState) {
      // 1. Use pre-loaded emoji metadata if provided, otherwise load from database
      const emojiMetadata =
        preloadedEmojis && preloadedEmojis.length > 0
          ? preloadedEmojis
          : await sql<
              Array<{
                emoji_disc_id: string;
                emoji_name: string;
                emoji_desc: string | null;
                emotion_key: string | null;
                is_animated: boolean;
                created_at: Date | null;
                updated_at: Date | null;
              }>
            >`
				SELECT emoji_disc_id, emoji_name, emoji_desc, emotion_key, is_animated, created_at, updated_at
				FROM server_emojis
				WHERE server_id = ${tomoriState.server_id}
				ORDER BY created_at ASC
			`;

      // 2. Create emoji metadata map by name (case-insensitive), prefer the latest with metadata
      const emojiMetadataByName = new Map<string, (typeof emojiMetadata)[number]>();
      const hasEmojiMetadata = (metadata: (typeof emojiMetadata)[number]) => {
        const hasEmotionKey = metadata.emotion_key && metadata.emotion_key !== "unset";
        const hasDescription = metadata.emoji_desc && metadata.emoji_desc.trim().length > 0;
        return hasEmotionKey || hasDescription;
      };
      const getMetadataTimestamp = (metadata: (typeof emojiMetadata)[number]) => {
        const updated = metadata.updated_at?.getTime() ?? 0;
        const created = metadata.created_at?.getTime() ?? 0;
        return Math.max(updated, created);
      };

      for (const metadata of emojiMetadata) {
        if (!metadata.emoji_name) continue;
        const nameKey = metadata.emoji_name.toLowerCase();
        const existing = emojiMetadataByName.get(nameKey);
        if (!existing) {
          emojiMetadataByName.set(nameKey, metadata);
          continue;
        }

        const existingHasMeta = hasEmojiMetadata(existing);
        const currentHasMeta = hasEmojiMetadata(metadata);
        if (currentHasMeta && !existingHasMeta) {
          emojiMetadataByName.set(nameKey, metadata);
          continue;
        }
        if (currentHasMeta === existingHasMeta) {
          const existingTime = getMetadataTimestamp(existing);
          const currentTime = getMetadataTimestamp(metadata);
          if (currentTime >= existingTime) {
            emojiMetadataByName.set(nameKey, metadata);
          }
        }
      }

      // 3. Sort emojis by creation date (deterministic, oldest first for caching stability)
      const sortedEmojis = Array.from(guildEmojisCache.values()).sort((a, b) => {
        const aTime = a.createdTimestamp || 0;
        const bTime = b.createdTimestamp || 0;
        return aTime - bTime; // Ascending order (oldest first)
      });

      // 4. Deduplicate by name (case-insensitive) while keeping latest
      const latestEmojiByName = new Map<string, (typeof sortedEmojis)[number]>();
      for (const emoji of sortedEmojis) {
        if (!emoji.name) continue;
        latestEmojiByName.set(emoji.name.toLowerCase(), emoji);
      }

      const dedupedEmojis = sortedEmojis.filter((emoji) => {
        if (!emoji.name) return false;
        return latestEmojiByName.get(emoji.name.toLowerCase())?.id === emoji.id;
      });

      // 5. Build emoji list with descriptions and emotion keys
      const emojiLines: string[] = [];
      for (const emoji of dedupedEmojis) {
        const metadata = emojiMetadataByName.get(emoji.name.toLowerCase());
        if (!emoji.name) continue;
        const emojiCode = `:${emoji.name}:`;
        const emotionKey = metadata?.emotion_key === "unset" ? null : (metadata?.emotion_key ?? null);

        // Graceful degradation: if no metadata, just show code
        if (!metadata || (!metadata.emoji_desc && !emotionKey)) {
          emojiLines.push(emojiCode);
        } else {
          // Show emotion key and description in a natural phrase if available
          const labelParts: string[] = [];
          if (emotionKey) {
            labelParts.push(`Expresses ${emotionKey}`);
          }
          if (metadata.emoji_desc) {
            labelParts.push(metadata.emoji_desc);
          }
          const label = ` (${labelParts.join("; ")})`;
          emojiLines.push(`${emojiCode}${label}`);
        }
      }

      const emojiContent = `## ${serverName}'s Emojis\n- ${emojiLines.join("\n- ")}.`;
      const emojiUsage = isUserImpersonation
        ? `\nTo use ${serverName}'s emojis, write :name: (name only, no IDs). Names are case-insensitive.\n`
        : `\nTo use ${serverName}'s emojis, just write :name: (name only, no IDs). Names are case-insensitive, and {bot} will expand them to the correct custom emoji. {bot} only uses server emojis when it matches their actual mood.\n`;

      contextItems.push({
        role: "system",
        parts: [
          {
            type: "text",
            text: await convertMentions(
              emojiContent + emojiUsage,
              client,
              guildId,
              "User", // Stable placeholder
              botName,
              tomoriConfig.personal_memories_enabled,
              snapshot,
            ),
          },
        ],
        metadataTag: ContextItemTag.KNOWLEDGE_SERVER_EMOJIS,
      });
    }
  }

  // 6. Stickers with Semantic Metadata (only available in guild channels, not DMs)
  // CRITICAL: Text-based format with LLM-generated descriptions and emotion keys for efficient caching
  // Skip during user impersonation (stickers require select_sticker_for_response tool)
  if (tomoriConfig.sticker_usage_enabled && !isDMChannel && !isUserImpersonation) {
    const guild = client.guilds.cache.get(guildId);
    const guildStickersCache = guild?.stickers.cache;

    if (guildStickersCache && guildStickersCache.size > 0 && tomoriState) {
      // 1. Use pre-loaded sticker metadata if provided, otherwise load from database
      const stickerMetadata =
        preloadedStickers && preloadedStickers.length > 0
          ? preloadedStickers
          : await sql<
              Array<{
                sticker_disc_id: string;
                sticker_name: string;
                sticker_desc: string | null;
                emotion_key: string | null;
                created_at: Date | null;
                updated_at: Date | null;
              }>
            >`
				SELECT sticker_disc_id, sticker_name, sticker_desc, emotion_key, created_at, updated_at
				FROM server_stickers
				WHERE server_id = ${tomoriState.server_id}
				ORDER BY created_at ASC
			`;

      // 2. Create sticker metadata map by name (case-insensitive), prefer the latest with metadata
      const stickerMetadataByName = new Map<string, (typeof stickerMetadata)[number]>();
      const hasStickerMetadata = (metadata: (typeof stickerMetadata)[number]) => {
        const hasEmotionKey = metadata.emotion_key && metadata.emotion_key !== "unset";
        const hasDescription = metadata.sticker_desc && metadata.sticker_desc.trim().length > 0;
        return hasEmotionKey || hasDescription;
      };
      const getStickerMetadataTimestamp = (metadata: (typeof stickerMetadata)[number]) => {
        const updated = metadata.updated_at?.getTime() ?? 0;
        const created = metadata.created_at?.getTime() ?? 0;
        return Math.max(updated, created);
      };

      for (const metadata of stickerMetadata) {
        if (!metadata.sticker_name) continue;
        const nameKey = metadata.sticker_name.toLowerCase();
        const existing = stickerMetadataByName.get(nameKey);
        if (!existing) {
          stickerMetadataByName.set(nameKey, metadata);
          continue;
        }

        const existingHasMeta = hasStickerMetadata(existing);
        const currentHasMeta = hasStickerMetadata(metadata);
        if (currentHasMeta && !existingHasMeta) {
          stickerMetadataByName.set(nameKey, metadata);
          continue;
        }
        if (currentHasMeta === existingHasMeta) {
          const existingTime = getStickerMetadataTimestamp(existing);
          const currentTime = getStickerMetadataTimestamp(metadata);
          if (currentTime >= existingTime) {
            stickerMetadataByName.set(nameKey, metadata);
          }
        }
      }

      // 3. Sort stickers by creation date (deterministic, oldest first for caching stability)
      const sortedStickers = Array.from(guildStickersCache.values()).sort((a, b) => {
        const aTime = a.createdTimestamp || 0;
        const bTime = b.createdTimestamp || 0;
        return aTime - bTime; // Ascending order (oldest first)
      });

      // 4. Deduplicate by name (case-insensitive) while keeping latest
      const latestStickerByName = new Map<string, (typeof sortedStickers)[number]>();
      for (const sticker of sortedStickers) {
        if (!sticker.name) continue;
        latestStickerByName.set(sticker.name.toLowerCase(), sticker);
      }

      const dedupedStickers = sortedStickers.filter((sticker) => {
        if (!sticker.name) return false;
        return latestStickerByName.get(sticker.name.toLowerCase())?.id === sticker.id;
      });

      // 5. Build sticker list with descriptions and emotion keys
      let stickerContent = `## ${serverName}'s Stickers\nThis server has the following stickers available for ${botName} to use with the '{sticker_tool}' function:\n`;

      for (const sticker of dedupedStickers) {
        if (!sticker.name) continue;
        const metadata = stickerMetadataByName.get(sticker.name.toLowerCase());
        const emotionKey = metadata?.emotion_key === "unset" ? null : (metadata?.emotion_key ?? null);

        // Build sticker entry
        let stickerEntry = `- "${sticker.name}"`;

        // Add metadata label (LLM first, Discord description as fallback)
        const labelParts: string[] = [];
        if (emotionKey) {
          labelParts.push(`Expresses ${emotionKey}`);
        }
        if (metadata?.sticker_desc) {
          labelParts.push(metadata.sticker_desc);
        }
        if (labelParts.length === 0 && sticker.description) {
          labelParts.push(sticker.description);
        }
        if (labelParts.length > 0) {
          stickerEntry += ` (${labelParts.join("; ")})`;
        }

        stickerEntry += "\n";
        stickerContent += stickerEntry;
      }

      stickerContent += "To use a sticker, call '{sticker_tool}' with the sticker's name (case-insensitive).\n";
      stickerContent = await toolPromptMacroResolver.expand(stickerContent);

      // 5. Add as "system" role (stays in system instruction for caching)
      contextItems.push({
        role: "system",
        parts: [
          {
            type: "text",
            text: await convertMentions(
              stickerContent,
              client,
              guildId,
              "User", // Stable placeholder
              botName,
              tomoriConfig.personal_memories_enabled,
            ),
          },
        ],
        metadataTag: ContextItemTag.KNOWLEDGE_SERVER_STICKERS,
      });
    }
  }

  // 7. Users in Conversation (ALL user-specific dynamic data)
  // This section combines: time/date, channel, user status, memories, and reminders
  if (userList.length > 0) {
    let usersInConversationText = "[System: The following users are having a conversation:\n\n";

    if (isUserImpersonation) {
      usersInConversationText +=
        'To ping users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If a user says mention requires clarification, ask for clarification instead of guessing. Use mentions only when the notification matters.\n\n';
    } else {
      usersInConversationText += `If ${botName} wants to ping any of these users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If a user says mention requires clarification, ask for clarification instead of guessing. Use mentions only when the notification matters.\n\n`;
    }

    type UserConversationEntry = {
      userId: string;
      displayName: string;
      detailLines: string[];
      imageAppearanceTags?: string[];
      isBot: boolean;
      mentionAliases: string[];
      primaryAlias: string | null;
      mentionable: boolean;
      resolvableTargetId?: string;
    };

    const userEntries: UserConversationEntry[] = [];
    const conversationUsers: ConversationUserReference[] = [];
    const aliasCounts = new Map<string, number>();

    const addAlias = (aliases: Set<string>, value?: string | null) => {
      const alias = value?.trim();
      if (!alias) return;
      if (aliases.has(alias)) return;
      aliases.add(alias);
      const key = alias.toLowerCase();
      aliasCounts.set(key, (aliasCounts.get(key) ?? 0) + 1);
    };
    const normalizeImageAppearanceTags = (tags: string[] | null | undefined): string[] | undefined => {
      const normalizedTags = tags?.map((tag) => tag.trim()).filter((tag) => tag.length > 0) ?? [];
      return normalizedTags.length > 0 ? normalizedTags : undefined;
    };

    // 3. Process each user (including bot itself)
    for (const userIdToProcess of userList) {
      // 4. Special handling for TomoriBot itself
      if (
        (client.user && userIdToProcess === client.user.id) ||
        (tomoriState?.is_alter && userIdToProcess === String(tomoriState.tomori_id))
      ) {
        userEntries.push({
          userId: userIdToProcess,
          displayName: botName,
          detailLines: ["- Status: Online - Currently active and responding to messages"],
          imageAppearanceTags:
            !isUserImpersonation && tomoriConfig.imagegen_enabled
              ? normalizeImageAppearanceTags(tomoriState?.nai_tags)
              : undefined,
          isBot: true,
          mentionAliases: [],
          primaryAlias: null,
          mentionable: false,
        });
        continue;
      }

      // 5. Load/register user
      let userRow = await loadUserRow(userIdToProcess).catch(() => null);
      if (!userRow) {
        // Try to register if not found (same logic as current implementation)
        const guild = client.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(userIdToProcess).catch(() => null) : null;
        if (guild && member) {
          const serverLocale = guild.preferredLocale;
          const userLanguage = serverLocale.startsWith("ja") ? "ja" : "en-US";
          const registrationDisplayName = resolvePreferredDiscordDisplayName({
            memberDisplayName: member.displayName,
            user: member.user,
          });
          userRow = await registerUser(userIdToProcess, registrationDisplayName, userLanguage);
        }
      }

      if (!userRow) {
        const syntheticEntry = syntheticUsers?.get(userIdToProcess);
        if (syntheticEntry) {
          userEntries.push({
            userId: userIdToProcess,
            displayName: syntheticEntry.displayName,
            detailLines: [],
            imageAppearanceTags: undefined,
            isBot: false,
            mentionAliases: [],
            primaryAlias: null,
            mentionable: false,
          });
          continue;
        }

        log.warn(`Skipping user ${userIdToProcess} - could not load user data`);
        continue;
      }

      // 6. Determine display name (respecting personalization settings)
      const guild = client.guilds.cache.get(guildId);
      const member = guild ? await guild.members.fetch(userIdToProcess).catch(() => null) : null;
      const fallbackUser = member ? null : await client.users.fetch(userIdToProcess).catch(() => null);
      const serverPersonalizationEnabled = tomoriConfig.personal_memories_enabled ?? true;
      const isTriggererId = snapshot?.triggererUserRow?.user_disc_id === userRow.user_disc_id;
      const userIsBlacklisted = isTriggererId
        ? (snapshot?.isTriggererBlacklisted ?? false)
        : await isBlacklisted(guildId, userRow.user_disc_id);
      const userPrivacyLevel = isTriggererId
        ? (snapshot?.triggererPrivacyLevel ?? PrivacyLevel.MINIMAL)
        : await getPrivacyLevel(userRow.user_disc_id);

      let displayName: string;
      const customNickname = userRow.user_nickname;
      const serverNickname = member?.nickname;
      const username = member?.user.username ?? fallbackUser?.username ?? null;
      const globalName = member?.user.globalName ?? fallbackUser?.globalName ?? null;
      const canUseCustomNickname =
        customNickname && serverPersonalizationEnabled && !userIsBlacklisted && userPrivacyLevel !== PrivacyLevel.FULL; // Allow MINIMAL and PARTIAL
      const shouldIncludeCustomNicknameAlias =
        customNickname &&
        serverPersonalizationEnabled &&
        !userIsBlacklisted &&
        (!serverNickname || canUseCustomNickname);

      if (canUseCustomNickname) {
        displayName = customNickname;
      } else if (serverNickname) {
        displayName = serverNickname;
      } else {
        displayName = `<@${userRow.user_disc_id}>`;
      }

      if (isUserImpersonation && userRow.user_disc_id === impersonatedUserId && impersonatedIdentityName) {
        displayName = impersonatedIdentityName;
      }

      const detailLines: string[] = [];

      // 8. Add status (only for Level 0 MINIMAL privacy)
      // Only include if GuildPresences intent is available (non-production)
      if (userPrivacyLevel === PrivacyLevel.MINIMAL) {
        const hasPresenceIntent = client.options.intents?.has(GatewayIntentBits.GuildPresences);

        if (isDMChannel) {
          // DMs always show online
          detailLines.push("- Status: Online (Direct Message)");
        } else if (hasPresenceIntent) {
          // Only fetch presence data if intent is available
          const presenceInfo = isTriggererId
            ? await getUserPresenceDetails(client, userRow.user_disc_id, guildId, snapshot?.preloadedMember)
            : await getUserPresenceDetails(client, userRow.user_disc_id, guildId);

          detailLines.push(`- Status: ${presenceInfo}`);
        }
        // In production without presence intent: skip status entirely
      }

      // 8.1. Add server roles (only for Level 0 MINIMAL privacy)
      if (userPrivacyLevel === PrivacyLevel.MINIMAL && member) {
        const roles = member.roles.cache
          .filter((role) => role.id !== guild?.id && role.name !== "@everyone")
          .sort((a, b) => b.position - a.position)
          .map((role) => role.name);

        if (roles.length > 0) {
          detailLines.push(`- Server Roles: ${roles.join(", ")}`);
        }
      }

      // 9. Add personal memories (only for Level 0 MINIMAL privacy)
      // For user impersonation: only include memories about the impersonated user (so AI knows facts about them)
      const shouldIncludePersonalMemories =
        !isUserImpersonation || (isUserImpersonation && userRow.user_disc_id === impersonatedUserId);

      if (
        shouldIncludePersonalMemories &&
        serverPersonalizationEnabled &&
        !userIsBlacklisted &&
        userPrivacyLevel === PrivacyLevel.MINIMAL
      ) {
        if (userRow.user_id) {
          const activeLineageId =
            personaLineageId ?? snapshot?.tomoriState?.persona_lineage_id ?? tomoriState?.persona_lineage_id ?? 0;
          const personalMemoryRows = await loadPersonalMemoriesForUserLineage(userRow.user_id, activeLineageId, true);
          const filteredPersonalRows = personalMemoryRows.filter((row) => {
            const tags = row.tags ?? [];
            const normalizedTags = tags.map((t) => t.replace(/^["']+|["']+$/g, ""));
            const contentTags = normalizedTags.filter((t) => !t.startsWith("#"));
            const passesTagFilter = conversationCorpus
              ? contentTags.length > 0 && contentTags.some((tag) => conversationCorpus.includes(tag.toLowerCase()))
              : true;
            return passesTagFilter && isChannelAllowed(tags);
          });
          if (filteredPersonalRows.length > 0) {
            const processedMemories = await Promise.all(
              filteredPersonalRows.map(async (memoryRow, index) => {
                const processedMemory = await convertMentions(
                  memoryRow.content,
                  client,
                  guildId,
                  displayName, // Use memory owner's name for {user} token
                  botName,
                  tomoriConfig.personal_memories_enabled,
                );
                const memoryId = memoryRow.personal_memory_id ?? index + 1;
                return formatMemoryWithId(memoryId, processedMemory, memoryRow.tags ?? []);
              }),
            );
            detailLines.push(`- Memories: ${processedMemories.join("; ")}`);
          }
        }
      }

      // 10. Add pending reminders
      const pendingReminders = await getPendingRemindersForUser(userRow.user_disc_id, guildId);
      if (pendingReminders && pendingReminders.length > 0) {
        detailLines.push("- Reminders:");
        for (const reminder of pendingReminders) {
          const reminderDate = new Date(reminder.reminder_time);
          const formattedTime = reminderDate.toLocaleString("en-US", {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          });
          detailLines.push(`  • "${reminder.reminder_purpose}" (scheduled for ${formattedTime})`);
        }
      }

      const aliasSet = new Set<string>();
      if (isUserImpersonation && userRow.user_disc_id === impersonatedUserId && impersonatedIdentityName) {
        addAlias(aliasSet, impersonatedIdentityName);
      }
      if (shouldIncludeCustomNicknameAlias) addAlias(aliasSet, customNickname);
      if (serverNickname) addAlias(aliasSet, serverNickname);
      if (globalName) addAlias(aliasSet, globalName);
      if (username) addAlias(aliasSet, username);

      let primaryAlias: string | null = null;
      if (isUserImpersonation && userRow.user_disc_id === impersonatedUserId && impersonatedIdentityName) {
        primaryAlias = impersonatedIdentityName;
      } else if (canUseCustomNickname) primaryAlias = customNickname;
      else if (serverNickname) primaryAlias = serverNickname;
      else if (globalName) primaryAlias = globalName;
      else if (username) primaryAlias = username;

      if (!primaryAlias && aliasSet.size === 0) {
        primaryAlias = userRow.user_disc_id;
        addAlias(aliasSet, primaryAlias);
      }

      userEntries.push({
        userId: userRow.user_disc_id,
        displayName,
        detailLines,
        imageAppearanceTags:
          !isUserImpersonation && tomoriConfig.imagegen_enabled
            ? normalizeImageAppearanceTags(userRow.nai_char_tags)
            : undefined,
        isBot: false,
        mentionAliases: Array.from(aliasSet),
        primaryAlias,
        mentionable: true,
        resolvableTargetId: userRow.user_disc_id,
      });
    }

    if (matrixUsers && matrixUsers.size > 0) {
      for (const [matrixUserId, displayName] of matrixUsers.entries()) {
        const matrixAliasSet = new Set<string>();
        addAlias(matrixAliasSet, displayName);
        userEntries.push({
          userId: matrixUserId,
          displayName,
          detailLines: ["- Status: Online or status unknown"],
          imageAppearanceTags: undefined,
          isBot: false,
          mentionAliases: Array.from(matrixAliasSet),
          primaryAlias: displayName || null,
          mentionable: false,
          resolvableTargetId: matrixUserId,
        });
      }
    }

    if (!isUserImpersonation && tomoriConfig.imagegen_enabled && syntheticUsers && syntheticUsers.size > 0) {
      const hasSyntheticPersonas = Array.from(syntheticUsers.values()).some((entry) => entry.type === "persona");
      if (hasSyntheticPersonas) {
        const allPersonas = await getCachedAllPersonas(guildId).catch((error) => {
          log.warn("Failed to load personas for image profile context", error);
          return [];
        });
        const personaById = new Map(
          allPersonas
            .filter((persona) => persona.tomori_id != null)
            .map((persona) => [persona.tomori_id as number, persona]),
        );

        for (const [syntheticId, syntheticEntry] of syntheticUsers.entries()) {
          if (syntheticEntry.type !== "persona" || !/^\d{1,10}$/.test(syntheticId)) {
            continue;
          }

          const personaId = Number.parseInt(syntheticId, 10);
          if (personaId === tomoriState?.tomori_id) {
            continue;
          }

          const persona = personaById.get(personaId);
          if (!persona) {
            continue;
          }

          const targetEntry = userEntries.find((entry) => entry.userId === syntheticId);
          if (targetEntry) {
            targetEntry.imageAppearanceTags = normalizeImageAppearanceTags(persona.nai_tags);
          }
        }
      }
    }

    const isAliasUnique = (alias: string) => (aliasCounts.get(alias.toLowerCase()) ?? 0) === 1;
    const formatMentionHandle = (alias: string) => `@{${alias}}`;

    for (const entry of userEntries) {
      if (entry.isBot) {
        const selfSuffix = isUserImpersonation ? "" : " (This is you!)";
        usersInConversationText += `${entry.displayName}${selfSuffix}\n`;
      } else {
        const mentionParts: string[] = [];
        const uniqueAliases = entry.mentionAliases.filter(isAliasUnique);
        const primaryVisibleAlias =
          entry.primaryAlias && isAliasUnique(entry.primaryAlias)
            ? entry.primaryAlias
            : (uniqueAliases.find((alias) => alias !== entry.primaryAlias) ?? null);
        const aliasHandles = uniqueAliases
          .filter((alias) => alias !== primaryVisibleAlias)
          .map((alias) => formatMentionHandle(alias));

        if (entry.mentionable && primaryVisibleAlias) {
          mentionParts.push(`Mention: ${formatMentionHandle(primaryVisibleAlias)}`);
        }
        if (aliasHandles.length > 0) {
          mentionParts.push(`Aliases: ${aliasHandles.join(", ")}`);
        }
        if (entry.mentionable && entry.mentionAliases.length > 0 && !primaryVisibleAlias) {
          mentionParts.push("Mention requires clarification");
        }

        const mentionInfo = mentionParts.length > 0 ? ` (${mentionParts.join("; ")})` : "";
        usersInConversationText += `${entry.displayName}${mentionInfo}\n`;
      }

      if (entry.imageAppearanceTags && entry.imageAppearanceTags.length > 0) {
        usersInConversationText += `- Appearance Tags: ${entry.imageAppearanceTags.join(", ")}\n`;
      }

      for (const line of entry.detailLines) {
        usersInConversationText += `${line}\n`;
      }

      usersInConversationText += "\n"; // Blank line between users

      if (entry.resolvableTargetId && entry.mentionAliases.length > 0) {
        conversationUsers.push({
          targetId: entry.resolvableTargetId,
          displayLabel: entry.displayName,
          aliases: entry.mentionAliases,
          mentionable: entry.mentionable,
        });
      }
    }

    // Append channel/time context last to keep more stable prompt content up front.
    const timezoneOffset = tomoriConfig.timezone_offset ?? 0;
    const currentTime = getCurrentTimeWithOffset(timezoneOffset);
    const timezoneLabel = formatUTCOffset(timezoneOffset);
    const timeOfDayPhrase = getTimeOfDayPhrase(timezoneOffset);
    const conversationContext = isDMChannel
      ? "Conversation context: Direct Message."
      : `Conversation context: #${channelName}${channelId ? ` (ID: ${channelId})` : ""}.`;
    const timeContext = `Current time: ${currentTime} (${timezoneLabel}), ${timeOfDayPhrase}.`;

    usersInConversationText += `${conversationContext}\n${timeContext}\n]`; // Close [System: ...] block

    // 11. Add as "user" role (goes in dialogue contents)
    contextItems.push({
      role: "user",
      parts: [
        {
          type: "text",
          text: await convertMentions(
            usersInConversationText.trim(),
            client,
            guildId,
            triggererName,
            botName,
            tomoriConfig.personal_memories_enabled,
          ),
        },
      ],
      metadataTag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
      conversationUsers,
    });
  }

  // === SHORT-TERM MEMORY CONTEXT (Phase 2 & 3) ===
  // Load recent conversations from other channels (other-channel awareness)
  // and current channel summary (same-channel working memory)
  // Store same-channel prompt separately to be added at the very end
  try {
    // Determine the triggering user ID (impersonation takes precedence)
    const actualTriggeringUserId = impersonatedUserId ?? snapshot?.triggererUserRow?.user_disc_id;

    // Determine locale (from snapshot if available)
    const actualLocale = snapshot?.triggererUserRow?.language_pref ?? "en-US";

    // Only build short-term memory context if we have a valid user ID
    if (actualTriggeringUserId) {
      const { memoryItems, createPromptText } = await buildShortTermMemoryContext(
        actualTriggeringUserId,
        channelId,
        guildId,
        tomoriState,
        actualLocale,
        triggererName,
        botName,
        tomoriConfig.personal_memories_enabled,
        client,
        isUserImpersonation,
        explicitLongTermMemoryIntent,
        toolPromptMacroResolver,
        parentChannelId,
      );
      // Push memory items now (goes in middle of context)
      // Includes: other-channel memories + same-channel summary (if exists)
      contextItems.push(...memoryItems);
      // Store create prompt for later (goes at very end)
      // This is the HINT or "create summary" instruction
      sameChannelMemoryDirective = createPromptText;
    }
  } catch (error) {
    // Don't fail context building if short-term memory loading fails
    log.warn("Failed to build short-term memory context", error);
  }

  // 7.5 Server Documents (RAG)
  // Placed after short-term memory so that the stable prefix (system prompt, personality,
  // server knowledge, users, STM) stays cache-friendly — RAG results change per query
  // and would invalidate everything that follows if left higher in the prompt.
  try {
    if (isRagAvailable() && memoryGuard.getStatus() !== "critical" && tomoriState?.server_id) {
      const queryText = getLatestUserQuery(simplifiedMessageHistory);
      if (queryText && queryText.length >= DOCUMENT_QUERY_MIN_LENGTH) {
        const [documentRow] =
          tomoriState.tomori_id === null || tomoriState.tomori_id === undefined
            ? await sql`
							SELECT document_id
							FROM documents
							WHERE server_id = ${tomoriState.server_id}
							  AND tomori_id IS NULL
							LIMIT 1
						`
            : await sql`
							SELECT document_id
							FROM documents
							WHERE server_id = ${tomoriState.server_id}
							  AND (
								tomori_id = ${tomoriState.tomori_id}
								OR tomori_id IS NULL
							  )
							LIMIT 1
						`;

        if (documentRow?.document_id) {
          const creds = await resolveCapabilityCredentials(tomoriState.server_id, "embedding", {
            userId: triggererUserId ?? null,
          });
          const resolvedEmbeddingModelId =
            getResolvedCapabilityModelId(creds, "embedding") ?? tomoriState.config.embedding_model_id;
          const embeddingModel = resolvedEmbeddingModelId
            ? await loadEmbeddingModelById(resolvedEmbeddingModelId)
            : null;
          if (embeddingModel) {
            const chunks = await retrieveRelevantDocumentChunks({
              serverId: tomoriState.server_id,
              tomoriId: tomoriState.tomori_id ?? null,
              query: queryText,
              embeddingModel,
              apiKey: creds.apiKey,
              maxResults: DOCUMENT_MAX_RESULTS,
              minSimilarity: DOCUMENT_MIN_SIMILARITY,
              channelName: tomoriConfig.channel_memory_enabled ? channelName : undefined,
            });

            const documentContext = formatRetrievedChunksForPrompt(chunks);

            if (documentContext) {
              contextItems.push({
                role: "user",
                parts: [{ type: "text", text: documentContext }],
                metadataTag: ContextItemTag.KNOWLEDGE_SERVER_DOCUMENTS,
              });
            }
          }
        }
      }
    }
  } catch (error) {
    log.warn("Failed to add server document context", error);
  }

  // 7.6 Conditioning history (reward/punish)
  // Placed near the end of system-context assembly so it can guide behavior
  // without displacing higher-stability persona and server state blocks.
  if (
    !isUserImpersonation &&
    tomoriState &&
    tomoriState.server_id &&
    tomoriState.persona_lineage_id >= 0 &&
    (tomoriState.reward_conditioning_enabled || tomoriState.punish_conditioning_enabled)
  ) {
    try {
      const conditioningItem = await buildConditioningContextItem({
        client,
        guildId,
        serverId: tomoriState.server_id,
        personaLineageId: tomoriState.persona_lineage_id,
        botName,
        personalMemoriesEnabled: tomoriConfig.personal_memories_enabled,
        rewardEnabled: tomoriState.reward_conditioning_enabled,
        punishEnabled: tomoriState.punish_conditioning_enabled,
      });

      if (conditioningItem) {
        contextItems.push(conditioningItem);
      }
    } catch (error) {
      log.warn("Failed to add conditioning context", error);
    }
  }

  // Skip sample dialogues for user impersonation (users don't need examples of bot's speech)
  if (
    !isUserImpersonation &&
    tomoriState &&
    tomoriState.sample_dialogues_in.length > 0 &&
    tomoriState.sample_dialogues_out.length > 0 &&
    tomoriState.sample_dialogues_in.length === tomoriState.sample_dialogues_out.length
  ) {
    // 8. Sample Dialogues (Request 3: Changed to alternating user/model turns)
    // 8.0. Add introductory system message for sample dialogues
    /*
		contextItems.push({
			role: "user",
			parts: [
				{
					type: "text",
					text: `[System: The following are example dialogues on how ${botName} should speak]`,
				},
			],
			metadataTag: ContextItemTag.DIALOGUE_SAMPLE,
		});*/

    // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
    for (let i = 0; i < tomoriState!.sample_dialogues_in.length; i++) {
      // 8.a. User's part of the sample dialogue
      // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
      let userSampleText = tomoriState!.sample_dialogues_in[i];
      const isUnpairedSample = userSampleText === UNPAIRED_SAMPLE_DIALOGUE_SENTINEL;
      if (!isUnpairedSample) {
        // No username prefix - prevents associating examples with the triggerer
        if (tomoriConfig.humanizer_degree >= HumanizerDegree.HEAVY) {
          userSampleText = humanizeString(userSampleText);
        }
        contextItems.push({
          role: "user",
          parts: [
            {
              type: "text",
              text: applyUncensorInputTransforms(
                await convertMentions(
                  userSampleText,
                  client,
                  guildId,
                  triggererName, // triggererName for {user} if it appears in sample
                  botName,
                  tomoriConfig.personal_memories_enabled,
                ),
                uncensorInputOptions,
              ),
            },
          ],
          metadataTag: ContextItemTag.DIALOGUE_SAMPLE, // Tagging
        });
      }

      // 8.b. Bot's part of the sample dialogue
      // biome-ignore lint/style/noNonNullAssertion: tomoriState is checked above
      let modelSampleText = tomoriState!.sample_dialogues_out[i];
      modelSampleText = `${botName}: ${modelSampleText}`; // Prepend bot's name
      if (tomoriConfig.humanizer_degree >= HumanizerDegree.HEAVY) {
        modelSampleText = humanizeString(modelSampleText);
      }
      contextItems.push({
        role: "model",
        parts: [
          {
            type: "text",
            text: applyUncensorInputTransforms(
              await convertMentions(
                modelSampleText,
                client,
                guildId,
                triggererName,
                botName, // botName for {bot} if it appears in sample
                tomoriConfig.personal_memories_enabled,
              ),
              uncensorInputOptions,
            ),
          },
        ],
        metadataTag: ContextItemTag.DIALOGUE_SAMPLE, // Tagging
      });
    }

    // 8.c. Spacer message after sample dialogues to delineate examples from real conversation.
    // Flip this flag to enable/disable the spacer.
    const ENABLE_SAMPLE_DIALOGUE_SPACER = false;
    if (ENABLE_SAMPLE_DIALOGUE_SPACER) {
      const spacerText = `[System: Above are only examples of how {{char}} acts and talks. Use them as reference for a completely new scene that starts now.]`;
      contextItems.push({
        role: "user",
        parts: [
          {
            type: "text",
            text: applyUncensorInputTransforms(
              await convertMentions(
                spacerText,
                client,
                guildId,
                triggererName,
                botName,
                tomoriConfig.personal_memories_enabled,
              ),
              uncensorInputOptions,
            ),
          },
        ],
        metadataTag: ContextItemTag.DIALOGUE_SAMPLE,
      });
    }
  }

  // 9. Conversation History (Main Dialogue)
  // Calculate media windowing boundaries
  const totalMessages = simplifiedMessageHistory.length;
  const configuredMessageFetchLimit = normalizeMessageFetchLimit(tomoriConfig.message_fetch_limit);
  const requestedMediaWindow = mediaContextWindow ?? memoryGuard.getMediaWindow();
  const effectiveMediaWindow = Math.min(requestedMediaWindow, configuredMessageFetchLimit);
  const maxExtendBy = Math.max(0, configuredMessageFetchLimit - effectiveMediaWindow);
  const mediaWindowCutoff = totalMessages - effectiveMediaWindow;
  const renderedImageMessageIds = getRenderedImageMessageIdsWithinWindow(simplifiedMessageHistory, mediaWindowCutoff);

  // Pre-compute duplicate image detection: when the same image (by proxyUrl)
  // appears in multiple rendered messages (e.g. original + reply reference),
  // only the latest occurrence gets rendered as base64 to avoid duplicate payloads.
  const duplicateImageLastIndex = getLastImageOccurrenceIndices(
    simplifiedMessageHistory,
    renderedImageMessageIds,
    mediaWindowCutoff,
  );

  // Author's note injection setup (April 2026)
  // Resolve effective note: active persona's note wins; falls back to server-global note.
  // tomoriState here is the full TomoriState (TomoriRow + config) loaded above at line ~1134.
  const effectiveContextNote = tomoriState?.context_note?.trim() || tomoriConfig.context_note?.trim() || null;
  const effectiveContextNoteDepth = effectiveContextNote
    ? tomoriState?.context_note?.trim()
      ? (tomoriState.context_note_depth ?? 0)
      : (tomoriConfig.context_note_depth ?? 0)
    : 0;

  // targetIndex: the history index at which to inject the note BEFORE that message.
  // depth=0 → targetIndex = totalMessages (i.e. never fires inside the loop → emitted after).
  // depth=N → inject before the message at index (totalMessages - N), clamped to 0.
  // depth >= totalMessages → inject at the very top of the history (index 0).
  const contextNoteTargetIndex = effectiveContextNote ? Math.max(0, totalMessages - effectiveContextNoteDepth) : -1;
  let contextNoteEmitted = false;

  const botNameLower = botName.toLowerCase();
  for (const [index, msg] of simplifiedMessageHistory.entries()) {
    const isPersonaMessage = msg.authorType === "persona" && !!msg.personaName;
    const isCurrentPersonaMessage = isPersonaMessage && msg.personaName?.toLowerCase() === botNameLower;

    // Role reversal for user impersonation (February 2026)
    let role: "user" | "model";
    if (isUserImpersonation) {
      // Reverse roles: user messages become "model", bot messages become "user"
      if (msg.authorType === "user" && msg.authorId === impersonatedUserId) {
        role = "model"; // This user's messages are treated as model output
      } else if (isCurrentPersonaMessage) {
        role = "user"; // Bot messages are treated as user input
      } else {
        role = "user"; // Other messages stay as user
      }
    } else {
      // Normal role assignment
      role = isCurrentPersonaMessage ? "model" : "user";
    }

    // Inject author's note block BEFORE this message when we've reached the target depth.
    // Uses a "user" turn with [System: ...] formatting so it sits naturally in the dialogue
    // stream without being attributed to any speaker — matching the pattern for other system
    // annotations (short-term memory, users-in-conversation, etc.).
    if (!contextNoteEmitted && effectiveContextNote && index === contextNoteTargetIndex) {
      pushDialogueHistoryContextItem(
        contextItems,
        "user",
        [{ type: "text", text: `[System: ${effectiveContextNote}]` }],
        "context_note_injection",
        ContextItemTag.CONTEXT_NOTE_INJECTION,
      );
      contextNoteEmitted = true;
    }

    const parts: ContextPart[] = [];
    // Media/tooling annotations are kept off the speaker-authored turn so models
    // do not treat bracketed [System: ...] metadata as dialogue they produced.
    const detachedSystemParts: ContextPart[] = [];

    // Determine if this message is within the media context window
    const isWithinMediaWindow = index >= mediaWindowCutoff;

    // Check if message has significant media (non-emoji images or videos)
    // Emoji-only messages are excluded from "increase_media_context" flagging
    // because emojis are common and the system flag message can flood context unnecessarily
    const hasNonEmojiImages = msg.imageAttachments.some((att) => !att.isEmoji);
    const hasVideos = msg.videoAttachments.length > 0;
    const hasSignificantMedia = hasNonEmojiImages || hasVideos;
    let mediaIdHintAdded = false;

    // Model capability flags (used for both the out-of-window hint and within-window rendering).
    // Prefer the caller-supplied override (resolved from the provider capability cache) so
    // the context builder stays in sync with what the stream adapter will actually send.
    // Fall back to the DB flag when no override is provided (e.g. non-OpenRouter providers).
    const seesImages = seesImagesOverride ?? tomoriState?.llm.sees_images ?? false;
    const seesVideos = seesVideosOverride ?? tomoriState?.llm.sees_videos ?? false;

    // If message has significant media but is outside window, add placeholder.
    // Only shown if the model actually supports the relevant media type — no point
    // suggesting increase_media_context if the model cannot see the media anyway.
    // Messages with only emojis are not flagged, but messages with emojis + real media ARE flagged
    const hasViewableMediaOutsideWindow = (hasNonEmojiImages && seesImages) || (hasVideos && seesVideos);
    if (hasViewableMediaOutsideWindow && !isWithinMediaWindow) {
      // Calculate extend_by needed to reach this message, capped at maxExtendBy
      const extendByNeeded = Math.min(mediaWindowCutoff - index, maxExtendBy);

      // Build media description
      const mediaDescription = buildMediaDescription(msg);

      // Add placeholder text
      detachedSystemParts.push({
        type: "text",
        text: `[System: This message (ID: ${messageIdMap?.register(msg.id, "media") ?? msg.id}) contained ${mediaDescription} - use increase_media_context with extend_by=${extendByNeeded} to view]`,
      });
      mediaIdHintAdded = true;
    } else if (isWithinMediaWindow) {
      // Within window: Add full media if model supports it, otherwise add placeholder
      // Check model capability flags
      // 9.a. Add image parts if attachments exist
      if (msg.imageAttachments.length > 0) {
        if (seesImages) {
          const hasCountedImages = msg.imageAttachments.some(isCountedRenderedImageAttachment);
          const shouldRenderCountedImages = !hasCountedImages || renderedImageMessageIds.has(msg.id);
          let skippedCountedImageCount = 0;

          // Model supports images - add them normally
          let skippedDuplicateImageCount = 0;
          for (const attachment of msg.imageAttachments) {
            const countsTowardRenderedImageLimit = isCountedRenderedImageAttachment(attachment);
            if (countsTowardRenderedImageLimit && !shouldRenderCountedImages) {
              skippedCountedImageCount++;
              continue;
            }

            // Skip duplicate images that will be rendered later in a more recent message
            // (e.g. original message image also appears in a reply that merged the reference)
            const lastIndex = duplicateImageLastIndex.get(attachment.proxyUrl);
            if (lastIndex !== undefined && countsTowardRenderedImageLimit && lastIndex !== index) {
              skippedDuplicateImageCount++;
              continue;
            }

            if (attachment.mimeType) {
              parts.push({
                type: "image",
                uri: attachment.proxyUrl,
                mimeType: attachment.mimeType,
              });
            } else {
              log.warn(
                `Skipping image attachment due to missing mimeType: ${attachment.filename} from user ${msg.authorName}`,
              );
            }
          }

          if (skippedDuplicateImageCount > 0) {
            log.info(
              `Skipped ${skippedDuplicateImageCount} duplicate image(s) for message ${msg.id} — same image rendered in a later message`,
            );
          }

          if (skippedCountedImageCount > 0) {
            const skippedImageDescription =
              skippedCountedImageCount === 1
                ? "1 image omitted due to rendered-image limit. Do not claim to see it."
                : `${skippedCountedImageCount} images omitted due to rendered-image limit. Do not claim to see them.`;
            detachedSystemParts.push({
              type: "text",
              text: `[System: ${skippedImageDescription}]`,
            });
            log.info(
              `Skipped ${skippedCountedImageCount} counted image(s) for message ${msg.id} due to MEDIA_IMAGE_MESSAGE_LIMIT=${MEDIA_IMAGE_MESSAGE_LIMIT}`,
            );
          }
        } else {
          // Model doesn't support images - add placeholder text
          const imageCount = msg.imageAttachments.length;
          const hasGif = msg.imageAttachments.some((att) => att.mimeType?.includes("gif"));
          let imageDescription: string;

          if (hasGif && imageCount === 1) {
            imageDescription = "a GIF";
          } else if (hasGif) {
            imageDescription = `${imageCount} images (including GIF)`;
          } else {
            imageDescription = `${imageCount === 1 ? "an image" : `${imageCount} images`}`;
          }

          if (hasVisionTool) {
            // Vision tool available — prompt the model to use it instead of guessing
            detachedSystemParts.push({
              type: "text",
              text: await toolPromptMacroResolver.expand(
                `[System: This message contains ${imageDescription}. Do not guess the image contents. Use the {image_analysis_tool} tool only if the user explicitly asks about the image or if unseen visual details are necessary to answer correctly.]`,
              ),
            });
          } else {
            // No vision tool — instruct the model to not pretend it can see
            detachedSystemParts.push({
              type: "text",
              text: `[System: This message contains ${imageDescription}. Current model cannot see images, please do not describe or claim to see the image contents.]`,
            });
          }
          log.info(
            `Images skipped for message ${msg.id} - model does not support images (visionTool=${hasVisionTool})`,
          );
        }
      }

      // 9.b. Add video parts if attachments exist
      if (msg.videoAttachments.length > 0) {
        if (seesVideos) {
          // Model supports videos - add them normally
          for (const attachment of msg.videoAttachments) {
            if (attachment.mimeType) {
              parts.push({
                type: "video",
                uri: attachment.isYouTubeLink ? attachment.url : attachment.proxyUrl,
                mimeType: attachment.mimeType,
                isYouTubeLink: attachment.isYouTubeLink,
              });
            } else {
              log.warn(
                `Skipping video attachment due to missing mimeType: ${attachment.filename} from user ${msg.authorName}`,
              );
            }
          }
        } else {
          // Model doesn't support videos - add placeholder text
          const videoCount = msg.videoAttachments.length;
          const videoDescription = videoCount === 1 ? "a video" : `${videoCount} videos`;

          detachedSystemParts.push({
            type: "text",
            text: `[System: This message contains ${videoDescription}. Current model cannot see videos, please do not describe or claim to see the video contents.]`,
          });
          log.info(`Videos skipped for message ${msg.id} - model does not support videos`);
        }
      }
    }

    // 9.c-pre. Build the media attribution hint for significant media messages.
    // This merges sender attribution with the tool-use media ID into a single structured
    // note that is appended to the end of the user's text (or used as the sole text for
    // media-only messages). Format: [System: This image (Media ID: X) was sent by Author]
    let mediaAttributionHint: string | null = null;
    if (hasSignificantMedia && !mediaIdHintAdded) {
      const mediaMessageIds = msg.mediaSourceMessageIds ?? [msg.id];
      const nonEmojiImageCount = msg.imageAttachments.filter((a) => !a.isEmoji).length;
      const videoCount = msg.videoAttachments.length;
      const totalMediaCount = nonEmojiImageCount + videoCount;

      let mediaWord: string;
      if (nonEmojiImageCount > 0 && videoCount === 0) {
        mediaWord = nonEmojiImageCount === 1 ? "image" : "images";
      } else if (videoCount > 0 && nonEmojiImageCount === 0) {
        mediaWord = videoCount === 1 ? "video" : "videos";
      } else {
        mediaWord = "media files";
      }

      const thisOrThese = totalMediaCount === 1 ? "This" : "These";
      const idLabel = mediaMessageIds.length === 1 ? "Media ID" : "Media IDs";
      const wasSent = totalMediaCount === 1 ? "was" : "were";
      const idList = mediaMessageIds.map((id) => messageIdMap?.register(id, "media") ?? id).join(", ");

      // If the current message's ID is absent from mediaSourceMessageIds, all media
      // came from a referenced/forwarded message — the leading [System: ...] block
      // already names the original sender, so don't misattribute to the current author.
      const isReferenceOnlyMedia = !mediaMessageIds.includes(msg.id);
      if (isReferenceOnlyMedia) {
        if (msg.remoteMediaSourceKind === "forwarded") {
          mediaAttributionHint = `[System: ${thisOrThese} ${mediaWord} (${idLabel}: ${idList}) ${wasSent} attached to the forwarded message described above]`;
        } else {
          mediaAttributionHint = `[System: ${thisOrThese} ${mediaWord} (${idLabel}: ${idList}) ${wasSent} included in the message being replied to]`;
        }
      } else {
        // Resolve the author name through convertMentions — msg.authorName may be a raw
        // <@userId> mention for regular users, which needs guild cache resolution.
        const resolvedHintAuthorName = await convertMentions(
          msg.authorName,
          client,
          guildId,
          msg.authorName,
          botName,
          tomoriConfig.personal_memories_enabled,
        );
        mediaAttributionHint = `[System: ${thisOrThese} ${mediaWord} (${idLabel}: ${idList}) ${wasSent} sent by ${resolvedHintAuthorName}]`;
      }
    }

    // 9.c. Add text part if content exists (always included, regardless of window).
    // If there is no text but media was added, use the attribution hint as the sole text
    // (or fall back to prose form for non-significant media like emoji-only attachments).
    if (msg.content) {
      // Request 4: Prepend speaker name to content
      const normalizedContent = normalizeCustomEmojisForLlm(msg.content);

      // Prepend author name, with special handling for [System:] content:
      // - Pure system injections (embeds, reminders, etc.) are standalone "[System: ...]" blocks — no prefix needed.
      // - Reply/forward annotations may add one or more leading "[System: ...]" lines before user text.
      let processedContent: string;
      if (normalizedContent.startsWith("[System:")) {
        const { leadingSystemBlocks, remainingContent } = splitLeadingSystemBlocks(normalizedContent);
        if (leadingSystemBlocks.length > 0 && remainingContent) {
          processedContent = `${leadingSystemBlocks.join("\n")}\n${msg.authorName}: ${remainingContent}`;
        } else {
          processedContent = normalizedContent; // Pure system injection, no author prefix
        }
      } else {
        processedContent = `${msg.authorName}: ${normalizedContent}`; // Add author prefix
      }

      if (tomoriConfig.humanizer_degree >= HumanizerDegree.HEAVY && role === "model") {
        processedContent = humanizeString(processedContent);
      }
      // convertMentions will handle {user} and {bot} replacements.
      // The {user} in convertMentions will refer to msg.authorName if it's a user message.
      processedContent = await convertMentions(
        processedContent,
        client,
        guildId,
        msg.authorName, // Pass the actual author of this historical message
        botName,
        tomoriConfig.personal_memories_enabled,
      );
      if (!processedContent.startsWith("[System:")) {
        processedContent = applyUncensorInputTransforms(processedContent, uncensorInputOptions);
      }
      // Append media attribution hint at the end of the user's message so the model
      // knows both who sent the media and its tool-use ID after reading the utterance.
      if (mediaAttributionHint) {
        processedContent += `\n${mediaAttributionHint}`;
      }
      parts.push({ type: "text", text: processedContent });

      // Append timestamp annotation when context was rebuilt with timestamps enabled
      if (includeTimestamps && msg.createdAt) {
        parts.push({
          type: "text",
          text: formatMessageTimestamp(msg.createdAt),
        });
      }
    } else if (parts.length > 0 || detachedSystemParts.length > 0) {
      // Media-only message (no text content): use the attribution hint as the sole text
      // if available, since it already identifies the sender and exposes the tool-use ID.
      // Fall back to prose form only for non-significant media (e.g., emoji-only attachments)
      // where no media ID hint is generated.
      if (mediaAttributionHint) {
        parts.push({ type: "text", text: mediaAttributionHint });
      } else {
        const mediaAttributionText = buildMediaAttributionText(msg, msg.authorName);
        const resolvedMediaAttributionText = await convertMentions(
          mediaAttributionText,
          client,
          guildId,
          msg.authorName,
          botName,
          tomoriConfig.personal_memories_enabled,
        );
        parts.push({ type: "text", text: resolvedMediaAttributionText });
      }
    }

    // When the message is from a user (not the model), combine all parts into a single
    // turn with media first (Gemini best practice: image before text prompt), followed
    // by remaining system hints, then the attributed text. For model-authored turns,
    // keep system hints as a separate user turn to prevent the model from treating them
    // as its own dialogue.
    if (role === "user" && (parts.length > 0 || detachedSystemParts.length > 0)) {
      const mediaParts = parts.filter((p) => p.type !== "text");
      const textParts = parts.filter((p) => p.type === "text");
      const combinedParts = [...mediaParts, ...detachedSystemParts, ...textParts];
      pushDialogueHistoryContextItem(contextItems, "user", combinedParts, msg.id);
    } else {
      pushDialogueHistoryContextItem(contextItems, "user", detachedSystemParts, msg.id);
      pushDialogueHistoryContextItem(contextItems, role, parts, msg.id);
    }
  }

  // Emit author's note AFTER all messages when depth=0 (targetIndex = totalMessages,
  // so the in-loop guard never fires) or as a safety net if the loop was empty.
  if (!contextNoteEmitted && effectiveContextNote) {
    pushDialogueHistoryContextItem(
      contextItems,
      "user",
      [{ type: "text", text: `[System: ${effectiveContextNote}]` }],
      "context_note_injection",
      ContextItemTag.CONTEXT_NOTE_INJECTION,
    );
    contextNoteEmitted = true;
  }

  // Inject user impersonation system prompt as the LAST message (February 2026)
  if (isUserImpersonation && impersonatedUserId) {
    const nameToUse = impersonatedIdentityName || "User";

    tailDirectives.push(`Imitate ${nameToUse}, start your message with ${nameToUse}:`);
  }

  // Add same-channel memory prompt at the very end (if it exists)
  // Keep this directive out of the hottest recency slot so recent user/assistant
  // turns can sit below it and reduce meta-commentary about following the note.
  if (sameChannelMemoryDirective) {
    lowerPriorityTailDirectives.push(sameChannelMemoryDirective);
  }

  // Capture optional uncensor prompt injection as the final tail directive (if enabled)
  const uncensorInjectionText = buildUncensorInjectionText({
    injectionEnabled: tomoriConfig.uncensor_injection_enabled,
    unicodeSpacesEnabled: tomoriConfig.uncensor_unicode_space_enabled,
  });
  if (uncensorInjectionText) {
    const strippedText = uncensorInjectionText
      .replace(/^\[System:\s*/i, "")
      .replace(/\]\s*$/, "")
      .trim();
    if (strippedText) {
      uncensorDirective = strippedText;
    }
  }

  log.info(`Built ${contextItems.length} structured context items for guild ${guildId}.`);
  return { contextItems, tailDirectives, lowerPriorityTailDirectives, uncensorDirective };
}

/**
 * Fetches a user's current presence and activity information
 * @param client - Discord client for presence lookups
 * @param userId - Discord user ID to fetch presence for
 * @param guildId - Discord guild ID where the user is active
 * @param preloadedMember - Optional preloaded GuildMember to avoid redundant fetches
 * @returns A formatted string describing user's status and activities
 */
async function getUserPresenceDetails(
  client: Client,
  userId: string,
  guildId: string,
  preloadedMember?: import("discord.js").GuildMember | null,
): Promise<string> {
  try {
    // 1. Try to get the guild and member objects
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      log.warn(`Guild ${guildId} not found in cache when fetching presence`);
      return "Status unknown";
    }

    // 2. Use preloaded member if provided, otherwise fetch with presence data
    // Preloaded member is provided for triggerer (no extra cost)
    // For non-triggerer users, this only runs in development (production skips them entirely)
    // Note: Fetching requires GUILD_PRESENCES intent to be enabled
    let member: import("discord.js").GuildMember | null = null;
    if (preloadedMember && preloadedMember.id === userId) {
      member = preloadedMember;
    } else {
      member = await guild.members.fetch({ user: userId, force: true }).catch((error) => {
        log.warn(`Failed to fetch member ${userId}: ${error}`);
        return null;
      });
    }

    if (!member) {
      log.warn(`Member ${userId} not found in guild ${guild.name}`);
      return "Offline or status unknown";
    }

    if (!member.presence) {
      log.warn(`No presence data available for ${member.user.username} (${member.id})`);
      return "Offline or status unknown";
    }

    // 3. Format the base status
    const statusMap: Record<PresenceStatus, string> = {
      online: "Online",
      idle: "Away/Idle",
      dnd: "Do Not Disturb",
      offline: "Offline",
      invisible: "Invisible",
    };

    const status = statusMap[member.presence.status] || "Status unknown";
    let result = status;

    // 4. Format activities if present
    if (member.presence.activities && member.presence.activities.length > 0) {
      const activityDetails = member.presence.activities.map((activity) => {
        // Build activity description based on type
        switch (activity.type) {
          case 0: // Playing
            return `Playing ${activity.name}${activity.details ? ` (${activity.details})` : ""}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
          case 1: // Streaming
            return `Streaming ${activity.name}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
          case 2: // Listening
            if (activity.name === "Spotify" && activity.details && activity.state) {
              return `Listening to ${activity.details} by ${activity.state} on Spotify${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
            }

            if (activity.details && activity.state) {
              return `Listening to ${activity.state} - ${activity.details} on ${activity.name}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
            }
            return `Listening to ${activity.name}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
          case 3: // Watching
            return `Watching ${activity.name}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
          case 4: // Custom Status
            return activity.state || "Custom status";
          case 5: // Competing
            return `Competing in ${activity.name}${getTimeSpent(activity.timestamps?.start, activity.timestamps?.end)}`;
          default:
            return activity.name;
        }
      });

      result += ` - ${activityDetails.join(", ")}`;
      log.info(`Final presence string: "${result}"`);
    } else {
      log.info(`User ${member.user.username} has no activities`);
    }

    return result;
  } catch (error) {
    log.error(`Error getting presence for user ${userId}:`, error);
    return "Status unknown";
  }
}

/**
 * Formats time spent on an activity based on start and end timestamps
 * @param startTimestamp - The activity start timestamp (as Date or number)
 * @param endTimestamp - The activity end timestamp (as Date or number, optional)
 * @returns Formatted string with time duration (e.g., "2 hours, 15 minutes")
 */
function getTimeSpent(startTimestamp?: Date | null | number, endTimestamp?: Date | null | number): string {
  if (!startTimestamp) {
    return "";
  }

  // Convert Date objects to timestamps if needed
  const startTime =
    startTimestamp instanceof Date ? startTimestamp.getTime() : typeof startTimestamp === "number" ? startTimestamp : 0;

  // If no valid start time, return empty string
  if (startTime === 0) {
    return "";
  }

  // If no end timestamp is provided, use current time
  const now = Date.now();
  const endTime =
    endTimestamp instanceof Date ? endTimestamp.getTime() : typeof endTimestamp === "number" ? endTimestamp : now;

  // Calculate time difference in milliseconds
  const timeDiff = endTime - startTime;

  // Convert to hours, minutes, seconds
  const seconds = Math.floor((timeDiff / 1000) % 60);
  const minutes = Math.floor((timeDiff / (1000 * 60)) % 60);
  const hours = Math.floor(timeDiff / (1000 * 60 * 60));

  // Format the time spent string
  let timeSpent = "";

  if (hours > 0) {
    timeSpent += `${hours} hour${hours !== 1 ? "s" : ""}`;
  }

  if (minutes > 0) {
    if (timeSpent) timeSpent += ", ";
    timeSpent += `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  }

  if (seconds > 0 && hours === 0) {
    // Only show seconds if less than an hour
    if (timeSpent) timeSpent += ", ";
    timeSpent += `${seconds} second${seconds !== 1 ? "s" : ""}`;
  }

  return timeSpent ? ` for ${timeSpent}` : "";
}

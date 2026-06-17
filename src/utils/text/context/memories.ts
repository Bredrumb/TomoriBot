import type { Client } from "discord.js";
import { getCachedUserRow } from "@/utils/cache/userCache";
import {
  getRelativeTimestamp,
  getShortTermMemoriesForServer,
  getShortTermMemoriesForUser,
  getShortTermMemoryForServerChannel,
  getShortTermMemoryForUserChannel,
} from "@/utils/cache/shortTermMemoryCache";
import { log } from "@/utils/misc/logger";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { TomoriState } from "@/types/db/schema";
import type { ToolPromptMacroResolver } from "@/utils/tools/toolPromptMacros";
import type { MentionConverter } from "./templates";
import { sql } from "@/utils/db/client";
import { formatMemoryWithId } from "@/utils/memory/memoryId";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { sanitizeUnknownTemplatePlaceholders } from "@/utils/text/processors/mentionProcessor";
import { buildSlugMap } from "@/utils/text/slugifyLabel";

const MIN_MESSAGES_FOR_SUMMARY = Number.parseInt(process.env.SHORT_TERM_MEMORY_MIN_MESSAGES_FOR_SUMMARY || "6", 10);
const MAX_OTHER_CHANNEL_MEMORIES = Number.parseInt(process.env.SHORT_TERM_MEMORY_MAX_OTHER_CHANNELS || "3", 10);

// ── Default seed strings ──────────────────────────────────────────────────────
// Single-summary (fallback) seeds are byte-identical to pre-category behavior.
// Category-mode seeds reference {category_labels}, substituted before sanitization.

const SEED_SUMMARY_UPDATE_HINT =
  "[System: HINT: Use the {short_term_memory_tool} tool to update this information AFTER you respond if the conversation has greatly changed its topic. Do NOT use {short_term_memory_tool} when a user explicitly asks you to remember/save/store something for future conversations; use {memory_tool} or {memory_update_tool} instead.]";

const SEED_SUMMARY_UPDATE_HINT_FALLBACK =
  "[System: HINT: Use the update_short_term_memory tool to update this information AFTER you respond if the conversation has greatly changed its topic. Do NOT use update_short_term_memory when a user explicitly asks you to remember/save/store something for future conversations; use create_long_term_memory or update_long_term_memory instead.]";

const SEED_SUMMARY_CREATE_NUDGE =
  "You currently do not have short term memory saved for this conversation. Use the {short_term_memory_tool} tool to create a short term memory about the current story or conversation's topic AFTER you respond in order to help you cross-reference this in different channels. Do NOT use {short_term_memory_tool} when a user explicitly asks you to remember/save/store something for future conversations; use {memory_tool} or {memory_update_tool} instead. Do NOT mention out loud that you are going to create a short term memory, always use the tool silently.";

const SEED_SUMMARY_CREATE_NUDGE_FALLBACK =
  "You currently do not have short term memory saved for this conversation. Use the update_short_term_memory tool to create a short term memory about the current story or conversation's topic AFTER you respond in order to help you cross-reference this in different channels. Do NOT use update_short_term_memory when a user explicitly asks you to remember/save/store something for future conversations; use create_long_term_memory or update_long_term_memory instead. Do NOT mention out loud that you are going to create a short term memory, always use the tool silently.";

const SEED_CATEGORY_UPDATE_HINT =
  "[System: HINT: Use the {short_term_memory_tool} tool AFTER you respond to update your short-term memory for this conversation. Update any fields that have changed: {category_labels}. Do NOT use {short_term_memory_tool} when a user explicitly asks you to remember/save/store something for future conversations; use {memory_tool} or {memory_update_tool} instead.]";

const SEED_CATEGORY_UPDATE_HINT_FALLBACK =
  "[System: HINT: Use the update_short_term_memory tool AFTER you respond to update your short-term memory for this conversation. Update any fields that have changed: {category_labels}. Do NOT use update_short_term_memory when a user explicitly asks you to remember/save/store something for future conversations; use create_long_term_memory or update_long_term_memory instead.]";

const SEED_CATEGORY_CREATE_NUDGE =
  "You currently do not have short term memory saved for this conversation. Use the {short_term_memory_tool} tool AFTER you respond to fill in your short-term memory fields: {category_labels}. Do NOT use {short_term_memory_tool} when a user explicitly asks you to remember/save/store something for future conversations; use {memory_tool} or {memory_update_tool} instead. Do NOT mention out loud that you are going to create a short term memory, always use the tool silently.";

const SEED_CATEGORY_CREATE_NUDGE_FALLBACK =
  "You currently do not have short term memory saved for this conversation. Use the update_short_term_memory tool AFTER you respond to fill in your short-term memory fields: {category_labels}. Do NOT use update_short_term_memory when a user explicitly asks you to remember/save/store something for future conversations; use create_long_term_memory or update_long_term_memory instead. Do NOT mention out loud that you are going to create a short term memory, always use the tool silently.";

// ─────────────────────────────────────────────────────────────────────────────

function formatDiscordChannelReference(channelId: string | undefined, fallbackText: string): string {
  return channelId ? `<#${channelId}>` : fallbackText;
}

/**
 * Derives a human-readable display label from a slug for other-channel memories
 * where the originating server's category definitions are not loaded.
 * e.g. "my_goals" → "My Goals"
 */
function slugToDisplayLabel(slug: string): string {
  return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Formats a categories map as labeled lines for context injection.
 * When labelMap is provided (same-channel with full category row data), uses the
 * original labels in position order. Without labelMap (other-channel), uses
 * humanized slug names.
 *
 * @param categories - slug → value map from the cache entry
 * @param labelMap - Optional slug → display-label map (position-ordered)
 */
function formatCategoryLines(categories: Record<string, string>, labelMap?: Map<string, string>): string {
  const lines: string[] = [];

  if (labelMap) {
    // Use ordered labels from the server's category definitions
    for (const [slug, label] of labelMap) {
      const value = categories[slug];
      if (value?.trim()) {
        lines.push(`${label}: ${value.trim()}`);
      }
    }
  } else {
    // Humanize slugs for cross-server / other-channel rendering
    for (const [slug, value] of Object.entries(categories)) {
      if (value?.trim()) {
        lines.push(`${slugToDisplayLabel(slug)}: ${value.trim()}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Builds persona-scoped server or DM long-term memory context.
 */
export async function buildServerMemoryContextItem(params: {
  tomoriState: TomoriState | null;
  guildId: string;
  serverName: string;
  isDMChannel: boolean;
  botName: string;
  personalMemoriesEnabled: boolean;
  conversationCorpus: string | null;
  channelName: string;
  channelMemoryEnabled: boolean;
  client: Client;
  convertMentions: MentionConverter;
}): Promise<StructuredContextItem | null> {
  if (
    !params.tomoriState?.server_memories ||
    !Array.isArray(params.tomoriState.server_memories) ||
    params.tomoriState.server_memories.length === 0
  ) {
    return null;
  }

  const memoryLabel = params.isDMChannel
    ? `\n## ${params.botName}'s Memories about this conversation with User\n`
    : `\n## ${params.botName}'s Memories about ${params.serverName}\n`;

  let serverMemoryLines: string[] = [];
  try {
    const serverMemoryRows = await sql<Array<{ server_memory_id: number; content: string; tags: string[] | null }>>`
      SELECT server_memory_id, content, tags
      FROM server_memories
      WHERE server_id = ${params.tomoriState.server_id}
        AND persona_lineage_id = ${params.tomoriState.persona_lineage_id}
      ORDER BY created_at DESC
    `;

    const filteredServerRows = serverMemoryRows.filter((row) => {
      const normalized = (row.tags ?? []).map((t) => t.replace(/^["']+|["']+$/g, ""));
      const channelTags = normalized.filter((t) => t.startsWith("#"));
      const contentTags = normalized.filter((t) => !t.startsWith("#"));

      // Channel tags gate: if present and channel_memory_enabled, channel must match.
      // Channel and content filters are independent — channel match does not exempt a memory
      // from the content/corpus check below (per baetican's intended design).
      if (params.channelMemoryEnabled && channelTags.length > 0) {
        const channelAllowed = channelTags.some((t) => t.slice(1).toLowerCase() === params.channelName.toLowerCase());
        if (!channelAllowed) return false;
      }

      // Content tags: if corpus filtering is active, memories must have a matching content tag
      if (params.conversationCorpus) {
        if (contentTags.length === 0) return false;
        return contentTags.some((tag) => params.conversationCorpus?.includes(tag.toLowerCase()));
      }

      return true;
    });

    serverMemoryLines = filteredServerRows.map((row) =>
      formatMemoryWithId(row.server_memory_id, row.content, row.tags ?? []),
    );
  } catch (error) {
    log.warn("Failed to load server memories with IDs for context", error);
    serverMemoryLines = params.tomoriState.server_memories;
  }

  if (serverMemoryLines.length === 0) {
    return null;
  }

  return {
    role: "system",
    parts: [
      {
        type: "text",
        text: await params.convertMentions(
          `${memoryLabel}${serverMemoryLines.join("\n")}\n`,
          params.client,
          params.guildId,
          "User",
          params.botName,
          params.personalMemoriesEnabled,
        ),
      },
    ],
    metadataTag: ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
  };
}

export async function buildShortTermMemoryContext(params: {
  triggeringUserId: string;
  currentChannelId: string;
  currentServerId: string;
  tomoriState: TomoriState | null;
  triggererName: string;
  botName: string;
  personalMemoriesEnabled: boolean;
  client: Client;
  isUserImpersonation: boolean;
  explicitLongTermMemoryIntent?: boolean;
  toolPromptMacroResolver?: ToolPromptMacroResolver;
  currentParentChannelId?: string | null;
  convertMentions: MentionConverter;
}): Promise<{
  memoryItems: StructuredContextItem[];
  createPromptText?: string;
}> {
  const memoryItems: StructuredContextItem[] = [];
  let createPromptText: string | undefined;

  const expandPromptToolText = (macroText: string, fallbackText: string) =>
    params.toolPromptMacroResolver ? params.toolPromptMacroResolver.expand(macroText) : Promise.resolve(fallbackText);

  try {
    // 1. Load STM config + category definitions for this server
    const numericServerId = params.tomoriState?.server_id ?? null;
    const [stmConfig, stmCategoryRows] = numericServerId
      ? await Promise.all([
          shortTermMemoryRepository.getStmConfig(numericServerId),
          shortTermMemoryRepository.getStmCategories(numericServerId),
        ])
      : [null, []];

    // Resolved config values (fall back to backward-compatible defaults)
    const refreshCadence = stmConfig?.refresh_cadence ?? 1;
    const renderMode = stmConfig?.render_mode ?? "supersede";
    const crudeMessageCount = stmConfig?.crude_message_count ?? MIN_MESSAGES_FOR_SUMMARY;
    const createNudgeOverride = stmConfig?.create_nudge_override ?? null;
    const updateNudgeOverride = stmConfig?.update_nudge_override ?? null;

    // Category mode: any configuration other than the single default "summary" category
    const isCategoryMode = !(stmCategoryRows.length === 1 && stmCategoryRows[0].label.toLowerCase() === "summary");
    const slugMap = isCategoryMode ? buildSlugMap(stmCategoryRows) : null;
    const categoryLabelList = isCategoryMode ? stmCategoryRows.map((r) => r.label).join(", ") : "";

    // 2. Cross-channel / cross-server other-channel memories
    const userRow = await getCachedUserRow(params.triggeringUserId);
    const crossServerOptIn = userRow?.shortterm_cache_crossserver_opt_in ?? false;

    const personaLineageId = params.tomoriState?.persona_lineage_id;
    let otherChannelMemories =
      params.currentServerId === "DM"
        ? getShortTermMemoriesForUser(params.triggeringUserId, params.currentChannelId, personaLineageId).filter(
            (memory) => crossServerOptIn || memory.serverId === params.currentServerId,
          )
        : getShortTermMemoriesForServer(params.currentServerId, params.currentChannelId, personaLineageId);

    if (params.currentServerId !== "DM" && crossServerOptIn) {
      const crossServerUserMemories = getShortTermMemoriesForUser(
        params.triggeringUserId,
        params.currentChannelId,
        personaLineageId,
      ).filter((memory) => memory.serverId !== params.currentServerId);

      otherChannelMemories = [...otherChannelMemories, ...crossServerUserMemories];
    }

    const privateChannelIds = params.tomoriState?.config.private_channel_ids ?? [];
    const stmPrivacyBypass = params.tomoriState?.config.stm_privacy_bypass ?? false;
    const isCurrentChannelPrivate =
      privateChannelIds.includes(params.currentChannelId) ||
      (params.currentParentChannelId != null && privateChannelIds.includes(params.currentParentChannelId));
    if (!stmPrivacyBypass && !isCurrentChannelPrivate && privateChannelIds.length > 0) {
      otherChannelMemories = otherChannelMemories.filter(
        (memory) =>
          !privateChannelIds.includes(memory.channelId) &&
          !(memory.parentChannelId != null && privateChannelIds.includes(memory.parentChannelId)),
      );
    }

    otherChannelMemories.sort((a, b) => b.lastUpdated - a.lastUpdated);

    const limitedMemories = otherChannelMemories.slice(0, MAX_OTHER_CHANNEL_MEMORIES);
    if (limitedMemories.length > 0) {
      let otherChannelText = "";

      for (const memory of limitedMemories) {
        const relativeTime = getRelativeTimestamp(memory.lastUpdated);
        const isSameServerSharedMemory = params.currentServerId !== "DM" && memory.serverId === params.currentServerId;

        const channelReference =
          memory.serverId === params.currentServerId
            ? formatDiscordChannelReference(
                memory.channelId,
                memory.channelName ? `#${memory.channelName}` : "another channel in this server",
              )
            : "a channel in another server";

        // Determine what content to render for this memory entry
        const hasCategories = memory.categories && Object.keys(memory.categories).length > 0;
        const categoryContent = hasCategories ? formatCategoryLines(memory.categories as Record<string, string>) : null;

        const memoryPrefix = isSameServerSharedMemory
          ? params.isUserImpersonation
            ? `[System: Recent conversation in ${channelReference} (${relativeTime}):\n`
            : `[System: ${params.botName} remembers a recent conversation in ${channelReference} (${relativeTime}):\n`
          : params.isUserImpersonation
            ? `[System: Recent conversation with ${params.triggererName} in ${channelReference} (${relativeTime}):\n`
            : `[System: ${params.botName} remembers a recent conversation with ${params.triggererName} in ${channelReference} (${relativeTime}):\n`;

        if (categoryContent) {
          // Category content available — use it as the primary memory representation
          otherChannelText += `${memoryPrefix}${categoryContent}]\n\n`;

          // Mode B (crude_summary): also show recent crude messages additively for other-channel
          if (renderMode === "crude_summary" && memory.messages.length > 0) {
            const crudePrefix = isSameServerSharedMemory
              ? params.isUserImpersonation
                ? `[System: Recent raw messages from ${channelReference}:\n`
                : `[System: ${params.botName}'s recent raw messages from ${channelReference}:\n`
              : params.isUserImpersonation
                ? `[System: Recent raw messages with ${params.triggererName} in ${channelReference}:\n`
                : `[System: ${params.botName}'s recent raw messages with ${params.triggererName} in ${channelReference}:\n`;
            let crudeText = crudePrefix;
            for (const msg of memory.messages) {
              const speaker =
                msg.speakerName ||
                (msg.role === "user" ? (isSameServerSharedMemory ? "Someone" : params.triggererName) : params.botName);
              crudeText += `${speaker}: "${msg.content}"\n`;
            }
            otherChannelText += `${crudeText}]\n\n`;
          }
        } else if (memory.summary) {
          // Single-blob summary (fallback / pre-category entries)
          otherChannelText += `${memoryPrefix}${memory.summary}]\n\n`;

          if (renderMode === "crude_summary" && memory.messages.length > 0) {
            const crudePrefix = isSameServerSharedMemory
              ? params.isUserImpersonation
                ? `[System: Recent raw messages from ${channelReference}:\n`
                : `[System: ${params.botName}'s recent raw messages from ${channelReference}:\n`
              : params.isUserImpersonation
                ? `[System: Recent raw messages with ${params.triggererName} in ${channelReference}:\n`
                : `[System: ${params.botName}'s recent raw messages with ${params.triggererName} in ${channelReference}:\n`;
            let crudeText = crudePrefix;
            for (const msg of memory.messages) {
              const speaker =
                msg.speakerName ||
                (msg.role === "user" ? (isSameServerSharedMemory ? "Someone" : params.triggererName) : params.botName);
              crudeText += `${speaker}: "${msg.content}"\n`;
            }
            otherChannelText += `${crudeText}]\n\n`;
          }
        } else {
          // No summary or categories — fall back to crude turn listing
          otherChannelText += memoryPrefix;
          for (const msg of memory.messages) {
            const speaker =
              msg.speakerName ||
              (msg.role === "user" ? (isSameServerSharedMemory ? "Someone" : params.triggererName) : params.botName);
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
              text: await params.convertMentions(
                otherChannelText.trim(),
                params.client,
                params.currentServerId,
                params.triggererName,
                params.botName,
                params.personalMemoriesEnabled,
              ),
            },
          ],
          metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
        });
      }
    }

    // 3. Same-channel memory (live injected scope)
    if (params.tomoriState?.llm?.has_tools) {
      const isStmToolAvailable =
        params.tomoriState.llm.llm_provider !== "novelai" && !params.explicitLongTermMemoryIntent;

      const sameChannelMemory =
        params.currentServerId === "DM"
          ? getShortTermMemoryForUserChannel(
              params.triggeringUserId,
              params.currentChannelId,
              params.tomoriState?.persona_id,
            )
          : getShortTermMemoryForServerChannel(
              params.currentServerId,
              params.currentChannelId,
              params.tomoriState?.persona_id,
            );

      // Determine cadence: default undefined → treat as ready to nudge (preserves today's behavior)
      const turnsSinceRefresh = sameChannelMemory?.turnsSinceRefresh ?? refreshCadence;
      const isNudgeDue = turnsSinceRefresh >= refreshCadence;

      // Determine what content is in the same-channel memory
      const sameChannelCategories =
        sameChannelMemory?.categories && Object.keys(sameChannelMemory.categories).length > 0
          ? (sameChannelMemory.categories as Record<string, string>)
          : null;
      const hasMemoryContent = sameChannelCategories !== null || Boolean(sameChannelMemory?.summary);

      if (hasMemoryContent) {
        // 3a. Render the same-channel memory block
        let memoryBodyText: string;
        if (sameChannelCategories && slugMap) {
          // Category mode: render labeled sections using the server's ordered category rows
          memoryBodyText = formatCategoryLines(sameChannelCategories, slugMap);
        } else if (sameChannelCategories) {
          // Categories present but no slug map (shouldn't happen in normal flow)
          memoryBodyText = formatCategoryLines(sameChannelCategories);
        } else {
          // Single-blob summary (fallback / pre-category)
          memoryBodyText = sameChannelMemory?.summary ?? "";
        }

        const summaryText = params.isUserImpersonation
          ? `[System: Short term memory for this ongoing conversation:\n${memoryBodyText}]`
          : `[System: ${params.botName}'s short term memory for this ongoing conversation:\n${memoryBodyText}]`;

        memoryItems.push({
          role: "user",
          parts: [
            {
              type: "text",
              text: await params.convertMentions(
                summaryText,
                params.client,
                params.currentServerId,
                params.triggererName,
                params.botName,
                params.personalMemoriesEnabled,
              ),
            },
          ],
          metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
        });

        // 3b. Update-nudge (cadence-gated)
        if (isStmToolAvailable && isNudgeDue) {
          let rawHintText: string;
          let rawHintFallback: string;

          if (isCategoryMode) {
            rawHintText = (updateNudgeOverride ?? SEED_CATEGORY_UPDATE_HINT).replace(
              "{category_labels}",
              categoryLabelList,
            );
            rawHintFallback = (updateNudgeOverride ?? SEED_CATEGORY_UPDATE_HINT_FALLBACK).replace(
              "{category_labels}",
              categoryLabelList,
            );
          } else {
            rawHintText = updateNudgeOverride ?? SEED_SUMMARY_UPDATE_HINT;
            rawHintFallback = updateNudgeOverride ?? SEED_SUMMARY_UPDATE_HINT_FALLBACK;
          }

          const hintText = sanitizeUnknownTemplatePlaceholders(
            await expandPromptToolText(rawHintText, rawHintFallback),
          );

          memoryItems.push({
            role: "user",
            parts: [
              {
                type: "text",
                text: await params.convertMentions(
                  hintText,
                  params.client,
                  params.currentServerId,
                  params.triggererName,
                  params.botName,
                  params.personalMemoriesEnabled,
                ),
              },
            ],
            metadataTag: ContextItemTag.KNOWLEDGE_SHORT_TERM_MEMORY,
          });
        }
      } else if (isStmToolAvailable && sameChannelMemory && sameChannelMemory.messages.length >= crudeMessageCount) {
        // 3c. Create-nudge: no STM yet but enough crude turns have accumulated
        let rawCreateText: string;
        let rawCreateFallback: string;

        if (isCategoryMode) {
          rawCreateText = (createNudgeOverride ?? SEED_CATEGORY_CREATE_NUDGE).replace(
            "{category_labels}",
            categoryLabelList,
          );
          rawCreateFallback = (createNudgeOverride ?? SEED_CATEGORY_CREATE_NUDGE_FALLBACK).replace(
            "{category_labels}",
            categoryLabelList,
          );
        } else {
          rawCreateText = createNudgeOverride ?? SEED_SUMMARY_CREATE_NUDGE;
          rawCreateFallback = createNudgeOverride ?? SEED_SUMMARY_CREATE_NUDGE_FALLBACK;
        }

        const createText = sanitizeUnknownTemplatePlaceholders(
          await expandPromptToolText(rawCreateText, rawCreateFallback),
        );

        createPromptText = await params.convertMentions(
          createText,
          params.client,
          params.currentServerId,
          params.triggererName,
          params.botName,
          params.personalMemoriesEnabled,
        );
      }
    }

    return { memoryItems, createPromptText };
  } catch (error) {
    await log.error(
      `[buildShortTermMemoryContext] Failed to build short-term memory context - triggeringUserId=${params.triggeringUserId}, currentChannelId=${params.currentChannelId}`,
      error,
      {
        errorType: "SHORT_TERM_MEMORY_CONTEXT_ERROR",
        metadata: { userDiscId: params.triggeringUserId, currentChannelId: params.currentChannelId },
      },
    );
    return { memoryItems: [], createPromptText: undefined };
  }
}

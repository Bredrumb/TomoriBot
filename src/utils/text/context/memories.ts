import type { MemoryRecallCollector } from "@/utils/text/context/memoryRecall";
import type { Client } from "discord.js";
import { getCachedUserRow } from "@/utils/cache/userCache";
import {
  getRelativeTimestamp,
  getShortTermMemoriesForServer,
  getShortTermMemoriesForUser,
  getShortTermMemoryForServerChannel,
  getShortTermMemoryForUserChannel,
  preWarmServerStmEntries,
  preWarmStmEntry,
  preWarmUserStmEntries,
  type ShortTermMemoryEntry,
} from "@/utils/cache/shortTermMemoryCache";
import { log } from "@/utils/misc/logger";
import { ContextItemTag, type ContextMemoryEntry, type StructuredContextItem } from "@/types/misc/context";
import type { TomoriState } from "@/types/db/schema";
import type { ToolPromptMacroResolver } from "@/utils/tools/toolPromptMacros";
import type { MentionConverter } from "./templates";
import { serverMemoryRepository } from "@/utils/db/repositories";
import { formatMemoryWithId } from "@/utils/memory/memoryId";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { sanitizeUnknownTemplatePlaceholders } from "@/utils/text/processors/mentionProcessor";
import { buildSlugMap } from "@/utils/text/slugifyLabel";
import { channelScopeAdmits, channelScopeCandidates } from "@/utils/discord/channelScope";
import { STM_TAIL_SLOT, type PromptLayoutItem } from "@/utils/text/context/promptLayout";

// Default render depth for crude messages (Mode B additive blocks + no-summary
// fallback listing). Also the fallback when a server has no crude_message_count set.
const DEFAULT_CRUDE_MESSAGE_COUNT = 6;
const MAX_OTHER_CHANNEL_MEMORIES = 3;

// Each chat turn's crude write refreshes lastUpdated, so an hour distinguishes active same-channel memory from ambient recall.
const STM_FRESH_WINDOW_MS = 60 * 60 * 1000;

// The single unified nudge (migration 052) covers BOTH cases: "no STM yet, please
// create one" and "STM exists, please refresh it": with one cadence-gated prompt.
// Category-mode seeds reference {category_labels}, substituted before sanitization.
// `_FALLBACK` variants are byte-stable literals used when no macro resolver is wired.

export const SEED_SUMMARY_UPDATE_HINT =
  "[System: Use the {short_term_memory_tool} tool AFTER you respond to create or update your short-term memory for this conversation.{{if tool:create_long_term_memory}} Do NOT use {short_term_memory_tool} when a user explicitly asks you to remember/save/store something for future conversations; use {memory_tool}{{if tool:update_long_term_memory}} or {memory_update_tool}{{/if}} instead.{{/if}}]";

const SEED_SUMMARY_UPDATE_HINT_FALLBACK =
  "[System: Use the update_short_term_memory tool AFTER you respond to create or update your short-term memory for this conversation. Do NOT use update_short_term_memory when a user explicitly asks you to remember/save/store something for future conversations; use create_long_term_memory or update_long_term_memory instead.]";

export const SEED_CATEGORY_UPDATE_HINT =
  "[System: Use the {short_term_memory_tool} tool AFTER you respond to create or update your short-term memory fields: {category_labels}.{{if tool:create_long_term_memory}} Do NOT use {short_term_memory_tool} when a user explicitly asks you to remember/save/store something for future conversations; use {memory_tool}{{if tool:update_long_term_memory}} or {memory_update_tool}{{/if}} instead.{{/if}}]";

const SEED_CATEGORY_UPDATE_HINT_FALLBACK =
  "[System: Use the update_short_term_memory tool AFTER you respond to create or update your short-term memory fields: {category_labels}. Do NOT use update_short_term_memory when a user explicitly asks you to remember/save/store something for future conversations; use create_long_term_memory or update_long_term_memory instead.]";

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
 * Renders the most recent crude turns of one other-channel memory entry.
 *
 * The speaker falls back through the stored name, then the triggerer for user turns and the bot for
 * model turns, so a turn whose author was never recorded still renders with someone recognizable.
 *
 * @param messages - Turns held by the cache entry
 * @param depth - Configured number of most recent turns to keep
 * @param isSameServerSharedMemory - Whether the entry belongs to the current server
 * @returns The turn lines, each terminated by a newline
 */
function renderCrudeTurns(
  messages: ShortTermMemoryEntry["messages"],
  depth: number,
  isSameServerSharedMemory: boolean,
  params: { triggererName: string; botName: string },
): string {
  let crudeText = "";
  // Cap the rendered crude turns to the configured depth (most recent N).
  for (const msg of messages.slice(-depth)) {
    const speaker =
      msg.speakerName ||
      (msg.role === "user" ? (isSameServerSharedMemory ? "Someone" : params.triggererName) : params.botName);
    crudeText += `${speaker}: "${msg.content}"\n`;
  }
  return crudeText;
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
  channelId: string;
  parentChannelId?: string | null;
  channelMemoryEnabled: boolean;
  client: Client;
  convertMentions: MentionConverter;
  memoryRecall?: MemoryRecallCollector;
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
  let memoryEntries: ContextMemoryEntry[] = [];
  try {
    // Without a resolved server id + persona lineage there is nothing to scope
    // to treat it as "no memories" (the previous raw query interpolated NULL,
    // matching none).
    const serverId = params.tomoriState.server_id;
    const personaLineageId = params.tomoriState.persona_lineage_id;
    const serverMemoryRows =
      serverId === undefined || personaLineageId === undefined
        ? []
        : await serverMemoryRepository.loadServerMemoriesScoped(serverId, personaLineageId);

    const channelCandidates = channelScopeCandidates(params.channelId, params.parentChannelId);
    const filteredServerRows = serverMemoryRows.filter(
      (row) => !params.channelMemoryEnabled || channelScopeAdmits(row.channel_disc_ids, channelCandidates),
    );

    const admitted = await Promise.all(
      filteredServerRows.map(
        async (row) =>
          !params.memoryRecall ||
          (await params.memoryRecall.include({
            kind: "server",
            id: row.server_memory_id as number,
            decayDays: row.decay_days,
            line: await params.convertMentions(
              formatMemoryWithId(row.server_memory_id as number, row.content),
              params.client,
              params.guildId,
              "User",
              params.botName,
              params.personalMemoriesEnabled,
            ),
          })),
      ),
    );
    const activeRows = filteredServerRows.filter((_row, index) => admitted[index]);

    memoryEntries = activeRows.map((row) => ({
      id: `server:${row.server_memory_id}`,
      text: row.content,
      createdAt: row.created_at?.getTime(),
    }));
    serverMemoryLines = activeRows.map((row) =>
      // biome-ignore lint/style/noNonNullAssertion: a loaded server-memory row always carries its PK.
      formatMemoryWithId(row.server_memory_id!, row.content),
    );
  } catch (error) {
    log.warn("Failed to build server memory context", error);
    return null;
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
    memoryEntries: await Promise.all(
      memoryEntries.map(async (entry) => ({
        ...entry,
        text: await params.convertMentions(
          entry.text,
          params.client,
          params.guildId,
          "User",
          params.botName,
          params.personalMemoriesEnabled,
        ),
      })),
    ),
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
  nudgeItem?: StructuredContextItem;
  nudgeInjectionDepth: number;
  /** Saved dialogue-item depth, with -1 anchoring stale same-channel memory at the top and STM_TAIL_SLOT marking fresh content for downstream position comparison. */
  memoryInjectionDepth: number;
}> {
  const memoryItems: PromptLayoutItem[] = [];
  let nudgeItem: StructuredContextItem | undefined;

  const expandPromptToolText = (macroText: string, fallbackText: string) =>
    params.toolPromptMacroResolver ? params.toolPromptMacroResolver.expand(macroText) : Promise.resolve(fallbackText);

  try {
    const numericServerId = params.tomoriState?.server_id ?? null;
    const [stmConfig, stmCategoryRows] = numericServerId
      ? await Promise.all([
          shortTermMemoryRepository.getStmConfig(numericServerId),
          shortTermMemoryRepository.getStmCategories(numericServerId),
        ])
      : [null, []];

    // Resolved config values (fall back to sensible defaults)
    const refreshCadence = stmConfig?.refresh_cadence ?? 5;
    // Most servers have no server_stm_configs row at all (it is not seeded at setup),
    // so this fallback, not the column default, decides the render mode for them.
    const renderMode = stmConfig?.render_mode ?? "crude_summary";
    const crudeMessageCount = stmConfig?.crude_message_count ?? DEFAULT_CRUDE_MESSAGE_COUNT;
    const updateNudgeOverride = stmConfig?.update_nudge_override ?? null;
    // Spacers and directives remain in saved depth counts because changing the unit would reinterpret existing server settings.
    const nudgeInjectionDepth = stmConfig?.nudge_injection_depth ?? 2;
    const configuredMemoryInjectionDepth = stmConfig?.content_injection_depth ?? -1;
    let isStmFresh = false;

    // Category mode: any configuration other than the single default "summary" category.
    // An empty list (no rows resolved, e.g. no server) is NOT category mode: it must
    // collapse to the backward-compatible summary path, not render empty labeled sections.
    const isCategoryMode =
      stmCategoryRows.length > 0 &&
      !(stmCategoryRows.length === 1 && stmCategoryRows[0].label.toLowerCase() === "summary");
    const slugMap = isCategoryMode ? buildSlugMap(stmCategoryRows) : null;
    const categoryLabelList = isCategoryMode ? stmCategoryRows.map((r) => r.label).join(", ") : "";
    const userRow = await getCachedUserRow(params.triggeringUserId);
    const crossServerOptIn = userRow?.shortterm_cache_crossserver_opt_in ?? false;

    // Bulk-warm cross-channel STM from the DB BEFORE the synchronous reads below, so
    // other-channel recall is available on the FIRST turn after a restart (cold cache)
    // rather than the second. The same-channel pre-warm (section 3) only covers the
    // current channel; cross-channel recall needs every channel's persisted row. Awaited
    // and one-shot per scope per process, so it costs a single query once after a restart.
    if (params.currentServerId === "DM") {
      await preWarmUserStmEntries(params.triggeringUserId);
    } else {
      await preWarmServerStmEntries(params.currentServerId);
      if (crossServerOptIn) {
        await preWarmUserStmEntries(params.triggeringUserId);
      }
    }

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

    // Entries warmed from the DB carry no messages, so a row with a cleared summary has nothing to recall.
    otherChannelMemories = otherChannelMemories.filter(
      (memory) =>
        Boolean(memory.summary) ||
        memory.messages.length > 0 ||
        (memory.categories !== undefined && formatCategoryLines(memory.categories) !== ""),
    );
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
        const crudeTurnPrefix = isSameServerSharedMemory
          ? params.isUserImpersonation
            ? `[System: Recent raw messages from ${channelReference}:\n`
            : `[System: ${params.botName}'s recent raw messages from ${channelReference}:\n`
          : params.isUserImpersonation
            ? `[System: Recent raw messages with ${params.triggererName} in ${channelReference}:\n`
            : `[System: ${params.botName}'s recent raw messages with ${params.triggererName} in ${channelReference}:\n`;

        if (categoryContent) {
          // Category content available: use it as the primary memory representation
          otherChannelText += `${memoryPrefix}${categoryContent}]\n\n`;

          // Mode B (crude_summary): also show recent crude messages additively for other-channel
          if (renderMode === "crude_summary" && memory.messages.length > 0) {
            otherChannelText += `${crudeTurnPrefix}${renderCrudeTurns(
              memory.messages,
              crudeMessageCount,
              isSameServerSharedMemory,
              params,
            )}]\n\n`;
          }
        } else if (memory.summary) {
          // Single-blob summary (fallback / pre-category entries)
          otherChannelText += `${memoryPrefix}${memory.summary}]\n\n`;

          if (renderMode === "crude_summary" && memory.messages.length > 0) {
            otherChannelText += `${crudeTurnPrefix}${renderCrudeTurns(
              memory.messages,
              crudeMessageCount,
              isSameServerSharedMemory,
              params,
            )}]\n\n`;
          }
        } else {
          // No summary or categories: fall back to crude turn listing (capped to depth).
          otherChannelText += `${memoryPrefix}${renderCrudeTurns(
            memory.messages,
            crudeMessageCount,
            isSameServerSharedMemory,
            params,
          )}]\n\n`;
        }
      }

      if (otherChannelText) {
        isStmFresh = true;
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
    if (params.tomoriState?.llm?.has_tools) {
      // The cadence nudge prompts the bot to CALL the STM write tool, so it must track
      // the same conditions that decide whether the tool is offered (see
      // updateShortTermMemoryTool.isAvailableForContext). When the per-server master
      // switch (migration 054) is off, the tool is suppressed: so we suppress the nudge
      // too. Crucially this only gates the nudge: the memory content blocks above and
      // below still render, so manually-curated STM (`/persona stm edit`) and crude
      // messages keep surfacing even with STM "off".
      const isStmToolAvailable =
        params.tomoriState.llm.llm_provider !== "novelai" &&
        !params.explicitLongTermMemoryIntent &&
        params.tomoriState.config?.short_term_memory_enabled !== false;

      // Ensure the cache is warm before the synchronous read below.
      // On the first turn after a bot restart the in-memory cache is cold; without
      // this await the sync getter would return undefined and miss the persisted
      // summary/categories for the entire turn.
      await (params.currentServerId === "DM"
        ? preWarmStmEntry("user", params.triggeringUserId, params.currentChannelId, params.tomoriState?.persona_id)
        : preWarmStmEntry("server", params.currentServerId, params.currentChannelId, params.tomoriState?.persona_id));

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

      // Unified cadence counter (migration 052). A channel with no prior STM starts
      // at 0 and increments once per bot-participation turn, so the nudge first fires
      // after exactly `refreshCadence` turns: for BOTH the create case (no STM yet)
      // and each subsequent update case (existing STM refresh).
      const turnsSinceRefresh = sameChannelMemory?.turnsSinceRefresh ?? 0;
      const isNudgeDue = turnsSinceRefresh >= refreshCadence;

      const stmAgeMs = sameChannelMemory ? Date.now() - sameChannelMemory.lastUpdated : Number.POSITIVE_INFINITY;
      isStmFresh ||= stmAgeMs <= STM_FRESH_WINDOW_MS;

      // Determine what content is in the same-channel memory
      const sameChannelCategories =
        sameChannelMemory?.categories && Object.keys(sameChannelMemory.categories).length > 0
          ? (sameChannelMemory.categories as Record<string, string>)
          : null;
      const hasMemoryContent = sameChannelCategories !== null || Boolean(sameChannelMemory?.summary);

      if (hasMemoryContent) {
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
          requiresToolCalling: true,
        });
      }

      // The nudge is NOT pushed into memoryItems; it is returned separately so the caller can
      // inject it at the configured dialogue depth (highest-signal tail position by default).
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

        const hintText = sanitizeUnknownTemplatePlaceholders(await expandPromptToolText(rawHintText, rawHintFallback));

        nudgeItem = {
          role: "user",
          completionText: "",
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
          requiresToolCalling: true,
        };
      }
    }

    // Other-channel content changes independently of this channel, so it uses the tail slot even when same-channel memory is stale.
    if (isStmFresh) {
      for (const item of memoryItems) item[STM_TAIL_SLOT] = true;
    }

    return { memoryItems, nudgeItem, nudgeInjectionDepth, memoryInjectionDepth: configuredMemoryInjectionDepth };
  } catch (error) {
    await log.error(
      `[buildShortTermMemoryContext] Failed to build short-term memory context - triggeringUserId=${params.triggeringUserId}, currentChannelId=${params.currentChannelId}`,
      error,
      {
        errorType: "SHORT_TERM_MEMORY_CONTEXT_ERROR",
        metadata: { userDiscId: params.triggeringUserId, currentChannelId: params.currentChannelId },
      },
    );
    return { memoryItems: [], nudgeInjectionDepth: 0, memoryInjectionDepth: -1 };
  }
}

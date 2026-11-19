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
import { getChannelPrivacyReason } from "@/utils/discord/channelPrivacy";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";

const DEFAULT_CRUDE_MESSAGE_COUNT = 6;
const MAX_OTHER_CHANNEL_MEMORIES = 3;

// Each chat turn's crude write refreshes lastUpdated, so an hour distinguishes active same-channel memory from ambient recall.
const STM_FRESH_WINDOW_MS = 60 * 60 * 1000;

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

function slugToDisplayLabel(slug: string): string {
  return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCategoryLines(categories: Record<string, string>, labelMap?: Map<string, string>): string {
  const lines: string[] = [];

  if (labelMap) {
    for (const [slug, label] of labelMap) {
      const value = categories[slug];
      if (value?.trim()) {
        lines.push(`${label}: ${value.trim()}`);
      }
    }
  } else {
    for (const [slug, value] of Object.entries(categories)) {
      if (value?.trim()) {
        lines.push(`${slugToDisplayLabel(slug)}: ${value.trim()}`);
      }
    }
  }

  return lines.join("\n");
}

function renderCrudeTurns(
  messages: ShortTermMemoryEntry["messages"],
  depth: number,
  isSameServerSharedMemory: boolean,
  params: { triggererName: string; botName: string },
): string {
  let crudeText = "";
  for (const msg of messages.slice(-depth)) {
    const speaker =
      msg.speakerName ||
      (msg.role === "user" ? (isSameServerSharedMemory ? "Someone" : params.triggererName) : params.botName);
    crudeText += `${speaker}: "${msg.content}"\n`;
  }
  return crudeText;
}

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
  convertMentions: MentionConverter;
}): Promise<{
  memoryItems: StructuredContextItem[];
  nudgeItem?: StructuredContextItem;
  nudgeInjectionDepth: number;
  // Sentinel depths: -1 anchors stale same-channel memory at the top, and STM_TAIL_SLOT marks fresh content so
  // downstream builders can compare positions.
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

    // Empty category rows collapse to summary mode so unconfigured scopes never render empty labeled sections.
    const isCategoryMode =
      stmCategoryRows.length > 0 &&
      !(stmCategoryRows.length === 1 && stmCategoryRows[0].label.toLowerCase() === "summary");
    const slugMap = isCategoryMode ? buildSlugMap(stmCategoryRows) : null;
    const categoryLabelList = isCategoryMode ? stmCategoryRows.map((r) => r.label).join(", ") : "";
    const userRow = await getCachedUserRow(params.triggeringUserId);
    const crossServerOptIn = userRow?.shortterm_cache_crossserver_opt_in ?? false;

    // Pre-warm every channel before the sync reads below so cross-channel recall works on the first post-restart turn.
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

    // Entries warmed from the DB carry no messages, so a row with a cleared summary has nothing to recall.
    otherChannelMemories = otherChannelMemories.filter(
      (memory) =>
        Boolean(memory.summary) ||
        memory.messages.length > 0 ||
        (memory.categories !== undefined && formatCategoryLines(memory.categories) !== ""),
    );
    otherChannelMemories.sort((a, b) => b.lastUpdated - a.lastUpdated);

    const channelIsPrivate = async (serverId: string, channelId: string, privateIds: readonly string[]) => {
      if (privateIds.includes(channelId)) return true;
      try {
        const channel = params.client.channels.cache.get(channelId) ?? (await params.client.channels.fetch(channelId));
        if (!channel || !("guildId" in channel) || channel.guildId !== serverId) return true;
        return getChannelPrivacyReason(channel, privateIds) !== null;
      } catch (error) {
        log.warn("Could not resolve STM channel privacy", { serverId, channelId, error });
        return true;
      }
    };
    const currentConfig = params.tomoriState?.config;
    const destinationBlocksRecall =
      params.currentServerId !== "DM" &&
      !currentConfig?.stm_privacy_bypass &&
      otherChannelMemories.length > 0 &&
      (await channelIsPrivate(
        params.currentServerId,
        params.currentChannelId,
        currentConfig?.private_channel_ids ?? [],
      ));
    const limitedMemories: ShortTermMemoryEntry[] = [];
    const sourceStates = new Map<string, TomoriState | null>();
    if (!destinationBlocksRecall) {
      for (const memory of otherChannelMemories) {
        if (memory.serverId !== "DM") {
          if (memory.serverId !== params.currentServerId && !sourceStates.has(memory.serverId)) {
            sourceStates.set(memory.serverId, await getCachedTomoriState(memory.serverId));
          }
          const sourceState =
            memory.serverId === params.currentServerId ? params.tomoriState : sourceStates.get(memory.serverId);
          if (!sourceState) continue;
          if (
            !sourceState.config.stm_privacy_bypass &&
            (await channelIsPrivate(memory.serverId, memory.channelId, sourceState.config.private_channel_ids ?? []))
          ) {
            continue;
          }
        }
        limitedMemories.push(memory);
        if (limitedMemories.length === MAX_OTHER_CHANNEL_MEMORIES) break;
      }
    }
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
          otherChannelText += `${memoryPrefix}${categoryContent}]\n\n`;

          if (renderMode === "crude_summary" && memory.messages.length > 0) {
            otherChannelText += `${crudeTurnPrefix}${renderCrudeTurns(
              memory.messages,
              crudeMessageCount,
              isSameServerSharedMemory,
              params,
            )}]\n\n`;
          }
        } else if (memory.summary) {
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
      // Gate only the nudge on updateShortTermMemoryTool availability so manual STM content still surfaces when
      // disabled.
      const isStmToolAvailable =
        params.tomoriState.llm.llm_provider !== "novelai" &&
        !params.explicitLongTermMemoryIntent &&
        params.tomoriState.config?.short_term_memory_enabled !== false;

      // Pre-warm the single-channel cache before the sync getter below so post-restart turns see persisted STM.
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

      const turnsSinceRefresh = sameChannelMemory?.turnsSinceRefresh ?? 0;
      const isNudgeDue = turnsSinceRefresh >= refreshCadence;

      const stmAgeMs = sameChannelMemory ? Date.now() - sameChannelMemory.lastUpdated : Number.POSITIVE_INFINITY;
      isStmFresh ||= stmAgeMs <= STM_FRESH_WINDOW_MS;

      const sameChannelCategories =
        sameChannelMemory?.categories && Object.keys(sameChannelMemory.categories).length > 0
          ? (sameChannelMemory.categories as Record<string, string>)
          : null;
      const hasMemoryContent = sameChannelCategories !== null || Boolean(sameChannelMemory?.summary);

      if (hasMemoryContent) {
        let memoryBodyText: string;
        if (sameChannelCategories && slugMap) {
          memoryBodyText = formatCategoryLines(sameChannelCategories, slugMap);
        } else if (sameChannelCategories) {
          memoryBodyText = formatCategoryLines(sameChannelCategories);
        } else {
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

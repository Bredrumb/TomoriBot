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

const MIN_MESSAGES_FOR_SUMMARY = Number.parseInt(process.env.SHORT_TERM_MEMORY_MIN_MESSAGES_FOR_SUMMARY || "6", 10);
const MAX_OTHER_CHANNEL_MEMORIES = Number.parseInt(process.env.SHORT_TERM_MEMORY_MAX_OTHER_CHANNELS || "3", 10);

function formatDiscordChannelReference(channelId: string | undefined, fallbackText: string): string {
  return channelId ? `<#${channelId}>` : fallbackText;
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

      // Channel tags gate first: if present and channel_memory_enabled, channel must match
      if (params.channelMemoryEnabled && channelTags.length > 0) {
        const channelAllowed = channelTags.some((t) => t.slice(1).toLowerCase() === params.channelName.toLowerCase());
        if (!channelAllowed) return false;
        // Channel matched with no content tags — sufficient to include without corpus check
        if (contentTags.length === 0) return true;
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

        if (memory.summary) {
          const memoryPrefix = isSameServerSharedMemory
            ? params.isUserImpersonation
              ? `[System: Recent conversation in ${channelReference} (${relativeTime}):\n${memory.summary}]\n\n`
              : `[System: ${params.botName} remembers a recent conversation in ${channelReference} (${relativeTime}):\n${memory.summary}]\n\n`
            : params.isUserImpersonation
              ? `[System: Recent conversation with ${params.triggererName} in ${channelReference} (${relativeTime}):\n${memory.summary}]\n\n`
              : `[System: ${params.botName} remembers a recent conversation with ${params.triggererName} in ${channelReference} (${relativeTime}):\n${memory.summary}]\n\n`;
          otherChannelText += memoryPrefix;
        } else {
          const memoryPrefix = isSameServerSharedMemory
            ? params.isUserImpersonation
              ? `[System: Recent conversation in ${channelReference} (${relativeTime}):\n`
              : `[System: ${params.botName} remembers a recent conversation in ${channelReference} (${relativeTime}):\n`
            : params.isUserImpersonation
              ? `[System: Recent conversation with ${params.triggererName} in ${channelReference} (${relativeTime}):\n`
              : `[System: ${params.botName} remembers a recent conversation with ${params.triggererName} in ${channelReference} (${relativeTime}):\n`;
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

      if (sameChannelMemory?.summary) {
        const summaryText = params.isUserImpersonation
          ? `[System: Short term memory for this ongoing conversation:\n${sameChannelMemory.summary}]`
          : `[System: ${params.botName}'s short term memory for this ongoing conversation:\n${sameChannelMemory.summary}]`;

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
      } else if (
        isStmToolAvailable &&
        sameChannelMemory &&
        sameChannelMemory.messages.length >= MIN_MESSAGES_FOR_SUMMARY
      ) {
        const createText = await expandPromptToolText(
          "You currently do not have short term memory saved for this conversation. Use the {short_term_memory_tool} tool to create a short term memory about the current story or conversation's topic AFTER you respond in order to help you cross-reference this in different channels. Do NOT use {short_term_memory_tool} when a user explicitly asks you to remember/save/store something for future conversations; use {memory_tool} or {memory_update_tool} instead. Do NOT mention out loud that you are going to create a short term memory, always use the tool silently.",
          "You currently do not have short term memory saved for this conversation. Use the update_short_term_memory tool to create a short term memory about the current story or conversation's topic AFTER you respond in order to help you cross-reference this in different channels. Do NOT use update_short_term_memory when a user explicitly asks you to remember/save/store something for future conversations; use create_long_term_memory or update_long_term_memory instead. Do NOT mention out loud that you are going to create a short term memory, always use the tool silently.",
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

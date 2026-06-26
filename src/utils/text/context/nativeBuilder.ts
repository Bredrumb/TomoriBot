import { personaRepository } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { hasExplicitLongTermMemoryIntent } from "@/utils/memory/explicitLongTermMemoryIntent";
import { buildUncensorInjectionText } from "@/utils/text/uncensor";
import { createToolPromptMacroResolver } from "@/utils/tools/toolPromptMacros";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { appendDialogueHistoryContext } from "./dialogueHistory";
import { convertMentions } from "./mentionNormalizer";
import { buildServerMemoryContextItem, buildShortTermMemoryContext } from "./memories";
import { buildUsersInConversationContextItem } from "./participants";
import { buildPersonaUserBlocksContextItem } from "./personaUserBlocks";
import { buildPersonaSpriteContextItem } from "./personaSprites";
import { buildServerDocumentContextItem } from "./rag";
import { buildServerEmojiContextItem, buildServerStickerContextItem } from "./serverAssets";
import { buildServerInfoContextItem } from "./serverInfo";
import { buildConditioningContextItem, buildPromptContextItems, buildSampleDialogueContextItems } from "./templates";
import { buildVerbatimToolDefinitionsContextItem } from "./toolDefinitions";
import type { BuildContextParams } from "./types";

export type NativeBuildContextResult = {
  contextItems: StructuredContextItem[];
  tailDirectives: string[];
  lowerPriorityTailDirectives: string[];
  uncensorDirective?: string;
};

/**
 * Native fixed-order context assembly used directly, or as the input to preset reassembly.
 */
export async function buildContextNative(params: BuildContextParams): Promise<NativeBuildContextResult> {
  const {
    guildId,
    serverName,
    serverDescription,
    simplifiedMessageHistory,
    userList,
    channelName,
    channelId,
    parentChannelId,
    client,
    triggererName,
    tomoriNickname,
    tomoriAttributes,
    publicPersonaAttributes,
    tomoriConfig,
    channelPromptOverride,
    channelContextNote,
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
    personaUserBlocks,
    includeTimestamps = false,
    explicitLongTermMemoryIntent: explicitLongTermMemoryIntentOverride,
    suppressDefaultSystemPrompt = false,
    messageIdMap,
  } = params;

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
  const tomoriState = snapshot?.tomoriState ?? (await personaRepository.loadState(guildId));
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
              voice_message_enabled: tomoriConfig.voice_message_enabled,
              user_blocking_enabled: tomoriConfig.user_blocking_enabled,
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

  contextItems.push(
    ...(await buildPromptContextItems({
      client,
      guildId,
      botName,
      tomoriAttributes,
      publicPersonaAttributes,
      tomoriConfig,
      channelPromptOverride,
      personaPrompt,
      isUserImpersonation,
      impersonatedIdentityName,
      impersonatedUserPrompt,
      suppressDefaultSystemPrompt,
      snapshot,
      toolPromptMacroResolver,
      convertMentions,
    })),
  );
  contextItems.push(
    await buildServerInfoContextItem({
      client,
      guildId,
      serverName,
      serverDescription,
      isDMChannel,
      isUserImpersonation,
      impersonatedIdentityName,
      botName,
      tomoriConfig,
      snapshot,
      convertMentions,
    }),
  );
  await appendOptionalItem(
    contextItems,
    buildPersonaUserBlocksContextItem({
      client,
      guildId,
      botName,
      tomoriConfig,
      personaUserBlocks,
    }),
  );

  const conversationCorpus = tomoriConfig.memory_tagging_enabled
    ? simplifiedMessageHistory
        .map((message) => message.content ?? "")
        .join(" ")
        .toLowerCase()
    : null;

  if (!isUserImpersonation) {
    const serverMemoryItem = await buildServerMemoryContextItem({
      tomoriState,
      guildId,
      serverName,
      isDMChannel,
      botName,
      personalMemoriesEnabled: tomoriConfig.personal_memories_enabled,
      conversationCorpus,
      channelName,
      channelMemoryEnabled: tomoriConfig.channel_memory_enabled,
      client,
      convertMentions,
    });
    if (serverMemoryItem) contextItems.push(serverMemoryItem);
  }

  await appendOptionalItem(
    contextItems,
    buildServerEmojiContextItem({
      client,
      guildId,
      serverName,
      botName,
      isDMChannel,
      isUserImpersonation,
      tomoriConfig,
      tomoriState,
      preloadedEmojis,
      snapshot,
      convertMentions,
    }),
  );
  await appendOptionalItem(
    contextItems,
    buildServerStickerContextItem({
      client,
      guildId,
      serverName,
      botName,
      isDMChannel,
      isUserImpersonation,
      tomoriConfig,
      tomoriState,
      preloadedStickers,
      toolPromptMacroResolver,
      convertMentions,
    }),
  );
  await appendOptionalItem(
    contextItems,
    buildPersonaSpriteContextItem({
      tomoriState,
      botName,
      isUserImpersonation,
    }),
  );
  await appendOptionalItem(
    contextItems,
    buildUsersInConversationContextItem({
      client,
      guildId,
      channelName,
      channelId,
      userList,
      triggererName,
      botName,
      personaLineageId,
      tomoriState,
      tomoriConfig,
      isDMChannel,
      isUserImpersonation,
      impersonatedUserId,
      impersonatedIdentityName,
      matrixUsers,
      syntheticUsers,
      publicPersonaAttributes,
      toolPromptMacroResolver,
      conversationCorpus,
      snapshot,
      convertMentions,
    }),
  );

  try {
    const actualTriggeringUserId = impersonatedUserId ?? snapshot?.triggererUserRow?.user_disc_id;
    if (actualTriggeringUserId) {
      const { memoryItems, createPromptText } = await buildShortTermMemoryContext({
        triggeringUserId: actualTriggeringUserId,
        currentChannelId: channelId,
        currentServerId: guildId,
        tomoriState,
        triggererName,
        botName,
        personalMemoriesEnabled: tomoriConfig.personal_memories_enabled,
        client,
        isUserImpersonation,
        explicitLongTermMemoryIntent,
        toolPromptMacroResolver,
        currentParentChannelId: parentChannelId,
        convertMentions,
      });
      contextItems.push(...memoryItems);
      sameChannelMemoryDirective = createPromptText;
    }
  } catch (error) {
    log.warn("Failed to build short-term memory context", error);
  }

  // Verbatim tool-calling workaround: when enabled, embed the resolved tool
  // schemas as JSON in-band so endpoints that ignore the native `tools` field
  // still expose them to the model. Placed in the stable reference zone (right
  // before server documents) to stay inside the prompt-cache-friendly prefix.
  await appendOptionalItem(contextItems, buildVerbatimToolDefinitionsContextItem({ tomoriConfig, tomoriState }));
  await appendOptionalItem(
    contextItems,
    buildServerDocumentContextItem({ tomoriState, simplifiedMessageHistory, triggererUserId, channelName }),
  );
  await appendConditioningContext({
    contextItems,
    client,
    guildId,
    tomoriState,
    botName,
    personalMemoriesEnabled: tomoriConfig.personal_memories_enabled,
    isUserImpersonation,
  });
  contextItems.push(
    ...(await buildSampleDialogueContextItems({
      client,
      guildId,
      triggererName,
      botName,
      tomoriState,
      tomoriConfig,
      isUserImpersonation,
      uncensorInputOptions,
      convertMentions,
    })),
  );

  await appendDialogueHistoryContext({
    contextItems,
    client,
    guildId,
    simplifiedMessageHistory,
    botName,
    tomoriConfig,
    tomoriState,
    channelContextNote,
    mediaContextWindow,
    includeTimestamps,
    isUserImpersonation,
    impersonatedUserId,
    messageIdMap,
    uncensorInputOptions,
    convertMentions,
  });

  if (isUserImpersonation && impersonatedUserId) {
    tailDirectives.push(
      `Imitate ${impersonatedIdentityName || "User"}, start your message with ${impersonatedIdentityName || "User"}:`,
    );
  }
  if (sameChannelMemoryDirective) {
    lowerPriorityTailDirectives.push(sameChannelMemoryDirective);
  }

  const uncensorInjectionText = buildUncensorInjectionText({
    injectionEnabled: tomoriConfig.uncensor_injection_enabled,
    unicodeSpacesEnabled: tomoriConfig.uncensor_unicode_space_enabled,
  });
  if (uncensorInjectionText) {
    const strippedText = uncensorInjectionText
      .replace(/^\[System:\s*/i, "")
      .replace(/\]\s*$/, "")
      .trim();
    if (strippedText) uncensorDirective = strippedText;
  }

  log.info(`Built ${contextItems.length} structured context items for guild ${guildId}.`);
  return { contextItems, tailDirectives, lowerPriorityTailDirectives, uncensorDirective };
}

async function appendOptionalItem(
  contextItems: StructuredContextItem[],
  itemPromise: Promise<StructuredContextItem | null>,
): Promise<void> {
  const item = await itemPromise;
  if (item) contextItems.push(item);
}

async function appendConditioningContext(params: {
  contextItems: StructuredContextItem[];
  client: BuildContextParams["client"];
  guildId: string;
  tomoriState: NonNullable<BuildContextParams["snapshot"]>["tomoriState"] | null | undefined;
  botName: string;
  personalMemoriesEnabled: boolean;
  isUserImpersonation: boolean;
}): Promise<void> {
  if (
    params.isUserImpersonation ||
    !params.tomoriState ||
    !params.tomoriState.server_id ||
    params.tomoriState.persona_lineage_id < 0 ||
    (!params.tomoriState.reward_conditioning_enabled && !params.tomoriState.punish_conditioning_enabled)
  ) {
    return;
  }

  try {
    const conditioningItem = await buildConditioningContextItem({
      client: params.client,
      guildId: params.guildId,
      serverId: params.tomoriState.server_id,
      personaLineageId: params.tomoriState.persona_lineage_id,
      botName: params.botName,
      personalMemoriesEnabled: params.personalMemoriesEnabled,
      rewardEnabled: params.tomoriState.reward_conditioning_enabled,
      punishEnabled: params.tomoriState.punish_conditioning_enabled,
      convertMentions,
    });

    if (conditioningItem) {
      params.contextItems.push({
        ...conditioningItem,
        metadataTag: conditioningItem.metadataTag ?? ContextItemTag.KNOWLEDGE_SERVER_CONDITIONING,
      });
    }
  } catch (error) {
    log.warn("Failed to add conditioning context", error);
  }
}

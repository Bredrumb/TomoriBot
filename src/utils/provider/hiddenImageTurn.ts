import { buildFailedToolResponse } from "@/utils/tools/toolResult";
import type { GenerationModelSelection } from "@/types/provider/generationModels";
import { reportProviderUsage, withProviderUsageContext } from "@/utils/provider/providerUsage";

import type { Client, Guild, Webhook } from "discord.js";
import { log } from "@/utils/misc/logger";
import { buildContext } from "@/utils/text/contextBuilder";
import type { SimplifiedMessageForContext } from "@/utils/text/contextBuilder";
import { getCachedChannelPrompt } from "@/utils/cache/channelPromptCache";
import { getProviderForTomori } from "@/utils/provider/providerFactory";
import { ToolRegistry } from "@/tools/toolRegistry";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { TomoriState } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import type { StreamingContext } from "@/types/tool/interfaces";
import type { FunctionCall } from "@/types/provider/interfaces";
import { getCapabilityCredentialFailureCopy, resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import { resolveTextCredentialState } from "@/utils/provider/textModelSelection";
import { stripBridgePrefix } from "@/utils/bridges";
import { resolveMediaForModel } from "@/utils/text/context/mediaResolver";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { prepareParticipantContext } from "@/utils/text/participants/preparation";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { createProviderToolFailure } from "@/utils/provider/providerToolFailure";

const BOT_GENERATE_IMAGE_HISTORY_LIMIT = 24;

const BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS = 5;

const SKIPPED_MESSAGE_TYPES = new Set<number>([
  1, // RecipientAdd
  2, // RecipientRemove
  3, // Call
  4, // ChannelNameChange
  5, // ChannelIconChange
  6, // ChannelPinnedMessage
  7, // UserJoin / GuildMemberJoin
  8, // GuildBoost
  9, // GuildBoostTier1
  10, // GuildBoostTier2
  11, // GuildBoostTier3
  14, // ThreadCreated
  19, // ThreadStarterMessage
  22, // GuildInviteReminder
  24, // AutoModerationAction
]);

export interface HiddenImageTurnParams {
  spoiler?: boolean;
  imageModelSelection?: GenerationModelSelection;
  channel: ToolContext["channel"];
  client: Client;
  guild: Guild | null;
  tomoriState: TomoriState;
  locale: string;
  interactingUserId: string;
  internalUserId?: number | null;
  backend: "current_provider" | "novelai";
  presetLabel: string;
  presetInstruction: string;
  aspectRatio: string;
  naiOrientation: "portrait" | "landscape" | "square";
  extraDirection?: string;
  webhook?: Webhook;
  personaUsername?: string;
  personaAvatarUrl?: string;
  contextPersonaOverride?: {
    tomoriNickname: string;
    personaPrompt: string | null;
    tomoriAttributes: string[];
    personaLineageId: number | null;
  };
}

export function buildHiddenImageDirective(
  params: Pick<
    HiddenImageTurnParams,
    "backend" | "presetLabel" | "presetInstruction" | "aspectRatio" | "naiOrientation" | "extraDirection"
  > & { lookupEnabled: boolean },
): string {
  const { backend, presetLabel, presetInstruction, aspectRatio, naiOrientation, extraDirection, lookupEnabled } =
    params;
  const toolInstruction = lookupEnabled
    ? backend === "current_provider"
      ? "Call the generate_image tool to draw the scene. Use the conversation context above, including any Physical Appearance lines for users/personas, to write a detailed prompt describing the scene."
      : "Call the generate_image_nai tool to draw the scene. Use the conversation context above, including any Physical Appearance lines for users/personas, to construct danbooru-style tags describing the scene."
    : backend === "current_provider"
      ? `You MUST call the generate_image tool immediately. Use the conversation context above, including any Physical Appearance lines for users/personas, to construct a detailed prompt describing the scene.`
      : `You MUST call the generate_image_nai tool immediately. Use the conversation context above, including any Physical Appearance lines for users/personas, to construct danbooru-style tags describing the scene.`;

  const dirLines: string[] = [
    toolInstruction,
    `Framing: ${presetLabel} — ${presetInstruction}`,
    backend === "current_provider" ? `Aspect ratio: ${aspectRatio}` : `Orientation: ${naiOrientation}`,
  ];
  if (extraDirection?.trim()) {
    dirLines.push(`Extra direction from user: ${extraDirection.trim()}`);
  }
  if (lookupEnabled) {
    dirLines.push(
      "If the scene includes an existing character, outfit, or series whose exact tags or look you are unsure of, first call danbooru_search_tags once with every such name, then call the image tool.",
      "IMPORTANT: Do not ask for clarification or ask if the user wants you to proceed. Your turn must end with a call to the image tool (generate_image or generate_image_nai).",
    );
  } else {
    dirLines.push(
      "IMPORTANT: You MUST call the image tool (generate_image or generate_image_nai) immediately. Do not ask for clarification or ask if the user wants you to proceed. Just call the tool now with the scene information from above.",
    );
  }

  return `[System: ${dirLines.join(" ")}]`;
}

export async function runHiddenImageTurn(params: HiddenImageTurnParams): Promise<{ success: boolean; error?: string }> {
  const serverDiscId = params.guild?.id ?? params.interactingUserId;
  const {
    channel,
    client,
    guild,
    tomoriState: baseState,
    locale,
    interactingUserId,
    backend,
    presetLabel,
    presetInstruction,
    aspectRatio,
    naiOrientation,
    extraDirection,
    webhook,
    personaUsername,
    personaAvatarUrl,
    contextPersonaOverride,
    internalUserId,
  } = params;

  let tomoriState: TomoriState;
  let credentials: Awaited<ReturnType<typeof resolveCapabilityCredentials>>;
  try {
    credentials = await resolveCapabilityCredentials(baseState.server_id, "text", {
      userId: internalUserId,
      textModel: baseState.llm,
    });
    tomoriState = await resolveTextCredentialState(baseState, credentials);
  } catch (error) {
    const failure = getCapabilityCredentialFailureCopy(error, locale);
    if (!failure) throw error;
    return { success: false, error: failure.description };
  }

  if (!tomoriState.llm.has_tools) {
    return {
      success: false,
      error:
        "The active model does not support function calling (has_tools=false). A tool-capable model is required for the hidden image agent.",
    };
  }

  const usageContext = credentials.usageContext;
  const rawMessages = await channel.messages.fetch({
    limit: BOT_GENERATE_IMAGE_HISTORY_LIMIT,
  });
  const messagesChron = [...rawMessages.values()].reverse();

  const botDiscordId = client.user?.id;
  const simplifiedMessages: SimplifiedMessageForContext[] = [];
  const userListSet = new Set<string>();

  for (const msg of messagesChron) {
    if (SKIPPED_MESSAGE_TYPES.has(msg.type as number)) continue;

    // Alter-persona webhooks share the bot's author ID, so checking botDiscordId counts them as persona turns.
    const isBotMessage = msg.author.bot && msg.author.id === botDiscordId;

    const authorId = msg.author.id;
    const authorName = stripBridgePrefix(msg.member?.displayName ?? msg.author.id);

    // Omit images from history so the provider does not base64-inline megabytes of attachments into the planning turn.
    simplifiedMessages.push({
      id: msg.id,
      authorId,
      authorName,
      authorType: isBotMessage ? "persona" : "user",
      personaName: isBotMessage ? tomoriState.persona_nickname : null,
      content: msg.cleanContent || msg.content || null,
      createdAt: msg.createdTimestamp,
      imageAttachments: [],
      videoAttachments: [],
    });

    if (!msg.author.bot && !msg.webhookId) {
      userListSet.add(authorId);
    }
  }

  if (botDiscordId) {
    userListSet.add(botDiscordId);
  }

  const userList = Array.from(userListSet);

  const channelName = "name" in channel ? channel.name : "Unknown Channel";
  const channelDesc = "topic" in channel ? (channel as unknown as { topic: string | null }).topic : null;

  const interactingMember = guild?.members.cache.get(interactingUserId);
  const triggererName = stripBridgePrefix(interactingMember?.displayName ?? interactingUserId);

  let contextItems: StructuredContextItem[];
  let messageIdMap: ToolContext["messageIdMap"];
  try {
    const persona = contextPersonaOverride ?? {
      tomoriNickname: tomoriState.persona_nickname,
      personaPrompt: tomoriState.persona_prompt ?? null,
      tomoriAttributes: tomoriState.attribute_list,
      personaLineageId: tomoriState.persona_lineage_id,
    };

    const channelPromptOverride = tomoriState.server_id
      ? await getCachedChannelPrompt(tomoriState.server_id, channel.id)
      : null;
    const personas = await getCachedAllPersonas(serverDiscId).catch(() => [tomoriState]);
    const preparedParticipantContext = await prepareParticipantContext({
      client,
      guildId: serverDiscId,
      simplifiedMessageHistory: simplifiedMessages,
      personas,
      activePersona: tomoriState,
      visibleUserIds: userList,
      syntheticUsers: new Map(),
      matrixUsers: new Map(),
    });

    const contextBuild = await buildContext({
      guildId: serverDiscId,
      serverName: guild?.name ?? "Direct Message",
      serverDescription: guild?.description ?? null,
      simplifiedMessageHistory: simplifiedMessages,
      preparedParticipantContext,
      channelDesc,
      channelName,
      channelId: channel.id,
      client,
      triggererName,
      triggererFormattedName: triggererName,
      triggererAddressTerm: "",
      tomoriNickname: persona.tomoriNickname,
      tomoriAttributes: persona.tomoriAttributes,
      tomoriConfig: tomoriState.config,
      channelPromptOverride,
      personaPrompt: persona.personaPrompt,
      personaLineageId: persona.personaLineageId ?? undefined,
      isDMChannel: false,
      triggererUserId: internalUserId ?? undefined,
    });
    contextItems = contextBuild.contextItems;
    messageIdMap = contextBuild.messageIdMap;
  } catch (error) {
    log.error("Hidden image agent: buildContext failed", error as Error, {
      errorType: "HiddenImageAgentContextError",
      metadata: { guildId: serverDiscId, channelId: channel.id },
    });
    return {
      success: false,
      error: "Failed to build conversation context for image generation.",
    };
  }

  const agentDirective: StructuredContextItem = {
    role: "user",
    parts: [
      {
        type: "text",
        text: buildHiddenImageDirective({
          backend,
          presetLabel,
          presetInstruction,
          aspectRatio,
          naiOrientation,
          extraDirection,
          lookupEnabled: tomoriState.config.danbooru_enabled === true,
        }),
      },
    ],
    metadataTag: ContextItemTag.DIALOGUE_HISTORY,
  };
  contextItems = [...contextItems, agentDirective];
  // This internal planner is intentionally allowed to inspect image context even when the text model's
  // public OpenRouter capability metadata would normally say otherwise.
  const mediaResolutionLlm = {
    ...tomoriState.llm,
    sees_images: true,
    ...(tomoriState.llm.llm_provider === "openrouter" ? { llm_codename: "other-model" } : {}),
  };
  contextItems = await resolveMediaForModel(contextItems, {
    ...tomoriState,
    llm: mediaResolutionLlm,
  });

  const targetToolName = backend === "current_provider" ? "generate_image" : "generate_image_nai";

  const streamingContext: StreamingContext = {
    deliveryMode: "persona",
    imageModelSelection: params.imageModelSelection,
    usageContext,
    textCredentialSource: credentials.source,
    disableYouTubeProcessing: true,
    disableProfilePictureProcessing: true,
    disableGifProcessing: true,
    disableShortTermMemoryUpdate: true,
    suppressTextOutput: true,
    suppressUserErrors: true,
    isManuallyTriggered: true,
    // End the turn as soon as either image tool succeeds, so both are listed so the
    // loop terminates cleanly even if the model calls the non-preferred backend.
    endTurnAfterTools: ["generate_image", "generate_image_nai"],
    messageIdMap,
    triggererUserId: internalUserId ?? undefined,
  };

  let provider: Awaited<ReturnType<typeof getProviderForTomori>>;
  try {
    provider = await getProviderForTomori(tomoriState);
  } catch (error) {
    log.error("Hidden image agent: failed to get provider", error as Error, {
      errorType: "HiddenImageAgentProviderError",
      metadata: { provider: tomoriState.llm.llm_provider },
    });
    return {
      success: false,
      error: `Failed to initialize provider "${tomoriState.llm.llm_provider}".`,
    };
  }

  let providerConfig: Awaited<ReturnType<typeof provider.createConfig>>;
  try {
    providerConfig = await provider.createConfig(tomoriState, credentials.apiKey);
  } catch (error) {
    log.error("Hidden image agent: failed to create provider config", error as Error, {
      errorType: "HiddenImageAgentConfigError",
    });
    return {
      success: false,
      error: "Failed to create provider configuration.",
    };
  }

  const planningFailure = (error: unknown) => ({
    success: false,
    error: createProviderToolFailure(error, {
      locale,
      provider: tomoriState.llm.llm_provider,
      credentialScope: credentials.source,
    }).error,
  });

  const functionInteractionHistory: Array<{
    functionCall: FunctionCall;
    functionResponse: Record<string, unknown>;
    preToolCallTextParts?: Array<Record<string, unknown>>;
  }> = [];

  const toolContext: ToolContext = {
    deliveryMode: "persona",
    channel,
    client,
    userId: interactingUserId,
    internalUserId: internalUserId ?? undefined,
    guildId: serverDiscId,
    tomoriState,
    locale,
    provider: provider.getInfo().name,
    streamContext: streamingContext,
    usageContext,
    suppressProgressNotices: true,
    webhook,
    personaUsername,
    personaAvatarUrl,
    contextItems,
    messageIdMap,
  };

  log.info(
    `[Hidden Image Agent] Starting hidden turn for channel ${channel.id} — backend=${backend}, tool=${targetToolName}, maxIterations=${BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS}`,
  );

  for (let i = 0; i < BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS; i++) {
    log.info(`[Hidden Image Agent] Iteration ${i + 1}/${BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS}`);

    // Omit per-stream timeouts because tomoriChat has none and BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS bounds loops.
    let streamResult: Awaited<ReturnType<typeof provider.streamToDiscord>>;
    try {
      streamResult = await withProviderUsageContext(usageContext, async () =>
        provider.streamToDiscord(
          channel,
          client,
          tomoriState,
          providerConfig,
          contextItems,
          [],
          undefined,
          functionInteractionHistory.length > 0 ? functionInteractionHistory : undefined,
          undefined,
          undefined,
          streamingContext,
          locale,
        ),
      );
    } catch (error) {
      // Providers report what they catch, so only an exception that escaped one is unreported here.
      await reportProviderFailure({
        summary: "Hidden image planning failed",
        errorType: "HiddenImageAgentStreamError",
        error,
        expected: false,
        serverId: tomoriState.server_id,
        userId: internalUserId,
        dimensions: { operation: "image-planning", provider: tomoriState.llm.llm_provider },
        metadata: {
          channelId: channel.id,
          model: providerConfig.model,
          iteration: i + 1,
          credentialSource: credentials.source,
        },
        redactValues: [credentials.apiKey],
      });
      return planningFailure(error);
    }

    reportProviderUsage(usageContext, {
      modelCodename: tomoriState.llm.llm_codename,
      costUsd: streamResult.usage?.costUsd,
      inputTokens: streamResult.usage?.inputTokens,
      outputTokens: streamResult.usage?.outputTokens,
    });

    if (streamResult.status === "function_call") {
      if (!streamResult.data) {
        log.error("[Hidden Image Agent] function_call status received without data.");
        return { success: false, error: "Malformed function call from model." };
      }

      const funcCall = streamResult.data as FunctionCall;
      const funcName = funcCall.name?.trim() ?? "";
      log.info(`[Hidden Image Agent] Model called tool: ${funcName}`);

      const args = { ...(funcCall.args || {}) };
      if (params.spoiler !== undefined && (funcName === "generate_image" || funcName === "generate_image_nai"))
        args.nsfw = params.spoiler;
      const toolResult = await ToolRegistry.executeTool(funcName, args, toolContext);
      log.info(
        `[Hidden Image Agent] Tool "${funcName}" ${toolResult.success ? "succeeded" : "failed"}: ${toolResult.message ?? toolResult.error ?? ""}`,
      );

      const functionExecutionResult: Record<string, unknown> = toolResult.success
        ? ((toolResult.data as Record<string, unknown>) ?? {
            status: "completed",
          })
        : buildFailedToolResponse(toolResult, funcName);

      const preToolCallText = (streamResult.accumulatedText ?? "").trim();
      functionInteractionHistory.push({
        functionCall: funcCall,
        functionResponse: {
          functionResponse: {
            name: funcName,
            response: { result: functionExecutionResult },
          },
        },
        preToolCallTextParts: preToolCallText ? [{ type: "text", text: preToolCallText }] : undefined,
      });

      if (toolResult.endTurn) {
        if (toolResult.success) {
          log.info(`[Hidden Image Agent] Image tool "${funcName}" completed successfully — ending hidden turn.`);
          return { success: true };
        }
        log.warn(`[Hidden Image Agent] Image tool "${funcName}" requested endTurn but reported failure.`);
        return {
          success: false,
          error: toolResult.error ?? "Image generation tool failed.",
        };
      }

      continue;
    }

    if (streamResult.status === "error") {
      return planningFailure(streamResult.data);
    }

    log.warn(`[Hidden Image Agent] Stream completed without calling ${targetToolName} on iteration ${i + 1}.`);
    break;
  }

  return {
    success: false,
    error: `The model did not call ${targetToolName} within ${BOT_GENERATE_IMAGE_AGENT_MAX_ITERATIONS} iteration(s).`,
  };
}

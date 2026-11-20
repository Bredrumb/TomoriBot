import { pickHumanizerSettings } from "@/constants/humanizer";
import { callCustomDecisions } from "@/providers/custom/customDecisions";
import type { ProviderDecisionRequest, DecisionResult, SupportsDecisions } from "@/types/provider/featureInterfaces";

import { resolveChatMaxOutputTokens } from "@/utils/provider/maxOutputTokens";
import type {
  BaseGuildTextChannel,
  BaseGuildVoiceChannel,
  Client,
  CommandInteraction,
  Message,
  DMChannel,
  AnyThreadChannel,
} from "discord.js";
import type { ZodType } from "zod";
import {
  generateConversationSummaryCustom,
  generateRoleplaySummaryCustom,
} from "@/providers/custom/customCompactGenerator";
import { generatePresetFromPromptCustom } from "@/providers/custom/customPresetGenerator";
import { callCustomStructuredJSON } from "@/providers/custom/customStructuredOutput";
import { getEffectiveLlmModelName } from "@/utils/provider/modelDisplay";
import { buildActiveSamplingParams, getActiveTemperature } from "@/utils/provider/samplingControl";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";
import { StreamOrchestrator } from "../../utils/discord/streamOrchestrator";
import { buildStreamContext } from "@/utils/provider/streamContext";
import { CustomStreamAdapter, type CustomStreamConfig } from "./customStreamAdapter";
import type { ProviderError, StreamContext } from "../../types/stream/interfaces";
import { DISCORD_STREAMING_CONSTANTS } from "../../types/stream/types";
import { type ToolStateForContext, getAvailableToolsWithMCP } from "../../tools/toolRegistry";
import { applyStreamContextAvailability } from "@/tools/availability";
import type { StreamingContext, ToolContext } from "../../types/tool/interfaces";
import type { TomoriState } from "../../types/db/schema";
import type { StructuredContextItem } from "../../types/misc/context";
import { log } from "../../utils/misc/logger";
import type {
  CompactConversationResult,
  CompactRoleplayResult,
  EmbeddingRequest,
  ProviderNativeImageGenerationRequest,
  ProviderNativeImageGenerationResult,
  ProviderNativeVideoGenerationRequest,
  ProviderNativeVideoGenerationResult,
  PresetGenerationResult,
  ProviderCompactSummaryRequest,
  ProviderPresetGenerationRequest,
  ProviderStructuredJsonRequest,
  StructuredOutputResult,
  SupportsEmbeddings,
  SupportsConversationCompaction,
  SupportsNativeImageGeneration,
  SupportsNativeVideoGeneration,
  SupportsPresetGeneration,
  SupportsStructuredOutput,
} from "../../types/provider/featureInterfaces";
import {
  BaseLLMProvider,
  type FunctionCall,
  type LLMProvider,
  type ProviderConfig,
  type ProviderInfo,
  type StreamResult,
  type FunctionResponseImageMetadata,
  type ApiKeyValidationResult,
} from "../../types/provider/interfaces";
import { getCustomToolAdapter } from "./customToolAdapter";
import { customProviderInfo } from "./providerInfo";
import {
  resolveCustomEndpointForProvider,
  resolveCustomTextEndpointTarget,
} from "@/utils/provider/customEndpointService";
import { parseCustomProvider } from "@/utils/provider/customProviderUtils";
import { buildCustomHeaders } from "@/providers/custom/customOpenAICompatibleUtils";
import { applyDeliberateToolAllowlist } from "@/utils/tools/deliberateToolMode";
import { resolveToolsEnabled } from "@/utils/tools/toolUseGate";
import { getEndpointRemotePolicy } from "@/utils/security/remoteUrlSecurity";

const DEFAULT_CUSTOM_MODEL = "custom/default";

export interface CustomProviderConfig extends ProviderConfig {
  endpointUrl: string;
  // Backend server connection ID is included here because it keys the server's ComfyUI VRAM handoff.
  customConnectionId?: number | null;
  seesImages?: boolean;
  seesVideos?: boolean;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  numCtx?: number | null;
}

export class CustomProvider
  extends BaseLLMProvider
  implements
    LLMProvider,
    SupportsDecisions,
    SupportsStructuredOutput,
    SupportsConversationCompaction,
    SupportsPresetGeneration,
    SupportsEmbeddings,
    SupportsNativeImageGeneration,
    SupportsNativeVideoGeneration
{
  async callDecisions(request: ProviderDecisionRequest): Promise<DecisionResult> {
    return await callCustomDecisions(request);
  }

  getInfo(): ProviderInfo {
    return customProviderInfo;
  }

  async validateApiKey(_apiKey: string): Promise<ApiKeyValidationResult> {
    log.info("Custom provider: Skipping strict API key validation (endpoint health checked on first use)");
    return { valid: true };
  }

  formatErrorDescription(error: ProviderError, locale: string): string | null {
    const customAdapter = new CustomStreamAdapter();
    return customAdapter.createErrorDescription(error, locale);
  }

  supportsEmbeddingTaskType(): boolean {
    return false;
  }

  async generateEmbeddings(request: EmbeddingRequest): Promise<number[][]> {
    const customEndpoint = await resolveCustomEndpointForProvider(request.provider, "embedding", request.modelId);
    const endpointUrl = customEndpoint?.endpoint_url ?? null;
    const modelName = customEndpoint?.model_name ?? request.model;

    if (!endpointUrl) {
      throw new Error("Custom embedding endpoint is not configured.");
    }

    const response = await fetchUserRemoteUrl(
      `${endpointUrl.replace(/\/+$/, "")}/embeddings`,
      {
        method: "POST",
        headers: buildCustomHeaders(request.apiKey),
        body: JSON.stringify({
          model: modelName,
          input: request.inputs,
        }),
      },
      getEndpointRemotePolicy(),
    );

    if (!response.ok) {
      throw new Error(`Custom embedding request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };

    return payload.data?.map((row) => row.embedding ?? []) ?? [];
  }

  async generateNativeImage(
    _request: ProviderNativeImageGenerationRequest,
  ): Promise<ProviderNativeImageGenerationResult> {
    throw new Error("Custom native image generation is routed through the custom endpoint dispatcher.");
  }

  async generateNativeVideo(
    _request: ProviderNativeVideoGenerationRequest,
  ): Promise<ProviderNativeVideoGenerationResult> {
    throw new Error("Custom native video generation is routed through the custom endpoint dispatcher.");
  }

  async getTools(
    tomoriState: TomoriState,
    streamingContext?: StreamingContext,
  ): Promise<Array<Record<string, unknown>>> {
    if (!resolveToolsEnabled(tomoriState, tomoriState.llm.has_tools)) {
      log.info(
        `Custom provider: Tools unavailable (tool_use_enabled=${tomoriState.config.tool_use_enabled}, has_tools=${tomoriState.llm.has_tools})`,
      );
      return [];
    }

    try {
      if (streamingContext) {
        streamingContext.speechToolState ??= { userId: streamingContext.triggererUserId };
      }
      const toolStateForContext: ToolStateForContext = {
        server_id: tomoriState.server_id.toString(),
        activePersonaHasElevenlabsVoice: Boolean(
          tomoriState.speech_voice_sample_id ||
            tomoriState.speech_voice_design_prompt?.trim() ||
            tomoriState.speech_voice_id?.trim(),
        ),
        activePersonaVoiceDesignPrompt: tomoriState.speech_voice_design_prompt?.trim() || null,
        activePersonaVoiceSampleId: tomoriState.speech_voice_sample_id,
        activePersonaVoiceId: tomoriState.speech_voice_id,
        activePersonaVoiceSourcePriority: tomoriState.voice_source_priority,
        speechToolState: streamingContext?.speechToolState,

        diffusion_model_id: tomoriState.config.diffusion_model_id,
        nai_diffusion_model_id: tomoriState.config.nai_diffusion_model_id,
        video_model_id: tomoriState.config.video_model_id,
        llm: {
          llm_codename: tomoriState.llm.llm_codename,
          has_tools: tomoriState.llm.has_tools,
          sees_images: tomoriState.llm.sees_images,
          sees_videos: tomoriState.llm.sees_videos,
          sees_youtube: tomoriState.llm.sees_youtube,
          supports_structoutput: tomoriState.llm.supports_structoutput,
        },
        config: {
          emoji_usage_enabled: tomoriState.config.emoji_usage_enabled,
          sticker_usage_enabled: tomoriState.config.sticker_usage_enabled,
          web_search_enabled: tomoriState.config.web_search_enabled,
          self_teaching_enabled: tomoriState.config.self_teaching_enabled,
          manage_message_enabled: tomoriState.config.manage_message_enabled,
          imagegen_enabled: tomoriState.config.imagegen_enabled,
          videogen_enabled: tomoriState.config.videogen_enabled,
          voice_message_enabled: tomoriState.config.voice_message_enabled,
          user_blocking_enabled: tomoriState.config.user_blocking_enabled,
          user_info_updates_enabled: tomoriState.config.user_info_updates_enabled,
          thread_creation_enabled: tomoriState.config.thread_creation_enabled,
          conditioning_interactions_enabled: tomoriState.config.conditioning_interactions_enabled,
          dice_rolling_enabled: tomoriState.config.dice_rolling_enabled,
          danbooru_enabled: tomoriState.config.danbooru_enabled,
        },
      };

      const {
        builtInTools: availableBuiltInTools,
        mcpFunctionNames: availableMcpFunctionNames,
        mcpToolFamilies,
        totalCount,
      } = await getAvailableToolsWithMCP("custom", toolStateForContext);

      let finalBuiltInTools = applyStreamContextAvailability({
        providerLabel: "Custom provider",
        provider: "custom",
        builtInTools: availableBuiltInTools,
        streamContext: streamingContext,
        tomoriState,
      });
      let finalMcpFunctionNames = availableMcpFunctionNames;

      ({ builtInTools: finalBuiltInTools, mcpFunctionNames: finalMcpFunctionNames } = applyDeliberateToolAllowlist({
        providerLabel: "Custom provider",
        builtInTools: finalBuiltInTools,
        mcpFunctionNames: finalMcpFunctionNames,
        mcpToolFamilies,
        allowedToolNames: streamingContext?.deliberateToolAllowedNames,
      }));

      const customAdapter = getCustomToolAdapter();
      const allToolsConfig = await customAdapter.getAllToolsInOpenAIFormat(
        finalBuiltInTools,
        tomoriState.server_id,
        finalMcpFunctionNames,
      );

      log.info(
        `Custom provider tools loaded: ${finalBuiltInTools.length} built-in + ${finalMcpFunctionNames.length} MCP = ${totalCount} total tools`,
      );

      return allToolsConfig;
    } catch (error) {
      log.error(`Failed to get tools for custom provider: ${tomoriState.llm.llm_codename}`, error as Error);
      return [];
    }
  }

  async getDefaultModel(): Promise<string> {
    return DEFAULT_CUSTOM_MODEL;
  }

  getExpressionInitializationBatchSize(): number {
    const parsed = Number.parseInt(process.env.CUSTOM_EXPRESSION_BATCH_SIZE || "20", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
  }

  async callStructuredJSON<T>(
    request: ProviderStructuredJsonRequest,
    responseSchema: Record<string, unknown>,
    zodSchema: ZodType<T>,
  ): Promise<StructuredOutputResult<T>> {
    return await callCustomStructuredJSON(request, responseSchema, zodSchema);
  }

  async generateConversationSummary(request: ProviderCompactSummaryRequest): Promise<CompactConversationResult> {
    return await generateConversationSummaryCustom(request);
  }

  async generateRoleplaySummary(request: ProviderCompactSummaryRequest): Promise<CompactRoleplayResult> {
    return await generateRoleplaySummaryCustom(request);
  }

  private async getPresetGenerationTools(
    request: ProviderPresetGenerationRequest,
  ): Promise<Array<Record<string, unknown>> | undefined> {
    if (!request.params.useWebSearch) {
      return undefined;
    }

    if (!request.toolContext) {
      log.warn("Custom preset generation skipped search tools: no tool context available.");
      return undefined;
    }

    const toolStateForContext: ToolStateForContext = {
      server_id: request.tomoriState.server_id.toString(),
      activePersonaHasElevenlabsVoice: Boolean(
        request.tomoriState.speech_voice_sample_id ||
          request.tomoriState.speech_voice_design_prompt?.trim() ||
          request.tomoriState.speech_voice_id?.trim(),
      ),
      activePersonaVoiceDesignPrompt: request.tomoriState.speech_voice_design_prompt?.trim() || null,
      activePersonaVoiceSampleId: request.tomoriState.speech_voice_sample_id,
      activePersonaVoiceId: request.tomoriState.speech_voice_id,
      activePersonaVoiceSourcePriority: request.tomoriState.voice_source_priority,

      diffusion_model_id: request.tomoriState.config.diffusion_model_id,
      nai_diffusion_model_id: request.tomoriState.config.nai_diffusion_model_id,
      video_model_id: request.tomoriState.config.video_model_id,
      llm: {
        llm_codename: request.tomoriState.llm.llm_codename,
        has_tools: request.tomoriState.llm.has_tools,
        sees_images: request.tomoriState.llm.sees_images,
        sees_videos: request.tomoriState.llm.sees_videos,
        sees_youtube: request.tomoriState.llm.sees_youtube,
        supports_structoutput: request.tomoriState.llm.supports_structoutput,
      },
      config: {
        emoji_usage_enabled: false,
        sticker_usage_enabled: false,
        web_search_enabled: true,
        self_teaching_enabled: false,
        manage_message_enabled: false,
        imagegen_enabled: false,
        videogen_enabled: false,
        voice_message_enabled: false,
        user_blocking_enabled: false,
        user_info_updates_enabled: false,
        thread_creation_enabled: false,
        conditioning_interactions_enabled: false,
        dice_rolling_enabled: false,
        danbooru_enabled: false,
      },
    };

    const { builtInTools, mcpFunctionNames } = await getAvailableToolsWithMCP("custom", toolStateForContext);

    const searchTools = builtInTools.filter(
      (tool) => tool.category === "search" || tool.requiresFeatureFlag === "web_search",
    );

    const customAdapter = getCustomToolAdapter();
    return await customAdapter.getAllToolsInOpenAIFormat(searchTools, request.tomoriState.server_id, mcpFunctionNames);
  }

  async generatePreset(request: ProviderPresetGenerationRequest): Promise<PresetGenerationResult> {
    const endpointUrl = request.tomoriState.config.custom_endpoint_url;
    if (!endpointUrl) {
      return {
        error: "Custom endpoint URL is not configured. Please register the custom endpoint again.",
        errorType: "MODEL_ERROR",
      };
    }

    const tools = await this.getPresetGenerationTools(request);
    const modelName = getEffectiveLlmModelName(request.tomoriState.llm, request.tomoriState.config.custom_model_name);

    return await generatePresetFromPromptCustom(request.apiKey, request.params, request.locale, {
      endpointUrl,
      model: modelName,
      temperature: getActiveTemperature(request.tomoriState.config),
      tools,
      toolContext: request.toolContext as ToolContext | undefined,
      maxToolRounds: request.maxToolRounds,
    });
  }

  async createConfig(tomoriState: TomoriState, apiKey: string): Promise<CustomProviderConfig> {
    const {
      endpointUrl,
      modelNameHint: endpointModelNameHint,
      numCtx,
    } = await resolveCustomTextEndpointTarget(tomoriState);

    if (!endpointUrl) {
      throw new Error(
        "Custom endpoint URL not configured. Register it with /providers or /personal providers, then select it again.",
      );
    }

    const modelName = tomoriState.config.custom_model_name || endpointModelNameHint || tomoriState.llm.llm_codename;

    log.info(`Custom provider: Using endpoint URL: ${endpointUrl}`);
    log.info(
      `Custom provider: Model name: ${modelName}${tomoriState.config.custom_model_name ? " (custom)" : " (default)"}`,
    );
    log.info(`Custom provider: has_tools: ${tomoriState.llm.has_tools}`);
    log.info(`Custom provider: sees_images: ${tomoriState.llm.sees_images}`);
    log.info(`Custom provider: sees_videos: ${tomoriState.llm.sees_videos}`);
    log.info(`Custom provider: supports_structoutput: ${tomoriState.llm.supports_structoutput}`);

    const samplingParams = buildActiveSamplingParams(tomoriState.config);
    const config: CustomProviderConfig = {
      model: modelName,
      apiKey: apiKey,
      temperature: tomoriState.config.llm_temperature,
      disabledParams: tomoriState.config.llm_disabled_params ?? [],
      maxOutputTokens: resolveChatMaxOutputTokens({
        provider: "custom",
        configured: tomoriState.config.llm_max_output_tokens,
        modelMaxOutputTokens: null,
        contextWindow: numCtx,
      }),
      endpointUrl: endpointUrl,
      customConnectionId: parseCustomProvider(tomoriState.llm.llm_provider)?.connectionId ?? null,
      seesImages: tomoriState.llm.sees_images,
      seesVideos: tomoriState.llm.sees_videos,
      ...samplingParams,
      repetitionPenalty: 1.1,
      numCtx,
    };

    if (resolveToolsEnabled(tomoriState, tomoriState.llm.has_tools)) {
      config.tools = await this.getTools(tomoriState);
    }

    return config;
  }

  async streamToDiscord(
    channel: BaseGuildTextChannel | BaseGuildVoiceChannel | DMChannel | AnyThreadChannel,
    client: Client,
    tomoriState: TomoriState,
    config: ProviderConfig,
    contextItems: StructuredContextItem[],
    currentTurnModelParts: Array<Record<string, unknown>>,
    emojiStrings?: string[],
    functionInteractionHistory?: Array<{
      functionCall: FunctionCall;
      functionResponse: Record<string, unknown>;
      imageMetadata?: FunctionResponseImageMetadata;
    }>,
    initialInteraction?: CommandInteraction,
    replyToMessage?: Message,
    streamingContext?: StreamingContext,
    userLocale?: string,
    webhook?: import("discord.js").Webhook,
    personaAvatarUrl?: string,
    personaUsername?: string,
    prefixStrippingName?: string,
  ): Promise<StreamResult> {
    log.info(`CustomProvider: Starting streaming for server ${tomoriState.server_id}, model ${config.model}`);

    try {
      const customConfig = config as CustomProviderConfig;

      const streamConfig: CustomStreamConfig = {
        ...customConfig,
        maxMessageLength: DISCORD_STREAMING_CONSTANTS.MAX_SINGLE_MESSAGE_LENGTH,
        flushBufferSize: DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_REGULAR,
        flushBufferSizeCodeBlock: DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_CODE_BLOCK,
        inactivityTimeoutMs: DISCORD_STREAMING_CONSTANTS.INACTIVITY_TIMEOUT_MS,
        baseTypeSpeedMsPerChar: DISCORD_STREAMING_CONSTANTS.BASE_TYPE_SPEED_MS_PER_CHAR,
        maxTypingTimeMs: DISCORD_STREAMING_CONSTANTS.MAX_TYPING_TIME_MS,
        minVisibleTypingDurationMs: DISCORD_STREAMING_CONSTANTS.MIN_VISIBLE_TYPING_DURATION_MS,
        humanizer: pickHumanizerSettings(tomoriState.config),
        emojiUsageEnabled: tomoriState.config.emoji_usage_enabled,
        seesImages: tomoriState.llm.sees_images,
        forceReason: streamingContext?.forceReason,
        isManuallyTriggered: streamingContext?.isManuallyTriggered,
      };

      if (streamingContext && resolveToolsEnabled(tomoriState, tomoriState.llm.has_tools)) {
        log.info("CustomProvider: Reloading tools with streaming context for context-aware availability");
        const contextAwareTools = await this.getTools(tomoriState, streamingContext);
        streamConfig.tools = contextAwareTools;
        log.info(`Context-aware tools loaded: ${contextAwareTools.length} tools`);
      } else if (streamingContext && !resolveToolsEnabled(tomoriState, tomoriState.llm.has_tools)) {
        log.info("Skipping context-aware tool reload - model doesn't support tools");
      }

      const streamContext: StreamContext = buildStreamContext({
        provider: "custom",
        channel,
        client,
        initialInteraction,
        replyToMessage,
        tomoriState,
        contextItems,
        currentTurnModelParts,
        emojiStrings,
        functionInteractionHistory,
        userLocale,
        streamingContext,
        webhook,
        personaAvatarUrl,
        personaUsername,
        prefixStrippingName,
      });

      const orchestrator = new StreamOrchestrator();
      const customAdapter = new CustomStreamAdapter();

      log.info("CustomProvider: Delegating to StreamOrchestrator with CustomStreamAdapter");
      const result = await orchestrator.streamToDiscord(customAdapter, streamConfig, streamContext);

      log.info(`CustomProvider: Streaming completed with status: ${result.status}`);
      return result;
    } catch (error) {
      log.error(
        `CustomProvider streaming error for server ${tomoriState.server_id}, model ${config.model}, channel ${channel.id}`,
        error as Error,
      );

      return {
        status: "error",
        data: error as Error,
      };
    }
  }
}

/**
 * Vertex AI provider implementation
 *
 * Implements the LLMProvider interface for Google's Vertex AI platform.
 * Uses Application Default Credentials (ADC) instead of an API key.
 *
 * Feature parity with Google AI Studio since the API surface is identical:
 * - Structured output (via Google helpers with injected Vertex client)
 * - Preset generation (via Google helpers with injected Vertex client)
 * - Conversation compaction (via Google helpers with injected Vertex client)
 * - Embeddings (direct Vertex client call)
 * - Native image generation (via Vertex chat responses with IMAGE modality)
 * - Chat streaming + tool calling (via VertexStreamAdapter)
 */

import type { ZodType } from "zod";
import type { GoogleGenAI, HarmBlockThreshold, HarmCategory } from "@google/genai";
import type {
  BaseGuildTextChannel,
  BaseGuildVoiceChannel,
  Client,
  CommandInteraction,
  Message,
  DMChannel,
  AnyThreadChannel,
} from "discord.js";
import { StreamOrchestrator } from "../../utils/discord/streamOrchestrator";
import { VertexStreamAdapter, type VertexStreamConfig } from "./vertexStreamAdapter";
import type { ProviderError, StreamContext } from "../../types/stream/interfaces";
import { DISCORD_STREAMING_CONSTANTS } from "../../types/stream/types";
import { type ToolStateForContext, getAvailableToolsWithMCP } from "../../tools/toolRegistry";
import type { StreamingContext } from "../../types/tool/interfaces";
import type { TomoriState } from "../../types/db/schema";
import type { StructuredContextItem } from "../../types/misc/context";
import { log } from "../../utils/misc/logger";
import { buildGoogleThinkingConfig } from "@/utils/provider/thinkingControl";
import {
  BaseLLMProvider,
  type FunctionCall,
  type LLMProvider,
  type ProviderConfig,
  type StreamResult,
  type ApiKeyValidationResult,
} from "../../types/provider/interfaces";
import type {
  CompactConversationResult,
  CompactRoleplayResult,
  EmbeddingRequest,
  PresetGenerationResult,
  ProviderCompactSummaryRequest,
  ProviderNativeImageGenerationRequest,
  ProviderNativeImageGenerationResult,
  ProviderPresetGenerationRequest,
  ProviderStructuredJsonRequest,
  StructuredOutputResult,
  SupportsConversationCompaction,
  SupportsEmbeddings,
  SupportsNativeImageGeneration,
  SupportsPresetGeneration,
  SupportsStructuredOutput,
} from "../../types/provider/featureInterfaces";
import { getVertexToolAdapter } from "./vertexToolAdapter";
import { parseVertexCompositeKey, createVertexClient } from "./vertexClient";
import { getCachedDefaultLLM, isLLMCacheReady } from "../../utils/cache/llmCache";
import { loadDefaultModelForProvider, loadAvailableModelsForProvider } from "../../utils/db/dbRead";
import { vertexProviderInfo } from "./providerInfo";
import { callGoogleStructuredJSON } from "../google/googleStructuredOutput";
import { generateConversationSummaryGoogle, generateRoleplaySummaryGoogle } from "../google/compactGenerator";
import { generatePresetFromPrompt } from "../google/presetGenerator";
import { getActiveTemperature, isParamDisabled } from "@/utils/provider/samplingControl";
import { applyDeliberateToolAllowlist } from "@/utils/tools/deliberateToolMode";

/**
 * Gets the default Vertex model with a robust fallback chain:
 * 1. Cached is_default LLM from the database
 * 2. Database query for is_default model
 * 3. First non-deprecated model from database
 * 4. Throws error if no models are available
 * @returns Promise<string> - The default model codename
 */
async function getDefaultVertexModel(): Promise<string> {
  const providerName = "vertex";

  // 1. Try cache first (fastest, no DB query)
  if (isLLMCacheReady()) {
    const cachedDefault = getCachedDefaultLLM(providerName);
    if (cachedDefault) {
      log.info(`Using cached default ${providerName} model: ${cachedDefault.llm_codename}`);
      return cachedDefault.llm_codename;
    }
  }

  // 2. Query database for is_default model
  try {
    const dbDefault = await loadDefaultModelForProvider(providerName);
    if (dbDefault) {
      log.info(`Using database default ${providerName} model: ${dbDefault.llm_codename}`);
      return dbDefault.llm_codename;
    }
  } catch (error) {
    log.warn(`Failed to load default model from database for ${providerName}`, {
      error: error as Error,
    });
  }

  // 3. Fallback to first non-deprecated model
  try {
    const availableModels = await loadAvailableModelsForProvider(providerName);
    if (availableModels && availableModels.length > 0) {
      const firstModel = availableModels[0].llm_codename;
      log.warn(`No default model found, using first available ${providerName} model: ${firstModel}`);
      return firstModel;
    }
  } catch (error) {
    log.error(`Failed to load available models for ${providerName}`, error as Error);
  }

  // 4. No models found
  throw new Error(`No default model found for provider: ${providerName}. Please configure models in the database.`);
}

/** Vertex-specific configuration extending the base ProviderConfig */
export interface VertexProviderConfig extends ProviderConfig {
  safetySettings: Array<{
    category: string;
    threshold: string;
  }>;
  generationConfig: {
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
}

/**
 * Vertex AI provider implementation with full feature parity.
 *
 * All Google-family helpers accept an optional pre-built client, so
 * Vertex simply constructs its ADC client and passes it through.
 */
export class VertexProvider
  extends BaseLLMProvider
  implements
    LLMProvider,
    SupportsEmbeddings,
    SupportsStructuredOutput,
    SupportsPresetGeneration,
    SupportsConversationCompaction,
    SupportsNativeImageGeneration
{
  /**
   * Get provider information and capabilities
   */
  getInfo() {
    return vertexProviderInfo;
  }

  // ─── Client helper ──────────────────────────────────────────────────

  /**
   * Build a Vertex GoogleGenAI client from the composite key.
   * @param compositeKey - The stored {project_id}::{location} string
   * @returns GoogleGenAI client configured for Vertex AI
   */
  private buildClient(compositeKey: string): GoogleGenAI {
    const config = parseVertexCompositeKey(compositeKey);
    return createVertexClient(config);
  }

  // ─── ApiKeyValidation ────────────────────────────────────────────────

  async validateApiKey(compositeKey: string): Promise<ApiKeyValidationResult> {
    // 1. Parse and validate composite-key format
    let genAI: GoogleGenAI;
    try {
      genAI = this.buildClient(compositeKey);
    } catch (parseError) {
      log.warn("Vertex composite key parse failed", {
        error: parseError as Error,
      });
      const adapter = new VertexStreamAdapter();
      const providerError = adapter.handleProviderError(parseError);
      return { valid: false, error: providerError };
    }

    // 2. Test with a lightweight generateContent call
    try {
      log.info("Validating Vertex AI configuration...");

      const defaultModel = await getDefaultVertexModel();
      const response = await genAI.models.generateContent({
        model: defaultModel,
        contents: [
          {
            text: 'This is a test message for verifying configuration. Say "VALID"',
          },
        ],
      });

      const responseText = response.text;

      if (!responseText?.toLowerCase().includes("valid")) {
        log.warn("Vertex validation response did not contain 'VALID'");
        const adapter = new VertexStreamAdapter();
        const error = new Error("Validation response did not contain expected confirmation");
        const providerError = adapter.handleProviderError(error);
        return { valid: false, error: providerError };
      }

      log.success("Vertex AI configuration validation successful");
      return { valid: true };
    } catch (error) {
      const adapter = new VertexStreamAdapter();
      const providerError = adapter.handleProviderError(error);

      await log.error("Vertex AI configuration validation failed", error, {
        errorType: "APIKeyValidationError",
        metadata: {
          provider: "vertex",
          errorCode: providerError.code,
          errorType: providerError.type,
        },
      });
      return { valid: false, error: providerError };
    }
  }

  // ─── Error formatting ───────────────────────────────────────────────

  formatErrorDescription(error: ProviderError, locale: string): string | null {
    const adapter = new VertexStreamAdapter();
    return adapter.createErrorDescription(error, locale);
  }

  // ─── SupportsEmbeddings ─────────────────────────────────────────────

  supportsEmbeddingTaskType(): boolean {
    return true;
  }

  async generateEmbeddings(request: EmbeddingRequest): Promise<number[][]> {
    if (request.inputs.length === 0) {
      return [];
    }

    const genAI = this.buildClient(request.apiKey);
    const response = await genAI.models.embedContent({
      model: request.model,
      contents: request.inputs,
      config: request.taskType ? { taskType: request.taskType } : undefined,
    });

    // Extract embeddings from response (same format as Google)
    const raw = response as unknown as {
      embeddings?: Array<{ values?: number[] } | number[]>;
      embedding?: { values?: number[] } | number[];
    };

    const embeddingsList = Array.isArray(raw?.embeddings) ? raw.embeddings : raw?.embedding ? [raw.embedding] : [];

    return embeddingsList
      .map((entry) => {
        if (Array.isArray(entry)) {
          return entry;
        }
        if (entry && Array.isArray((entry as { values?: number[] }).values)) {
          return (entry as { values: number[] }).values;
        }
        return [];
      })
      .filter((values) => values.length > 0);
  }

  // ─── SupportsStructuredOutput ────────────────────────────────────────

  getExpressionInitializationBatchSize(): number {
    return 30;
  }

  async callStructuredJSON<T>(
    request: ProviderStructuredJsonRequest,
    responseSchema: Record<string, unknown>,
    zodSchema: ZodType<T>,
  ): Promise<StructuredOutputResult<T>> {
    const client = this.buildClient(request.apiKey);
    return await callGoogleStructuredJSON(request, responseSchema, zodSchema, client);
  }

  // ─── SupportsPresetGeneration ────────────────────────────────────────

  async generatePreset(request: ProviderPresetGenerationRequest): Promise<PresetGenerationResult> {
    const client = this.buildClient(request.apiKey);
    return await generatePresetFromPrompt(
      request.apiKey,
      {
        ...request.params,
        modelName: request.tomoriState.llm.llm_codename,
      },
      request.locale,
      client,
    );
  }

  // ─── SupportsConversationCompaction ──────────────────────────────────

  async generateConversationSummary(request: ProviderCompactSummaryRequest): Promise<CompactConversationResult> {
    const client = this.buildClient(request.apiKey);
    return await generateConversationSummaryGoogle(request, client);
  }

  async generateRoleplaySummary(request: ProviderCompactSummaryRequest): Promise<CompactRoleplayResult> {
    const client = this.buildClient(request.apiKey);
    return await generateRoleplaySummaryGoogle(request, client);
  }

  async generateNativeImage(
    request: ProviderNativeImageGenerationRequest,
  ): Promise<ProviderNativeImageGenerationResult> {
    const genAI = this.buildClient(request.apiKey);
    const chat = genAI.chats.create({
      model: request.model,
    });

    const messagePayload: {
      message: string;
      media?: Array<{ mimeType: string; data: string }>;
      config: {
        responseModalities: string[];
        imageConfig: {
          aspectRatio: string;
        };
      };
    } = {
      message: request.prompt,
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: request.aspectRatio,
        },
      },
    };

    if (request.referenceImages && request.referenceImages.length > 0) {
      messagePayload.media = request.referenceImages;
    }

    const response = await chat.sendMessage(messagePayload);
    if (response?.candidates && response.candidates.length > 0 && response.candidates[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          return {
            imageData: part.inlineData.data,
            mimeType: part.inlineData.mimeType ?? null,
          };
        }
      }
    }

    throw new Error("Vertex image generation response did not contain inline image data");
  }

  // ─── Tools ──────────────────────────────────────────────────────────

  async getTools(
    tomoriState: TomoriState,
    streamingContext?: StreamingContext,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const toolStateForContext: ToolStateForContext = {
        server_id: tomoriState.server_id.toString(),
        activePersonaHasElevenlabsVoice: Boolean(
          tomoriState.speech_voice_sample_id ||
            tomoriState.speech_voice_design_prompt?.trim() ||
            tomoriState.speech_voice_id?.trim() ||
            tomoriState.elevenlabs_voice_id?.trim(),
        ),
        activePersonaVoiceDesignPrompt: tomoriState.speech_voice_design_prompt?.trim() || null,
        activePersonaVoiceName: tomoriState.speech_voice_name,
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
          sticker_usage_enabled: tomoriState.config.sticker_usage_enabled,
          web_search_enabled: tomoriState.config.web_search_enabled,
          self_teaching_enabled: tomoriState.config.self_teaching_enabled,
          manage_message_enabled: tomoriState.config.manage_message_enabled,
          imagegen_enabled: tomoriState.config.imagegen_enabled,
          videogen_enabled: tomoriState.config.videogen_enabled,
          nai_exclusive_imggen: tomoriState.config.nai_exclusive_imggen,
          voice_message_enabled: tomoriState.config.voice_message_enabled,
          thread_creation_enabled: tomoriState.config.thread_creation_enabled,
        },
      };

      const {
        builtInTools: availableBuiltInTools,
        mcpFunctionNames: availableMcpFunctionNames,
        totalCount,
      } = await getAvailableToolsWithMCP("vertex", toolStateForContext);

      // Apply streaming context filtering if available
      let finalBuiltInTools = availableBuiltInTools;
      let finalMcpFunctionNames = availableMcpFunctionNames;
      if (streamingContext) {
        const minimalContext = {
          streamContext: streamingContext,
          provider: "vertex" as const,
          channel: {} as BaseGuildTextChannel,
          client: {} as Client,
          tomoriState: tomoriState,
          locale: "en-US",
        };

        finalBuiltInTools = availableBuiltInTools.filter((tool) => {
          const isContextAvailable =
            "isAvailableForContext" in tool && typeof tool.isAvailableForContext === "function"
              ? tool.isAvailableForContext("vertex", minimalContext)
              : true;

          return isContextAvailable;
        });

        log.info(
          `Applied streaming context filtering: ${availableBuiltInTools.length} → ${finalBuiltInTools.length} built-in tools`,
        );
      }

      ({ builtInTools: finalBuiltInTools, mcpFunctionNames: finalMcpFunctionNames } =
        applyDeliberateToolAllowlist({
          providerLabel: "Vertex provider",
          builtInTools: finalBuiltInTools,
          mcpFunctionNames: finalMcpFunctionNames,
          allowedToolNames: streamingContext?.deliberateToolAllowedNames,
        }));

      // Use the Vertex tool adapter to get all tools in Gemini format
      const vertexAdapter = getVertexToolAdapter();
      const allToolsConfig = await vertexAdapter.getAllToolsInProviderFormat(
        finalBuiltInTools,
        tomoriState.server_id,
        finalMcpFunctionNames,
      );

      log.info(
        `Vertex provider tools loaded: ${finalBuiltInTools.length} built-in + ${finalMcpFunctionNames.length} MCP = ${totalCount} total tools`,
      );

      return allToolsConfig;
    } catch (error) {
      log.error(`Failed to get tools for Vertex provider: ${tomoriState.llm.llm_codename}`, error as Error);
      return [];
    }
  }

  // ─── Default model ──────────────────────────────────────────────────

  async getDefaultModel(): Promise<string> {
    return await getDefaultVertexModel();
  }

  // ─── Config ─────────────────────────────────────────────────────────

  async createConfig(tomoriState: TomoriState, apiKey: string): Promise<VertexProviderConfig> {
    const maxOutputTokens =
      tomoriState.config.llm_max_output_tokens ?? Number.parseInt(process.env.GOOGLE_MAX_OUTPUT_TOKENS || "8192", 10);
    const disabledParams = tomoriState.config.llm_disabled_params ?? [];
    const temperature = getActiveTemperature(tomoriState.config);
    const topKDisabled = isParamDisabled(disabledParams, "topK");
    const topPDisabled = isParamDisabled(disabledParams, "topP");

    const config: VertexProviderConfig = {
      model: tomoriState.llm.llm_codename,
      apiKey: apiKey,
      temperature: tomoriState.config.llm_temperature,
      disabledParams,
      maxOutputTokens,
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        },
      ],
      generationConfig: {
        ...(temperature !== undefined && {
          temperature,
        }),
        ...(!topKDisabled &&
          tomoriState.config.llm_top_k > 0 && {
            topK: tomoriState.config.llm_top_k,
          }),
        ...(!topPDisabled &&
          tomoriState.config.llm_top_p < 1.0 && {
            topP: tomoriState.config.llm_top_p,
          }),
        maxOutputTokens,
        stopSequences: [],
      },
    };

    // Only attach tools for models that support function calling
    if (tomoriState.llm.has_tools) {
      config.tools = await this.getTools(tomoriState);
    }

    return config;
  }

  // ─── Streaming ──────────────────────────────────────────────────────

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
    log.info(`VertexProvider: Starting modular streaming for server ${tomoriState.server_id}, model ${config.model}`);

    try {
      const vertexConfig = config as VertexProviderConfig;

      // Ensure safety settings exist
      const safetySettings = vertexConfig.safetySettings || [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE",
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE",
        },
      ];

      const streamConfig: VertexStreamConfig = {
        ...vertexConfig,
        maxMessageLength: DISCORD_STREAMING_CONSTANTS.MAX_SINGLE_MESSAGE_LENGTH,
        flushBufferSize: DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_REGULAR,
        flushBufferSizeCodeBlock: DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_CODE_BLOCK,
        inactivityTimeoutMs: DISCORD_STREAMING_CONSTANTS.INACTIVITY_TIMEOUT_MS,
        baseTypeSpeedMsPerChar: DISCORD_STREAMING_CONSTANTS.BASE_TYPE_SPEED_MS_PER_CHAR,
        maxTypingTimeMs: DISCORD_STREAMING_CONSTANTS.MAX_TYPING_TIME_MS,
        minVisibleTypingDurationMs: DISCORD_STREAMING_CONSTANTS.MIN_VISIBLE_TYPING_DURATION_MS,
        humanizerDegree: tomoriState.config.humanizer_degree,
        emojiUsageEnabled: tomoriState.config.emoji_usage_enabled,
        safetySettings: safetySettings.map((setting) => ({
          category: setting.category as HarmCategory,
          threshold: setting.threshold as HarmBlockThreshold,
        })),
        forceReason: streamingContext?.forceReason,
        isManuallyTriggered: streamingContext?.isManuallyTriggered,
      };

      const thinkingConfig = buildGoogleThinkingConfig(
        config.model ?? "",
        tomoriState.config.thinking_level,
        streamingContext?.forceReason,
      );
      if (thinkingConfig) {
        streamConfig.thinkingConfig = thinkingConfig;
        log.info(`VertexProvider: Applied thinking config for model ${config.model}`);
      }

      // Override tools with context-aware tools when streaming context is provided
      if (streamingContext && tomoriState.llm.has_tools) {
        log.info("VertexProvider: Reloading tools with streaming context for context-aware availability");
        const contextAwareTools = await this.getTools(tomoriState, streamingContext);
        streamConfig.tools = contextAwareTools;
      } else if (streamingContext && !tomoriState.llm.has_tools) {
        log.info("VertexProvider: Skipping context-aware tool reload - model doesn't support tools");
      }

      // Create streaming context
      const streamContext: StreamContext = {
        channel,
        client,
        initialInteraction,
        replyToMessage,
        tomoriState,
        contextItems,
        currentTurnModelParts,
        emojiStrings,
        functionInteractionHistory,
        provider: "vertex",
        locale: userLocale ?? "en-US",
        suppressUserErrors: streamingContext?.suppressUserErrors,
        suppressTextOutput: streamingContext?.suppressTextOutput,
        rotationKeyRetriesUsed: streamingContext?.rotationKeyRetriesUsed,
        outputPrefill: streamingContext?.outputPrefill,
        outputPrefillState: streamingContext?.outputPrefillState,
        replyNoticeState: streamingContext?.replyNoticeState,
        webhook,
        personaAvatarUrl,
        personaUsername,
        prefixStrippingName,
        forcedMentions: streamingContext?.forcedMentions,
        abortSignal: streamingContext?.abortSignal,

        // Opaque message ID map for snowflake ID abstraction in LLM-visible text
        messageIdMap: streamingContext?.messageIdMap,
      };

      // Create streaming components
      const orchestrator = new StreamOrchestrator();
      const vertexAdapter = new VertexStreamAdapter();

      log.info("VertexProvider: Delegating to StreamOrchestrator with VertexStreamAdapter");
      const result = await orchestrator.streamToDiscord(vertexAdapter, streamConfig, streamContext);

      log.info(
        `VertexProvider: Modular streaming completed with status: ${result.status}${result.status === "stopped_by_user" && result.stopReason ? ` (reason: ${result.stopReason})` : ""}`,
      );
      return result;
    } catch (error) {
      log.error(
        `VertexProvider modular streaming error for server ${tomoriState.server_id}, model ${config.model}, channel ${channel.id}`,
        error as Error,
      );

      return {
        status: "error",
        data: error as Error,
      };
    }
  }
}

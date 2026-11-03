/**
 * NovelAI provider implementation
 * Implements the LLMProvider interface for NovelAI's text generation models
 *
 * NovelAI is a roleplay-focused provider that:
 * - Uses flat text prompts (no structured messages)
 * - Does not support images or videos
 * - Specializes in creative storytelling and roleplay
 */

import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";
import type {
  BaseGuildTextChannel,
  BaseGuildVoiceChannel,
  Client,
  CommandInteraction,
  Message,
  DMChannel,
  AnyThreadChannel,
} from "discord.js";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { buildStreamContext } from "@/utils/provider/streamContext";
import { NovelaiStreamAdapter } from "./novelaiStreamAdapter";
import type { ProviderError, StreamConfig, StreamContext } from "@/types/stream/interfaces";
import { DISCORD_STREAMING_CONSTANTS } from "@/types/stream/types";
import type { StreamingContext } from "@/types/tool/interfaces";
import type { TomoriState } from "@/types/db/schema";
import type { StructuredContextItem } from "@/types/misc/context";
import { log } from "@/utils/misc/logger";
import {
  BaseLLMProvider,
  type FunctionCall,
  type LLMProvider,
  type ProviderConfig,
  type ProviderInfo,
  type StreamResult,
  type ApiKeyValidationResult,
} from "@/types/provider/interfaces";
import { getCachedDefaultLLM, isLLMCacheReady } from "@/utils/cache/llmCache";
import { llmModelRepo } from "@/utils/db/repositories";
import { validateNovelAIApiKey } from "./novelaiService";
import { novelaiProviderInfo } from "./providerInfo";
import { getActiveTemperature } from "@/utils/provider/samplingControl";

/**
 * Gets the default NovelAI model with a robust fallback chain:
 * 1. First checks the cached is_default LLM from the database
 * 2. Falls back to database query for is_default model if cache is not ready
 * 3. Falls back to first non-deprecated model from database
 * 4. Throws error if no models are available
 * @returns Promise<string> - The default model codename
 */
async function getDefaultNovelAIModel(): Promise<string> {
  const providerName = "novelai";

  if (isLLMCacheReady()) {
    const cachedDefault = getCachedDefaultLLM(providerName);
    if (cachedDefault) {
      log.info(`Using cached default ${providerName} model: ${cachedDefault.llm_codename}`);
      return cachedDefault.llm_codename;
    }
  }

  try {
    const dbDefault = await llmModelRepo.loadDefaultModel(providerName);
    if (dbDefault) {
      log.info(`Using database default ${providerName} model: ${dbDefault.llm_codename}`);
      return dbDefault.llm_codename;
    }
  } catch (error) {
    log.warn(`Failed to load default model from database for ${providerName}`, {
      error: error as Error,
    });
  }

  try {
    const availableModels = await llmModelRepo.loadAvailableModelsForProvider(providerName);
    if (availableModels && availableModels.length > 0) {
      const firstModel = availableModels[0].llm_codename;
      log.warn(`No default model found, using first available ${providerName} model: ${firstModel}`);
      return firstModel;
    }
  } catch (error) {
    log.error(`Failed to load available models for ${providerName}`, error as Error);
  }

  throw new Error(`No default model found for provider: ${providerName}. Please configure models in the database.`);
}

/**
 * NovelAI-specific configuration extending the base ProviderConfig
 * NovelAI has minimal configuration compared to other providers
 */
export interface NovelaiProviderConfig extends ProviderConfig {
  // NovelAI uses flat parameters in the service layer
  // No provider-specific config needed here
}

export class NovelaiProvider extends BaseLLMProvider implements LLMProvider {
  /**
   * Get provider information and capabilities
   */
  getInfo(): ProviderInfo {
    return novelaiProviderInfo;
  }

  /**
   * Validate a NovelAI API key by making a test request
   * @returns Promise<ApiKeyValidationResult> - Validation result with detailed error info if failed
   */
  async validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
    if (!apiKey || apiKey.trim().length < 10) {
      log.warn("NovelAI API key is too short or empty");
      const novelaiAdapter = new NovelaiStreamAdapter();
      const error = new Error("API key is too short or empty");
      const providerError = novelaiAdapter.handleProviderError(error);
      return { valid: false, error: providerError };
    }

    try {
      log.info("Validating NovelAI API key...");
      await validateNovelAIApiKey(apiKey);

      log.success("NovelAI API key validation successful");
      return { valid: true };
    } catch (error) {
      const novelaiAdapter = new NovelaiStreamAdapter();
      const providerError = novelaiAdapter.handleProviderError(error);

      const isUserError = providerError.type === "api_error";

      if (!isUserError) {
        await log.error("API key validation failed", error, {
          errorType: "APIKeyValidationError",
          metadata: {
            provider: "novelai",
            errorCode: providerError.code,
            errorType: providerError.type,
          },
        });
      } else {
        log.warn(`NovelAI API key validation failed (user input error): ${providerError.message}`);
      }
      return { valid: false, error: providerError };
    }
  }

  formatErrorDescription(error: ProviderError, locale: string): string | null {
    const novelaiAdapter = new NovelaiStreamAdapter();
    return novelaiAdapter.createErrorDescription(error, locale);
  }

  async getTools(): Promise<Array<Record<string, unknown>>> {
    return [];
  }

  /**
   * Uses the robust fallback chain: cache > database
   * @returns Promise<string> - The default model codename
   */
  async getDefaultModel(): Promise<string> {
    return await getDefaultNovelAIModel();
  }

  /**
   * Convert provider-specific configuration from TomoriState
   */
  async createConfig(tomoriState: TomoriState, apiKey: string): Promise<NovelaiProviderConfig> {
    const tools = await this.getTools();

    return {
      model: tomoriState.llm.llm_codename,
      apiKey: apiKey,
      temperature: getActiveTemperature(tomoriState.config) ?? tomoriState.config.llm_temperature,
      disabledParams: tomoriState.config.llm_disabled_params ?? [],
      maxOutputTokens:
        tomoriState.config.llm_max_output_tokens ?? getNovelAIProfile(tomoriState.llm.llm_codename).defaultOutputTokens,
      tools: tools,
    };
  }

  /**
   * Stream LLM response directly to a Discord channel
   * Uses the modular streaming architecture with StreamOrchestrator and NovelAIStreamAdapter
   */
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
    log.info(`NovelAIProvider: Starting streaming for server ${tomoriState.server_id}, model ${config.model}`);

    try {
      const streamConfig: StreamConfig = {
        ...config,
        tools: [],
        maxMessageLength: DISCORD_STREAMING_CONSTANTS.MAX_SINGLE_MESSAGE_LENGTH,
        flushBufferSize: DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_REGULAR,
        flushBufferSizeCodeBlock: DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_CODE_BLOCK,
        inactivityTimeoutMs: DISCORD_STREAMING_CONSTANTS.INACTIVITY_TIMEOUT_MS,
        baseTypeSpeedMsPerChar: DISCORD_STREAMING_CONSTANTS.BASE_TYPE_SPEED_MS_PER_CHAR,
        maxTypingTimeMs: DISCORD_STREAMING_CONSTANTS.MAX_TYPING_TIME_MS,
        minVisibleTypingDurationMs: DISCORD_STREAMING_CONSTANTS.MIN_VISIBLE_TYPING_DURATION_MS,
        humanizerDegree: tomoriState.config.humanizer_degree,
        emojiUsageEnabled: tomoriState.config.emoji_usage_enabled,
      };

      const streamContext: StreamContext = buildStreamContext({
        provider: "novelai",
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
      const novelaiAdapter = new NovelaiStreamAdapter();

      log.info("NovelAIProvider: Delegating to StreamOrchestrator with NovelAIStreamAdapter");
      const result = await orchestrator.streamToDiscord(novelaiAdapter, streamConfig, streamContext);

      log.info(`NovelAIProvider: Streaming completed with status: ${result.status}`);

      return result;
    } catch (error) {
      log.error(
        `NovelAIProvider streaming error for server ${tomoriState.server_id}, model ${config.model}, channel ${channel.id}`,
        error as Error,
      );

      return {
        status: "error",
        data: error as Error,
      };
    }
  }
}

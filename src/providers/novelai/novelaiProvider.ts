/**
 * NovelAI provider implementation
 * Implements the LLMProvider interface for NovelAI's text generation models
 *
 * NovelAI is a roleplay-focused provider that:
 * - Uses flat text prompts (no structured messages)
 * - Does not support function calling
 * - Does not support images or videos
 * - Specializes in creative storytelling and roleplay
 */

import type {
	BaseGuildTextChannel,
	Client,
	CommandInteraction,
	Message,
	DMChannel,
} from "discord.js";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import {
	NovelaiStreamAdapter,
	type NovelaiStreamConfig,
} from "./novelaiStreamAdapter";
import type { StreamContext } from "@/types/stream/interfaces";
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
} from "@/types/provider/interfaces";
import { getCachedDefaultLLM, isLLMCacheReady } from "@/utils/cache/llmCache";
import {
	loadDefaultModelForProvider,
	loadAvailableModelsForProvider,
} from "@/utils/db/dbRead";
import { validateNovelAIApiKey } from "./novelaiService";

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

	// 1. Try to get default from cache (fastest, no DB query)
	if (isLLMCacheReady()) {
		const cachedDefault = getCachedDefaultLLM(providerName);
		if (cachedDefault) {
			log.info(
				`Using cached default ${providerName} model: ${cachedDefault.llm_codename}`,
			);
			return cachedDefault.llm_codename;
		}
	}

	// 2. Cache not ready or no default found - query database for is_default model
	try {
		const dbDefault = await loadDefaultModelForProvider(providerName);
		if (dbDefault) {
			log.info(
				`Using database default ${providerName} model: ${dbDefault.llm_codename}`,
			);
			return dbDefault.llm_codename;
		}
	} catch (error) {
		log.warn(`Failed to load default model from database for ${providerName}`, {
			error: error as Error,
		});
	}

	// 3. Fallback to first non-deprecated model from database
	try {
		const availableModels = await loadAvailableModelsForProvider(providerName);
		if (availableModels && availableModels.length > 0) {
			const firstModel = availableModels[0].llm_codename;
			log.warn(
				`No default model found, using first available ${providerName} model: ${firstModel}`,
			);
			return firstModel;
		}
	} catch (error) {
		log.error(
			`Failed to load available models for ${providerName}`,
			error as Error,
		);
	}

	// 4. No models found - throw error
	throw new Error(
		`No default model found for provider: ${providerName}. Please configure models in the database.`,
	);
}

/**
 * NovelAI-specific configuration extending the base ProviderConfig
 * NovelAI has minimal configuration compared to other providers
 */
export interface NovelaiProviderConfig extends ProviderConfig {
	// NovelAI uses flat parameters in the service layer
	// No provider-specific config needed here
}

/**
 * NovelAI provider implementation
 */
export class NovelaiProvider extends BaseLLMProvider implements LLMProvider {
	/**
	 * Get provider information and capabilities
	 */
	getInfo(): ProviderInfo {
		return {
			name: "novelai",
			displayName: "NovelAI",
			aliases: ["nai"], // Support "nai" as an alias
			supportedModels: [], // Models are loaded dynamically from database
			requiresApiKey: true,
			supportsStreaming: true,
			supportsFunctionCalling: false, // NovelAI doesn't support function calling
			supportsImages: false, // NovelAI is text-only
			supportsVideos: false, // NovelAI is text-only
		};
	}

	/**
	 * Validate a NovelAI API key by making a test request
	 * @param apiKey - The API key to validate
	 * @returns Promise<boolean> - True if the key is valid, false otherwise
	 */
	async validateApiKey(apiKey: string): Promise<boolean> {
		if (!apiKey || apiKey.trim().length < 10) {
			log.warn("NovelAI API key is too short or empty");
			return false;
		}

		try {
			log.info("Validating NovelAI API key...");
			const isValid = await validateNovelAIApiKey(apiKey);

			if (isValid) {
				log.success("NovelAI API key validation successful");
			} else {
				log.warn("NovelAI API key validation failed");
			}

			return isValid;
		} catch (error) {
			await log.error(
				"API key validation failed",
				error,
				{
					errorType: "APIKeyValidationError",
					metadata: {
						provider: "novelai",
					},
				},
			);
			return false;
		}
	}

	/**
	 * Get available tools/functions based on Tomori's configuration
	 * NovelAI doesn't support function calling, so this always returns an empty array
	 * @param _tomoriState - The current Tomori state (unused)
	 * @param _streamingContext - Optional streaming context (unused)
	 * @returns Promise<Array<Record<string, unknown>>> - Empty array
	 */
	async getTools(
		_tomoriState: TomoriState,
		_streamingContext?: StreamingContext,
	): Promise<Array<Record<string, unknown>>> {
		// NovelAI doesn't support function calling
		log.info(
			"NovelAI provider: No tools available (function calling not supported)",
		);
		return [];
	}

	/**
	 * Get the default model for this provider
	 * Uses the robust fallback chain: cache > database
	 * @returns Promise<string> - The default model codename
	 */
	async getDefaultModel(): Promise<string> {
		return await getDefaultNovelAIModel();
	}

	/**
	 * Convert provider-specific configuration from TomoriState
	 * @param tomoriState - The current Tomori state
	 * @param apiKey - The decrypted API key
	 * @returns Promise<NovelaiProviderConfig> - Provider-specific configuration object
	 */
	async createConfig(
		tomoriState: TomoriState,
		apiKey: string,
	): Promise<NovelaiProviderConfig> {
		return {
			model: tomoriState.llm.llm_codename,
			apiKey: apiKey,
			temperature: tomoriState.config.llm_temperature,
			maxOutputTokens: 2048, // NovelAI's typical max length
			tools: [], // No tools for NovelAI
		};
	}

	/**
	 * Stream LLM response directly to a Discord channel
	 * Uses the modular streaming architecture with StreamOrchestrator and NovelAIStreamAdapter
	 */
	async streamToDiscord(
		channel: BaseGuildTextChannel | DMChannel,
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
		_streamingContext?: StreamingContext,
		userLocale?: string,
	): Promise<StreamResult> {
		log.info(
			`NovelAIProvider: Starting streaming for server ${tomoriState.server_id}, model ${config.model}`,
		);

		try {
			// Create streaming configuration
			const streamConfig: NovelaiStreamConfig = {
				...config,
				// Add Discord streaming constants
				maxMessageLength: DISCORD_STREAMING_CONSTANTS.MAX_SINGLE_MESSAGE_LENGTH,
				flushBufferSize: DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_REGULAR,
				flushBufferSizeCodeBlock:
					DISCORD_STREAMING_CONSTANTS.FLUSH_BUFFER_SIZE_CODE_BLOCK,
				inactivityTimeoutMs: DISCORD_STREAMING_CONSTANTS.INACTIVITY_TIMEOUT_MS,
				baseTypeSpeedMsPerChar:
					DISCORD_STREAMING_CONSTANTS.BASE_TYPE_SPEED_MS_PER_CHAR,
				maxTypingTimeMs: DISCORD_STREAMING_CONSTANTS.MAX_TYPING_TIME_MS,
				minVisibleTypingDurationMs:
					DISCORD_STREAMING_CONSTANTS.MIN_VISIBLE_TYPING_DURATION_MS,
				humanizerDegree: tomoriState.config.humanizer_degree,
				emojiUsageEnabled: tomoriState.config.emoji_usage_enabled,
			};

			// Create streaming context
			const streamContext: StreamContext = {
				// Discord context
				channel,
				client,
				initialInteraction,
				replyToMessage,

				// Application context
				tomoriState,
				contextItems,
				currentTurnModelParts,
				emojiStrings,
				functionInteractionHistory,

				// Provider context
				provider: "novelai",
				locale: userLocale ?? "en-US", // Use user's preferred locale, fallback to en-US
			};

			// Create the modular streaming components
			const orchestrator = new StreamOrchestrator();
			const novelaiAdapter = new NovelaiStreamAdapter();

			// Execute streaming with the modular architecture
			log.info(
				"NovelAIProvider: Delegating to StreamOrchestrator with NovelAIStreamAdapter",
			);
			const result = await orchestrator.streamToDiscord(
				novelaiAdapter,
				streamConfig,
				streamContext,
			);

			log.info(
				`NovelAIProvider: Streaming completed with status: ${result.status}`,
			);
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

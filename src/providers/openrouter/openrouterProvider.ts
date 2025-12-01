/**
 * OpenRouter provider implementation
 * Implements the LLMProvider interface for OpenRouter's multi-provider API
 *
 * Uses the modular streaming architecture with StreamOrchestrator
 * and OpenrouterStreamAdapter for better code organization and maintainability.
 */

import type {
	BaseGuildTextChannel,
	Client,
	CommandInteraction,
	Message,
	DMChannel,
} from "discord.js";
import { StreamOrchestrator } from "../../utils/discord/streamOrchestrator";
import {
	OpenrouterStreamAdapter,
	type OpenrouterStreamConfig,
} from "./openrouterStreamAdapter";
import type { StreamContext } from "../../types/stream/interfaces";
import { DISCORD_STREAMING_CONSTANTS } from "../../types/stream/types";
import {
	type ToolStateForContext,
	getAvailableToolsWithMCP,
} from "../../tools/toolRegistry";
import type { StreamingContext } from "../../types/tool/interfaces";
import type { TomoriState } from "../../types/db/schema";
import type { StructuredContextItem } from "../../types/misc/context";
import { log } from "../../utils/misc/logger";
import {
	BaseLLMProvider,
	type FunctionCall,
	type LLMProvider,
	type ProviderConfig,
	type ProviderInfo,
	type StreamResult,
	type FunctionResponseImageMetadata,
} from "../../types/provider/interfaces";
import { getOpenrouterToolAdapter } from "./openrouterToolAdapter";
import {
	getCachedDefaultLLM,
	isLLMCacheReady,
} from "../../utils/cache/llmCache";
import {
	loadDefaultModelForProvider,
	loadAvailableModelsForProvider,
} from "../../utils/db/dbRead";

/**
 * Gets the default OpenRouter model with a robust fallback chain:
 * 1. First checks the cached is_default LLM from the database
 * 2. Falls back to database query for is_default model if cache is not ready
 * 3. Falls back to first non-deprecated model from database
 * 4. Throws error if no models are available
 * @returns Promise<string> - The default model codename
 */
async function getDefaultOpenrouterModel(): Promise<string> {
	const providerName = "openrouter";

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

// OpenRouter-specific configuration extending the base ProviderConfig
export interface OpenrouterProviderConfig extends ProviderConfig {
	// OpenRouter uses OpenAI-compatible API, simple configuration
	seesImages?: boolean; // Whether the model supports image inputs
	// Sampling parameters to control output quality
	topP?: number; // Nucleus sampling (0.0-1.0)
	topK?: number; // Top-k sampling
	frequencyPenalty?: number; // Penalize frequent tokens (-2.0 to 2.0)
	presencePenalty?: number; // Penalize repeated topics (-2.0 to 2.0)
	repetitionPenalty?: number; // Penalize token repetition (0.0-2.0)
}

/**
 * OpenRouter provider implementation
 */
export class OpenrouterProvider extends BaseLLMProvider implements LLMProvider {
	/**
	 * Get provider information and capabilities
	 */
	getInfo(): ProviderInfo {
		return {
			name: "openrouter",
			displayName: "OpenRouter",
			aliases: ["or"], // Support "or" as an alias
			supportedModels: [], // Models are loaded dynamically from database
			requiresApiKey: true,
			supportsStreaming: true,
			supportsFunctionCalling: true,
			supportsImages: true, // Depends on specific models
			supportsVideos: false, // Most models don't support video yet
		};
	}

	/**
	 * Validate an OpenRouter API key using the dedicated auth endpoint
	 * This method doesn't require a specific model and is more reliable than making a test chat request
	 * @param apiKey - The API key to validate
	 * @returns Promise<boolean> - True if the key is valid, false otherwise
	 */
	async validateApiKey(apiKey: string): Promise<boolean> {
		if (!apiKey || apiKey.trim().length < 10) {
			log.warn("API key is too short or empty");
			return false;
		}

		try {
			log.info("Validating OpenRouter API key...");

			// Use OpenRouter's dedicated auth endpoint to validate the key
			// This is more reliable than making a test chat request because:
			// 1. It doesn't depend on a specific model being available
			// 2. It doesn't consume credits
			// 3. It's faster and more accurate
			const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
				method: "GET",
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
			});

			// Check if the response is successful (2xx status code)
			if (!response.ok) {
				log.warn(
					`API key validation failed with status ${response.status}: ${response.statusText}`,
				);
				return false;
			}

			// Parse the response to ensure it contains valid user data
			const data = await response.json();

			// Validate that we got proper user data structure
			// The response should contain user information and rate limits
			if (!data || typeof data !== "object") {
				log.warn("API key validation received invalid response structure");
				return false;
			}

			log.success("API key validation successful");
			return true;
		} catch (error) {
			// Log the specific error during validation failure
			log.error(
				`API key validation failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		}
	}

	/**
	 * Get available tools/functions based on Tomori's configuration
	 * Uses the enhanced tool adapter that handles both built-in and MCP tools
	 * @param tomoriState - The current Tomori state with configuration
	 * @param streamingContext - Optional streaming context for context-aware tool availability
	 * @returns Promise<Array<Record<string, unknown>>> - Array of tool configurations
	 */
	async getTools(
		tomoriState: TomoriState,
		streamingContext?: StreamingContext,
	): Promise<Array<Record<string, unknown>>> {
		try {
			// Get built-in tools from the registry
			const toolStateForContext: ToolStateForContext = {
				server_id: tomoriState.server_id.toString(),
				config: {
					sticker_usage_enabled: tomoriState.config.sticker_usage_enabled,
					web_search_enabled: tomoriState.config.web_search_enabled,
					self_teaching_enabled: tomoriState.config.self_teaching_enabled,
					pin_message_enabled: tomoriState.config.pin_message_enabled,
				},
			};

			// Use context-aware tool availability when streaming context is provided
			// Use centralized tool filtering (built-in + MCP with feature flags)
			const {
				builtInTools: availableBuiltInTools,
				mcpFunctionNames,
				totalCount,
			} = await getAvailableToolsWithMCP("openrouter", toolStateForContext);

			// Apply streaming context filtering if available
			let finalBuiltInTools = availableBuiltInTools;
			if (streamingContext) {
				// Create a minimal ToolContext for context-aware availability checking
				const minimalContext = {
					streamContext: streamingContext,
					provider: "openrouter" as const,
					channel: {} as BaseGuildTextChannel,
					client: {} as Client,
					tomoriState: tomoriState,
					locale: "en-US", // Default locale
				};

				// Apply additional streaming-aware filtering for tools that support it
				finalBuiltInTools = availableBuiltInTools.filter((tool) => {
					const isContextAvailable =
						"isAvailableForContext" in tool &&
						typeof tool.isAvailableForContext === "function"
							? tool.isAvailableForContext("openrouter", minimalContext)
							: true;

					return isContextAvailable;
				});

				log.info(
					`Applied streaming context filtering: ${availableBuiltInTools.length} → ${finalBuiltInTools.length} built-in tools`,
				);
			}

			// Use the enhanced tool adapter to get all tools (built-in + MCP)
			const openrouterAdapter = getOpenrouterToolAdapter();
			const allToolsConfig =
				await openrouterAdapter.getAllToolsInOpenrouterFormat(
					finalBuiltInTools,
					tomoriState.server_id,
					mcpFunctionNames,
				);

			log.info(
				`OpenRouter provider tools loaded: ${finalBuiltInTools.length} built-in + ${mcpFunctionNames.length} MCP = ${totalCount} total tools (centralized filtering applied)`,
			);

			return allToolsConfig;
		} catch (error) {
			log.error(
				`Failed to get tools for OpenRouter provider: ${tomoriState.llm.llm_codename}`,
				error as Error,
			);
			return [];
		}
	}

	/**
	 * Get the default model for this provider
	 * Uses the robust fallback chain: cache > database > first available
	 * @returns Promise<string> - The default model codename
	 */
	async getDefaultModel(): Promise<string> {
		return await getDefaultOpenrouterModel();
	}

	/**
	 * Convert provider-specific configuration from TomoriState
	 * @param tomoriState - The current Tomori state
	 * @param apiKey - The decrypted API key
	 * @returns Promise<OpenrouterProviderConfig> - Provider-specific configuration object
	 */
	async createConfig(
		tomoriState: TomoriState,
		apiKey: string,
	): Promise<OpenrouterProviderConfig> {
		log.info(`createConfig for model: ${tomoriState.llm.llm_codename}`);
		log.info(`has_tools flag: ${tomoriState.llm.has_tools}`);
		log.info(`sees_images flag: ${tomoriState.llm.sees_images}`);

		// Build config object - only include tools if model supports them
		// NOTE: OpenRouter models are more sensitive to temperature than other providers.
		// Database stores temperature in range 1.0-2.0, but OpenRouter works best with 0.2-1.2.
		// We subtract 0.8 to adjust the range specifically for OpenRouter (hidden from user).
		const adjustedTemperature = Math.max(
			0.2,
			Math.min(1.2, tomoriState.config.llm_temperature - 0.8),
		);

		const config: OpenrouterProviderConfig = {
			model: tomoriState.llm.llm_codename,
			apiKey: apiKey,
			temperature: adjustedTemperature,
			maxOutputTokens: 4096, // Default, can be adjusted per model
			seesImages: tomoriState.llm.sees_images, // Pass image capability flag
			// Sampling parameters to reduce hallucinations and improve coherence
			topP: 0.9, // Nucleus sampling - use top 90% probability mass
			frequencyPenalty: 0.3, // Slightly penalize frequent tokens
			presencePenalty: 0.2, // Slightly penalize repeated topics
			repetitionPenalty: 1.1, // Penalize exact token repetition
		};

		// Only add tools field if the model supports them
		if (tomoriState.llm.has_tools)
			config.tools = await this.getTools(tomoriState);

		return config;
	}

	/**
	 * Stream LLM response directly to a Discord channel
	 * Uses the modular streaming architecture with StreamOrchestrator and OpenrouterStreamAdapter
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
			imageMetadata?: FunctionResponseImageMetadata;
		}>,
		initialInteraction?: CommandInteraction,
		replyToMessage?: Message,
		streamingContext?: StreamingContext,
		userLocale?: string,
	): Promise<StreamResult> {
		log.info(
			`OpenrouterProvider: Starting modular streaming for server ${tomoriState.server_id}, model ${config.model}`,
		);

		try {
			// Convert the generic config to OpenRouter-specific streaming config
			const openrouterConfig = config as OpenrouterProviderConfig;

			const streamConfig: OpenrouterStreamConfig = {
				...openrouterConfig,
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
				seesImages: tomoriState.llm.sees_images,
				// Command-specific overrides from streaming context
				forceReason: streamingContext?.forceReason,
				isManuallyTriggered: streamingContext?.isManuallyTriggered,
			};

			// Override tools with context-aware tools when streaming context is provided
			// BUT only if the model supports tools
			if (streamingContext && tomoriState.llm.has_tools) {
				log.info(
					"OpenrouterProvider: Reloading tools with streaming context for context-aware availability",
				);
				const contextAwareTools = await this.getTools(
					tomoriState,
					streamingContext,
				);
				streamConfig.tools = contextAwareTools;
				log.info(
					`Context-aware tools loaded: ${contextAwareTools.length} tools`,
				);
			} else if (streamingContext && !tomoriState.llm.has_tools) {
				log.info(
					"Skipping context-aware tool reload - model doesn't support tools",
				);
			}

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
				provider: "openrouter",
				locale: userLocale ?? "en-US", // Use user's preferred locale, fallback to en-US
			};

			// Create the modular streaming components
			const orchestrator = new StreamOrchestrator();
			const openrouterAdapter = new OpenrouterStreamAdapter();

			// Execute streaming with the modular architecture
			log.info(
				"OpenrouterProvider: Delegating to StreamOrchestrator with OpenrouterStreamAdapter",
			);
			const result = await orchestrator.streamToDiscord(
				openrouterAdapter,
				streamConfig,
				streamContext,
			);

			log.info(
				`OpenrouterProvider: Modular streaming completed with status: ${result.status}`,
			);
			return result;
		} catch (error) {
			log.error(
				`OpenrouterProvider modular streaming error for server ${tomoriState.server_id}, model ${config.model}, channel ${channel.id}`,
				error as Error,
			);

			return {
				status: "error",
				data: error as Error,
			};
		}
	}
}

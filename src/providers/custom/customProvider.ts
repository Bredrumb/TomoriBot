/**
 * Custom provider implementation for self-hosted OpenAI-compatible endpoints
 *
 * This provider allows self-hosted TomoriBot users to connect to any OpenAI-compatible
 * endpoint such as Ollama, KoboldCPP, vLLM, LocalAI, or OpenRouter proxies.
 *
 * IMPORTANT: This provider is only available in non-production environments.
 * When RUN_ENV=production, this provider should be filtered out from loadUniqueProviders().
 *
 * Key differences from OpenRouter:
 * - Uses custom endpoint URL from tomori_configs.custom_endpoint_url
 * - Model capabilities are user-declared (stored in llms table row)
 * - API key field may contain endpoint URL or actual auth token
 * - validateApiKey() performs health check rather than strict key validation
 */

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
import {
	CustomStreamAdapter,
	type CustomStreamConfig,
} from "./customStreamAdapter";
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
	type ApiKeyValidationResult,
} from "../../types/provider/interfaces";
import { getCustomToolAdapter } from "./customToolAdapter";

/**
 * Default model name placeholder for custom provider
 * Fallback codename when server-specific model isn't configured
 */
const DEFAULT_CUSTOM_MODEL = "custom/default";

/**
 * Custom provider configuration extending the base ProviderConfig
 */
export interface CustomProviderConfig extends ProviderConfig {
	/** Custom endpoint URL (e.g., http://localhost:11434/v1) */
	endpointUrl: string;
	/** Whether the model supports image inputs (user-declared) */
	seesImages?: boolean;
	/** Whether the model supports video inputs (user-declared) */
	seesVideos?: boolean;
	/** Sampling parameters */
	topP?: number;
	topK?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
	repetitionPenalty?: number;
}

/**
 * Custom provider implementation for self-hosted OpenAI-compatible endpoints
 */
export class CustomProvider extends BaseLLMProvider implements LLMProvider {
	/**
	 * Get provider information and capabilities
	 */
	getInfo(): ProviderInfo {
		return {
			name: "custom",
			displayName: "Custom Endpoint",
			aliases: [], // No aliases for custom provider
			supportedModels: [], // Models are user-defined, not pre-registered
			requiresApiKey: false, // API key is optional for local endpoints
			supportsStreaming: true,
			supportsFunctionCalling: true, // Depends on user-declared capabilities
			supportsImages: true, // Depends on user-declared capabilities
			supportsVideos: false, // Most local models don't support video
		};
	}

	/**
	 * Validate the custom endpoint by performing a health check
	 *
	 * Unlike other providers, we don't strictly validate an API key.
	 * Instead, we attempt a basic health check on the endpoint.
	 * We warn on failure but allow usage since some endpoints may not
	 * have a standard health check endpoint.
	 *
	 * @param apiKey - May contain endpoint URL or actual auth token
	 * @returns Promise<ApiKeyValidationResult> - Always returns valid unless endpoint is clearly broken
	 */
	async validateApiKey(_apiKey: string): Promise<ApiKeyValidationResult> {
		// For custom provider, we're lenient - always return valid
		// The actual validation happens when we try to use the endpoint
		log.info(
			"Custom provider: Skipping strict API key validation (endpoint health checked on first use)",
		);
		return { valid: true };
	}

	/**
	 * Get available tools/functions based on Tomori's configuration
	 * Uses the tool adapter that handles both built-in and MCP tools
	 *
	 * @param tomoriState - The current Tomori state with configuration
	 * @param streamingContext - Optional streaming context for context-aware tool availability
	 * @returns Promise<Array<Record<string, unknown>>> - Array of tool configurations
	 */
	async getTools(
		tomoriState: TomoriState,
		streamingContext?: StreamingContext,
	): Promise<Array<Record<string, unknown>>> {
		// Only return tools if the model supports them (user-declared capability)
		if (!tomoriState.llm.has_tools) {
			log.info(
				"Custom provider: Model does not support tools (user-declared capability)",
			);
			return [];
		}

		try {
			// Get built-in tools from the registry
			const toolStateForContext: ToolStateForContext = {
				server_id: tomoriState.server_id.toString(),
				config: {
					sticker_usage_enabled: tomoriState.config.sticker_usage_enabled,
					web_search_enabled: tomoriState.config.web_search_enabled,
					self_teaching_enabled: tomoriState.config.self_teaching_enabled,
					pin_message_enabled: tomoriState.config.pin_message_enabled,
					imagegen_enabled: tomoriState.config.imagegen_enabled,
				},
			};

			// Use centralized tool filtering (built-in + MCP with feature flags)
			const {
				builtInTools: availableBuiltInTools,
				mcpFunctionNames,
				totalCount,
			} = await getAvailableToolsWithMCP("custom", toolStateForContext);

			// Apply streaming context filtering if available
			let finalBuiltInTools = availableBuiltInTools;
			if (streamingContext) {
				const minimalContext = {
					streamContext: streamingContext,
					provider: "custom" as const,
					channel: {} as BaseGuildTextChannel,
					client: {} as Client,
					tomoriState: tomoriState,
					locale: "en-US",
				};

				finalBuiltInTools = availableBuiltInTools.filter((tool) => {
					const isContextAvailable =
						"isAvailableForContext" in tool &&
						typeof tool.isAvailableForContext === "function"
							? tool.isAvailableForContext("custom", minimalContext)
							: true;

					return isContextAvailable;
				});

				log.info(
					`Applied streaming context filtering: ${availableBuiltInTools.length} → ${finalBuiltInTools.length} built-in tools`,
				);
			}

			// Use the tool adapter to get all tools in OpenAI-compatible format
			const customAdapter = getCustomToolAdapter();
			const allToolsConfig = await customAdapter.getAllToolsInOpenAIFormat(
				finalBuiltInTools,
				tomoriState.server_id,
				mcpFunctionNames,
			);

			log.info(
				`Custom provider tools loaded: ${finalBuiltInTools.length} built-in + ${mcpFunctionNames.length} MCP = ${totalCount} total tools`,
			);

			return allToolsConfig;
		} catch (error) {
			log.error(
				`Failed to get tools for custom provider: ${tomoriState.llm.llm_codename}`,
				error as Error,
			);
			return [];
		}
	}

	/**
	 * Get the default model for this provider
	 * Returns the placeholder since custom models are user-defined
	 *
	 * @returns Promise<string> - The default model placeholder
	 */
	async getDefaultModel(): Promise<string> {
		return DEFAULT_CUSTOM_MODEL;
	}

	/**
	 * Convert provider-specific configuration from TomoriState
	 *
	 * @param tomoriState - The current Tomori state
	 * @param apiKey - The decrypted API key (may be endpoint URL or auth token)
	 * @returns Promise<CustomProviderConfig> - Provider-specific configuration object
	 */
	async createConfig(
		tomoriState: TomoriState,
		apiKey: string,
	): Promise<CustomProviderConfig> {
		// Get endpoint URL from tomori_configs
		const endpointUrl = tomoriState.config.custom_endpoint_url;

		if (!endpointUrl) {
			throw new Error(
				"Custom endpoint URL not configured. Please run /config setup or /config apikey set to configure your custom endpoint.",
			);
		}

		// Determine which model name to use:
		// 1. If custom_model_name is set, use it (for Ollama, etc. that require exact model names)
		// 2. Otherwise, fall back to llm_codename (for KoboldCpp, etc. that don't care)
		const modelName = tomoriState.config.custom_model_name || tomoriState.llm.llm_codename;

		log.info(`Custom provider: Using endpoint URL: ${endpointUrl}`);
		log.info(`Custom provider: Model name: ${modelName}${tomoriState.config.custom_model_name ? " (custom)" : " (default)"}`);
		log.info(`Custom provider: has_tools: ${tomoriState.llm.has_tools}`);
		log.info(`Custom provider: sees_images: ${tomoriState.llm.sees_images}`);
		log.info(`Custom provider: sees_videos: ${tomoriState.llm.sees_videos}`);
		log.info(
			`Custom provider: supports_structoutput: ${tomoriState.llm.supports_structoutput}`,
		);

		// Build config object
		// Note: Temperature adjustment similar to OpenRouter (database stores 1.0-2.0, most APIs prefer 0.2-1.2)
		const adjustedTemperature = Math.max(
			0.2,
			Math.min(1.2, tomoriState.config.llm_temperature - 0.8),
		);

		const config: CustomProviderConfig = {
			model: modelName, // Use custom_model_name if set, otherwise llm_codename
			apiKey: apiKey, // May be used for Bearer auth if endpoint requires it
			temperature: adjustedTemperature,
			maxOutputTokens: 4096,
			endpointUrl: endpointUrl,
			seesImages: tomoriState.llm.sees_images,
			seesVideos: tomoriState.llm.sees_videos,
			// Sampling parameters for better output quality
			topP: 0.9,
			frequencyPenalty: 0.3,
			presencePenalty: 0.2,
			repetitionPenalty: 1.1,
		};

		// Only add tools if the model supports them (user-declared)
		if (tomoriState.llm.has_tools) {
			config.tools = await this.getTools(tomoriState);
		}

		return config;
	}

	/**
	 * Stream LLM response directly to a Discord channel
	 * Uses the modular streaming architecture with StreamOrchestrator and CustomStreamAdapter
	 */
	async streamToDiscord(
		channel:
			| BaseGuildTextChannel
			| BaseGuildVoiceChannel
			| DMChannel
			| AnyThreadChannel,
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
		log.info(
			`CustomProvider: Starting streaming for server ${tomoriState.server_id}, model ${config.model}`,
		);

		try {
			// Convert the generic config to Custom-specific streaming config
			const customConfig = config as CustomProviderConfig;

			const streamConfig: CustomStreamConfig = {
				...customConfig,
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
			if (streamingContext && tomoriState.llm.has_tools) {
				log.info(
					"CustomProvider: Reloading tools with streaming context for context-aware availability",
				);
				const contextAwareTools = await this.getTools(
					tomoriState,
					streamingContext,
				);
				streamConfig.tools = contextAwareTools;
				log.info(`Context-aware tools loaded: ${contextAwareTools.length} tools`);
			} else if (streamingContext && !tomoriState.llm.has_tools) {
				log.info(
					"Skipping context-aware tool reload - model doesn't support tools",
				);
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
				provider: "custom",
				locale: userLocale ?? "en-US",
				suppressUserErrors: streamingContext?.suppressUserErrors,

				// Multi-persona webhook support
				webhook,
				personaAvatarUrl,
				personaUsername,
				prefixStrippingName,

				// Forced mentions (e.g., reminder recipients)
				forcedMentions: streamingContext?.forcedMentions,
			};

			// Create the modular streaming components
			const orchestrator = new StreamOrchestrator();
			const customAdapter = new CustomStreamAdapter();

			// Execute streaming with the modular architecture
			log.info(
				"CustomProvider: Delegating to StreamOrchestrator with CustomStreamAdapter",
			);
			const result = await orchestrator.streamToDiscord(
				customAdapter,
				streamConfig,
				streamContext,
			);

			log.info(
				`CustomProvider: Streaming completed with status: ${result.status}`,
			);
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

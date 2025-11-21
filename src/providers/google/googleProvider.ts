/**
 * Google Gemini provider implementation
 * Implements the LLMProvider interface for Google's Gemini AI models
 *
 * Now uses the modular streaming architecture with StreamOrchestrator
 * and GoogleStreamAdapter for better code organization and maintainability.
 */

import {
	GoogleGenAI,
	type HarmBlockThreshold,
	type HarmCategory,
} from "@google/genai";
import type {
	BaseGuildTextChannel,
	Client,
	CommandInteraction,
	Message,
	DMChannel,
} from "discord.js";
import { StreamOrchestrator } from "../../utils/discord/streamOrchestrator";
import {
	GoogleStreamAdapter,
	type GoogleStreamConfig,
} from "./googleStreamAdapter";
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
} from "../../types/provider/interfaces";
import { getGoogleToolAdapter } from "./googleToolAdapter";
import {
	getCachedDefaultLLM,
	isLLMCacheReady,
} from "../../utils/cache/llmCache";
import {
	loadDefaultModelForProvider,
	loadAvailableModelsForProvider,
} from "../../utils/db/dbRead";

/**
 * Gets the default Google Gemini model with a robust fallback chain:
 * 1. First checks the cached is_default LLM from the database
 * 2. Falls back to database query for is_default model if cache is not ready
 * 3. Falls back to first non-deprecated model from database
 * 4. Throws error if no models are available
 * @returns Promise<string> - The default model codename
 */
async function getDefaultGoogleModel(): Promise<string> {
	const providerName = "google";

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

// Google-specific configuration extending the base ProviderConfig
export interface GoogleProviderConfig extends ProviderConfig {
	safetySettings: Array<{
		category: string;
		threshold: string;
	}>;
	generationConfig: {
		temperature: number;
		topK?: number;
		topP?: number;
		maxOutputTokens?: number;
		stopSequences?: string[];
	};
}

/**
 * Google Gemini provider implementation
 */
export class GoogleProvider extends BaseLLMProvider implements LLMProvider {
	/**
	 * Get provider information and capabilities
	 */
	getInfo(): ProviderInfo {
		return {
			name: "google",
			displayName: "Google Gemini",
			aliases: ["gemini"], // Support "gemini" as an alias for "google"
			supportedModels: [
				"gemini-2.5-flash",
				"gemini-2.5-pro-preview-05-06",
				"gemini-2.0-flash-thinking-exp-01-21",
			],
			requiresApiKey: true,
			supportsStreaming: true,
			supportsFunctionCalling: true,
			supportsImages: true,
			supportsVideos: true,
		};
	}

	/**
	 * Validate a Google API key by making a test request
	 * @param apiKey - The API key to validate
	 * @returns Promise<boolean> - True if the key is valid, false otherwise
	 */
	async validateApiKey(apiKey: string): Promise<boolean> {
		if (!apiKey || apiKey.trim().length < 10) {
			log.warn("API key is too short or empty");
			return false;
		}

		try {
			log.info("Validating Google API key...");

			// Initialize the Google AI client with the provided API key
			const genAI = new GoogleGenAI({ apiKey });

			// Use the default model with proper fallback chain
			const defaultModel = await getDefaultGoogleModel();
			const response = await genAI.models.generateContent({
				model: defaultModel,
				contents: [
					{
						text: 'This is a test message for verifying API keys. Say "VALID"',
					},
				],
			});

			const responseText = response.text; // Use the text getter

			if (!responseText?.toLowerCase().includes("valid")) {
				log.warn("API key validation response did not contain 'VALID'");
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
			} = await getAvailableToolsWithMCP("google", toolStateForContext);

			// Apply streaming context filtering if available
			let finalBuiltInTools = availableBuiltInTools;
			if (streamingContext) {
				// Create a minimal ToolContext for context-aware availability checking
				const minimalContext = {
					streamContext: streamingContext,
					provider: "google" as const,
					// Add minimal required fields to satisfy ToolContext interface - these are not used by YouTube tool's context check
					channel: {} as BaseGuildTextChannel,
					client: {} as Client,
					tomoriState: tomoriState,
					locale: "en-US", // Default locale
				};

				// Apply additional streaming-aware filtering for tools that support it
				finalBuiltInTools = availableBuiltInTools.filter((tool) => {
					// Use context-aware availability check if available, otherwise keep the tool
					const isContextAvailable =
						"isAvailableForContext" in tool &&
						typeof tool.isAvailableForContext === "function"
							? tool.isAvailableForContext("google", minimalContext)
							: true; // Keep tool if no context-aware check available

					return isContextAvailable;
				});

				log.info(
					`Applied streaming context filtering: ${availableBuiltInTools.length} → ${finalBuiltInTools.length} built-in tools`,
				);
			}

			// Use the enhanced tool adapter to get all tools (built-in + MCP)
			// Pass the pre-filtered MCP function names to ensure centralized filtering
			const googleAdapter = getGoogleToolAdapter();
			const allToolsConfig = await googleAdapter.getAllToolsInGoogleFormat(
				finalBuiltInTools,
				tomoriState.server_id,
				mcpFunctionNames, // Pass filtered MCP functions from centralized filtering
			);

			log.info(
				`Google provider tools loaded: ${finalBuiltInTools.length} built-in + ${mcpFunctionNames.length} MCP = ${totalCount} total tools (centralized filtering applied)`,
			);

			return allToolsConfig;
		} catch (error) {
			log.error(
				`Failed to get tools for Google provider: ${tomoriState.llm.llm_codename}`,
				error as Error,
			);
			return [];
		}
	}

	/**
	 * Get the default model for this provider
	 * Uses the robust fallback chain: cache > database > env > hardcoded
	 * @returns Promise<string> - The default model codename
	 */
	async getDefaultModel(): Promise<string> {
		return await getDefaultGoogleModel();
	}

	/**
	 * Convert provider-specific configuration from TomoriState
	 * @param tomoriState - The current Tomori state
	 * @param apiKey - The decrypted API key
	 * @returns Promise<GoogleProviderConfig> - Provider-specific configuration object
	 */
	async createConfig(
		tomoriState: TomoriState,
		apiKey: string,
	): Promise<GoogleProviderConfig> {
		const tools = await this.getTools(tomoriState);

		return {
			model: tomoriState.llm.llm_codename,
			apiKey: apiKey,
			temperature: tomoriState.config.llm_temperature,
			maxOutputTokens: 8192,
			tools: tools,
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
				temperature: tomoriState.config.llm_temperature,
				topK: 1,
				topP: 0.95,
				maxOutputTokens: 8192,
				stopSequences: [],
			},
		};
	}

	/**
	 * Stream LLM response directly to a Discord channel
	 * Now uses the modular streaming architecture with StreamOrchestrator and GoogleStreamAdapter
	 * This maintains the exact same interface for full backward compatibility
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
		streamingContext?: StreamingContext,
		userLocale?: string,
	): Promise<StreamResult> {
		log.info(
			`GoogleProvider: Starting modular streaming for server ${tomoriState.server_id}, model ${config.model}`,
		);

		try {
			// Convert the generic config to Google-specific streaming config
			const googleConfig = config as GoogleProviderConfig;

			// Ensure safetySettings exists, provide default if not
			const safetySettings = googleConfig.safetySettings || [
				{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
				{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
				{
					category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
					threshold: "BLOCK_NONE",
				},
				{
					category: "HARM_CATEGORY_DANGEROUS_CONTENT",
					threshold: "BLOCK_NONE",
				},
			];

			const streamConfig: GoogleStreamConfig = {
				...googleConfig,
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
				// Convert safety settings to Google format
				safetySettings: safetySettings.map((setting) => ({
					category: setting.category as HarmCategory,
					threshold: setting.threshold as HarmBlockThreshold,
				})),
				// Command-specific overrides from streaming context
				forceReason: streamingContext?.forceReason,
				isManuallyTriggered: streamingContext?.isManuallyTriggered,
			};

			// Override tools with context-aware tools when streaming context is provided
			if (streamingContext) {
				log.info(
					"GoogleProvider: Reloading tools with streaming context for context-aware availability",
				);
				const contextAwareTools = await this.getTools(
					tomoriState,
					streamingContext,
				);
				streamConfig.tools = contextAwareTools;
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
				provider: "google",
				locale: userLocale ?? "en-US", // Use user's preferred locale, fallback to en-US
			};

			// Create the modular streaming components
			const orchestrator = new StreamOrchestrator();
			const googleAdapter = new GoogleStreamAdapter();

			// Execute streaming with the modular architecture
			log.info(
				"GoogleProvider: Delegating to StreamOrchestrator with GoogleStreamAdapter",
			);
			const result = await orchestrator.streamToDiscord(
				googleAdapter,
				streamConfig,
				streamContext,
			);

			log.info(
				`GoogleProvider: Modular streaming completed with status: ${result.status}`,
			);
			return result;
		} catch (error) {
			log.error(
				`GoogleProvider modular streaming error for server ${tomoriState.server_id}, model ${config.model}, channel ${channel.id}`,
				error as Error,
			);

			return {
				status: "error",
				data: error as Error,
			};
		}
	}
}

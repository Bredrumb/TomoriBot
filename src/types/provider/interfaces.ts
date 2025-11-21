/**
 * Base provider interface for LLM services
 * This interface defines the contract that all LLM providers must implement
 * to work with TomoriBot's modular architecture.
 */

import type {
	BaseGuildTextChannel,
	Client,
	CommandInteraction,
	Message,
	DMChannel,
} from "discord.js";
import type { TomoriState } from "../db/schema";
import type { StructuredContextItem } from "../misc/context";
import type { StreamingContext } from "../tool/interfaces";

/**
 * Generic stream response result
 */
export interface StreamResult {
	status:
		| "completed"
		| "function_call"
		| "error"
		| "timeout"
		| "stopped_by_user"
		| "empty_response";
	data?: unknown | Error; // Function call data or error details
}

/**
 * Generic provider configuration
 * Each provider can extend this with their specific configuration
 */
export interface ProviderConfig {
	model: string;
	apiKey: string;
	temperature: number;
	maxOutputTokens?: number;
	tools?: Array<Record<string, unknown>>;
}

/**
 * Provider information and metadata
 */
export interface ProviderInfo {
	name: string;
	displayName: string;
	aliases?: string[]; // Optional aliases for provider name (e.g., ["gemini"] for "google")
	supportedModels: string[];
	requiresApiKey: boolean;
	supportsStreaming: boolean;
	supportsFunctionCalling: boolean;
	supportsImages: boolean;
	supportsVideos: boolean;
}

/**
 * Function call representation (provider-agnostic)
 */
export interface FunctionCall {
	name: string;
	args?: Record<string, unknown>;
}

/**
 * Metadata about images sent to Discord by tool execution
 * Used to make LLM aware of images it sent via tools
 */
export interface FunctionResponseImageMetadata {
	imageUrls: Array<{
		url: string;
		mimeType?: string;
		wasCompressed?: boolean;
		originalUrl?: string;
	}>;
	totalSent: number;
	totalValidated: number;
}

/**
 * Base interface that all LLM providers must implement
 */
export interface LLMProvider {
	/**
	 * Get provider information and capabilities
	 */
	getInfo(): ProviderInfo;

	/**
	 * Validate an API key by making a test request
	 * @param apiKey - The API key to validate
	 * @returns Promise<boolean> - True if the key is valid, false otherwise
	 */
	validateApiKey(apiKey: string): Promise<boolean>;

	/**
	 * Get available tools/functions based on Tomori's configuration
	 * @param tomoriState - The current Tomori state with configuration
	 * @returns Array of tool configurations specific to this provider
	 */
	getTools(tomoriState: TomoriState): Promise<Array<Record<string, unknown>>>;

	/**
	 * Stream LLM response directly to a Discord channel
	 * @param channel - The Discord TextChannel to send messages to
	 * @param client - The Discord client instance
	 * @param tomoriState - The current Tomori state
	 * @param config - Provider-specific configuration
	 * @param contextItems - An array of structured context items for the LLM
	 * @param currentTurnModelParts - Accumulated model parts for the current turn
	 * @param emojiStrings - Optional array of emoji strings for cleaning
	 * @param functionInteractionHistory - Optional function calling history
	 * @param initialInteraction - Optional initial interaction for error reporting
	 * @param replyToMessage - Optional message to reply to
	 * @param streamingContext - Optional streaming context for context-aware tool availability
	 * @param userLocale - User's preferred locale for error messages (defaults to en-US)
	 * @returns Promise<StreamResult> - The outcome of the streaming operation
	 */
	streamToDiscord(
		channel: BaseGuildTextChannel | DMChannel,
		client: Client,
		tomoriState: TomoriState,
		config: ProviderConfig,
		contextItems: StructuredContextItem[],
		currentTurnModelParts: Array<Record<string, unknown>>, // Provider-specific parts
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
	): Promise<StreamResult>;

	/**
	 * Get the default model for this provider
	 * @returns Promise<string> - The default model codename
	 */
	getDefaultModel(): Promise<string>;

	/**
	 * Convert provider-specific configuration from TomoriState
	 * @param tomoriState - The current Tomori state
	 * @param apiKey - The decrypted API key
	 * @returns Provider-specific configuration object
	 */
	createConfig(
		tomoriState: TomoriState,
		apiKey: string,
	): Promise<ProviderConfig>;
}

/**
 * Abstract base class that provides common functionality for all providers
 */
export abstract class BaseLLMProvider implements LLMProvider {
	abstract getInfo(): ProviderInfo;
	abstract validateApiKey(apiKey: string): Promise<boolean>;
	abstract getTools(
		tomoriState: TomoriState,
	): Promise<Array<Record<string, unknown>>>;
	abstract streamToDiscord(
		channel: BaseGuildTextChannel,
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
	): Promise<StreamResult>;
	abstract getDefaultModel(): Promise<string>;
	abstract createConfig(
		tomoriState: TomoriState,
		apiKey: string,
	): Promise<ProviderConfig>;

	/**
	 * Common helper method to check if a provider supports a given model
	 * @param modelCodename - The model codename to check
	 * @returns True if the model is supported by this provider
	 */
	protected supportsModel(modelCodename: string): boolean {
		return this.getInfo().supportedModels.includes(modelCodename);
	}
}

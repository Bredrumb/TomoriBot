/**
 * NovelAI-specific streaming adapter
 *
 * This adapter implements the StreamProvider interface for NovelAI's API,
 * handling the unique requirements of NovelAI's text-based prompt format.
 *
 * Key responsibilities:
 * - Convert structured context to NovelAI's flat text prompt format
 * - Handle SSE streaming from NovelAI API
 * - Convert NovelAI chunks to normalized ProcessedChunk format
 * - Map NovelAI errors to normalized ProviderError type
 *
 * NovelAI Specifics:
 * - No native function calling support
 * - Uses flat text prompts with "{username}: {message}\n" format
 * - Uses `prefix` parameter to force bot name at start of generation
 * - Uses `stop_sequences` to prevent multi-speaker generation
 */

import type { FunctionCall } from "@/types/provider/interfaces";
import {
	ContextItemTag,
	type StructuredContextItem,
} from "@/types/misc/context";
import { log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type {
	ProcessedChunk,
	ProviderError,
	RawStreamChunk,
	StreamConfig,
	StreamContext,
	StreamProvider,
} from "@/types/stream/interfaces";
import {
	novelaiGenerateStream,
	getParametersForModel,
	isNovelAIApiKeyError,
	isNovelAICreditsError,
	isNovelAIRateLimitError,
	type NovelAIGenerationRequest,
	type NovelAIStreamChunk,
} from "./novelaiService";

/**
 * NovelAI-specific stream configuration
 */
export interface NovelaiStreamConfig extends StreamConfig {
	// NovelAI doesn't have provider-specific config beyond base StreamConfig
}

/**
 * NovelAI streaming adapter implementation
 *
 * NovelAI requires a flat text prompt with speaker labels:
 * [System instructions]
 *
 * Username1: message1
 * BotName: response1
 * Username2: message2
 * BotName:
 */
export class NovelaiStreamAdapter implements StreamProvider {
	/**
	 * Tags that should be prepended as system instructions
	 */
	private static readonly SYSTEM_INSTRUCTION_TAGS: ContextItemTag[] = [
		ContextItemTag.SYSTEM_INSTRUCTION_BLOCK,
		ContextItemTag.SYSTEM_PERSONALITY,
		ContextItemTag.SYSTEM_HUMANIZER_RULES,
		ContextItemTag.SYSTEM_FUNCTION_GUIDE,
		ContextItemTag.KNOWLEDGE_SERVER_INFO,
		ContextItemTag.KNOWLEDGE_SERVER_EMOJIS,
		ContextItemTag.KNOWLEDGE_SERVER_STICKERS,
		ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
		ContextItemTag.KNOWLEDGE_USER_MEMORIES,
		ContextItemTag.KNOWLEDGE_USER_STATUS,
		ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT,
	];

	/**
	 * Start streaming from NovelAI's API
	 */
	async *startStream(
		config: StreamConfig,
		context: StreamContext,
	): AsyncGenerator<RawStreamChunk, void, unknown> {
		log.info("NovelAIStreamAdapter: Initializing NovelAI streaming");

		// Ensure model is provided
		if (!config.model) {
			throw new Error(
				"Model must be specified in config. Use NovelAIProvider.getDefaultModel() if needed.",
			);
		}

		// Assemble context for NovelAI format
		const prompt = this.assembleNovelAIPrompt(
			context.contextItems,
			context.tomoriState.tomori_nickname,
		);

		log.info(
			`Assembled NovelAI prompt. Length: ${prompt.length} characters`,
		);

		// Get generation parameters for the model
		const parameters = getParametersForModel(
			config.model,
			config.temperature,
		);

		// Build request
		const request: NovelAIGenerationRequest = {
			input: prompt,
			model: config.model,
			parameters,
			prefix: `${context.tomoriState.tomori_nickname}:`, // Force bot name at start
		};

		// Log sanitized request for debugging
		this.logSanitizedRequest(request, prompt.length);

		try {
			// Start streaming
			const stream = novelaiGenerateStream(request, {
				apiKey: config.apiKey,
				timeout: config.inactivityTimeoutMs,
			});

			// Yield each chunk
			for await (const chunk of stream) {
				yield {
					data: chunk,
					provider: "novelai",
					metadata: {
						timestamp: Date.now(),
						model: config.model,
					},
				};
			}
		} catch (error) {
			// Convert NovelAI errors to our format
			const providerError = this.handleProviderError(error);
			yield {
				data: { error: providerError },
				provider: "novelai",
				metadata: {
					timestamp: Date.now(),
					error: true,
				},
			};
		}
	}

	/**
	 * Process a raw NovelAI chunk into normalized format
	 */
	processChunk(chunk: RawStreamChunk): ProcessedChunk {
		const novelaiChunk = chunk.data as NovelAIStreamChunk & {
			error?: ProviderError;
		};

		// Handle errors first
		if (novelaiChunk.error) {
			// If error is already a ProviderError (from startStream catch)
			if (typeof novelaiChunk.error === "object" && "type" in novelaiChunk.error) {
				return {
					type: "error",
					error: novelaiChunk.error as ProviderError,
				};
			}

			// Otherwise convert string error
			return {
				type: "error",
				error: {
					type: "api_error",
					message: novelaiChunk.error as unknown as string,
					retryable: false,
				},
			};
		}

		// Check for completion
		if (novelaiChunk.final) {
			return {
				type: "done",
			};
		}

		// Check for text content
		if (novelaiChunk.token) {
			return {
				type: "text",
				content: novelaiChunk.token,
			};
		}

		// Default: empty chunk
		return {
			type: "text",
			content: "",
		};
	}

	/**
	 * Extract function call from raw NovelAI chunk
	 * NovelAI doesn't support function calling, so always return null
	 */
	extractFunctionCall(_chunk: RawStreamChunk): FunctionCall | null {
		return null;
	}

	/**
	 * Handle NovelAI-specific errors
	 */
	handleProviderError(error: unknown): ProviderError {
		const errorMessage = error instanceof Error ? error.message : String(error);

		// Try to extract status code from error message
		let statusCode: number | undefined;
		const statusMatch = errorMessage.match(/\((\d{3})\)/);
		if (statusMatch) {
			statusCode = Number.parseInt(statusMatch[1], 10);
		}

		// Determine error type based on status code and message
		let errorType: ProviderError["type"];
		let retryable: boolean;

		if (statusCode === 401 || isNovelAIApiKeyError(errorMessage, statusCode)) {
			errorType = "api_error";
			retryable = false;
		} else if (statusCode === 402 || isNovelAICreditsError(errorMessage, statusCode)) {
			errorType = "api_error";
			retryable = false;
		} else if (statusCode === 429 || isNovelAIRateLimitError(errorMessage, statusCode)) {
			errorType = "rate_limit";
			retryable = true;
		} else if (statusCode === 500 || statusCode === 502) {
			errorType = "api_error";
			retryable = true;
		} else if (statusCode === 503) {
			errorType = "provider_overloaded";
			retryable = true;
		} else if (statusCode === 504 || errorMessage.toLowerCase().includes("timeout")) {
			errorType = "timeout";
			retryable = true;
		} else {
			errorType = "api_error";
			retryable = false;
		}

		return {
			type: errorType,
			message: `NovelAI API error${statusCode ? ` (${statusCode})` : ""}: ${errorMessage}`,
			code: statusCode?.toString() || "unknown",
			retryable,
			originalError: error,
		};
	}

	/**
	 * Create NovelAI-specific error description for embedding
	 */
	createErrorDescription(error: ProviderError, locale: string): string | null {
		// Get NovelAI-specific message based on error code
		const errorCode = error.code;
		let messageKey: string;

		// Map error types to locale keys
		switch (error.type) {
			case "rate_limit":
				messageKey = "429_default_message";
				break;
			case "timeout":
				messageKey = "504_default_message";
				break;
			case "provider_overloaded":
				messageKey = "503_default_message";
				break;
			case "api_error":
				// Check for specific error codes
				if (errorCode === "401") {
					messageKey = "401_default_message";
				} else if (errorCode === "402") {
					messageKey = "402_default_message";
				} else {
					messageKey = "unknown_default_message";
				}
				break;
			default:
				messageKey = "unknown_default_message";
				break;
		}

		try {
			const novelaiMessage = localizer(locale, `genai.novelai.${messageKey}`);
			return `Error Code ${errorCode}: ${novelaiMessage}`;
		} catch {
			// Fallback if locale key doesn't exist
			return `Error Code ${errorCode}: ${error.message}`;
		}
	}

	/**
	 * Get provider information
	 */
	getProviderInfo() {
		return {
			name: "novelai",
			version: "1.0",
			supportsStreaming: true,
			supportsFunctionCalling: false, // NovelAI doesn't support function calling
		};
	}

	/**
	 * Assemble context items into NovelAI's expected flat text format
	 *
	 * Format:
	 * [System instructions]
	 *
	 * Username1: message1
	 * BotName: response1
	 * Username2: message2
	 * BotName:
	 */
	private assembleNovelAIPrompt(
		contextItems: StructuredContextItem[],
		_botName: string,
	): string {
		const systemInstructionParts: string[] = [];
		const dialogueParts: string[] = [];

		for (const item of contextItems) {
			// Extract text content from parts
			const textContent = item.parts
				.filter((p) => p.type === "text")
				.map((p) => (p as { type: "text"; text: string }).text)
				.join("\n");

			if (!textContent) {
				// Skip items with no text (e.g., images/videos - NovelAI doesn't support these)
				continue;
			}

			// Check if this should be system instruction
			if (
				item.role === "system" ||
				(item.metadataTag &&
					NovelaiStreamAdapter.SYSTEM_INSTRUCTION_TAGS.includes(
						item.metadataTag,
					))
			) {
				systemInstructionParts.push(textContent);
			} else if (
				(item.role === "user" || item.role === "model") &&
				item.metadataTag &&
				(item.metadataTag === ContextItemTag.DIALOGUE_HISTORY ||
					item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE)
			) {
				// Dialogue turns - already formatted with speaker labels from contextBuilder
				// The context builder formats these as "{username}: {message}"
				dialogueParts.push(textContent);
			}
		}

		// Combine parts: system instructions first, then dialogue
		const prompt = [
			...systemInstructionParts,
			"", // Empty line separator
			...dialogueParts,
		]
			.filter((part) => part !== undefined && part !== "")
			.join("\n\n");

		return prompt;
	}

	/**
	 * Log sanitized request configuration for debugging
	 */
	private logSanitizedRequest(
		request: NovelAIGenerationRequest,
		promptLength: number,
	): void {
		log.section("NovelAIStreamAdapter: Request Details");

		log.info(`Model: ${request.model}`);
		log.info(`Prefix: ${request.prefix}`);
		log.info(`Prompt Length: ${promptLength} characters`);
		log.info(
			`Parameters: temperature=${request.parameters.temperature}, max_length=${request.parameters.max_length}`,
		);
	}
}

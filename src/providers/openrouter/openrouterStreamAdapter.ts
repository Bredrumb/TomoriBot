/**
 * OpenRouter-specific streaming adapter
 *
 * This adapter implements the StreamProvider interface for OpenRouter's API,
 * which uses OpenAI-compatible streaming format with Server-Sent Events (SSE).
 *
 * Key responsibilities:
 * - Initialize OpenRouter client and configure streaming
 * - Convert context items to OpenAI message format
 * - Handle OpenRouter-specific API responses and errors
 * - Extract function calls from OpenRouter's response format
 * - Convert OpenRouter chunks to normalized ProcessedChunk format
 * - Handle ": OPENROUTER PROCESSING" SSE comments (keepalive)
 * - Handle mid-stream errors with unified error format
 */

import { OpenRouter } from "@openrouter/sdk";
import type { FunctionCall } from "../../types/provider/interfaces";
import {
	ContextItemTag,
	type StructuredContextItem,
} from "../../types/misc/context";
import { log } from "../../utils/misc/logger";
import { localizer } from "../../utils/text/localizer";
import type {
	ProcessedChunk,
	ProviderError,
	RawStreamChunk,
	StreamConfig,
	StreamContext,
	StreamProvider,
} from "../../types/stream/interfaces";

/**
 * OpenRouter-specific stream configuration extending the base StreamConfig
 */
export interface OpenrouterStreamConfig extends StreamConfig {
	// OpenRouter uses OpenAI-compatible config, simple structure
	seesImages?: boolean; // Whether the model supports image inputs
}

/**
 * Raw chunk from OpenRouter's streaming API (OpenAI-compatible format)
 */
interface OpenrouterStreamChunk {
	id?: string;
	object?: string;
	created?: number;
	model?: string;
	provider?: string;
	choices?: Array<{
		index: number;
		delta?: {
			role?: string;
			content?: string;
			tool_calls?: Array<{
				id?: string;
				type?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
	error?: {
		code: string;
		message: string;
	};
}

/**
 * OpenRouter streaming adapter implementation
 */
export class OpenrouterStreamAdapter implements StreamProvider {
	private static readonly SYSTEM_INSTRUCTION_TAGS: ContextItemTag[] = [
		ContextItemTag.KNOWLEDGE_SERVER_INFO,
		ContextItemTag.KNOWLEDGE_SERVER_EMOJIS,
		ContextItemTag.KNOWLEDGE_SERVER_STICKERS,
		ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
		ContextItemTag.KNOWLEDGE_USER_MEMORIES,
		ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT,
	];

	/**
	 * Start streaming from OpenRouter's API
	 */
	async *startStream(
		config: StreamConfig,
		context: StreamContext,
	): AsyncGenerator<RawStreamChunk, void, unknown> {
		log.info("OpenrouterStreamAdapter: Initializing OpenRouter streaming");

		// Initialize OpenRouter client
		const openRouter = new OpenRouter({ apiKey: config.apiKey });

		// Cast config to OpenrouterStreamConfig to access provider-specific fields
		const openrouterConfig = config as OpenrouterStreamConfig;

		// Assemble context for OpenAI message format
		const messages = await this.assembleOpenrouterContext(
			context.contextItems,
			context.functionInteractionHistory,
			openrouterConfig.seesImages ?? true, // Default to true for backward compatibility
		);

		// Ensure model is provided
		if (!config.model) {
			throw new Error(
				"Model must be specified in config. Use OpenrouterProvider.getDefaultModel() if needed.",
			);
		}

		log.info(`Generating content with model ${config.model}`);

		// Log tools FIRST (before conversation history for better readability)
		if (
			config.tools &&
			Array.isArray(config.tools) &&
			config.tools.length > 0
		) {
			log.info(`[DEBUG] Tools available: ${config.tools.length} tools`);
			log.info(`[DEBUG] Tools:\n${JSON.stringify(config.tools, null, 2)}`);
		} else {
			log.info(
				"[DEBUG] No tools field in config - will be OMITTED from SDK call",
			);
		}

		// Log sanitized request for debugging
		this.logSanitizedRequest(messages);

		// DEBUG: Log the last message to see if user input is correct
		if (messages.length > 0) {
			const lastMessage = messages[messages.length - 1];
			log.info(
				`[DEBUG] Last message in array - Role: ${lastMessage.role}, Content type: ${typeof lastMessage.content}`,
			);
			if (typeof lastMessage.content === "string") {
				log.info(
					`[DEBUG] Last message content (string): "${lastMessage.content.substring(0, 200)}"`,
				);
			} else if (Array.isArray(lastMessage.content)) {
				log.info(
					`[DEBUG] Last message content (array): ${lastMessage.content.length} parts`,
				);
			}
		}

		try {
			// Build SDK request - conditionally include tools
			const requestParams = {
				model: config.model,
				// biome-ignore lint/suspicious/noExplicitAny: SDK types don't match our internal format
				messages: messages as any,
				temperature: config.temperature,
				maxTokens: config.maxOutputTokens,
				stream: true,
				streamOptions: { includeUsage: true },
				// Only include tools if defined and has items
				...(config.tools && config.tools.length > 0
					? {
							// biome-ignore lint/suspicious/noExplicitAny: SDK types don't match our internal format
							tools: config.tools as any,
						}
					: {}),
			};

			// Log whether tools are included
			if (config.tools && config.tools.length > 0) {
				log.info("[DEBUG] Tools field INCLUDED in SDK request");
			} else {
				log.info("[DEBUG] Tools field OMITTED from SDK request");
			}

			// Start the streaming
			// biome-ignore lint/suspicious/noExplicitAny: SDK streaming response needs async iterator cast
			const stream = (await openRouter.chat.send(requestParams)) as any;

			// Yield each chunk
			for await (const chunkResponse of stream) {
				// Note: OpenRouter occasionally sends ": OPENROUTER PROCESSING" comments
				// These are keepalive messages per SSE spec and should be ignored
				// The SDK handles this automatically

				yield {
					data: chunkResponse,
					provider: "openrouter",
					metadata: {
						timestamp: Date.now(),
						model: config.model,
					},
				};
			}
		} catch (error) {
			// Convert OpenRouter API errors to our format
			const providerError = this.handleProviderError(error);
			yield {
				data: { error: providerError },
				provider: "openrouter",
				metadata: {
					timestamp: Date.now(),
					error: true,
				},
			};
		}
	}

	/**
	 * Process a raw OpenRouter chunk into normalized format
	 */
	processChunk(chunk: RawStreamChunk): ProcessedChunk {
		const openrouterChunk = chunk.data as OpenrouterStreamChunk;

		// Handle errors first (both pre-stream and mid-stream errors)
		if ("error" in openrouterChunk && openrouterChunk.error) {
			return {
				type: "error",
				error: {
					type: "api_error",
					message: openrouterChunk.error.message || "OpenRouter API error",
					code: openrouterChunk.error.code,
					retryable: false,
					originalError: openrouterChunk.error,
				} as ProviderError,
			};
		}

		const choice = openrouterChunk.choices?.[0];
		if (!choice) {
			// Empty chunk, likely keepalive
			return {
				type: "text",
				content: "",
			};
		}

		// Check for finish_reason "error" (mid-stream error in unified format)
		if (choice.finish_reason === "error") {
			return {
				type: "error",
				error: {
					type: "api_error",
					message: "Stream terminated due to error",
					retryable: false,
					originalError: openrouterChunk,
				} as ProviderError,
			};
		}

		// Check for usage stats (final chunk)
		const metadata: Record<string, unknown> = {};
		if (openrouterChunk.usage) {
			metadata.usage = openrouterChunk.usage;
			log.info(
				`OpenRouter usage: ${openrouterChunk.usage.total_tokens} total tokens`,
			);
		}

		// Check for tool/function calls
		if (choice.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
			const toolCall = choice.delta.tool_calls[0];
			if (toolCall.function) {
				const functionCall: FunctionCall = {
					name: toolCall.function.name || "",
					args: toolCall.function.arguments
						? JSON.parse(toolCall.function.arguments)
						: {},
				};
				return {
					type: "function_call",
					functionCall,
					metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
				};
			}
		}

		// Check for text content
		if (choice.delta?.content) {
			return {
				type: "text",
				content: choice.delta.content,
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		}

		// Handle finish reason indicating completion
		if (choice.finish_reason === "stop") {
			return {
				type: "done",
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		}

		// Default: empty chunk (keepalive or incomplete data)
		return {
			type: "text",
			content: "",
			metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
		};
	}

	/**
	 * Extract function call from raw OpenRouter chunk
	 */
	extractFunctionCall(chunk: RawStreamChunk): FunctionCall | null {
		const openrouterChunk = chunk.data as OpenrouterStreamChunk;

		const choice = openrouterChunk.choices?.[0];
		if (choice?.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
			const toolCall = choice.delta.tool_calls[0];
			if (toolCall.function) {
				return {
					name: toolCall.function.name || "",
					args: toolCall.function.arguments
						? JSON.parse(toolCall.function.arguments)
						: {},
				};
			}
		}

		return null;
	}

	/**
	 * Handle OpenRouter-specific errors using official error codes
	 */
	handleProviderError(error: unknown): ProviderError {
		// Log the full error object for debugging
		log.error("OpenRouter error details:", error);
		if (error && typeof error === "object") {
			log.error(
				"OpenRouter error stringified:",
				JSON.stringify(error, null, 2),
			);
		}

		const errorMessage = error instanceof Error ? error.message : String(error);

		// Try to parse OpenRouter API error structure
		let errorCode: string | undefined;
		let extractedMessage: string | undefined;

		// First, try to extract from the error object directly (OpenRouter SDK format)
		if (error && typeof error === "object") {
			const errorObj = error as Record<string, unknown>;

			// Check for statusCode (OpenRouter SDK)
			if (errorObj.statusCode) {
				errorCode = String(errorObj.statusCode);
			}

			// Check for error.code or data$.error.code
			if (!errorCode && errorObj.error && typeof errorObj.error === "object") {
				const errorField = errorObj.error as Record<string, unknown>;
				if (errorField.code) {
					errorCode = String(errorField.code);
				}
			}

			if (!errorCode && errorObj.data$ && typeof errorObj.data$ === "object") {
				const data = errorObj.data$ as Record<string, unknown>;
				if (data.error && typeof data.error === "object") {
					const dataError = data.error as Record<string, unknown>;
					if (dataError.code) {
						errorCode = String(dataError.code);
					}
					if (dataError.message && typeof dataError.message === "string") {
						extractedMessage = dataError.message;
					}
				}
			}

			// Try to parse body field
			if (errorObj.body && typeof errorObj.body === "string") {
				try {
					const bodyParsed = JSON.parse(errorObj.body);
					if (!extractedMessage && bodyParsed.error?.metadata?.raw) {
						extractedMessage = bodyParsed.error.metadata.raw;
					}
				} catch {
					// Ignore body parsing errors
				}
			}
		}

		// Fallback: try to parse from error message string
		if (!errorCode || !extractedMessage) {
			try {
				if (errorMessage.includes("{")) {
					const jsonMatch = errorMessage.match(/\{.*\}/s);
					if (jsonMatch) {
						const parsedError = JSON.parse(jsonMatch[0]);
						if (!errorCode) {
							errorCode = parsedError.error?.code || parsedError.code;
						}
						if (!extractedMessage) {
							extractedMessage =
								parsedError.error?.message || parsedError.message;
						}
					}
				}
			} catch {
				// Ignore parsing errors
			}
		}

		const finalMessage = extractedMessage || errorMessage;
		const finalCode = errorCode || "unknown";

		// Map common HTTP status codes and OpenRouter error codes
		let errorType: ProviderError["type"] = "unknown";
		let retryable = false;

		// Status code mapping (from error messages or codes)
		if (finalCode.includes("400") || finalMessage.includes("400")) {
			errorType = "api_error";
			retryable = false;
		} else if (finalCode.includes("401") || finalMessage.includes("401")) {
			errorType = "api_error";
			retryable = false;
		} else if (finalCode.includes("402") || finalMessage.includes("402")) {
			errorType = "rate_limit"; // Insufficient credits
			retryable = false;
		} else if (finalCode.includes("429") || finalMessage.includes("429")) {
			errorType = "rate_limit";
			retryable = true;
		} else if (
			finalCode.includes("502") ||
			finalCode.includes("503") ||
			finalMessage.includes("502") ||
			finalMessage.includes("503")
		) {
			errorType = "provider_overloaded";
			retryable = true;
		} else if (finalMessage.toLowerCase().includes("timeout")) {
			errorType = "timeout";
			retryable = true;
		} else if (finalMessage.toLowerCase().includes("content")) {
			errorType = "content_blocked";
			retryable = false;
		}

		return {
			type: errorType,
			message: `OpenRouter API error (${finalCode}): ${finalMessage}`,
			code: finalCode,
			retryable,
			originalError: error,
			userMessage: extractedMessage,
		};
	}

	/**
	 * Create a user-friendly error description from a ProviderError
	 */
	createErrorDescription(error: ProviderError, locale: string): string | null {
		// Get OpenRouter-specific message based on error code and type
		let openrouterMessage = error.userMessage;

		if (!openrouterMessage) {
			// Fallback to locale-based default messages
			const errorCode = error.code;
			let messageKey: string;

			// Map error types to OpenRouter-specific locale keys
			switch (error.type) {
				case "content_blocked":
					messageKey = "403_default_message";
					break;
				case "rate_limit":
					messageKey = "429_default_message";
					break;
				case "timeout":
					messageKey = "408_default_message";
					break;
				case "provider_overloaded":
					// Could be 502 or 503
					messageKey =
						errorCode === "502" ? "502_default_message" : "503_default_message";
					break;
				case "api_error":
					// Use the specific error code if available
					messageKey = `${errorCode}_default_message`;
					break;
				default:
					messageKey = "unknown_default_message";
					break;
			}

			try {
				openrouterMessage = localizer(locale, `genai.openrouter.${messageKey}`);
			} catch {
				// If locale key doesn't exist, use a generic fallback
				openrouterMessage = localizer(
					locale,
					"genai.openrouter.unknown_default_message",
				);
			}
		}

		// Format as "Error Code {code}: {OpenRouter message}"
		const errorCode = error.code || "unknown";
		return `Error Code ${errorCode}: ${openrouterMessage}`;
	}

	/**
	 * Get provider metadata
	 */
	getProviderInfo(): {
		name: string;
		version: string;
		supportsStreaming: boolean;
		supportsFunctionCalling: boolean;
	} {
		return {
			name: "openrouter",
			version: "1.0.0",
			supportsStreaming: true,
			supportsFunctionCalling: true,
		};
	}

	/**
	 * Assemble context items into OpenAI message format
	 */
	private async assembleOpenrouterContext(
		contextItems: StructuredContextItem[],
		functionInteractionHistory?: Array<{
			functionCall: FunctionCall;
			functionResponse: Record<string, unknown>;
		}>,
		seesImages: boolean = true,
	): Promise<Array<Record<string, unknown>>> {
		const messages: Array<Record<string, unknown>> = [];
		const systemInstructionParts: string[] = [];

		// Process context items following StructuredContextItem format
		for (const item of contextItems) {
			// Extract text from parts array
			let itemTextContent = "";
			if (item.parts.some((p) => p.type === "text")) {
				itemTextContent = item.parts
					.filter((p) => p.type === "text")
					.map((p) => (p as { type: "text"; text: string }).text)
					.join("\n");
			}

			// Check if this should be system instruction
			if (
				item.role === "system" ||
				(item.role === "user" &&
					item.metadataTag &&
					OpenrouterStreamAdapter.SYSTEM_INSTRUCTION_TAGS.includes(
						item.metadataTag,
					))
			) {
				if (itemTextContent) systemInstructionParts.push(itemTextContent);
			} else if (
				(item.role === "user" || item.role === "model") &&
				item.metadataTag &&
				(item.metadataTag === ContextItemTag.DIALOGUE_HISTORY ||
					item.metadataTag === ContextItemTag.DIALOGUE_SAMPLE)
			) {
				// Convert to OpenAI message format
				const role = item.role === "user" ? "user" : "assistant";
				const contentParts: Array<Record<string, unknown>> = [];

				// Process parts array
				for (const part of item.parts) {
					if (part.type === "text") {
						contentParts.push({
							type: "text",
							text: part.text,
						});
					} else if (part.type === "image" && part.uri && part.mimeType) {
						// Only process images if the model supports them
						if (!seesImages) {
							log.info(
								`Skipping image (model doesn't support images): ${part.uri}`,
							);
							continue;
						}

						// Handle images with URI - fetch and convert to base64
						try {
							const imageResponse = await fetch(part.uri);
							if (!imageResponse.ok) {
								log.warn(
									`Failed to fetch image: ${part.uri} (status: ${imageResponse.status})`,
								);
								continue;
							}

							const imageArrayBuffer = await imageResponse.arrayBuffer();
							const base64ImageData =
								Buffer.from(imageArrayBuffer).toString("base64");

							// Add image as OpenAI format
							contentParts.push({
								type: "image_url",
								imageUrl: {
									url: `data:${part.mimeType};base64,${base64ImageData}`,
								},
							});

							log.success(`Successfully added image to message: ${part.uri}`);
						} catch (imgErr) {
							log.warn(`Error processing image: ${part.uri}`, {
								error:
									imgErr instanceof Error ? imgErr.message : String(imgErr),
							});
						}
					}
					// Note: OpenRouter doesn't widely support video yet, skip video parts
				}

				// Add message
				if (contentParts.length > 0) {
					// For single text-only messages, use string content; otherwise use array
					const content =
						contentParts.length === 1 && contentParts[0].type === "text"
							? contentParts[0].text
							: contentParts;

					messages.push({
						role,
						content,
					});
				}
			}
		}

		// Build system message from system instruction parts
		if (systemInstructionParts.length > 0) {
			const systemContent = systemInstructionParts.join("\n\n");
			messages.unshift({
				// Add at beginning
				role: "system",
				content: systemContent,
			});
			log.info(
				`Assembled system message. Length: ${systemContent.length} characters`,
			);
		}

		// Add function interaction history if present
		if (functionInteractionHistory && functionInteractionHistory.length > 0) {
			for (const interaction of functionInteractionHistory) {
				// Generate a tool call ID since our generic FunctionCall doesn't have one
				const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substring(7)}`;

				// Add assistant message with tool call
				messages.push({
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: toolCallId,
							type: "function",
							function: {
								name: interaction.functionCall.name,
								arguments: JSON.stringify(interaction.functionCall.args || {}),
							},
						},
					],
				});

				// Add tool response
				messages.push({
					role: "tool",
					tool_call_id: toolCallId,
					content: JSON.stringify(interaction.functionResponse),
				});
			}
		}

		log.info(`Assembled ${messages.length} messages for OpenRouter API`);
		return messages;
	}

	/**
	 * Log full request for debugging (hides base64 image data)
	 */
	private logSanitizedRequest(messages: Array<Record<string, unknown>>): void {
		// Deep clone and sanitize image data
		const sanitized = messages.map((msg) => {
			if (Array.isArray(msg.content)) {
				return {
					...msg,
					content: msg.content.map((part: Record<string, unknown>) => {
						if (part.type === "image_url") {
							// Handle both snake_case (image_url) and camelCase (imageUrl) formats
							const imageUrlField = part.image_url || part.imageUrl;
							if (imageUrlField) {
								const imageUrl = imageUrlField as Record<string, unknown>;
								if (
									imageUrl.url &&
									typeof imageUrl.url === "string" &&
									imageUrl.url.startsWith("data:")
								) {
									return {
										type: "image_url",
										// Preserve the original field name format
										...(part.image_url
											? {
													image_url: {
														...imageUrl,
														url: "[BASE64_HIDDEN]",
													},
												}
											: {
													imageUrl: {
														...imageUrl,
														url: "[BASE64_HIDDEN]",
													},
												}),
									};
								}
							}
						}
						return part;
					}),
				};
			}
			return msg;
		});

		log.info(`Full request structure:\n${JSON.stringify(sanitized, null, 2)}`);
	}
}

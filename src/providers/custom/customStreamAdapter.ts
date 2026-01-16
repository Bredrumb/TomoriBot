/**
 * Custom Provider Stream Adapter
 *
 * This adapter implements the StreamProvider interface for custom OpenAI-compatible endpoints.
 * Unlike OpenRouter which uses the @openrouter/sdk, this adapter uses raw fetch requests
 * for maximum compatibility with various OpenAI-compatible servers like Ollama, KoboldCPP,
 * vLLM, LocalAI, and OpenRouter proxies.
 *
 * Key responsibilities:
 * - Initialize streaming connection to custom endpoint
 * - Convert context items to OpenAI message format
 * - Handle SSE (Server-Sent Events) streaming responses
 * - Extract function calls from OpenAI-compatible format
 * - Handle various endpoint error formats gracefully
 */

import type {
	FunctionCall,
	FunctionResponseImageMetadata,
} from "../../types/provider/interfaces";
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
 * Custom-specific stream configuration extending the base StreamConfig
 */
export interface CustomStreamConfig extends StreamConfig {
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
 * OpenAI-compatible stream chunk format
 */
interface OpenAIStreamChunk {
	id?: string;
	object?: string;
	created?: number;
	model?: string;
	choices?: Array<{
		index: number;
		delta?: {
			role?: string;
			content?: string | null;
			tool_calls?: Array<{
				index?: number;
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
		code?: string;
		message: string;
		type?: string;
	};
}

/**
 * Accumulated tool call data across streaming chunks
 */
interface AccumulatedToolCall {
	id?: string;
	type?: string;
	functionName: string;
	functionArguments: string;
}

/**
 * Custom provider streaming adapter implementation
 */
export class CustomStreamAdapter implements StreamProvider {
	private static readonly SYSTEM_INSTRUCTION_TAGS: ContextItemTag[] = [
		ContextItemTag.SYSTEM_HUMANIZER_RULES,
		ContextItemTag.SYSTEM_PERSONALITY,
		ContextItemTag.KNOWLEDGE_SERVER_INFO,
		ContextItemTag.KNOWLEDGE_SERVER_EMOJIS,
		ContextItemTag.KNOWLEDGE_SERVER_STICKERS,
		ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
	];

	// Accumulator for tool calls across streaming chunks
	private toolCallAccumulator: Map<number, AccumulatedToolCall> = new Map();

	/**
	 * Start streaming from the custom endpoint
	 */
	async *startStream(
		config: StreamConfig,
		context: StreamContext,
	): AsyncGenerator<RawStreamChunk, void, unknown> {
		log.info("CustomStreamAdapter: Initializing custom endpoint streaming");

		// Reset accumulators for this stream
		this.toolCallAccumulator.clear();

		// Cast config to CustomStreamConfig
		const customConfig = config as CustomStreamConfig;

		if (!customConfig.endpointUrl) {
			throw new Error("Custom endpoint URL is required");
		}

		// Ensure endpoint URL ends with /chat/completions
		let apiUrl = customConfig.endpointUrl;
		if (!apiUrl.endsWith("/chat/completions")) {
			// Remove trailing slash if present
			apiUrl = apiUrl.replace(/\/$/, "");
			// Add /chat/completions if not present
			if (!apiUrl.endsWith("/v1")) {
				apiUrl = `${apiUrl}/chat/completions`;
			} else {
				apiUrl = `${apiUrl}/chat/completions`;
			}
		}

		log.info(`CustomStreamAdapter: Using API URL: ${apiUrl}`);

		// Assemble context for OpenAI message format
		const messages = await this.assembleOpenAIContext(
			context.contextItems,
			context.functionInteractionHistory,
			customConfig.seesImages ?? false,
		);

		// Ensure model is provided
		if (!config.model) {
			throw new Error("Model must be specified in config");
		}

		log.info(`CustomStreamAdapter: Using model ${config.model}`);

		// Log tools if present
		if (config.tools && Array.isArray(config.tools) && config.tools.length > 0) {
			log.info(`CustomStreamAdapter: Tools:\n${JSON.stringify(config.tools, null, 2)}`);
		}

		// Log sanitized request for debugging
		this.logSanitizedRequest(messages);

		try {
			// Build request body
			const requestBody: Record<string, unknown> = {
				model: config.model,
				messages: messages,
				temperature: config.temperature,
				stream: true,
			};

			// Add optional parameters
			if (config.maxOutputTokens !== undefined) {
				requestBody.max_tokens = config.maxOutputTokens;
			}

			if (config.tools && config.tools.length > 0) {
				requestBody.tools = config.tools;
			}

			if (customConfig.topP !== undefined) {
				requestBody.top_p = customConfig.topP;
			}

			if (customConfig.frequencyPenalty !== undefined) {
				requestBody.frequency_penalty = customConfig.frequencyPenalty;
			}

			if (customConfig.presencePenalty !== undefined) {
				requestBody.presence_penalty = customConfig.presencePenalty;
			}

			// Build headers
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				Accept: "text/event-stream",
			};

			// Add authorization if API key is provided and not a placeholder
			if (
				config.apiKey &&
				config.apiKey.trim() !== "" &&
				config.apiKey !== "custom-endpoint-key"
			) {
				headers.Authorization = `Bearer ${config.apiKey}`;
			}

			log.info(
				`CustomStreamAdapter: Sampling params - temp: ${config.temperature}, top_p: ${customConfig.topP ?? "default"}`,
			);

			// Make the streaming request
			const response = await fetch(apiUrl, {
				method: "POST",
				headers,
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				const errorText = await response.text();
				let errorData: { error?: { message?: string } } | null = null;
				try {
					errorData = JSON.parse(errorText);
				} catch {
					// Not JSON, use raw text
				}

				const errorMessage =
					errorData?.error?.message || errorText || response.statusText;
				throw new Error(`HTTP ${response.status}: ${errorMessage}`);
			}

			if (!response.body) {
				throw new Error("Response body is null");
			}

			// Process SSE stream
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });

				// Process complete SSE lines
				const lines = buffer.split("\n");
				buffer = lines.pop() || ""; // Keep incomplete line in buffer

				for (const line of lines) {
					const trimmedLine = line.trim();

					// Skip empty lines and SSE comments
					if (!trimmedLine || trimmedLine.startsWith(":")) {
						continue;
					}

					// Parse SSE data
					if (trimmedLine.startsWith("data:")) {
						const data = trimmedLine.slice(5).trim();

						// Check for stream end marker
						if (data === "[DONE]") {
							log.info("CustomStreamAdapter: Stream completed [DONE]");
							// Continue reading until the stream naturally closes
							// This prevents ConnectionResetError on servers like KoboldCPP
							continue;
						}

						try {
							const chunk = JSON.parse(data) as OpenAIStreamChunk;

							yield {
								data: chunk,
								provider: "custom",
								metadata: {
									timestamp: Date.now(),
									model: config.model,
								},
							};
						} catch (parseError) {
							log.warn(
								`CustomStreamAdapter: Failed to parse SSE data: ${data}`,
								{
									error:
										parseError instanceof Error
											? parseError.message
											: String(parseError),
								},
							);
						}
					}
				}
			}
		} catch (error) {
			const providerError = this.handleProviderError(error);
			yield {
				data: { error: providerError },
				provider: "custom",
				metadata: {
					timestamp: Date.now(),
					error: true,
				},
			};
		}
	}

	/**
	 * Process a raw chunk into normalized format
	 */
	processChunk(chunk: RawStreamChunk): ProcessedChunk {
		const openaiChunk = chunk.data as OpenAIStreamChunk;

		// Handle errors first
		if ("error" in openaiChunk && openaiChunk.error) {
			return {
				type: "error",
				error: {
					type: "api_error",
					message: openaiChunk.error.message || "Custom endpoint API error",
					code: openaiChunk.error.code || "unknown",
					retryable: false,
					originalError: openaiChunk.error,
				} as ProviderError,
			};
		}

		const choice = openaiChunk.choices?.[0];
		if (!choice) {
			return {
				type: "text",
				content: "",
			};
		}

		// Check for usage stats
		const metadata: Record<string, unknown> = {};
		if (openaiChunk.usage) {
			metadata.usage = openaiChunk.usage;
			log.info(
				`Custom endpoint usage: ${openaiChunk.usage.total_tokens} total tokens`,
			);
		}

		// Handle finish reasons
		if (choice.finish_reason === "tool_calls") {
			// Accumulate final tool call data if present
			if (choice.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
				for (const deltaToolCall of choice.delta.tool_calls) {
					const index = deltaToolCall.index ?? 0;

					let accumulated = this.toolCallAccumulator.get(index);
					if (!accumulated) {
						accumulated = {
							functionName: "",
							functionArguments: "",
						};
						this.toolCallAccumulator.set(index, accumulated);
					}

					if (deltaToolCall.id) {
						accumulated.id = deltaToolCall.id;
					}
					if (deltaToolCall.type) {
						accumulated.type = deltaToolCall.type;
					}
					if (deltaToolCall.function) {
						if (deltaToolCall.function.name) {
							accumulated.functionName += deltaToolCall.function.name;
						}
						if (deltaToolCall.function.arguments) {
							accumulated.functionArguments += deltaToolCall.function.arguments;
						}
					}
				}
			}

			log.info(
				"CustomStreamAdapter: finish_reason is 'tool_calls' - parsing accumulated tool calls",
			);

			const accumulated = this.toolCallAccumulator.get(0);

			if (!accumulated || !accumulated.functionName) {
				log.warn(
					"CustomStreamAdapter: finish_reason is 'tool_calls' but no tool call was accumulated",
				);
				return {
					type: "done",
					metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
				};
			}

			// Parse accumulated arguments
			let parsedArgs: Record<string, unknown> = {};
			if (accumulated.functionArguments) {
				try {
					parsedArgs = JSON.parse(accumulated.functionArguments);
				} catch (parseError) {
					log.error(
						`CustomStreamAdapter: Failed to parse arguments: "${accumulated.functionArguments}"`,
						parseError,
					);
				}
			}

			const functionCall: FunctionCall = {
				name: accumulated.functionName,
				args: parsedArgs,
			};

			log.info(
				`CustomStreamAdapter: Returning function_call - name: "${functionCall.name}"`,
			);

			// Clear accumulators
			this.toolCallAccumulator.clear();

			return {
				type: "function_call",
				functionCall,
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		}

		// Handle finish_reason "stop"
		if (choice.finish_reason === "stop") {
			return {
				type: "done",
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		}

		// Handle finish_reason "length" (max tokens reached)
		if (choice.finish_reason === "length") {
			log.warn("CustomStreamAdapter: Response truncated due to max_tokens");
			return {
				type: "done",
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		}

		// Accumulate tool calls from delta
		if (choice.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
			for (const deltaToolCall of choice.delta.tool_calls) {
				const index = deltaToolCall.index ?? 0;

				let accumulated = this.toolCallAccumulator.get(index);
				if (!accumulated) {
					accumulated = {
						functionName: "",
						functionArguments: "",
					};
					this.toolCallAccumulator.set(index, accumulated);
				}

				if (deltaToolCall.id) {
					accumulated.id = deltaToolCall.id;
				}
				if (deltaToolCall.type) {
					accumulated.type = deltaToolCall.type;
				}
				if (deltaToolCall.function) {
					if (deltaToolCall.function.name) {
						accumulated.functionName += deltaToolCall.function.name;
					}
					if (deltaToolCall.function.arguments) {
						accumulated.functionArguments += deltaToolCall.function.arguments;
					}
				}
			}

			return {
				type: "text",
				content: "",
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		}

		// Check for text content
		if (choice.delta?.content) {
			return {
				type: "text",
				content: choice.delta.content,
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		}

		// Default: empty chunk
		return {
			type: "text",
			content: "",
			metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
		};
	}

	/**
	 * Extract function call from raw chunk
	 */
	extractFunctionCall(chunk: RawStreamChunk): FunctionCall | null {
		const openaiChunk = chunk.data as OpenAIStreamChunk;

		const choice = openaiChunk.choices?.[0];
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
	 * Handle custom endpoint errors
	 */
	handleProviderError(error: unknown): ProviderError {
		log.error("Custom endpoint error:", error);

		const errorMessage = error instanceof Error ? error.message : String(error);

		// Try to extract error details
		let errorCode = "unknown";
		let errorType: ProviderError["type"] = "unknown";
		let retryable = false;

		// Check for HTTP status codes
		if (errorMessage.includes("HTTP 4") || errorMessage.includes("HTTP 5")) {
			const statusMatch = errorMessage.match(/HTTP (\d{3})/);
			if (statusMatch) {
				errorCode = statusMatch[1];
				const status = Number.parseInt(errorCode, 10);

				if (status === 401 || status === 403) {
					errorType = "api_error";
					retryable = false;
				} else if (status === 429) {
					errorType = "rate_limit";
					retryable = true;
				} else if (status === 500 || status === 502 || status === 503) {
					errorType = "provider_overloaded";
					retryable = true;
				} else if (status === 504) {
					errorType = "timeout";
					retryable = true;
				}
			}
		}

		// Check for connection errors
		if (
			errorMessage.toLowerCase().includes("econnrefused") ||
			errorMessage.toLowerCase().includes("connection refused")
		) {
			errorType = "api_error";
			errorCode = "ECONNREFUSED";
			retryable = false;
		}

		// Check for timeout
		if (errorMessage.toLowerCase().includes("timeout")) {
			errorType = "timeout";
			retryable = true;
		}

		return {
			type: errorType,
			message: `Custom endpoint error: ${errorMessage}`,
			code: errorCode,
			retryable,
			originalError: error,
		};
	}

	/**
	 * Create a user-friendly error description
	 */
	createErrorDescription(error: ProviderError, locale: string): string | null {
		// Map error types to localized messages
		const errorCode = error.code || "unknown";

		let messageKey: string;

		switch (error.type) {
			case "rate_limit":
				messageKey = "429_default_message";
				break;
			case "timeout":
				messageKey = "408_default_message";
				break;
			case "provider_overloaded":
				messageKey = "503_default_message";
				break;
			case "api_error":
				if (errorCode === "ECONNREFUSED") {
					// Custom message for connection refused
					return `Error Code ECONNREFUSED: Could not connect to the custom endpoint. Please verify that your local LLM server is running and accessible.`;
				}
				messageKey = `${errorCode}_default_message`;
				break;
			default:
				messageKey = "unknown_default_message";
				break;
		}

		// Try to get localized message (fallback to generic)
		const localeKey = `genai.custom.${messageKey}`;
		let message = localizer(locale, localeKey);

		// If key not found, use a generic message
		if (message === localeKey) {
			message = localizer(locale, "genai.custom.unknown_default_message");
			if (message === "genai.custom.unknown_default_message") {
				// Absolute fallback
				message =
					"An error occurred while communicating with the custom endpoint.";
			}
			// Append actual error message
			const maxErrorLength = 500;
			const errorSnippet =
				error.message.length > maxErrorLength
					? `${error.message.substring(0, maxErrorLength)}...`
					: error.message;
			message += `\n\n**Details:**\n${errorSnippet}`;
		}

		return `Error Code ${errorCode}: ${message}`;
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
			name: "custom",
			version: "1.0.0",
			supportsStreaming: true,
			supportsFunctionCalling: true,
		};
	}

	/**
	 * Assemble context items into OpenAI message format
	 */
	private async assembleOpenAIContext(
		contextItems: StructuredContextItem[],
		functionInteractionHistory?: Array<{
			functionCall: FunctionCall;
			functionResponse: Record<string, unknown>;
			imageMetadata?: FunctionResponseImageMetadata;
		}>,
		seesImages: boolean = false,
	): Promise<Array<Record<string, unknown>>> {
		const messages: Array<Record<string, unknown>> = [];
		const systemInstructionParts: string[] = [];

		// Process context items
		for (const item of contextItems) {
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
					CustomStreamAdapter.SYSTEM_INSTRUCTION_TAGS.includes(item.metadataTag))
			) {
				if (itemTextContent) systemInstructionParts.push(itemTextContent);
			} else if (item.role === "user" || item.role === "model") {
				const role = item.role === "user" ? "user" : "assistant";
				const contentParts: Array<Record<string, unknown>> = [];

				for (const part of item.parts) {
					if (part.type === "text") {
						contentParts.push({
							type: "text",
							text: part.text,
						});
					} else if (part.type === "image" && seesImages) {
						// Handle images if model supports them
						if ("inlineData" in part && part.inlineData) {
							const inlineData = part.inlineData as {
								mimeType: string;
								data: string;
							};

							if (inlineData.mimeType && inlineData.data) {
								// Skip GIFs for custom endpoints (memory protection)
								if (inlineData.mimeType === "image/gif") {
									contentParts.push({
										type: "text",
										text: "[System: This message contains a GIF which is not supported by this endpoint.]",
									});
								} else {
									contentParts.push({
										type: "image_url",
										image_url: {
											url: `data:${inlineData.mimeType};base64,${inlineData.data}`,
										},
									});
								}
							}
						} else if (part.uri && part.mimeType) {
							// Skip GIFs
							if (part.mimeType === "image/gif") {
								contentParts.push({
									type: "text",
									text: "[System: This message contains a GIF which is not supported by this endpoint.]",
								});
							} else {
								// Fetch and convert to base64
								try {
									const imageResponse = await fetch(part.uri);
									if (imageResponse.ok) {
										const imageArrayBuffer = await imageResponse.arrayBuffer();
										const base64Data =
											Buffer.from(imageArrayBuffer).toString("base64");

										contentParts.push({
											type: "image_url",
											image_url: {
												url: `data:${part.mimeType};base64,${base64Data}`,
											},
										});
									}
								} catch (imgErr) {
									log.warn(`Failed to fetch image: ${part.uri}`, {
										error:
											imgErr instanceof Error ? imgErr.message : String(imgErr),
									});
								}
							}
						}
					}
				}

				if (contentParts.length > 0) {
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

		// Build system message
		if (systemInstructionParts.length > 0) {
			const systemContent = systemInstructionParts.join("\n\n");
			messages.unshift({
				role: "system",
				content: systemContent,
			});
			log.info(
				`CustomStreamAdapter: Assembled system message (${systemContent.length} chars)`,
			);
		}

		// Add function interaction history
		if (functionInteractionHistory && functionInteractionHistory.length > 0) {
			for (const interaction of functionInteractionHistory) {
				const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substring(7)}`;

				// Assistant message with tool call
				messages.push({
					role: "assistant",
					content: "",
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

				// Tool response
				messages.push({
					role: "tool",
					tool_call_id: toolCallId,
					content: JSON.stringify(interaction.functionResponse),
				});

				// Optional follow-up with images
				const responseParts: Array<Record<string, unknown>> = [];

				if (interaction.functionResponse) {
					responseParts.push({
						type: "text",
						text: JSON.stringify(interaction.functionResponse),
					});
				}

				if (
					seesImages &&
					interaction.imageMetadata?.imageUrls &&
					interaction.imageMetadata.imageUrls.length > 0
				) {
					for (const img of interaction.imageMetadata.imageUrls) {
						const sourceUrl = img.originalUrl || img.url;
						responseParts.push({
							type: "image_url",
							image_url: {
								url: sourceUrl,
							},
						});
					}
				}

				if (responseParts.length > 0) {
					messages.push({
						role: "user",
						content: responseParts,
					});
				}
			}
		}

		log.info(`CustomStreamAdapter: Assembled ${messages.length} messages`);
		return messages;
	}

	/**
	 * Log full request for debugging (hides base64 image data)
	 */
	private logSanitizedRequest(messages: Array<Record<string, unknown>>): void {
		const sanitized = messages.map((msg) => {
			if (Array.isArray(msg.content)) {
				return {
					...msg,
					content: (msg.content as Record<string, unknown>[]).map(
						(part: Record<string, unknown>) => {
							if (part.type === "image_url") {
								const imageUrlField =
									(part as { image_url?: { url?: string } }).image_url ||
									(part as { imageUrl?: { url?: string } }).imageUrl;
								if (imageUrlField?.url?.startsWith("data:")) {
									return {
										type: "image_url",
										image_url: {
											...imageUrlField,
											url: "[BASE64_HIDDEN]",
										},
									};
								}
							}
							return part;
						},
					),
				};
			}
			return msg;
		});

		log.info(
			`CustomStreamAdapter: Request structure:\n${JSON.stringify(sanitized, null, 2)}`,
		);
	}
}

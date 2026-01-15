/**
 * NovelAI REST API Service
 * Direct HTTP implementation for NovelAI text generation API
 * Supports streaming via Server-Sent Events (SSE)
 */

import { log } from "@/utils/misc/logger";

// =============================================
// Constants
// =============================================

const NOVELAI_API_BASE_URL = "https://text.novelai.net";
const REQUEST_TIMEOUT = 60; // 60 seconds (NovelAI can be slow)

// =============================================
// Types
// =============================================

/**
 * NovelAI generation parameters
 * Based on reference implementation and API documentation
 */
export interface NovelAIParameters {
	bad_words_ids?: number[][];
	bracket_ban?: boolean;
	cfg_scale?: number;
	cfg_uc?: string;
	force_emotion?: boolean;
	generate_until_sentence?: boolean;
	logit_bias_exp?: Array<{
		sequence: number[];
		bias: number;
		ensure_sequence_finish: boolean;
		generate_once: boolean;
	}>;
	max_length?: number;
	min_length?: number;
	min_p?: number;
	mirostat_lr?: number | null;
	mirostat_tau?: number | null;
	order?: number[];
	phrase_rep_pen?:
		| "off"
		| "very_light"
		| "light"
		| "medium"
		| "aggressive"
		| "very_aggressive";
	prefix?: string;
	repetition_penalty?: number;
	repetition_penalty_frequency?: number;
	repetition_penalty_presence?: number;
	repetition_penalty_range?: number;
	repetition_penalty_slope?: number;
	repetition_penalty_whitelist?: number[];
	stop_sequences?: number[][];
	tail_free_sampling?: number;
	temperature?: number;
	top_a?: number;
	top_g?: number;
	top_k?: number;
	top_p?: number;
	typical_p?: number | null;
	use_string?: boolean;
}

/**
 * NovelAI generation request body
 */
export interface NovelAIGenerationRequest {
	input: string;
	model: string;
	parameters: NovelAIParameters;
	prefix?: string;
}

/**
 * NovelAI generation response (non-streaming)
 */
export interface NovelAIGenerationResponse {
	output: string;
}

/**
 * NovelAI SSE stream chunk
 */
export interface NovelAIStreamChunk {
	token?: string;
	final?: boolean;
	error?: string;
}

/**
 * OpenAI-compatible completion request (for glm-4-6 and other newer models)
 */
export interface OpenAICompletionRequest {
	model: string;
	prompt: string | string[];
	max_tokens?: number;
	temperature?: number;
	top_p?: number;
	top_k?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	repetition_penalty?: number;
	min_p?: number;
	stop?: string | string[];
	stream?: boolean;
	seed?: number;
}

/**
 * OpenAI-compatible SSE chunk
 */
export interface OpenAIStreamChunk {
	id: string;
	object: "text_completion";
	created: number;
	model: string;
	choices: Array<{
		text: string;
		index: number;
		logprobs: null;
		finish_reason: string | null;
	}>;
}

/**
 * API request configuration
 */
export interface ApiRequestConfig {
	apiKey: string;
	timeout?: number;
}

/**
 * API result wrapper
 */
export interface ApiResult<T> {
	success: boolean;
	data?: T;
	error?: string;
	statusCode?: number;
}

// =============================================
// Parameter Presets
// =============================================

/**
 * Get default parameters for kayra-v1 model
 * Based on reference implementation with sensible defaults for roleplay
 */
// Use https://novelai.net/tokenizer to find stop sequences
export function getKayraParameters(): NovelAIParameters {
	return {
		max_length: 150, // Increased from reference for longer responses
		min_length: 10,
		temperature: 1.35,
		top_k: 15,
		top_p: 0.85,
		top_a: 0.1,
		tail_free_sampling: 0.915,
		repetition_penalty: 2.8,
		repetition_penalty_frequency: 0.02,
		repetition_penalty_presence: 0,
		repetition_penalty_range: 2048,
		repetition_penalty_slope: 0.02,
		cfg_scale: 1,
		phrase_rep_pen: "aggressive",
		generate_until_sentence: true,
		use_string: true,
		bracket_ban: true,
		order: [2, 3, 0, 4, 1],
		stop_sequences: [],
		// stop_sequences: [[85], [85, 23]], // \n and \n***
	};
}

/**
 * Get default parameters for glm-4-6 model
 * Based on reference implementation optimized for latest model
 */
export function getGlmParameters(): NovelAIParameters {
	return {
		max_length: 150, // Increased from reference for longer responses
		min_length: 1,
		temperature: 0.75,
		top_k: 40,
		top_p: 0.95,
		top_a: 1,
		tail_free_sampling: 1,
		typical_p: 1,
		repetition_penalty: 0, // GLM-4-6 doesn't need heavy rep penalty
		repetition_penalty_range: 0,
		repetition_penalty_slope: 0,
		repetition_penalty_frequency: 0,
		repetition_penalty_presence: 0,
		cfg_scale: 1,
		phrase_rep_pen: "medium",
		use_string: true,
		stop_sequences: [],
		// stop_sequences: [[58]], // Character "["
	};
}

/**
 * Convert temperature from Gemini scale to NovelAI scale
 * Database stores temperature in Gemini's optimal range (1.0 to 2.0, default 1.5)
 * NovelAI models have different optimal ranges, so we need to convert
 *
 * @param geminiTemp - Temperature in Gemini scale (1.0 to 2.0)
 * @param model - Target NovelAI model
 * @returns Converted temperature for the target model
 */
export function convertTemperatureToNovelAI(
	geminiTemp: number,
	model: string,
): number {
	if (model === "kayra-v1") {
		// Kayra-v1: Simple offset conversion
		// Gemini 1.5 (default) → Kayra 1.35 (default)
		// Just subtract 0.15 from Gemini temperature
		return geminiTemp - 0.15;
	}

	// glm-4-6: Piecewise linear mapping
	// Low range: [1.0, 1.5] gemini → [0.5, 0.75] glm
	// High range: [1.5, 2.0] gemini → [0.75, 1.5] glm
	if (geminiTemp <= 1.5) {
		// Below or at default: interpolate between 0.5 and 0.75
		// slope = (0.75 - 0.5) / (1.5 - 1.0) = 0.5
		return 0.5 + (geminiTemp - 1.0) * 0.5;
	}

	// Above default: interpolate between 0.75 and 1.5
	// slope = (1.5 - 0.75) / (2.0 - 1.5) = 1.5
	return 0.75 + (geminiTemp - 1.5) * 1.5;
}

/**
 * Get parameters for a specific model with optional temperature override
 * @param model - Model name
 * @param temperature - Optional temperature in Gemini scale (will be converted to NovelAI scale)
 */
export function getParametersForModel(
	model: string,
	temperature?: number,
): NovelAIParameters {
	const params =
		model === "kayra-v1" ? getKayraParameters() : getGlmParameters();

	// Override temperature if provided (convert from Gemini scale to NovelAI scale)
	if (temperature !== undefined) {
		params.temperature = convertTemperatureToNovelAI(temperature, model);
	}

	return params;
}

/**
 * Check if a model requires the OpenAI-compatible API endpoint
 * @param model - Model name to check
 * @returns True if model uses OpenAI endpoint, false for native NovelAI endpoint
 */
export function usesOpenAIEndpoint(model: string): boolean {
	// glm-4-6 and newer models require OpenAI-compatible API
	// kayra-v1 uses the native NovelAI API
	return model === "glm-4-6";
}

/**
 * Convert NovelAI parameters to OpenAI-compatible format
 * @param naiParams - NovelAI parameters
 * @returns OpenAI-compatible parameters
 */
function convertToOpenAIParams(
	naiParams: NovelAIParameters,
): Partial<OpenAICompletionRequest> {
	return {
		max_tokens: naiParams.max_length,
		temperature: naiParams.temperature,
		top_p: naiParams.top_p,
		top_k: naiParams.top_k,
		min_p: naiParams.min_p,
		frequency_penalty: naiParams.repetition_penalty_frequency,
		presence_penalty: naiParams.repetition_penalty_presence,
		repetition_penalty: naiParams.repetition_penalty,
	};
}

// =============================================
// Core API Functions
// =============================================

/**
 * Make a request to NovelAI API
 * @param endpoint - API endpoint path
 * @param body - Request body
 * @param config - Request configuration
 * @returns API response
 */
async function makeNovelAIRequest<T>(
	endpoint: string,
	body: Record<string, unknown>,
	config: ApiRequestConfig,
): Promise<ApiResult<T>> {
	const { apiKey, timeout = REQUEST_TIMEOUT } = config;

	try {
		// Build URL
		const url = `${NOVELAI_API_BASE_URL}${endpoint}`;

		log.info(`Making NovelAI API request to: ${endpoint}`);

		// Create fetch request with timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		// Check if request was successful
		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");
			log.error(
				`NovelAI API request failed with status ${response.status}: ${errorText}`,
			);

			return {
				success: false,
				error: `API request failed: ${response.statusText}`,
				statusCode: response.status,
			};
		}

		// Parse JSON response
		const data = (await response.json()) as T;
		log.success(`NovelAI API request to ${endpoint} completed successfully`);

		return {
			success: true,
			data,
			statusCode: response.status,
		};
	} catch (error) {
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				log.error(
					`NovelAI API request to ${endpoint} timed out after ${timeout}ms`,
				);
				return {
					success: false,
					error: "Request timed out",
					statusCode: 408,
				};
			}

			log.error(`NovelAI API request to ${endpoint} failed:`, error);
			return {
				success: false,
				error: error.message,
			};
		}

		return {
			success: false,
			error: "Unknown error occurred",
		};
	}
}

/**
 * Start streaming generation using OpenAI-compatible API endpoint
 * @param prompt - Generation prompt
 * @param model - Model name
 * @param parameters - Generation parameters
 * @param config - Request configuration
 * @returns AsyncGenerator yielding stream chunks
 */
async function* novelaiGenerateStreamOpenAI(
	prompt: string,
	model: string,
	parameters: NovelAIParameters,
	config: ApiRequestConfig,
): AsyncGenerator<NovelAIStreamChunk, void, unknown> {
	const { apiKey, timeout = REQUEST_TIMEOUT } = config;

	try {
		const url = `${NOVELAI_API_BASE_URL}/oa/v1/completions`;

		log.info("Starting NovelAI streaming generation (OpenAI-compatible API)");

		// Convert NovelAI parameters to OpenAI format
		const openaiParams = convertToOpenAIParams(parameters);

		// Build OpenAI-compatible request
		const requestBody: OpenAICompletionRequest = {
			model,
			prompt,
			stream: true,
			...openaiParams,
		};

		// Create fetch request with timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(requestBody),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");
			log.error(
				`NovelAI OpenAI streaming request failed: ${response.status} ${errorText}`,
			);

			yield {
				error: `NovelAI API request failed with status ${response.status}: ${errorText}`,
			};
			return;
		}

		if (!response.body) {
			log.error("NovelAI OpenAI streaming response has no body");
			yield {
				error: "Response has no body",
			};
			return;
		}

		// Read SSE stream
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					log.info("NovelAI OpenAI stream complete");
					break;
				}

				// Decode chunk
				buffer += decoder.decode(value, { stream: true });

				// Process SSE lines
				const lines = buffer.split("\n");
				buffer = lines.pop() || ""; // Keep incomplete line in buffer

				for (const line of lines) {
					if (!line.trim() || line.startsWith(":")) {
						continue; // Skip empty lines and comments
					}

					if (line.startsWith("data: ")) {
						const data = line.slice(6); // Remove 'data: ' prefix

						if (data === "[DONE]") {
							yield { final: true };
							return;
						}

						try {
							const chunk = JSON.parse(data) as OpenAIStreamChunk;

							// Extract text from choices
							if (chunk.choices?.[0]?.text) {
								yield {
									token: chunk.choices[0].text,
									final: chunk.choices[0].finish_reason !== null,
								};
							}

							// Check if generation is complete
							if (chunk.choices?.[0]?.finish_reason) {
								yield { final: true };
								return;
							}
						} catch (parseError) {
							log.error("Failed to parse OpenAI SSE chunk:", parseError);
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	} catch (error) {
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				log.error(
					`NovelAI OpenAI streaming request timed out after ${timeout}ms`,
				);
				yield {
					error: "Request timed out",
				};
			} else {
				log.error("NovelAI OpenAI streaming error:", error);
				yield {
					error: error.message,
				};
			}
		} else {
			yield {
				error: "Unknown error occurred",
			};
		}
	}
}

/**
 * Start streaming generation from NovelAI using native SSE endpoint
 * @param request - Generation request
 * @param config - Request configuration
 * @returns AsyncGenerator yielding stream chunks
 */
async function* novelaiGenerateStreamNative(
	request: NovelAIGenerationRequest,
	config: ApiRequestConfig,
): AsyncGenerator<NovelAIStreamChunk, void, unknown> {
	const { apiKey, timeout = REQUEST_TIMEOUT } = config;

	try {
		const url = `${NOVELAI_API_BASE_URL}/ai/generate-stream`;

		log.info("Starting NovelAI streaming generation");

		// Create fetch request with timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeout);

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(request),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");
			log.error(
				`NovelAI streaming request failed: ${response.status} ${errorText}`,
			);

			yield {
				error: `NovelAI API request failed with status ${response.status}: ${errorText}`,
			};
			return;
		}

		if (!response.body) {
			log.error("NovelAI streaming response has no body");
			yield {
				error: "Response body is empty",
			};
			return;
		}

		// Parse SSE stream
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				log.info("NovelAI stream completed");
				yield { final: true };
				break;
			}

			// Decode chunk and add to buffer
			buffer += decoder.decode(value, { stream: true });

			// Process complete SSE messages (lines ending with \n\n)
			const lines = buffer.split("\n");
			buffer = lines.pop() || ""; // Keep incomplete line in buffer

			for (const line of lines) {
				// Skip empty lines and comments
				if (!line.trim() || line.startsWith(":")) {
					continue;
				}

				// Parse SSE data lines
				if (line.startsWith("data: ")) {
					const data = line.slice(6); // Remove "data: " prefix

					try {
						const parsed = JSON.parse(data);

						// NovelAI sends tokens as strings in the response
						if (typeof parsed === "string") {
							yield { token: parsed };
						} else if (parsed.token) {
							yield { token: parsed.token };
						} else if (parsed.error) {
							yield { error: parsed.error };
							return;
						}
					} catch (_parseError) {
						log.warn(`Failed to parse NovelAI SSE data: ${data}`);
						// Yield raw data if JSON parsing fails
						yield { token: data };
					}
				}
			}
		}
	} catch (error) {
		if (error instanceof Error) {
			if (error.name === "AbortError") {
				log.error("NovelAI streaming timed out");
				yield { error: "Request timed out" };
			} else {
				log.error("NovelAI streaming failed:", error);
				yield { error: error.message };
			}
		} else {
			yield { error: "Unknown error occurred" };
		}
	}
}

/**
 * Start streaming generation from NovelAI
 * Routes to the appropriate endpoint based on the model
 * @param request - Generation request
 * @param config - Request configuration
 * @returns AsyncGenerator yielding stream chunks
 */
export async function* novelaiGenerateStream(
	request: NovelAIGenerationRequest,
	config: ApiRequestConfig,
): AsyncGenerator<NovelAIStreamChunk, void, unknown> {
	// Check if model requires OpenAI endpoint
	if (usesOpenAIEndpoint(request.model)) {
		// Use OpenAI-compatible endpoint
		yield* novelaiGenerateStreamOpenAI(
			request.input,
			request.model,
			request.parameters,
			config,
		);
	} else {
		// Use native NovelAI endpoint
		yield* novelaiGenerateStreamNative(request, config);
	}
}

/**
 * Validate NovelAI API key by making a minimal request
 * @param apiKey - API key to validate
 * @returns True if valid, throws error with details if invalid
 * @throws Error with statusCode and message on validation failure
 */
export async function validateNovelAIApiKey(apiKey: string): Promise<boolean> {
	log.info("Validating NovelAI API key");

	// Get proper parameters for kayra-v1 (use existing preset)
	const parameters = getKayraParameters();
	// Override to minimal generation for faster validation
	parameters.max_length = 10;
	parameters.min_length = 1;

	// Make a minimal request to test the key
	const result = await makeNovelAIRequest<NovelAIGenerationResponse>(
		"/ai/generate",
		{
			input: "Test",
			model: "kayra-v1",
			parameters,
		},
		{ apiKey, timeout: 10000 },
	);

	if (result.success) {
		log.success("NovelAI API key is valid");
		return true;
	}

	// 401 = invalid key, 402 = insufficient credits (but key is valid)
	if (result.statusCode === 402) {
		log.info("NovelAI API key is valid but has insufficient credits");
		return true;
	}

	// Create an error object with statusCode for proper error handling
	const error: Error & { statusCode?: number } = new Error(
		result.error || "API key validation failed",
	);
	error.statusCode = result.statusCode;

	log.warn(
		`NovelAI API key validation failed with status ${result.statusCode}: ${result.error}`,
	);
	throw error;
}

// =============================================
// Error Checking Utilities
// =============================================

/**
 * Check if an error is related to API key issues
 */
export function isNovelAIApiKeyError(
	error: string,
	statusCode?: number,
): boolean {
	const keywordErrors = [
		"unauthorized",
		"invalid api key",
		"authentication",
		"bearer",
	];

	return (
		statusCode === 401 ||
		keywordErrors.some((keyword) => error.toLowerCase().includes(keyword))
	);
}

/**
 * Check if an error is related to insufficient credits
 */
export function isNovelAICreditsError(
	error: string,
	statusCode?: number,
): boolean {
	const creditsKeywords = ["insufficient", "credits", "quota", "billing"];

	return (
		statusCode === 402 ||
		creditsKeywords.some((keyword) => error.toLowerCase().includes(keyword))
	);
}

/**
 * Check if an error is related to rate limiting
 */
export function isNovelAIRateLimitError(
	error: string,
	statusCode?: number,
): boolean {
	const rateLimitKeywords = ["rate limit", "too many requests"];

	return (
		statusCode === 429 ||
		rateLimitKeywords.some((keyword) => error.toLowerCase().includes(keyword))
	);
}

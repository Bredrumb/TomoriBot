/**
 * OpenRouter Capability Cache
 *
 * Provides in-memory caching for OpenRouter model capabilities by fetching directly
 * from the OpenRouter API. This ensures model capabilities (tools, images, etc.) are
 * accurate and prevents routing errors caused by stale database flags.
 *
 * Key features:
 * - Fetches model metadata from https://openrouter.ai/api/v1/models at startup
 * - Caches capabilities to avoid per-request API calls
 * - Overrides database flags with actual OpenRouter API data
 * - Handles account-setting model with conservative defaults
 * - Graceful fallback to database flags on API failures
 */

import { log } from "../misc/logger";

/**
 * OpenRouter API model response structure
 * Based on https://openrouter.ai/api/v1/models endpoint
 */
interface OpenRouterModel {
	id: string;
	name: string;
	description?: string;
	supported_parameters?: string[];
	architecture?: {
		modality?: string;
		tokenizer?: string;
		instruct_type?: string;
	};
}

/**
 * Cached model capabilities
 * Extracted from OpenRouter API's supported_parameters and architecture fields
 */
export interface ModelCapabilities {
	hasTools: boolean; // Function calling support
	seesImages: boolean; // Vision/image input support
	seesVideos: boolean; // Video input support
	supportsStructuredOutput: boolean; // JSON mode / structured output support
}

/**
 * In-memory cache for OpenRouter model capabilities
 * Key: llm_codename (e.g., "anthropic/claude-3.5-sonnet")
 * Value: ModelCapabilities object
 */
const capabilityCache = new Map<string, ModelCapabilities>();

/**
 * Cache initialization state
 */
let cacheReady = false;

/**
 * Determines if a model supports function calling
 *
 * Requirements:
 * - Must have BOTH "tools" AND "tool_choice" in supported_parameters
 * - OpenRouter requires both for full function calling support
 *
 * @param model - OpenRouter model object from API
 * @returns True if model supports function calling
 */
function detectToolSupport(model: OpenRouterModel): boolean {
	// 1. Check if supported_parameters exists and is an array
	if (
		!model.supported_parameters ||
		!Array.isArray(model.supported_parameters)
	) {
		return false;
	}

	// 2. Both "tools" AND "tool_choice" must be present for full tool support
	const hasTools = model.supported_parameters.includes("tools");
	const hasToolChoice = model.supported_parameters.includes("tool_choice");

	return hasTools && hasToolChoice;
}

/**
 * Determines if a model supports image inputs (vision)
 *
 * Detection logic:
 * - Checks architecture.modality for "vision" or "multimodal"
 * - OpenRouter uses modality field to indicate visual capabilities
 *
 * @param model - OpenRouter model object from API
 * @returns True if model supports image inputs
 */
function detectImageSupport(model: OpenRouterModel): boolean {
	// 1. Get modality string and convert to lowercase for comparison
	const modality = model.architecture?.modality?.toLowerCase();

	// 2. Check for vision or multimodal indicators
	return modality?.includes("vision") || modality?.includes("multimodal") || false;
}

/**
 * Determines if a model supports video inputs
 *
 * Detection logic:
 * - Checks architecture.modality for "video"
 * - Checks supported_parameters for "video" parameter
 *
 * @param model - OpenRouter model object from API
 * @returns True if model supports video inputs
 */
function detectVideoSupport(model: OpenRouterModel): boolean {
	// 1. Check modality field for video indicator
	const modality = model.architecture?.modality?.toLowerCase();
	const hasVideoModality = modality?.includes("video") || false;

	// 2. Check supported_parameters for explicit video parameter
	const hasVideoParam =
		model.supported_parameters?.includes("video") || false;

	// 3. Model supports video if either indicator is present
	return hasVideoModality || hasVideoParam;
}

/**
 * Determines if a model supports structured output (JSON mode)
 *
 * Requirements:
 * - Must have "response_format" in supported_parameters
 * - Indicates support for JSON schema / structured output
 *
 * @param model - OpenRouter model object from API
 * @returns True if model supports structured output
 */
function detectStructuredOutputSupport(model: OpenRouterModel): boolean {
	// 1. Check if response_format parameter is supported
	return (
		model.supported_parameters?.includes("response_format") ||
		model.supported_parameters?.includes("structured_outputs") ||
		false
	);
}

/**
 * Initializes the OpenRouter capability cache by fetching models from the API
 *
 * This function:
 * 1. Fetches all models from https://openrouter.ai/api/v1/models (public endpoint)
 * 2. Extracts capability information from each model
 * 3. Caches capabilities in memory for fast lookup
 * 4. Handles errors gracefully (non-fatal, falls back to database flags)
 *
 * Should be called once at bot startup after LLM cache initialization.
 *
 * Error handling: Non-fatal - logs warning and continues with empty cache
 * on API failure, allowing fallback to database flags.
 */
export async function initializeOpenRouterCapabilityCache(): Promise<void> {
	try {
		log.info("Initializing OpenRouter capability cache...");

		// 1. Clear existing cache
		capabilityCache.clear();
		cacheReady = false;

		// 2. Fetch models from OpenRouter API (no auth required - public endpoint)
		const response = await fetch("https://openrouter.ai/api/v1/models", {
			headers: {
				"Content-Type": "application/json",
			},
		});

		// 3. Check response status
		if (!response.ok) {
			throw new Error(
				`OpenRouter API returned ${response.status}: ${response.statusText}`,
			);
		}

		// 4. Parse JSON response
		const data = await response.json();

		// 5. Validate response structure
		if (!data.data || !Array.isArray(data.data)) {
			throw new Error("Unexpected API response format - missing data array");
		}

		const models: OpenRouterModel[] = data.data;
		log.info(`Fetched ${models.length} models from OpenRouter API`);

		// 6. Cache capabilities for each model
		for (const model of models) {
			// Extract capabilities using detection functions
			const capabilities: ModelCapabilities = {
				hasTools: detectToolSupport(model),
				seesImages: detectImageSupport(model),
				seesVideos: detectVideoSupport(model),
				supportsStructuredOutput: detectStructuredOutputSupport(model),
			};

			// Store in cache with model ID as key
			capabilityCache.set(model.id, capabilities);
		}

		// 7. Mark cache as ready
		cacheReady = true;

		// 8. Log statistics
		const toolModels = Array.from(capabilityCache.values()).filter(
			(c) => c.hasTools,
		).length;
		const visionModels = Array.from(capabilityCache.values()).filter(
			(c) => c.seesImages,
		).length;
		const videoModels = Array.from(capabilityCache.values()).filter(
			(c) => c.seesVideos,
		).length;

		log.success(
			`OpenRouter capability cache initialized: ${capabilityCache.size} models ` +
				`(${toolModels} with tools, ${visionModels} with vision, ${videoModels} with video)`,
		);
	} catch (error) {
		// Non-critical error - bot continues with database flags as fallback
		log.warn(
			"Failed to initialize OpenRouter capability cache (non-critical) - " +
				"will fall back to database flags",
			error as Error,
		);

		// Ensure cache is in a clean state even on error
		capabilityCache.clear();
		cacheReady = false;
	}
}

/**
 * Gets cached capabilities for a specific OpenRouter model
 *
 * @param modelCodename - Model codename (e.g., "anthropic/claude-3.5-sonnet")
 * @returns ModelCapabilities if found in cache, undefined if not found or cache not ready
 *
 * @example
 * const capabilities = getOpenRouterCapabilities("anthropic/claude-3.5-sonnet");
 * if (capabilities && capabilities.hasTools) {
 *   // Model supports function calling
 * }
 */
export function getOpenRouterCapabilities(
	modelCodename: string,
): ModelCapabilities | undefined {
	// 1. Return undefined if cache is not ready
	if (!cacheReady) {
		return undefined;
	}

	// 2. Look up capabilities in cache
	return capabilityCache.get(modelCodename);
}

/**
 * Checks if the OpenRouter capability cache is ready
 *
 * @returns True if cache is initialized (may be empty if API failed), false otherwise
 *
 * Note: A ready cache may be empty if the API fetch failed.
 * Use getOpenRouterCapabilities() and check for undefined to handle cache misses.
 */
export function isOpenRouterCapabilityCacheReady(): boolean {
	return cacheReady;
}

/**
 * Gets the number of models cached
 *
 * @returns Number of cached model capabilities
 *
 * Useful for monitoring and debugging cache state.
 */
export function getOpenRouterCapabilityCacheSize(): number {
	return capabilityCache.size;
}

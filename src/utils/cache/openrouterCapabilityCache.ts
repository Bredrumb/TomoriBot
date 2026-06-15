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
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";

/**
 * OpenRouter API model response structure
 * Based on https://openrouter.ai/api/v1/models endpoint
 */
interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number; // Total context window size (input + output tokens)
  supported_parameters?: string[];
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string;
  };
  top_provider?: {
    max_completion_tokens?: number; // Maximum output tokens the provider supports
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
 * Cached model token limits
 * Extracted from OpenRouter API's context_length and top_provider fields
 */
export interface ModelTokenLimits {
  contextLength: number; // Total context window (input + output)
  maxCompletionTokens: number | undefined; // Max output tokens, undefined if not reported
}

/**
 * Cached model pricing.
 * Values are normalized to USD per million tokens for prompt/completion cost math.
 */
export interface ModelPricing {
  promptPricePerMillion: number;
  completionPricePerMillion: number;
}

/**
 * In-memory cache for OpenRouter model capabilities
 * Key: llm_codename (e.g., "anthropic/claude-3.5-sonnet")
 * Value: ModelCapabilities object
 */
const capabilityCache = new Map<string, ModelCapabilities>();
const supportedParametersCache = new Map<string, Set<string>>();
const tokenizerCache = new Map<string, string>();

/**
 * In-memory cache for OpenRouter model token limits
 * Key: llm_codename (e.g., "anthropic/claude-3.5-sonnet")
 * Value: ModelTokenLimits object
 */
const tokenLimitsCache = new Map<string, ModelTokenLimits>();
const pricingCache = new Map<string, ModelPricing>();

/**
 * On-demand fetch cache for models not in the startup cache
 * Used for account-setting and other dynamically-specified models
 * Separate from startup cache to avoid unbounded memory growth
 */
const onDemandCapabilityCache = new Map<string, ModelCapabilities>();

/**
 * Cache initialization state
 */
let cacheReady = false;

/**
 * Determines if a model supports function calling
 *
 * Requirements:
 * - Prefer explicit "tools" in supported_parameters
 * - Fall back to description-based detection when OpenRouter metadata is inconsistent
 *
 * Rationale:
 * - OpenRouter tool calling works when the model accepts the `tools` parameter.
 * - `tool_choice` is optional for our chat path because OpenRouter defaults it to
 *   automatic selection when omitted.
 * - Some models expose native function calling but do not advertise `tool_choice`.
 * - Some models also advertise native function calling in the description while
 *   omitting `tools` from supported_parameters, so we need a fallback to avoid
 *   incorrectly disabling working tools.
 *
 * @param model - OpenRouter model object from API
 * @returns True if model supports function calling
 */
function detectToolSupport(model: OpenRouterModel): boolean {
  // 1. Check if supported_parameters exists and is an array
  if (model.supported_parameters && Array.isArray(model.supported_parameters)) {
    // 2. `tools` is the primary capability gate for function calling.
    if (model.supported_parameters.includes("tools")) {
      return true;
    }
  }

  // 3. OpenRouter metadata is occasionally contradictory: the model description can
  // advertise native function/tool calling even when supported_parameters omits `tools`.
  const normalizedDescription = model.description?.toLowerCase() ?? "";
  const descriptionAdvertisesToolUse =
    normalizedDescription.includes("function calling") || normalizedDescription.includes("tool calling");

  if (descriptionAdvertisesToolUse) {
    log.info(
      `[OpenRouter capability cache] ${model.id} advertises tool use in its description but does not list tools in supported_parameters; treating it as tool-capable.`,
    );
    return true;
  }

  return false;
}

/**
 * Determines if a model supports image inputs (vision)
 *
 * Detection logic:
 * - Checks architecture.modality for image capability indicators
 * - OpenRouter uses arrow notation: "text+image->text" (NOT "vision"/"multimodal")
 * - Also accepts "vision" and "multimodal" as fallback keywords for forward compatibility
 *
 * @param model - OpenRouter model object from API
 * @returns True if model supports image inputs
 */
function detectImageSupport(model: OpenRouterModel): boolean {
  // 1. Get modality string and convert to lowercase for comparison
  const modality = model.architecture?.modality?.toLowerCase();

  // 2. Check for image capability indicators
  // OpenRouter uses "text+image->text" notation — check for "image" as the primary signal,
  // plus "vision" and "multimodal" for forward compatibility with any future API format changes
  return modality?.includes("image") || modality?.includes("vision") || modality?.includes("multimodal") || false;
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
  const hasVideoParam = model.supported_parameters?.includes("video") || false;

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

function parseUsdPerMillion(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;

  // OpenRouter /models pricing values are per-token USD.
  return parsed * 1_000_000;
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

    // 1. Clear existing caches
    capabilityCache.clear();
    supportedParametersCache.clear();
    tokenizerCache.clear();
    tokenLimitsCache.clear();
    pricingCache.clear();
    cacheReady = false;

    // 2. Fetch models from OpenRouter API (no auth required - public endpoint)
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "Content-Type": "application/json",
        ...buildOpenRouterAttributionHeaders(),
      },
    });

    // 3. Check response status
    if (!response.ok) {
      throw new Error(`OpenRouter API returned ${response.status}: ${response.statusText}`);
    }

    // 4. Parse JSON response
    const data = await response.json();

    // 5. Validate response structure
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Unexpected API response format - missing data array");
    }

    const models: OpenRouterModel[] = data.data;
    log.info(`Fetched ${models.length} models from OpenRouter API`);

    // 6. Cache capabilities and token limits for each model
    for (const model of models) {
      // Extract capabilities using detection functions
      const capabilities: ModelCapabilities = {
        hasTools: detectToolSupport(model),
        seesImages: detectImageSupport(model),
        seesVideos: detectVideoSupport(model),
        supportsStructuredOutput: detectStructuredOutputSupport(model),
      };

      // Extract token limits from API response fields
      const tokenLimits: ModelTokenLimits = {
        contextLength: model.context_length ?? 0,
        maxCompletionTokens: model.top_provider?.max_completion_tokens,
      };
      const promptPricePerMillion = parseUsdPerMillion(model.pricing?.prompt);
      const completionPricePerMillion = parseUsdPerMillion(model.pricing?.completion);

      // Store in caches with model ID as key
      capabilityCache.set(model.id, capabilities);
      supportedParametersCache.set(model.id, new Set(model.supported_parameters ?? []));
      if (typeof model.architecture?.tokenizer === "string") {
        const tokenizer = model.architecture.tokenizer.trim();
        if (tokenizer.length > 0) {
          tokenizerCache.set(model.id, tokenizer);
        }
      }
      tokenLimitsCache.set(model.id, tokenLimits);
      if (promptPricePerMillion !== undefined && completionPricePerMillion !== undefined) {
        pricingCache.set(model.id, {
          promptPricePerMillion,
          completionPricePerMillion,
        });
      }
    }

    // 7. Mark cache as ready
    cacheReady = true;

    // 8. Log statistics
    const toolModels = Array.from(capabilityCache.values()).filter((c) => c.hasTools).length;
    const visionModels = Array.from(capabilityCache.values()).filter((c) => c.seesImages).length;
    const videoModels = Array.from(capabilityCache.values()).filter((c) => c.seesVideos).length;
    const pricedModels = pricingCache.size;

    log.success(
      `OpenRouter capability cache initialized: ${capabilityCache.size} models ` +
        `(${toolModels} with tools, ${visionModels} with vision, ${videoModels} with video, ${pricedModels} with pricing)`,
    );
  } catch (error) {
    // Non-critical error - bot continues with database flags as fallback
    log.warn(
      "Failed to initialize OpenRouter capability cache (non-critical) - " + "will fall back to database flags",
      error as Error,
    );

    // Ensure caches are in a clean state even on error
    capabilityCache.clear();
    supportedParametersCache.clear();
    tokenizerCache.clear();
    tokenLimitsCache.clear();
    pricingCache.clear();
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
export function getOpenRouterCapabilities(modelCodename: string): ModelCapabilities | undefined {
  // 1. Return undefined if cache is not ready
  if (!cacheReady) {
    return undefined;
  }

  // 2. Look up capabilities in cache
  return capabilityCache.get(modelCodename);
}

/**
 * Gets the supported parameter names for a specific OpenRouter model.
 *
 * @param modelCodename - Model codename (e.g., "anthropic/claude-3.5-sonnet")
 * @returns Set of supported parameter names, or undefined if cache/model not ready
 */
export function getOpenRouterSupportedParameters(modelCodename: string): ReadonlySet<string> | undefined {
  if (!cacheReady) {
    return undefined;
  }

  return supportedParametersCache.get(modelCodename);
}

/**
 * Gets the tokenizer metadata reported by OpenRouter for a specific model.
 *
 * @param modelCodename - Model codename (e.g., "openai/gpt-4o-mini")
 * @returns Raw tokenizer label from OpenRouter, or undefined if not cached
 */
export function getOpenRouterTokenizer(modelCodename: string): string | undefined {
  if (!cacheReady) {
    return undefined;
  }

  return tokenizerCache.get(modelCodename);
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

export function getOpenRouterOnDemandCapabilityCacheSize(): number {
  return onDemandCapabilityCache.size;
}

export function clearOpenRouterOnDemandCapabilityCache(): void {
  onDemandCapabilityCache.clear();
}

/**
 * Gets the cached token limits for a specific OpenRouter model
 *
 * @param modelCodename - Model codename (e.g., "google/gemini-2.0-flash-exp")
 * @returns ModelTokenLimits if found, undefined if not cached or cache not ready
 */
export function getOpenRouterTokenLimits(modelCodename: string): ModelTokenLimits | undefined {
  if (!cacheReady) return undefined;
  return tokenLimitsCache.get(modelCodename);
}

/**
 * Gets cached pricing for a specific OpenRouter model.
 *
 * @param modelCodename - Model codename (e.g., "google/gemini-2.0-flash-exp")
 * @returns ModelPricing if found, undefined if cache/model not ready
 */
export function getOpenRouterPricing(modelCodename: string): ModelPricing | undefined {
  if (!cacheReady) return undefined;
  return pricingCache.get(modelCodename);
}

/**
 * Tests account-setting model by making a minimal request to detect the actual model
 *
 * When a user selects "account-setting" in OpenRouter, it resolves to their default model
 * at request time. This function makes a test request and extracts which model was actually
 * used, then fetches that model's real capabilities.
 *
 * @param apiKey - OpenRouter API key for the user
 * @returns Object with { actualModel, capabilities } or { error } if test fails
 *
 * @example
 * const result = await testAccountSettingModel(apiKey);
 * if ("actualModel" in result) {
 *   console.log("User's default:", result.actualModel); // e.g., "xai/grok-2"
 *   console.log("Supports images:", result.capabilities.seesImages);
 * }
 */
export async function testAccountSettingModel(apiKey: string): Promise<
  | {
      actualModel: string;
      capabilities: ModelCapabilities;
    }
  | { error: string }
> {
  try {
    log.info("Testing account-setting model to detect actual OpenRouter default...");

    // Make a minimal streaming request to account-setting to see which model OpenRouter picks
    // Using streaming because some models/configurations prefer it
    const testPayload = {
      model: "account-setting",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
      temperature: 1.0,
      max_tokens: 5,
    };

    const testResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...buildOpenRouterAttributionHeaders(),
      },
      body: JSON.stringify(testPayload),
    });

    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      return {
        error: `OpenRouter API error: ${testResponse.status} ${testResponse.statusText} | ${errorText}`,
      };
    }

    // For streaming, read the first chunk to get model info
    const reader = testResponse.body?.getReader();
    if (!reader) {
      return {
        error: "Response body is null",
      };
    }

    const decoder = new TextDecoder();
    let actualModel: string | undefined;

    try {
      const { value } = await reader.read();
      const chunk = decoder.decode(value);

      // Parse the first SSE chunk to extract model
      // Format: data: {"id":"...", "model":"actual-model-name", ...}
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const jsonStr = line.substring(6); // Remove "data: "
            const parsed = JSON.parse(jsonStr);
            if (parsed.model) {
              actualModel = parsed.model;
              break;
            }
          } catch {
            // Continue to next line
          }
        }
      }
    } finally {
      reader.cancel();
    }

    if (!actualModel) {
      return {
        error: "Could not determine actual model from OpenRouter streaming response",
      };
    }

    log.info(`Detected account-setting resolves to: ${actualModel}`);

    // Now fetch capabilities for the actual model
    const capabilities = await getOrFetchOpenRouterCapabilities(actualModel);

    if (!capabilities) {
      return {
        error: `Could not fetch capabilities for detected model: ${actualModel}`,
      };
    }

    return { actualModel, capabilities };
  } catch (error) {
    return {
      error: `Test request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Gets or fetches capabilities for an OpenRouter model
 *
 * This function provides a fallback mechanism for account-setting and other
 * dynamically-specified models that may not be in the startup cache:
 * 1. Checks the startup cache first (fastest)
 * 2. Checks the on-demand cache (previously fetched models)
 * 3. Fetches from OpenRouter API if not cached (for account-setting models)
 * 4. Caches the result to avoid repeated API calls
 *
 * @param modelCodename - Model codename (e.g., "anthropic/claude-3.5-sonnet" or "account-setting" user's model)
 * @returns ModelCapabilities if found or fetched, undefined on error or if cache not ready
 *
 * @example
 * // For registered models (in startup cache)
 * const capabilities = await getOrFetchOpenRouterCapabilities("anthropic/claude-3.5-sonnet");
 *
 * // For account-setting models (fetches on-demand if not cached)
 * const accountSettingCaps = await getOrFetchOpenRouterCapabilities("openai/gpt-4-turbo");
 * if (accountSettingCaps?.seesImages) {
 *   // User's account-setting model supports images
 * }
 */
export async function getOrFetchOpenRouterCapabilities(modelCodename: string): Promise<ModelCapabilities | undefined> {
  // 1. Cache not ready - cannot even fetch on-demand
  if (!cacheReady) {
    log.warn(`Cannot fetch capabilities for ${modelCodename}: cache not ready`);
    return undefined;
  }

  // 2. Check startup cache first (populated at bot startup)
  const cachedCapabilities = capabilityCache.get(modelCodename);
  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  // 3. Check on-demand cache (previously fetched models)
  const onDemandCached = onDemandCapabilityCache.get(modelCodename);
  if (onDemandCached) {
    return onDemandCached;
  }

  // 4. Model not in either cache - fetch from OpenRouter API
  try {
    log.info(`Fetching capabilities on-demand for model: ${modelCodename}`);

    // Fetch specific model from OpenRouter API
    const response = await fetch(`https://openrouter.ai/api/v1/models/${encodeURIComponent(modelCodename)}`, {
      headers: {
        "Content-Type": "application/json",
        ...buildOpenRouterAttributionHeaders(),
      },
    });

    // 5. Check response status
    if (!response.ok) {
      log.warn(`Failed to fetch capabilities for ${modelCodename}: ${response.status} ${response.statusText}`);
      return undefined;
    }

    // 6. Parse response and extract model data
    const data = await response.json();

    // OpenRouter returns the model in a 'data' property
    const model: OpenRouterModel | undefined = data.data;

    if (!model) {
      log.warn(`OpenRouter API returned no model data for ${modelCodename}`);
      return undefined;
    }

    // 7. Extract capabilities using the same detection functions
    const capabilities: ModelCapabilities = {
      hasTools: detectToolSupport(model),
      seesImages: detectImageSupport(model),
      seesVideos: detectVideoSupport(model),
      supportsStructuredOutput: detectStructuredOutputSupport(model),
    };

    // 8. Cache the result for future requests
    onDemandCapabilityCache.set(modelCodename, capabilities);

    log.info(
      `Fetched capabilities for ${modelCodename}: ` +
        `tools=${capabilities.hasTools}, images=${capabilities.seesImages}, ` +
        `videos=${capabilities.seesVideos}, structOutput=${capabilities.supportsStructuredOutput}`,
    );

    return capabilities;
  } catch (error) {
    log.warn(
      `Error fetching capabilities for ${modelCodename}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

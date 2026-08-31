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
const onDemandPricingCache = new Map<string, ModelPricing>();

/**
 * Cache initialization state
 */
let cacheReady = false;

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_CATALOG_REFRESH_MIN_INTERVAL_MS = 60 * 1000;

let lastCatalogAttemptAt: number | null = null;
let catalogRefreshInFlight: Promise<boolean> | null = null;

/**
 * Floor on the gap between catalog refresh *attempts*.
 *
 * The gate counts attempts rather than successes so a codename OpenRouter does not publish
 * cannot amplify into a fetch per chat turn: the account-setting path calls
 * `getOrFetchOpenRouterCapabilities` whenever its stored capabilities are stale, and a
 * misconfigured codename misses on every one of those calls. Zero disables it.
 */
function getCatalogRefreshMinIntervalMs(): number {
  const parsed = Number.parseInt(process.env.OPENROUTER_CATALOG_REFRESH_MIN_INTERVAL_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CATALOG_REFRESH_MIN_INTERVAL_MS;
}

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
  if (model.supported_parameters && Array.isArray(model.supported_parameters)) {
    if (model.supported_parameters.includes("tools")) {
      return true;
    }
  }

  // OpenRouter metadata is occasionally contradictory: the model description can
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
  const modality = model.architecture?.modality?.toLowerCase();

  // OpenRouter uses "text+image->text" notation, so check for "image" as the primary signal,
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
  const modality = model.architecture?.modality?.toLowerCase();
  const hasVideoModality = modality?.includes("video") || false;

  const hasVideoParam = model.supported_parameters?.includes("video") || false;

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
 * Normalizes a model's prompt/completion rates to USD per million tokens.
 *
 * Both directions must parse: a half-priced model would silently bill one direction at
 * zero, which is worse than reporting no price at all.
 */
function extractPricing(model: OpenRouterModel): ModelPricing | undefined {
  const promptPricePerMillion = parseUsdPerMillion(model.pricing?.prompt);
  const completionPricePerMillion = parseUsdPerMillion(model.pricing?.completion);
  if (promptPricePerMillion === undefined || completionPricePerMillion === undefined) {
    return undefined;
  }

  return { promptPricePerMillion, completionPricePerMillion };
}

/**
 * Reads the OpenRouter catalog and replaces the cached snapshot.
 *
 * The fetch completes before any cached map is touched, so a failed attempt leaves the
 * previous catalog serving. Clearing first and refilling would strand every chat turn on
 * database flags until the next success.
 */
async function loadOpenRouterCatalog(): Promise<void> {
  const response = await fetch(OPENROUTER_MODELS_URL, {
    headers: {
      "Content-Type": "application/json",
      ...buildOpenRouterAttributionHeaders(),
    },
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("Unexpected API response format - missing data array");
  }

  const models: OpenRouterModel[] = data.data;

  capabilityCache.clear();
  supportedParametersCache.clear();
  tokenizerCache.clear();
  tokenLimitsCache.clear();
  pricingCache.clear();

  for (const model of models) {
    const capabilities: ModelCapabilities = {
      hasTools: detectToolSupport(model),
      seesImages: detectImageSupport(model),
      seesVideos: detectVideoSupport(model),
      supportsStructuredOutput: detectStructuredOutputSupport(model),
    };

    const tokenLimits: ModelTokenLimits = {
      contextLength: model.context_length ?? 0,
      maxCompletionTokens: model.top_provider?.max_completion_tokens,
    };
    const pricing = extractPricing(model);

    capabilityCache.set(model.id, capabilities);
    supportedParametersCache.set(model.id, new Set(model.supported_parameters ?? []));
    if (typeof model.architecture?.tokenizer === "string") {
      const tokenizer = model.architecture.tokenizer.trim();
      if (tokenizer.length > 0) {
        tokenizerCache.set(model.id, tokenizer);
      }
    }
    tokenLimitsCache.set(model.id, tokenLimits);
    if (pricing) {
      pricingCache.set(model.id, pricing);
    }
  }

  cacheReady = true;

  const toolModels = Array.from(capabilityCache.values()).filter((c) => c.hasTools).length;
  const visionModels = Array.from(capabilityCache.values()).filter((c) => c.seesImages).length;
  const videoModels = Array.from(capabilityCache.values()).filter((c) => c.seesVideos).length;
  const pricedModels = pricingCache.size;

  log.success(
    `OpenRouter capability cache loaded: ${capabilityCache.size} models ` +
      `(${toolModels} with tools, ${visionModels} with vision, ${videoModels} with video, ${pricedModels} with pricing)`,
  );
}

/**
 * Refresh entry point shared by startup and by on-demand misses.
 *
 * Concurrent callers share one in-flight fetch, and `force` skips the attempt cooldown that
 * otherwise bounds how often a miss can reach the network.
 */
async function refreshOpenRouterCatalog(options?: { force?: boolean }): Promise<boolean> {
  if (catalogRefreshInFlight) {
    return catalogRefreshInFlight;
  }

  if (!options?.force && lastCatalogAttemptAt !== null) {
    if (Date.now() - lastCatalogAttemptAt < getCatalogRefreshMinIntervalMs()) {
      return cacheReady;
    }
  }

  lastCatalogAttemptAt = Date.now();
  catalogRefreshInFlight = (async () => {
    try {
      await loadOpenRouterCatalog();
      return true;
    } catch (error) {
      log.warn(
        `Failed to refresh OpenRouter capability cache (non-critical); keeping ${capabilityCache.size} cached models`,
        error as Error,
      );
      return cacheReady;
    } finally {
      catalogRefreshInFlight = null;
    }
  })();

  return catalogRefreshInFlight;
}

/**
 * Warms the OpenRouter capability cache at startup.
 *
 * Non-fatal: a failure leaves the cache unready and chat falls back to database flags until
 * a later miss or refresh succeeds.
 */
export async function initializeOpenRouterCapabilityCache(): Promise<void> {
  log.info("Initializing OpenRouter capability cache...");
  await refreshOpenRouterCatalog({ force: true });
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
  if (!cacheReady) {
    return undefined;
  }

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
  onDemandPricingCache.clear();
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
  return pricingCache.get(modelCodename) ?? onDemandPricingCache.get(modelCodename);
}

/**
 * Every model rate from the startup catalog fetch, keyed by OpenRouter codename.
 *
 * On-demand entries are excluded: they are registered one model at a time and persist their
 * own rate at registration, so including them here would let a stale single-model probe
 * overwrite the authoritative catalog value.
 *
 * @returns Empty map when the cache is not ready, so callers cannot mistake an unavailable
 *   catalog for a catalog in which nothing is priced.
 */
export function getAllOpenRouterPricing(): ReadonlyMap<string, ModelPricing> {
  if (!cacheReady) return new Map();
  return pricingCache;
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
          } catch {}
        }
      }
    } finally {
      // This probe reads one chunk and abandons the rest, so the body always needs cancelling.
      // Awaited and caught because an aborted or already-errored stream rejects here, and an
      // unhandled rejection from a background capability probe would surface as a crash.
      await reader.cancel().catch(() => undefined);
    }

    if (!actualModel) {
      return {
        error: "Could not determine actual model from OpenRouter streaming response",
      };
    }

    log.info(`Detected account-setting resolves to: ${actualModel}`);

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
 * Gets capabilities for an OpenRouter model, re-reading the catalog on a miss.
 *
 * Use this wherever the codename can be newer than the cached catalog: account-setting
 * resolution and scoped model registration both accept a codename the startup snapshot
 * never saw. The refresh is cooldown-gated, so a codename OpenRouter does not publish
 * costs one fetch per window rather than one per call.
 *
 * @param modelCodename - Model codename (e.g., "anthropic/claude-3.5-sonnet")
 * @returns ModelCapabilities if found or fetched, undefined when OpenRouter does not list it
 */
export async function getOrFetchOpenRouterCapabilities(modelCodename: string): Promise<ModelCapabilities | undefined> {
  const cachedCapabilities = capabilityCache.get(modelCodename);
  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  const onDemandCached = onDemandCapabilityCache.get(modelCodename);
  if (onDemandCached) {
    return onDemandCached;
  }

  // OpenRouter publishes no per-model metadata route: `/api/v1/models/{id}` answers 404 for
  // every codename, live ones included, so a miss can only be resolved by re-reading the
  // whole catalog. An unready cache means the startup fetch failed and this path is the only
  // recovery from it, so it must not return early on `!cacheReady`.
  await refreshOpenRouterCatalog();
  return capabilityCache.get(modelCodename);
}

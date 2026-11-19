import { createOpenRouterCatalog } from "@/utils/cache/openrouterCatalog";

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

export interface ModelCapabilities {
  hasTools: boolean; // Function calling support
  seesImages: boolean; // Vision/image input support
  seesVideos: boolean; // Video input support
  supportsStructuredOutput: boolean; // JSON mode / structured output support
}

export interface ModelTokenLimits {
  contextLength: number; // Total context window (input + output)
  maxCompletionTokens: number | undefined; // Max output tokens, undefined if not reported
}

// Values are normalized to USD per million tokens because the field names omit the currency unit.
export interface ModelPricing {
  promptPricePerMillion: number;
  completionPricePerMillion: number;
}

export interface OpenRouterModelMetadata {
  id: string;
  capabilities: ModelCapabilities;
  supportedParameters: ReadonlySet<string>;
  tokenizer: string | undefined;
  tokenLimits: ModelTokenLimits;
  pricing: ModelPricing | undefined;
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Description fallback and ignoring `tool_choice` are required because some OpenRouter models omit `tools` or
// `tool_choice` from `supported_parameters`.
function detectToolSupport(model: OpenRouterModel): boolean {
  if (model.supported_parameters && Array.isArray(model.supported_parameters)) {
    if (model.supported_parameters.includes("tools")) {
      return true;
    }
  }

  // OpenRouter metadata is occasionally contradictory: the model description can
  // advertise native function/tool calling even when supported_parameters omits `tools`.
  const normalizedDescription = model.description?.toLowerCase() ?? "";
  return normalizedDescription.includes("function calling") || normalizedDescription.includes("tool calling");
}

// OpenRouter uses arrow notation ("text+image->text") rather than "vision" or "multimodal", so those extra keywords
// exist only for forward compatibility.
function detectImageSupport(model: OpenRouterModel): boolean {
  const modality = model.architecture?.modality?.toLowerCase();

  return modality?.includes("image") || modality?.includes("vision") || modality?.includes("multimodal") || false;
}

function detectVideoSupport(model: OpenRouterModel): boolean {
  const modality = model.architecture?.modality?.toLowerCase();
  const hasVideoModality = modality?.includes("video") || false;

  const hasVideoParam = model.supported_parameters?.includes("video") || false;

  return hasVideoModality || hasVideoParam;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildModelMetadata(model: OpenRouterModel): OpenRouterModelMetadata {
  const promptPricePerMillion = parseUsdPerMillion(model.pricing?.prompt);
  const completionPricePerMillion = parseUsdPerMillion(model.pricing?.completion);
  const tokenizer = model.architecture?.tokenizer?.trim();

  return {
    id: model.id,
    capabilities: {
      hasTools: detectToolSupport(model),
      seesImages: detectImageSupport(model),
      seesVideos: detectVideoSupport(model),
      supportsStructuredOutput: detectStructuredOutputSupport(model),
    },
    supportedParameters: new Set(model.supported_parameters ?? []),
    tokenizer: tokenizer && tokenizer.length > 0 ? tokenizer : undefined,
    tokenLimits: {
      contextLength: model.context_length ?? 0,
      maxCompletionTokens: model.top_provider?.max_completion_tokens,
    },
    pricing:
      promptPricePerMillion !== undefined && completionPricePerMillion !== undefined
        ? { promptPricePerMillion, completionPricePerMillion }
        : undefined,
  };
}

export function parseOpenRouterModelList(payload: unknown): OpenRouterModelMetadata[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Unexpected API response format - missing data array");
  }

  const models: OpenRouterModelMetadata[] = [];
  for (const entry of payload.data) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.trim().length === 0) {
      continue;
    }
    models.push(buildModelMetadata(entry as unknown as OpenRouterModel));
  }

  return models;
}

const textCatalog = createOpenRouterCatalog<OpenRouterModelMetadata>({
  label: "text",
  url: OPENROUTER_MODELS_URL,
  parse: parseOpenRouterModelList,
  keyOf: (entry) => entry.id,
});

// Startup fetch failures stay non-fatal because cache-miss refreshes and TTL retries recover after one refresh window
// instead of failing boot.
export async function initializeOpenRouterCapabilityCache(): Promise<void> {
  await textCatalog.initialize();
}

export function refreshOpenRouterCapabilityCacheIfStale(): Promise<boolean> {
  return textCatalog.refreshIfStale();
}

export function getOpenRouterCapabilities(modelCodename: string): ModelCapabilities | undefined {
  return textCatalog.get(modelCodename)?.capabilities;
}

export function getOpenRouterSupportedParameters(modelCodename: string): ReadonlySet<string> | undefined {
  return textCatalog.get(modelCodename)?.supportedParameters;
}

export function getOpenRouterTokenizer(modelCodename: string): string | undefined {
  return textCatalog.get(modelCodename)?.tokenizer;
}

export function isOpenRouterCapabilityCacheReady(): boolean {
  return textCatalog.isReady();
}

export function getOpenRouterCapabilityCacheSize(): number {
  return textCatalog.size();
}

export function getOpenRouterTokenLimits(modelCodename: string): ModelTokenLimits | undefined {
  return textCatalog.get(modelCodename)?.tokenLimits;
}

export function getOpenRouterPricing(modelCodename: string): ModelPricing | undefined {
  return textCatalog.get(modelCodename)?.pricing;
}

export function getAllOpenRouterPricing(): ReadonlyMap<string, ModelPricing> {
  const pricing = new Map<string, ModelPricing>();
  for (const model of textCatalog.values()) {
    if (model.pricing) {
      pricing.set(model.id, model.pricing);
    }
  }
  return pricing;
}

export function resetOpenRouterCapabilityCache(): void {
  textCatalog.reset();
}

// Cache misses trigger a cooldown-gated refresh, while `fresh` refreshes upfront without the cooldown so interactive
// callers see newly published models.
export async function getOrFetchOpenRouterCapabilities(
  modelCodename: string,
  options?: { fresh?: boolean },
): Promise<ModelCapabilities | undefined> {
  return (await textCatalog.getOrFetch(modelCodename, options))?.capabilities;
}

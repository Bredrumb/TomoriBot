import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { log } from "@/utils/misc/logger";

export interface LiveModelLimits {
  contextWindow: number | null;
  maxOutputTokens: number | null;
}

export type LiveLimitsProvider = "anthropic" | "google";

// Vendor model limits only change on revision, so successful lookups stay cached for a full day.
const SUCCESS_REFRESH_MS = 24 * 60 * 60 * 1000;
// Failed lookups retry after this delay rather than sticking until restart so a transient outage or rotated key will
// not pin catalog limits.
const FAILURE_RETRY_MS = 10 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 5_000;
const HTTP_NOT_FOUND = 404;

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
const ANTHROPIC_API_VERSION = "2023-06-01";

const positiveTokenCount = z.number().int().positive().nullish();
const anthropicModelSchema = z.object({ max_input_tokens: positiveTokenCount, max_tokens: positiveTokenCount });

interface CacheEntry {
  limits: LiveModelLimits | null;
  refreshAt: number;
}

const entries = new Map<string, CacheEntry>();
const inFlight = new Set<string>();

function positiveIntegerOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function cacheKey(provider: LiveLimitsProvider, codename: string): string {
  return `${provider}:${codename}`;
}

async function fetchAnthropicLimits(codename: string, apiKey: string): Promise<LiveModelLimits> {
  const response = await fetch(`${ANTHROPIC_MODELS_URL}/${encodeURIComponent(codename)}`, {
    headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_API_VERSION },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new ApiError({ message: `Anthropic models API returned ${response.status}`, status: response.status });
  const model = anthropicModelSchema.parse(await response.json());
  return { contextWindow: model.max_input_tokens ?? null, maxOutputTokens: model.max_tokens ?? null };
}

async function fetchGoogleLimits(codename: string, apiKey: string): Promise<LiveModelLimits> {
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: LOOKUP_TIMEOUT_MS } });
  const model = await client.models.get({ model: codename });
  return {
    contextWindow: positiveIntegerOrNull(model.inputTokenLimit),
    maxOutputTokens: positiveIntegerOrNull(model.outputTokenLimit),
  };
}

// Stale cached limits are intentionally returned when a refresh is due because vendor model limits rarely change.
export function getLiveModelLimits(provider: LiveLimitsProvider, codename: string): LiveModelLimits | undefined {
  return entries.get(cacheKey(provider, codename))?.limits ?? undefined;
}

export function isLiveModelLimitsRefreshDue(provider: LiveLimitsProvider, codename: string): boolean {
  const key = cacheKey(provider, codename);
  if (inFlight.has(key)) return false;
  const entry = entries.get(key);
  return !entry || Date.now() >= entry.refreshAt;
}

export async function refreshLiveModelLimits(
  provider: LiveLimitsProvider,
  codename: string,
  apiKey: string,
): Promise<void> {
  const key = cacheKey(provider, codename);
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const limits =
      provider === "anthropic"
        ? await fetchAnthropicLimits(codename, apiKey)
        : await fetchGoogleLimits(codename, apiKey);
    entries.set(key, { limits, refreshAt: Date.now() + SUCCESS_REFRESH_MS });
  } catch (error) {
    // A codename the models API does not know (a GA alias, a scoped registration) will not appear
    // within minutes, so it waits as long as a success instead of retrying every pause.
    const status = error instanceof ApiError ? error.status : 0;
    const retryMs = status === HTTP_NOT_FOUND ? SUCCESS_REFRESH_MS : FAILURE_RETRY_MS;
    const previous = entries.get(key)?.limits ?? null;
    entries.set(key, { limits: previous, refreshAt: Date.now() + retryMs });
    // The status stays on the metric because a 401 is how a rotated key shows up on a dashboard.
    log.metric("live_model_limits_lookup_failed", { provider, codename, status });
    // Message only: a provider SDK error object can carry request details, including credentials.
    log.warn(
      `Live model limits lookup failed (${provider}, ${codename}): ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    inFlight.delete(key);
  }
}

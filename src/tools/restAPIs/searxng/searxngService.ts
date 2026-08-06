/**
 * SearXNG Search REST API Service.
 *
 * Direct HTTP integration with a self-hosted SearXNG instance. SearXNG
 * normalizes results from upstream engines (Google, Bing, DDG, Brave,
 * Wikipedia, etc.) and exposes a single `/search` endpoint that takes
 * a `categories=` parameter, so unlike Brave (4 endpoints) all supported
 * search modes ride one HTTP call here.
 *
 * Availability gates on whether `SEARXNG_BASE_URL` is set AND the
 * instance responds healthy. We cache the health probe so we don't hit
 * the sidecar on every tool invocation (the chain dispatcher calls
 * `isSearxngAvailable()` once per call).
 */

import { log } from "../../../utils/misc/logger";
import type {
  SearxngApiResult,
  SearxngCategory,
  SearxngRequestConfig,
  SearxngResponse,
  SearxngSearchParams,
} from "./types";

const SERVICE_NAME = "searxng";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// Per-request timeout. Matches the 5s engine-budget from the migration plan.
const REQUEST_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.WEB_SEARCH_TIMEOUT_MS ?? "5000", 10) || 5000);

// Cache duration for the "SearXNG reachable" probe, so avoids re-probing on every
//    LLM tool turn while still allowing recovery within a minute when the sidecar
//    comes back online.
const HEALTHCHECK_CACHE_MS =
  Math.max(5, Number.parseInt(process.env.WEB_SEARCH_HEALTHCHECK_CACHE_SEC ?? "60", 10) || 60) * 1000;

interface HealthcheckCache {
  available: boolean;
  expiresAt: number;
}

let healthcheckCache: HealthcheckCache | null = null;

/** Last availability the transition logger reported; null until the first probe resolves. */
let lastReportedAvailability: boolean | null = null;

/**
 * Emits an error-level record when availability flips, and only then.
 *
 * A sidecar that is merely unreachable is otherwise invisible in production: the probe
 * failures below log at `warn`, which sits under the level-50 threshold on the JSONL sink
 * that Azure Monitor tails, and `dispatcher.ts` skips an unavailable engine silently on its
 * way down the chain. So the operator sees errors when SearXNG is up and broken, but nothing
 * at all when it is simply gone, which is the louder failure. Error level is what reaches the
 * table; transition-only is what keeps a 60s probe from flooding it.
 */
function reportAvailabilityTransition(available: boolean, reason?: string): void {
  if (lastReportedAvailability === available) return;

  const firstResolution = lastReportedAvailability === null;
  lastReportedAvailability = available;

  // log.error persists to the database, so it is awaited nowhere on this path: a health
  // probe must not block a tool call on a write, and an unobserved rejection here would
  // take down the process.
  const emit = (message: string, errorType: string): void => {
    void log.error(message, undefined, { errorType }).catch(() => undefined);
  };

  if (available) {
    // Recovery is only newsworthy against a previously reported outage.
    if (!firstResolution) {
      emit(
        `${SERVICE_NAME} sidecar is reachable again; web_search will prefer it over the fallback chain`,
        "SearxngRecovered",
      );
    }
    return;
  }

  emit(
    `${SERVICE_NAME} sidecar is unreachable; web_search is falling back down the engine chain${reason ? `: ${reason}` : ""}`,
    "SearxngUnavailable",
  );
}

/**
 * Resolve the configured SearXNG base URL, trimming trailing slashes.
 * Returns null if the env var is not set.
 */
function getSearxngBaseUrl(): string | null {
  const raw = process.env.SEARXNG_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/**
 * Test whether a configured SearXNG instance is reachable.
 *
 * Result is cached for `WEB_SEARCH_HEALTHCHECK_CACHE_SEC` seconds (default 60)
 * to keep the dispatcher fast without locking the bot out of recovery.
 */
export async function isSearxngAvailable(force = false): Promise<boolean> {
  const baseUrl = getSearxngBaseUrl();
  if (!baseUrl) return false;

  const now = Date.now();
  if (!force && healthcheckCache && healthcheckCache.expiresAt > now) {
    return healthcheckCache.available;
  }

  // Probe the lightweight `/healthz` endpoint exposed by SearXNG.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`${baseUrl}/healthz`, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    const available = response.ok;
    healthcheckCache = { available, expiresAt: now + HEALTHCHECK_CACHE_MS };
    if (!available) {
      log.warn(`${SERVICE_NAME} health check returned status ${response.status}`);
    }
    reportAvailabilityTransition(available, available ? undefined : `health check returned ${response.status}`);
    return available;
  } catch (error) {
    healthcheckCache = { available: false, expiresAt: now + HEALTHCHECK_CACHE_MS };
    log.warn(`${SERVICE_NAME} health check failed:`, error as Error);
    reportAvailabilityTransition(false, (error as Error).message);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function makeSearxngRequest(
  params: SearxngSearchParams,
  config: SearxngRequestConfig = {},
): Promise<SearxngApiResult<SearxngResponse>> {
  const baseUrl = config.baseUrl ?? getSearxngBaseUrl();
  if (!baseUrl) {
    return { success: false, error: "SEARXNG_BASE_URL is not configured", statusCode: 503 };
  }

  const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS;

  // Build query-string, so SearXNG returns HTML by default, explicitly request JSON.
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.append("format", "json");
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.append(key, String(value));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (config.signal) {
    if (config.signal.aborted) {
      clearTimeout(timeoutId);
      return { success: false, error: "Request aborted", statusCode: 408 };
    }
    config.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    log.info(`${SERVICE_NAME} request: categories=${params.categories ?? "general"} q="${params.q}"`);

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      log.error(`${SERVICE_NAME} request failed with status ${response.status}: ${errorText}`);
      return {
        success: false,
        error: `SearXNG request failed: ${response.statusText}`,
        statusCode: response.status,
      };
    }

    const data = (await response.json()) as SearxngResponse;
    log.success(`${SERVICE_NAME} request completed (${data.results?.length ?? 0} results)`);
    return { success: true, data, statusCode: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      log.error(`${SERVICE_NAME} request timed out after ${timeoutMs}ms`);
      return { success: false, error: "Request timed out", statusCode: 408 };
    }
    log.error(`${SERVICE_NAME} request error:`, error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Generic search: pass any category supported by your SearXNG config.
 */
export async function searxngSearch(
  query: string,
  category: SearxngCategory,
  config: SearxngRequestConfig = {},
): Promise<SearxngApiResult<SearxngResponse>> {
  return makeSearxngRequest(
    {
      q: query,
      categories: category,
      safesearch: 1,
    },
    config,
  );
}

/**
 * Format SearXNG results into a compact text block.
 *
 * Output shape intentionally mirrors `formatBraveSearchResults` so consumers
 * downstream of the engine layer don't see provider-specific formatting drift.
 */
export function formatSearxngResults(response: SearxngResponse, category: SearxngCategory, count?: number): string {
  const results = response.results ?? [];
  const queryDisplay = response.query || "your search";

  if (results.length === 0) {
    return `No ${categoryLabel(category)} results found for "${queryDisplay}"`;
  }

  let formatted = `**${capitalize(categoryLabel(category))} Search Results for "${queryDisplay}"** (via SearXNG)\n\n`;

  const resultLimit = count !== undefined ? Math.min(Math.max(Math.floor(count), 1), 20) : 10;
  const limit = Math.min(results.length, resultLimit);
  for (let i = 0; i < limit; i++) {
    const r = results[i];
    formatted += `**${i + 1}. ${r.title ?? "(untitled)"}**\n`;
    if (r.url) formatted += `${r.url}\n`;
    if (r.content) formatted += `${r.content}\n`;
    if (category === "videos" && r.length) formatted += `Duration: ${r.length}\n`;
    if (r.publishedDate) formatted += `Published: ${r.publishedDate}\n`;
    formatted += "\n";
  }

  // Surface SearXNG's first answer snippet (Wikipedia / calculator / etc.) when present.
  const firstAnswer = response.answers?.[0];
  if (firstAnswer) {
    const answerText = typeof firstAnswer === "string" ? firstAnswer : firstAnswer.answer;
    if (answerText) formatted += `\n*Answer: ${answerText}*\n`;
  }

  return formatted;
}

export function extractSearxngImageUrls(response: SearxngResponse): string[] {
  const urls: string[] = [];
  for (const r of response.results ?? []) {
    const candidate = r.img_src ?? r.thumbnail_src ?? r.thumbnail;
    if (typeof candidate === "string" && candidate.length > 0) {
      urls.push(candidate);
    }
  }
  return urls;
}

function categoryLabel(category: SearxngCategory): string {
  switch (category) {
    case "general":
      return "web";
    case "images":
      return "image";
    case "videos":
      return "video";
    case "news":
      return "news";
    case "science":
      return "science";
    case "it":
      return "IT";
    case "files":
      return "file";
    case "music":
      return "music";
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

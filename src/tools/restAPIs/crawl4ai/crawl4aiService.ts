/**
 * Crawl4AI REST API service.
 *
 * Hidden HTTP client used by the unified `fetch_url` dispatcher. Availability
 * requires `CRAWL4AI_BASE_URL` plus a successful cached `/health` probe.
 */

import { log } from "@/utils/misc/logger";
import type {
  Crawl4aiApiResult,
  Crawl4aiFilterMode,
  Crawl4aiHealthResponse,
  Crawl4aiMarkdownRequest,
  Crawl4aiMarkdownResponse,
  Crawl4aiRequestConfig,
} from "./types";

const SERVICE_NAME = "crawl4ai";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 TomoriBot";

const REQUEST_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.FETCH_URL_TIMEOUT_MS ?? "15000", 10) || 15000);
const HEALTHCHECK_CACHE_MS =
  Math.max(5, Number.parseInt(process.env.FETCH_URL_HEALTHCHECK_CACHE_SEC ?? "60", 10) || 60) * 1000;
const HEALTHCHECK_TIMEOUT_MS = Math.min(3000, REQUEST_TIMEOUT_MS);

const FILTER_MODES = new Set<Crawl4aiFilterMode>(["raw", "fit", "bm25", "llm"]);

interface HealthcheckCache {
  available: boolean;
  expiresAt: number;
}

let healthcheckCache: HealthcheckCache | null = null;
let warnedInvalidFilterMode = false;

function getCrawl4aiBaseUrl(): string | null {
  const raw = process.env.CRAWL4AI_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function getCrawl4aiToken(): string | null {
  const raw = process.env.CRAWL4AI_TOKEN?.trim();
  return raw || null;
}

export function getCrawl4aiFilterMode(raw = process.env.FETCH_URL_FILTER_MODE): Crawl4aiFilterMode {
  const normalized = raw?.trim().toLowerCase();
  if (normalized && FILTER_MODES.has(normalized as Crawl4aiFilterMode)) {
    return normalized as Crawl4aiFilterMode;
  }

  if (normalized && !warnedInvalidFilterMode) {
    warnedInvalidFilterMode = true;
    log.warn(`Invalid FETCH_URL_FILTER_MODE "${normalized}"; defaulting to "fit"`);
  }

  return "fit";
}

function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const token = getCrawl4aiToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function createAbortController(
  timeoutMs: number,
  signal?: AbortSignal,
): { controller: AbortController; timeoutId: ReturnType<typeof setTimeout> } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  return { controller, timeoutId };
}

export async function isCrawl4aiAvailable(force = false): Promise<boolean> {
  const baseUrl = getCrawl4aiBaseUrl();
  if (!baseUrl) return false;

  const now = Date.now();
  if (!force && healthcheckCache && healthcheckCache.expiresAt > now) {
    return healthcheckCache.available;
  }

  const { controller, timeoutId } = createAbortController(HEALTHCHECK_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
      headers: buildHeaders(),
    });

    const available = response.ok;
    healthcheckCache = { available, expiresAt: now + HEALTHCHECK_CACHE_MS };
    if (!available) {
      log.warn(`${SERVICE_NAME} health check returned status ${response.status}`);
    }
    return available;
  } catch (error) {
    healthcheckCache = { available: false, expiresAt: now + HEALTHCHECK_CACHE_MS };
    log.warn(`${SERVICE_NAME} health check failed:`, error as Error);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function resetCrawl4aiHealthCache(): void {
  healthcheckCache = null;
}

export async function crawl4aiMarkdown(
  request: Crawl4aiMarkdownRequest,
  config: Crawl4aiRequestConfig = {},
): Promise<Crawl4aiApiResult<Crawl4aiMarkdownResponse>> {
  const baseUrl = config.baseUrl ?? getCrawl4aiBaseUrl();
  if (!baseUrl) {
    return { success: false, error: "CRAWL4AI_BASE_URL is not configured", statusCode: 503 };
  }

  const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const { controller, timeoutId } = createAbortController(timeoutMs, config.signal);

  try {
    log.info(`${SERVICE_NAME} /md request: url="${request.url}" filter="${request.f}"`);

    const response = await fetch(`${baseUrl}/md`, {
      method: "POST",
      headers: buildHeaders(),
      signal: controller.signal,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      log.warn(`${SERVICE_NAME} /md failed with status ${response.status}: ${errorText}`);
      return {
        success: false,
        error: `Crawl4AI request failed: ${response.statusText || response.status}`,
        statusCode: response.status,
      };
    }

    const data = (await response.json()) as Crawl4aiMarkdownResponse;
    if (!data.success) {
      return {
        success: false,
        error: "Crawl4AI returned an unsuccessful response",
        statusCode: response.status,
        data,
      };
    }

    return { success: true, data, statusCode: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      log.warn(`${SERVICE_NAME} /md timed out after ${timeoutMs}ms`);
      return { success: false, error: "Request timed out", statusCode: 408 };
    }

    log.warn(`${SERVICE_NAME} /md request error:`, error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getCrawl4aiHealth(
  config: Crawl4aiRequestConfig = {},
): Promise<Crawl4aiApiResult<Crawl4aiHealthResponse>> {
  const baseUrl = config.baseUrl ?? getCrawl4aiBaseUrl();
  if (!baseUrl) {
    return { success: false, error: "CRAWL4AI_BASE_URL is not configured", statusCode: 503 };
  }

  const timeoutMs = config.timeoutMs ?? HEALTHCHECK_TIMEOUT_MS;
  const { controller, timeoutId } = createAbortController(timeoutMs, config.signal);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
      headers: buildHeaders(),
    });
    const data = (await response.json().catch(() => ({}))) as Crawl4aiHealthResponse;
    return { success: response.ok, data, statusCode: response.status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Browserless REST API service.
 *
 * Hidden HTTP client used by the unified `fetch_url` dispatcher. Availability
 * requires `BROWSERLESS_BASE_URL` plus a successful cached `/pressure` probe.
 */

import { log } from "@/utils/misc/logger";
import type {
  BrowserlessApiResult,
  BrowserlessCookie,
  BrowserlessContentRequest,
  BrowserlessPressureResponse,
  BrowserlessRequestConfig,
} from "./types";

const SERVICE_NAME = "browserless";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 TomoriBot";

const REQUEST_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.FETCH_URL_TIMEOUT_MS ?? "15000", 10) || 15000);
const HEALTHCHECK_CACHE_MS =
  Math.max(5, Number.parseInt(process.env.FETCH_URL_HEALTHCHECK_CACHE_SEC ?? "60", 10) || 60) * 1000;
const HEALTHCHECK_TIMEOUT_MS = Math.min(3000, REQUEST_TIMEOUT_MS);

interface HealthcheckCache {
  available: boolean;
  expiresAt: number;
}

let healthcheckCache: HealthcheckCache | null = null;

function getBrowserlessBaseUrl(): string | null {
  const raw = process.env.BROWSERLESS_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function getBrowserlessToken(): string | null {
  const raw = process.env.BROWSERLESS_TOKEN?.trim();
  return raw || null;
}

function buildEndpoint(path: `/${string}`, baseUrl: string): string {
  const endpoint = new URL(`${baseUrl.replace(/\/+$/, "")}${path}`);
  const token = getBrowserlessToken();
  if (token) {
    endpoint.searchParams.set("token", token);
  }

  return endpoint.toString();
}

function buildHeaders(): HeadersInit {
  return {
    Accept: "application/json,text/html",
    "Accept-Encoding": "gzip",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
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

function isPressureAvailable(data: BrowserlessPressureResponse): boolean {
  return data.pressure?.isAvailable !== false;
}

export async function isBrowserlessAvailable(force = false): Promise<boolean> {
  const baseUrl = getBrowserlessBaseUrl();
  if (!baseUrl) return false;

  const now = Date.now();
  if (!force && healthcheckCache && healthcheckCache.expiresAt > now) {
    return healthcheckCache.available;
  }

  const { controller, timeoutId } = createAbortController(HEALTHCHECK_TIMEOUT_MS);

  try {
    const response = await fetch(buildEndpoint("/pressure", baseUrl), {
      method: "GET",
      signal: controller.signal,
      headers: buildHeaders(),
    });

    if (!response.ok) {
      healthcheckCache = { available: false, expiresAt: now + HEALTHCHECK_CACHE_MS };
      log.warn(`${SERVICE_NAME} health check returned status ${response.status}`);
      return false;
    }

    const data = (await response.json().catch(() => ({}))) as BrowserlessPressureResponse;
    const available = isPressureAvailable(data);
    healthcheckCache = { available, expiresAt: now + HEALTHCHECK_CACHE_MS };
    if (!available) {
      log.warn(`${SERVICE_NAME} pressure check is unavailable: ${data.pressure?.reason ?? "unknown reason"}`);
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

export function resetBrowserlessHealthCache(): void {
  healthcheckCache = null;
}

/**
 * Parse BROWSERLESS_COOKIES_JSON into a cookie array. Returns empty array if
 * unset or malformed (logs a warning on parse failure).
 */
export function getBrowserlessCookies(): BrowserlessCookie[] {
  const raw = process.env.BROWSERLESS_COOKIES_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      log.warn("BROWSERLESS_COOKIES_JSON must be a JSON array — ignoring");
      return [];
    }
    return parsed as BrowserlessCookie[];
  } catch {
    log.warn("BROWSERLESS_COOKIES_JSON is not valid JSON — ignoring");
    return [];
  }
}

export async function browserlessContent(
  request: BrowserlessContentRequest,
  config: BrowserlessRequestConfig = {},
): Promise<BrowserlessApiResult<string>> {
  const baseUrl = config.baseUrl ?? getBrowserlessBaseUrl();
  if (!baseUrl) {
    return { success: false, error: "BROWSERLESS_BASE_URL is not configured", statusCode: 503 };
  }

  const timeoutMs = config.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const { controller, timeoutId } = createAbortController(timeoutMs, config.signal);

  try {
    log.info(`${SERVICE_NAME} /content request: url="${request.url}"`);

    const response = await fetch(buildEndpoint("/content", baseUrl), {
      method: "POST",
      headers: buildHeaders(),
      signal: controller.signal,
      body: JSON.stringify(request),
    });

    const responseText = await response.text();
    if (!response.ok) {
      log.warn(`${SERVICE_NAME} /content failed with status ${response.status}: ${responseText}`);
      return {
        success: false,
        error: `Browserless request failed: ${response.statusText || response.status}`,
        statusCode: response.status,
      };
    }

    return { success: true, data: responseText, statusCode: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      log.warn(`${SERVICE_NAME} /content timed out after ${timeoutMs}ms`);
      return { success: false, error: "Request timed out", statusCode: 408 };
    }

    log.warn(`${SERVICE_NAME} /content request error:`, error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getBrowserlessPressure(
  config: BrowserlessRequestConfig = {},
): Promise<BrowserlessApiResult<BrowserlessPressureResponse>> {
  const baseUrl = config.baseUrl ?? getBrowserlessBaseUrl();
  if (!baseUrl) {
    return { success: false, error: "BROWSERLESS_BASE_URL is not configured", statusCode: 503 };
  }

  const timeoutMs = config.timeoutMs ?? HEALTHCHECK_TIMEOUT_MS;
  const { controller, timeoutId } = createAbortController(timeoutMs, config.signal);

  try {
    const response = await fetch(buildEndpoint("/pressure", baseUrl), {
      method: "GET",
      signal: controller.signal,
      headers: buildHeaders(),
    });
    const data = (await response.json().catch(() => ({}))) as BrowserlessPressureResponse;
    return { success: response.ok && isPressureAvailable(data), data, statusCode: response.status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

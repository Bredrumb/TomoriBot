/**
 * Type definitions for the Browserless Docker REST API.
 *
 * TomoriBot uses only `/content` and `/pressure` for the hidden `fetch_url`
 * engine. Browser automation remains internal; the LLM still sees only
 * `fetch_url`.
 */

export interface BrowserlessCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export interface BrowserlessGotoOptions {
  /** Puppeteer waitUntil condition. Defaults to "networkidle2" for SPA compatibility. */
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
  /** Navigation timeout in ms. */
  timeout?: number;
}

export interface BrowserlessContentRequest {
  /** Absolute http/https URL to fetch with Browserless. */
  url: string;
  /** Browser-level cookies injected before navigation. */
  cookies?: BrowserlessCookie[];
  /** Puppeteer GoTo options controlling when navigation is considered complete. */
  gotoOptions?: BrowserlessGotoOptions;
}

export interface BrowserlessPressureResponse {
  pressure?: {
    cpu?: number | null;
    memory?: number | null;
    isAvailable?: boolean;
    maxConcurrent?: number;
    maxQueued?: number;
    running?: number;
    queued?: number;
    reason?: string;
    recentlyRejected?: number;
    date?: number;
    message?: string;
  };
  [extra: string]: unknown;
}

export interface BrowserlessRequestConfig {
  /** Override global base URL. Mainly useful for tests. */
  baseUrl?: string;
  /** Per-request timeout in ms. Defaults to FETCH_URL_TIMEOUT_MS. */
  timeoutMs?: number;
  /** External abort signal from the tool execution context. */
  signal?: AbortSignal;
}

export interface BrowserlessApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

/**
 * Type definitions for the Crawl4AI Docker REST API.
 *
 * TomoriBot uses only the `/md` endpoint for the hidden `fetch_url` engine.
 * Other Crawl4AI capabilities such as screenshots, PDFs, JS execution, and
 * multi-page crawling stay out of the LLM-visible tool surface.
 */

export type Crawl4aiFilterMode = "raw" | "fit" | "bm25" | "llm";

export interface Crawl4aiMarkdownRequest {
  /** Absolute http/https URL to fetch. */
  url: string;
  /** Content filter strategy. `fit` is the default for LLM-friendly output. */
  f: Crawl4aiFilterMode;
  /** Optional query used by bm25/llm filters. Not used by fetch_url v1. */
  q?: string;
  /** Optional cache-bust/revision counter accepted by Crawl4AI. */
  c?: string;
}

export interface Crawl4aiMarkdownResponse {
  url: string;
  filter: Crawl4aiFilterMode;
  query?: string | null;
  cache?: string | null;
  markdown: string;
  success: boolean;
}

export interface Crawl4aiHealthResponse {
  status?: string;
  timestamp?: number;
  version?: string;
  [extra: string]: unknown;
}

export interface Crawl4aiRequestConfig {
  /** Override global base URL. Mainly useful for tests. */
  baseUrl?: string;
  /** Per-request timeout in ms. Defaults to FETCH_URL_TIMEOUT_MS. */
  timeoutMs?: number;
  /** External abort signal from the tool execution context. */
  signal?: AbortSignal;
}

export interface Crawl4aiApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

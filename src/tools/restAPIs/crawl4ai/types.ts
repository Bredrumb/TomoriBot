/**
 * Type definitions for the Crawl4AI Docker REST API.
 *
 * TomoriBot uses the `/md` endpoint normally and falls back to `/crawl` when
 * CRAWL4AI_COOKIES_JSON is configured (cookie injection requires browser_config,
 * which only the /crawl endpoint supports).
 */

export type Crawl4aiFilterMode = "raw" | "fit" | "bm25" | "llm";

export interface Crawl4aiCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export interface Crawl4aiCrawlRequest {
  urls: string[];
  browser_config?: {
    cookies?: Crawl4aiCookie[];
    [key: string]: unknown;
  };
  crawler_config?: Record<string, unknown>;
}

interface Crawl4aiCrawlMarkdown {
  raw_markdown?: string;
  fit_markdown?: string;
  markdown_with_citations?: string;
  references_markdown?: string;
}

interface Crawl4aiCrawlResult {
  url: string;
  success: boolean;
  status_code?: number;
  error_message?: string;
  markdown?: Crawl4aiCrawlMarkdown;
  html?: string;
}

export interface Crawl4aiCrawlResponse {
  success: boolean;
  results: Crawl4aiCrawlResult[];
}

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

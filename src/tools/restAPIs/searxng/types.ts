/**
 * Type definitions for the SearXNG JSON Search API.
 *
 * SearXNG normalizes results from upstream engines (Google, Bing, DDG, Brave,
 * Wikipedia, etc.) into a single flat `results[]` array. Different categories
 * (`general`, `images`, `videos`, `news`, `science`, `it`, `files`, `music`)
 * populate different optional fields, which is why every per-category field
 * below is optional.
 *
 * Reference: https://docs.searxng.org/dev/search_api.html
 */

/**
 * Search categories supported by SearXNG.
 *
 * Mapped from the unified WebSearch `SearchCategory` ("text" → "general").
 */
export type SearxngCategory = "general" | "images" | "videos" | "news" | "science" | "it" | "files" | "music";

/**
 * Common request parameters accepted by the SearXNG `/search` endpoint.
 */
export interface SearxngSearchParams {
  /** Query string. */
  q: string;
  /** One or more comma-separated categories (e.g. "general"). */
  categories?: SearxngCategory | string;
  /** Output format — we only ever request `json`. */
  format?: "json";
  /** Two-letter language code or `all` (default). */
  language?: string;
  /** Time range filter for news/videos: day, week, month, year. */
  time_range?: "day" | "week" | "month" | "year";
  /** Safe search level: 0=off, 1=moderate, 2=strict. */
  safesearch?: 0 | 1 | 2;
  /** Result pagination, starts at 1. */
  pageno?: number;
}

/**
 * A single result entry. Different categories populate different fields:
 *  - general/news: `title`, `url`, `content`
 *  - images:       `title`, `url`, `img_src`, `thumbnail_src`, `resolution`
 *  - videos:       `title`, `url`, `content`, `thumbnail`, `length`
 *  - science/it/files/music: usually `title`, `url`, `content`, plus
 *    engine-specific metadata
 */
export interface SearxngResult {
  /** Title of the result. */
  title?: string;
  /** Canonical URL of the result. */
  url?: string;
  /** Snippet / description text. */
  content?: string;
  /** Engine that produced this result (e.g. "google", "duckduckgo"). */
  engine?: string;
  /** Aggregated source engines, populated when SearXNG dedupes. */
  engines?: string[];

  /** Image categories: direct image URL. */
  img_src?: string;
  /** Image / video categories: thumbnail URL. */
  thumbnail_src?: string;
  thumbnail?: string;
  /** Image categories: e.g. "1920x1080". */
  resolution?: string;

  /** Video categories: ISO 8601 or hh:mm:ss duration. */
  length?: string;
  /** News/videos: ISO 8601 timestamp string. */
  publishedDate?: string;

  /** Catch-all for additional engine-specific metadata SearXNG passes through. */
  [extra: string]: unknown;
}

/**
 * Top-level SearXNG JSON response envelope.
 */
export interface SearxngResponse {
  query: string;
  number_of_results?: number;
  results: SearxngResult[];
  /** Suggested query corrections. */
  suggestions?: string[];
  /** Related terms. */
  unresponsive_engines?: Array<[string, string]>;
  /** Answer snippets (Wikipedia, calculator, etc.). */
  answers?: Array<string | { answer?: string; url?: string }>;
  infoboxes?: unknown[];
}

/**
 * Internal config for a single API request.
 */
export interface SearxngRequestConfig {
  /** Override the global base URL (rarely used; mainly for tests). */
  baseUrl?: string;
  /** Per-request timeout in ms. Defaults to WEB_SEARCH_TIMEOUT_MS env. */
  timeoutMs?: number;
  /** External abort signal (e.g. from ToolContext). */
  signal?: AbortSignal;
}

/**
 * Wrapped result returned by service helpers — mirrors the `ApiResult<T>` shape
 * used in `braveSearchService.ts` so the upper layer can treat both providers
 * uniformly.
 */
export interface SearxngApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

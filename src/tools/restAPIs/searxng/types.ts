export type SearxngCategory = "general" | "images" | "videos" | "news" | "science" | "it" | "files" | "music";

export interface SearxngSearchParams {
  q: string;
  categories?: SearxngCategory | string;
  format?: "json";
  // SearXNG language parameter format: a two-letter code, or `all` as the default sentinel.
  language?: string;
  time_range?: "day" | "week" | "month" | "year";
  // SearXNG numeric safesearch levels: 0 means off, 1 means moderate, and 2 means strict.
  safesearch?: 0 | 1 | 2;
  // SearXNG pagination is 1-based, so the first page is 1 rather than 0.
  pageno?: number;
}

interface SearxngResult {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
  engines?: string[];

  img_src?: string;
  thumbnail_src?: string;
  thumbnail?: string;
  resolution?: string;

  // SearXNG video duration rather than byte length: formatted as ISO 8601 or hh:mm:ss.
  length?: string;
  publishedDate?: string;

  [extra: string]: unknown;
}

export interface SearxngResponse {
  query: string;
  number_of_results?: number;
  results: SearxngResult[];
  suggestions?: string[];
  unresponsive_engines?: Array<[string, string]>;
  answers?: Array<string | { answer?: string; url?: string }>;
  infoboxes?: unknown[];
}

export interface SearxngRequestConfig {
  baseUrl?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SearxngApiResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

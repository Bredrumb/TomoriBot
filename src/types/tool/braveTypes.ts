interface Query {
  original: string;
  altered?: string;
  cleaned?: string;
  spellcheck_off?: boolean;
  show_strict_warning?: boolean;
}

interface Thumbnail {
  src: string;
  original?: string;
  width?: number;
  height?: number;
}

interface MetaUrl {
  scheme?: string;
  netloc?: string;
  hostname?: string;
  favicon?: string;
  path?: string;
}

interface Extra {
  [key: string]: unknown;
}

export interface WebResult {
  type: "search_result";
  url: string;
  title: string;
  description?: string;
  age?: string;
  page_age?: string;
  page_fetched?: string;
  meta_url?: MetaUrl;
  extra_snippets?: string[];
}

interface Search {
  type: "search";
  results: WebResult[];
  extra?: Extra;
}

interface News {
  results: NewsResult[];
}

interface Videos {
  results: VideoResult[];
}

export interface WebSearchApiResponse {
  type: "search";
  query?: Query;
  web?: Search;
  news?: News;
  videos?: Videos;
  extra?: Extra;
}

interface ImageProperties {
  url?: string;
  placeholder?: string;
  width?: number;
  height?: number;
}

export interface ImageResult {
  type: "image_result";
  title?: string;
  url?: string;
  source?: string;
  page_fetched?: string;
  thumbnail?: Thumbnail;
  properties?: ImageProperties;
  meta_url?: MetaUrl;
  confidence?: "low" | "medium" | "high";
}

export interface ImageSearchApiResponse {
  type: "images";
  query: Query;
  results: ImageResult[];
  extra: Extra;
}

interface Profile {
  name: string;
  long_name?: string;
  url: string;
  img?: string;
}

interface VideoData {
  duration?: string;
  views?: number;
  creator?: string;
  publisher?: string;
  requires_subscription?: boolean;
  tags?: string[];
  author?: Profile;
}

export interface VideoResult {
  type: "video_result";
  url: string;
  title: string;
  description?: string;
  age?: string;
  page_age?: string;
  page_fetched?: string;
  thumbnail?: Thumbnail;
  video?: VideoData;
  meta_url?: MetaUrl;
}

export interface VideoSearchApiResponse {
  type: "videos";
  query: Query;
  results: VideoResult[];
  extra: Extra;
}

export interface NewsResult {
  type: "news_result";
  url: string;
  title: string;
  description?: string;
  age?: string;
  page_age?: string;
  page_fetched?: string;
  breaking?: boolean;
  thumbnail?: Thumbnail;
  meta_url?: MetaUrl;
  extra_snippets?: string[];
}

export interface NewsSearchApiResponse {
  type: "news";
  query: Query;
  results: NewsResult[];
}

interface BaseSearchParams {
  q: string;
  // Brave Search API requires a 2-character country code because `string` alone does not enforce length.
  country?: string;
  // Brave Search API requires a 2+ character language code because `string` alone does not enforce minimum length.
  search_lang?: string;
  spellcheck?: boolean;
  // TypeScript interfaces are not assignable to `Record<string, unknown>` without an explicit index signature, so
  // removing this breaks that compatibility.
  [key: string]: unknown;
}

export interface WebSearchParams extends BaseSearchParams {
  ui_lang?: string;
  // Brave Search API caps result count at 20 per request because `number` alone hides the upper bound.
  count?: number;
  // Brave Search API treats pagination `offset` as zero-based and caps it at 9 because `number` hides both bounds.
  offset?: number;
  safesearch?: "off" | "moderate" | "strict";
  freshness?: "pd" | "pw" | "pm" | "py" | string; // Also supports date ranges
  text_decorations?: boolean;
  // Brave Web Search expects a comma-delimited string here because the API does not accept an array.
  result_filter?: string;
  units?: "metric" | "imperial";
  // Brave Web Search caps extra snippets at 5 additional excerpts per result, so callers cannot expect more.
  extra_snippets?: boolean;
  summary?: boolean;
}

export interface ImageSearchParams extends BaseSearchParams {
  // Brave Image Search caps count at 200 per request because larger values exceed the endpoint limit.
  count?: number;
  safesearch?: "off" | "strict";
}

export interface VideoSearchParams extends BaseSearchParams {
  ui_lang?: string;
  // Brave Video Search caps count at 50 per request because larger values exceed the endpoint limit.
  count?: number;
  // Brave Video Search expects a zero-based page offset capped at 9, so passing 10 or item counts breaks pagination.
  offset?: number;
  safesearch?: "off" | "moderate" | "strict";
  freshness?: "pd" | "pw" | "pm" | "py" | string; // Also supports date ranges
}

export interface NewsSearchParams extends BaseSearchParams {
  ui_lang?: string;
  // Brave News Search caps count at 50 per request because larger values exceed the endpoint limit.
  count?: number;
  // Brave News Search expects a zero-based page offset capped at 9, so passing 10 or item counts breaks pagination.
  offset?: number;
  safesearch?: "off" | "moderate" | "strict";
  freshness?: "pd" | "pw" | "pm" | "py" | string; // Also supports date ranges
  extra_snippets?: boolean;
  goggles?: string[];
}

export type BraveSearchResponse =
  | WebSearchApiResponse
  | ImageSearchApiResponse
  | VideoSearchApiResponse
  | NewsSearchApiResponse;

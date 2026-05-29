/**
 * Brave Search REST API - Main Export
 * Provides direct HTTP access to Brave Search API endpoints
 */

// Export all types
export * from "../../types/tool/braveTypes";

// Export all service functions
export {
  braveWebSearch,
  braveImageSearch,
  braveVideoSearch,
  braveNewsSearch,
  isBraveSearchAvailable,
  testBraveApiConnection,
  formatBraveSearchResults,
  isBraveApiKeyError,
  isBraveRateLimitError,
  // Discord integration utilities
  extractImageUrls,
  sendImagesToDiscord,
  cleanImageSearchResult,
  addFetchCapabilityReminder,
} from "./brave/braveSearchService";

// Export function call implementations that match MCP function signatures
export {
  brave_web_search,
  brave_image_search,
  brave_video_search,
  brave_news_search,
} from "./brave/toolImplementations";

// NOTE: The four BraveXxxSearchTool classes were demoted to internal services
// under `./brave/internal/braveServiceClasses.ts` (renamed to `InternalBrave*`).
// They are now consumed only by `webSearch/braveEngine.ts` — not LLM-visible.

// SearXNG search (self-hosted JSON metasearch aggregator).
// Phase 2 — added alongside Brave; consumed by `webSearch/searxngEngine.ts`.
export {
  searxngSearch,
  isSearxngAvailable,
  resetSearxngHealthCache,
  formatSearxngResults,
  extractSearxngImageUrls,
} from "./searxng/searxngService";

export {
  searxng_web_search,
  searxng_image_search,
  searxng_video_search,
  searxng_news_search,
} from "./searxng/toolImplementations";

export type {
  SearxngCategory,
  SearxngResult,
  SearxngResponse,
  SearxngSearchParams,
  SearxngRequestConfig,
  SearxngApiResult,
} from "./searxng/types";

// Crawl4AI URL-fetch sidecar. Consumed only by `fetchUrl/crawl4aiEngine.ts`.
export {
  crawl4aiMarkdown,
  getCrawl4aiFilterMode,
  getCrawl4aiHealth,
  isCrawl4aiAvailable,
  resetCrawl4aiHealthCache,
} from "./crawl4ai/crawl4aiService";

export { crawl4ai_fetch_url } from "./crawl4ai/toolImplementations";

export type {
  Crawl4aiApiResult,
  Crawl4aiFilterMode,
  Crawl4aiHealthResponse,
  Crawl4aiMarkdownRequest,
  Crawl4aiMarkdownResponse,
  Crawl4aiRequestConfig,
} from "./crawl4ai/types";

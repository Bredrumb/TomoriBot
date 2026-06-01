/**
 * Web-search engine-abstraction layer.
 *
 * Public surface:
 * - `WebSearchTool` — the single LLM-visible tool (auto-discovered).
 * - `executeWebSearchWithFallback` / `getActiveWebSearchEngine` — dispatcher API.
 * - `WebSearchEngine` / `SearchCategory` — types for new engine implementations
 *   (e.g. SearXNG in Phase 2).
 */

export { WebSearchTool } from "./webSearchTool";
export { executeWebSearchWithFallback, getActiveWebSearchEngine } from "./dispatcher";
export { BraveEngine } from "./braveEngine";
export { SearxngEngine } from "./searxngEngine";
export { DuckDuckGoEngine } from "./duckduckgoEngine";
export { FeloEngine } from "./feloEngine";
export type { SearchCategory, WebSearchEngine, WebSearchEngineName } from "./types";

/**
 * Web Search engine-abstraction types.
 *
 * Defines the uniform interface implemented by each search engine
 * (Brave, DuckDuckGo, Felo — and SearXNG in Phase 2). The dispatcher
 * walks an ordered chain of engines per category, calling `search()`
 * on the first one whose `available()` returns true.
 */

import type { ToolContext, ToolResult } from "@/types/tool/interfaces";

/**
 * Search categories supported by the unified `web_search` tool.
 *
 * Only `text` has fallback engines (DDG/Felo). The non-text categories
 * fail with a friendly "category unavailable" message when no engine
 * in the chain supports them.
 */
export type SearchCategory = "text" | "image" | "video" | "news";

/**
 * Canonical engine identifiers. Used for logging and embed labelling.
 */
export type WebSearchEngineName = "brave" | "searxng" | "duckduckgo" | "felo";

/**
 * Uniform contract every web-search engine implements so the dispatcher
 * can route opaque `web_search(query, category)` calls without caring
 * which engine handles them.
 */
export interface WebSearchEngine {
  /** Stable identifier — used for logs, telemetry, and embed provider labels. */
  readonly name: WebSearchEngineName;

  /**
   * Async because some engines (e.g. Brave) consult cache/DB to discover
   * whether a per-server API key is configured.
   *
   * @param context - Tool execution context (provides serverId for key lookup).
   * @returns True if the engine is currently usable.
   */
  available(context: ToolContext): Promise<boolean>;

  /**
   * Whether this engine can handle the given category.
   * DDG/Felo return true only for `text`; Brave/SearXNG support all four.
   */
  supportsCategory(category: SearchCategory): boolean;

  /**
   * Execute the search. Implementations are expected to return a fully
   * formed ToolResult — including any Discord side-effects (embeds /
   * attachments) the engine wants to surface.
   */
  search(query: string, category: SearchCategory, context: ToolContext): Promise<ToolResult>;
}

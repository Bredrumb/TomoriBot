import type { ToolContext, ToolResult } from "@/types/tool/interfaces";

export const BASE_SEARCH_CATEGORIES = ["text", "image", "video", "news"] as const;

const SEARXNG_ONLY_SEARCH_CATEGORIES = ["papers", "code", "files", "music"] as const;

export const SEARCH_CATEGORIES = [...BASE_SEARCH_CATEGORIES, ...SEARXNG_ONLY_SEARCH_CATEGORIES] as const;

export type SearchCategory = (typeof SEARCH_CATEGORIES)[number];

// Why an engine failed, carried on its failed result's `data` so the dispatcher can tell a refusal from an outage.
export interface WebSearchEngineFailure {
  failure: string;
  status?: number;
}

export type WebSearchEngineName = "brave" | "searxng" | "openrouter" | "duckduckgo";

export interface WebSearchEngine {
  readonly name: WebSearchEngineName;

  available(context: ToolContext): Promise<boolean>;

  supportsCategory(category: SearchCategory): boolean;

  search(query: string, category: SearchCategory, context: ToolContext, count?: number): Promise<ToolResult>;
}

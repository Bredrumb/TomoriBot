/**
 * WebSearchTool — the single LLM-visible search tool.
 *
 * Replaces the previously-LLM-visible 4-tool Brave surface (`brave_web_search`,
 * `brave_image_search`, `brave_video_search`, `brave_news_search`) with one
 * tool that takes a `category` enum. The dispatcher routes to whichever
 * engine in the chain (Brave → DuckDuckGo → Felo for Phase 1) can serve
 * the requested category.
 *
 * Saves ~400 tokens/turn from removed tool declarations and eliminates
 * wrong-tool-name fuzzy-matching errors observed in NovelAI streams.
 */

import { BaseTool, type ToolContext, type ToolResult } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import { executeWebSearchWithFallback } from "./dispatcher";
import type { SearchCategory } from "./types";

const SUPPORTED_CATEGORIES: SearchCategory[] = ["text", "image", "video", "news"];

export class WebSearchTool extends BaseTool {
  name = "web_search";
  description =
    "Search the web for information. Supports text/image/video/news categories. " +
    "Routes through the best available search engine automatically.";

  category = "search" as const;
  requiresFeatureFlag = "web_search";
  requiresFollowUp = true;

  parameters = {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "The search query to execute.",
      },
      category: {
        type: "string" as const,
        description:
          "Search category. Use 'text' for general web results (default), 'image' for pictures, " +
          "'video' for videos, 'news' for recent articles.",
        enum: SUPPORTED_CATEGORIES,
      },
    },
    required: ["query"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  protected isEnabled(context: ToolContext): boolean {
    return context.tomoriState.config.web_search_enabled;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    try {
      // 1. Feature flag gate — mirrors the previous BraveSearchTool behavior.
      if (!this.isEnabled(context)) {
        return {
          success: false,
          error: "Web search is disabled for this server",
          message: "Web search functionality is not enabled for this server.",
        };
      }

      // 2. Validate query.
      if (typeof args.query !== "string" || args.query.trim().length === 0) {
        return {
          success: false,
          error: "Query is required and must be a non-empty string",
          message: "I need a search query to look anything up.",
        };
      }

      // 3. Normalize category (default to text).
      const rawCategory = typeof args.category === "string" ? args.category : "text";
      const category: SearchCategory = SUPPORTED_CATEGORIES.includes(rawCategory as SearchCategory)
        ? (rawCategory as SearchCategory)
        : "text";

      log.info(`web_search invoked: category=${category} query="${args.query}"`);

      // 4. Hand off to the dispatcher. The dispatcher itself emits the
      //    per-engine Discord notice via the engine's underlying tool wrapper
      //    (BraveEngine reuses the Internal*Tool classes that already call
      //    sendToolNotice; DDG/Felo do it inside processWebSearch).
      return await executeWebSearchWithFallback(args.query as string, category, context);
    } catch (error) {
      log.error("Error in web_search tool:", error as Error);
      return {
        success: false,
        error: `Failed to execute web search: ${(error as Error).message}`,
      };
    }
  }
}

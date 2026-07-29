/**
 * BraveEngine — wraps the internal Brave service classes into a uniform
 * WebSearchEngine. Routes on category to the appropriate Internal*Tool.
 *
 * Supports the common 4 categories (text/image/video/news).
 * Availability gates on whether a Brave API key is configured (global or per-guild).
 */

import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { isBraveSearchAvailable } from "@/tools/restAPIs/brave/braveSearchService";
import {
  InternalBraveWebSearchTool,
  InternalBraveImageSearchTool,
  InternalBraveVideoSearchTool,
  InternalBraveNewsSearchTool,
} from "@/tools/restAPIs/brave/internal/braveServiceClasses";
import { BASE_SEARCH_CATEGORIES, type SearchCategory, type WebSearchEngine } from "./types";

export class BraveEngine implements WebSearchEngine {
  readonly name = "brave" as const;

  private readonly webTool = new InternalBraveWebSearchTool();
  private readonly imageTool = new InternalBraveImageSearchTool();
  private readonly videoTool = new InternalBraveVideoSearchTool();
  private readonly newsTool = new InternalBraveNewsSearchTool();

  async available(context: ToolContext): Promise<boolean> {
    // Brave needs an API key (global env var OR per-server OptApiKey).
    return await isBraveSearchAvailable(context.tomoriState?.server_id);
  }

  supportsCategory(category: SearchCategory): boolean {
    return BASE_SEARCH_CATEGORIES.includes(category as (typeof BASE_SEARCH_CATEGORIES)[number]);
  }

  async search(query: string, category: SearchCategory, context: ToolContext, count?: number): Promise<ToolResult> {
    const args: Record<string, unknown> = { query, ...(count !== undefined && { count }) };

    switch (category) {
      case "text":
        return await this.webTool.execute(args, context);
      case "image":
        return await this.imageTool.execute(args, context);
      case "video":
        return await this.videoTool.execute(args, context);
      case "news":
        return await this.newsTool.execute(args, context);
    }

    return {
      success: false,
      error: `Brave search does not support category "${category}"`,
    };
  }
}

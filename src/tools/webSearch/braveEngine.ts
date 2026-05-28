/**
 * BraveEngine — wraps the internal Brave service classes into a uniform
 * WebSearchEngine. Routes on category to the appropriate Internal*Tool.
 *
 * Supports all 4 categories (text/image/video/news).
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
import type { SearchCategory, WebSearchEngine } from "./types";

export class BraveEngine implements WebSearchEngine {
  readonly name = "brave" as const;

  // 1. Instantiate the per-category internal tools once and reuse them across calls.
  private readonly webTool = new InternalBraveWebSearchTool();
  private readonly imageTool = new InternalBraveImageSearchTool();
  private readonly videoTool = new InternalBraveVideoSearchTool();
  private readonly newsTool = new InternalBraveNewsSearchTool();

  async available(context: ToolContext): Promise<boolean> {
    // 2. Brave needs an API key (global env var OR per-server OptApiKey).
    return await isBraveSearchAvailable(context.tomoriState?.server_id);
  }

  supportsCategory(_category: SearchCategory): boolean {
    return true;
  }

  async search(query: string, category: SearchCategory, context: ToolContext): Promise<ToolResult> {
    // 3. Pass the query as the `query` arg expected by the internal tool params.
    const args: Record<string, unknown> = { query };

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
  }
}

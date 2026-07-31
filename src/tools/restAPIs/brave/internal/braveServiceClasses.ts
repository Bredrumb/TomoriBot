/**
 * Internal Brave Search service classes.
 *
 * These are NOT exposed to the LLM directly. They are consumed by
 * `webSearch/braveEngine.ts` which routes the unified `web_search(query, category)`
 * tool call to the appropriate per-category implementation.
 *
 * Placed under `internal/` so the auto-discovery glob in `toolInitializer.ts`
 * (which only scans files matching `braveTools.ts` at the top of `restAPIs/brave/`)
 * does NOT pick these up as LLM-visible tools.
 *
 * Class names are prefixed with `Internal` to make their non-LLM-visible status
 * explicit at every call site.
 */

import { BaseTool, type ToolContext, type ToolResult } from "../../../../types/tool/interfaces";
import { log } from "../../../../utils/misc/logger";
import { sendToolNotice } from "../../../../utils/discord/toolProgressNotice";
import { brave_web_search, brave_image_search, brave_video_search, brave_news_search } from "../toolImplementations";
import { getSearchNoticeTitleVars } from "@/tools/webSearch/categoryMetadata";

/**
 * Abstract base for internal Brave search adapters.
 * Provides common availability/serverId/result-conversion helpers.
 */
abstract class BaseInternalBraveSearchTool extends BaseTool {
  category = "search" as const;
  requiresFeatureFlag = "web_search";
  requiresFollowUp = true;

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  /**
   * Check if web search functionality is enabled in Tomori config.
   */
  protected isEnabled(context: ToolContext): boolean {
    return context.tomoriState.config.web_search_enabled;
  }

  /**
   * Helper to extract server ID from tool context.
   */
  protected getServerId(context: ToolContext): number | undefined {
    return context.tomoriState?.server_id;
  }

  /**
   * Pass-through conversion (kept for parity with the previous public-facing class).
   */
  protected convertToToolResult(result: ToolResult): ToolResult {
    return result;
  }
}

export class InternalBraveWebSearchTool extends BaseInternalBraveSearchTool {
  name = "brave_web_search";
  description = "Internal Brave Web Search: consumed by BraveEngine via the unified web_search tool.";

  parameters = {
    type: "object" as const,
    properties: {
      query: { type: "string" as const, description: "The search query to execute" },
      country: { type: "string" as const, description: "Country code for localized results" },
      search_lang: { type: "string" as const, description: "Search language preference" },
      count: { type: "number" as const, description: "Number of results to return (max 20)" },
      offset: { type: "number" as const, description: "Offset for pagination (0-9)" },
      safesearch: {
        type: "string" as const,
        description: "Safe search level",
        enum: ["off", "moderate", "strict"],
      },
      freshness: { type: "string" as const, description: "Filter by content freshness" },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    try {
      if (!this.isEnabled(context)) {
        return {
          success: false,
          error: "Web search is disabled for this server",
          message: "Web search functionality is not enabled for this server.",
        };
      }

      log.info(`Executing ${this.name} with query: ${args.query}`);

      await sendToolNotice(
        context,
        "web_search",
        {
          titleKey: "tools.search.category_search_title",
          titleVars: getSearchNoticeTitleVars(context.locale, "text", args.query as string),
          descriptionKey: "tools.search.disclaimer_description",
        },
        "InternalBraveWebSearchTool",
      );

      const enhancedContext = { ...context, serverId: this.getServerId(context) };
      const result = await brave_web_search(args, enhancedContext);
      return this.convertToToolResult(result);
    } catch (error) {
      log.error(`Error in ${this.name}:`, error as Error);
      return {
        success: false,
        error: `Failed to execute web search: ${(error as Error).message}`,
      };
    }
  }
}

export class InternalBraveImageSearchTool extends BaseInternalBraveSearchTool {
  name = "brave_image_search";
  description = "Internal Brave Image Search: consumed by BraveEngine via the unified web_search tool.";

  parameters = {
    type: "object" as const,
    properties: {
      query: { type: "string" as const, description: "The image search query to execute" },
      country: { type: "string" as const, description: "Country code for localized results" },
      search_lang: { type: "string" as const, description: "Search language preference" },
      count: { type: "number" as const, description: "Number of image results to return (max 200)" },
      safesearch: {
        type: "string" as const,
        description: "Safe search level for images",
        enum: ["off", "strict"],
      },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    try {
      if (!this.isEnabled(context)) {
        return {
          success: false,
          error: "Web search is disabled for this server",
          message: "Web search functionality is not enabled for this server.",
        };
      }

      log.info(`Executing ${this.name} with query: ${args.query}`);

      await sendToolNotice(
        context,
        "image_search",
        {
          titleKey: "tools.search.category_search_title",
          titleVars: getSearchNoticeTitleVars(context.locale, "image", args.query as string),
          descriptionKey: "tools.search.disclaimer_description",
        },
        "InternalBraveImageSearchTool",
      );

      const enhancedContext = { ...context, serverId: this.getServerId(context) };
      const result = await brave_image_search(args, enhancedContext);
      return this.convertToToolResult(result);
    } catch (error) {
      log.error(`Error in ${this.name}:`, error as Error);
      return {
        success: false,
        error: `Failed to execute image search: ${(error as Error).message}`,
      };
    }
  }
}

export class InternalBraveVideoSearchTool extends BaseInternalBraveSearchTool {
  name = "brave_video_search";
  description = "Internal Brave Video Search: consumed by BraveEngine via the unified web_search tool.";

  parameters = {
    type: "object" as const,
    properties: {
      query: { type: "string" as const, description: "The video search query to execute" },
      country: { type: "string" as const, description: "Country code for localized results" },
      search_lang: { type: "string" as const, description: "Search language preference" },
      count: { type: "number" as const, description: "Number of video results to return (max 50)" },
      offset: { type: "number" as const, description: "Offset for pagination (0-9)" },
      safesearch: {
        type: "string" as const,
        description: "Safe search level for videos",
        enum: ["off", "moderate", "strict"],
      },
      freshness: { type: "string" as const, description: "Filter by content freshness" },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    try {
      if (!this.isEnabled(context)) {
        return {
          success: false,
          error: "Web search is disabled for this server",
          message: "Web search functionality is not enabled for this server.",
        };
      }

      log.info(`Executing ${this.name} with query: ${args.query}`);

      await sendToolNotice(
        context,
        "video_search",
        {
          titleKey: "tools.search.category_search_title",
          titleVars: getSearchNoticeTitleVars(context.locale, "video", args.query as string),
          descriptionKey: "tools.search.disclaimer_description",
        },
        "InternalBraveVideoSearchTool",
      );

      const enhancedContext = { ...context, serverId: this.getServerId(context) };
      const result = await brave_video_search(args, enhancedContext);
      return this.convertToToolResult(result);
    } catch (error) {
      log.error(`Error in ${this.name}:`, error as Error);
      return {
        success: false,
        error: `Failed to execute video search: ${(error as Error).message}`,
      };
    }
  }
}

export class InternalBraveNewsSearchTool extends BaseInternalBraveSearchTool {
  name = "brave_news_search";
  description = "Internal Brave News Search: consumed by BraveEngine via the unified web_search tool.";

  parameters = {
    type: "object" as const,
    properties: {
      query: { type: "string" as const, description: "The news search query to execute" },
      country: { type: "string" as const, description: "Country code for localized results" },
      search_lang: { type: "string" as const, description: "Search language preference" },
      count: { type: "number" as const, description: "Number of news results to return (max 50)" },
      offset: { type: "number" as const, description: "Offset for pagination (0-9)" },
      safesearch: {
        type: "string" as const,
        description: "Safe search level for news",
        enum: ["off", "moderate", "strict"],
      },
      freshness: { type: "string" as const, description: "Filter by content freshness" },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    try {
      if (!this.isEnabled(context)) {
        return {
          success: false,
          error: "Web search is disabled for this server",
          message: "Web search functionality is not enabled for this server.",
        };
      }

      log.info(`Executing ${this.name} with query: ${args.query}`);

      await sendToolNotice(
        context,
        "news_search",
        {
          titleKey: "tools.search.category_search_title",
          titleVars: getSearchNoticeTitleVars(context.locale, "news", args.query as string),
          descriptionKey: "tools.search.disclaimer_description",
        },
        "InternalBraveNewsSearchTool",
      );

      const enhancedContext = { ...context, serverId: this.getServerId(context) };
      const result = await brave_news_search(args, enhancedContext);
      return this.convertToToolResult(result);
    } catch (error) {
      log.error(`Error in ${this.name}:`, error as Error);
      return {
        success: false,
        error: `Failed to execute news search: ${(error as Error).message}`,
      };
    }
  }
}

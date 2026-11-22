import {
  BaseTool,
  type Tool,
  type ToolAssemblyContext,
  type ToolContext,
  type ToolParameterSchema,
  type ToolResult,
} from "@/types/tool/interfaces";
import { createToolVariant } from "@/tools/assembly";
import { log } from "@/utils/misc/logger";
import { executeWebSearchWithFallback } from "./dispatcher";
import { resolveWebSearchToolCapabilities, type WebSearchToolCapabilities } from "./capabilities";
import { SEARCH_CATEGORIES, type SearchCategory } from "./types";

export function buildWebSearchToolVariant(tool: Tool, capabilities: WebSearchToolCapabilities): Tool {
  const categoryDescription =
    capabilities.categories.length === 1 && capabilities.categories[0] === "text"
      ? "Only 'text' is available for this search."
      : "Choose a supported search category.";

  const parameters: ToolParameterSchema = {
    ...tool.parameters,
    properties: {
      ...tool.parameters.properties,
      category: {
        ...tool.parameters.properties.category,
        description: categoryDescription,
        enum: [...capabilities.categories],
      },
    },
  };

  return createToolVariant(tool, {
    description: `Search the web using ${capabilities.engineLabel}.`,
    parameters,
  });
}

export class WebSearchTool extends BaseTool {
  name = "web_search";
  description = "Search the web with the best available engine.";

  category = "search" as const;
  requiresFeatureFlag = "web_search";
  requiresFollowUp = true;

  parameters = {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "For image, video, or news searches, use plain terms without operators or quotes.",
      },
      category: {
        type: "string" as const,
        description: "Choose a supported search category.",
        enum: [...SEARCH_CATEGORIES],
      },
      count: {
        type: "number" as const,
        description:
          "Max 10 for images sent to Discord or 20 text, news, or video results. Omit for the server default.",
      },
    },
    required: ["query"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  async assembleForContext(context: ToolAssemblyContext): Promise<Tool | null> {
    const serverId = Number.parseInt(context.state.server_id, 10);
    const capabilities = await resolveWebSearchToolCapabilities(
      Number.isInteger(serverId) ? serverId : undefined,
      context.provider,
    );
    return buildWebSearchToolVariant(this, capabilities);
  }

  protected isEnabled(context: ToolContext): boolean {
    return context.tomoriState.config.web_search_enabled;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    try {
      if (!this.isEnabled(context)) {
        return {
          success: false,
          error: "Web search is disabled for this server",
          message: "Web search functionality is not enabled for this server.",
        };
      }

      if (typeof args.query !== "string" || args.query.trim().length === 0) {
        return {
          success: false,
          error: "Query is required and must be a non-empty string",
          message: "I need a search query to look anything up.",
        };
      }

      const rawCategory = typeof args.category === "string" ? args.category : "text";
      const category: SearchCategory = SEARCH_CATEGORIES.includes(rawCategory as SearchCategory)
        ? (rawCategory as SearchCategory)
        : "text";

      const rawCount = typeof args.count === "number" && args.count > 0 ? Math.floor(args.count) : undefined;

      log.info(
        `web_search invoked: category=${category} query="${args.query}"${rawCount !== undefined ? ` count=${rawCount}` : ""}`,
      );

      // Notice emission is delegated to each engine (Brave via Internal*Tool; SearXNG and DuckDuckGo directly) rather
      // than sent here.
      return await executeWebSearchWithFallback(args.query as string, category, context, rawCount);
    } catch (error) {
      log.error("Error in web_search tool:", error as Error);
      return {
        success: false,
        error: `Failed to execute web search: ${(error as Error).message}`,
      };
    }
  }
}

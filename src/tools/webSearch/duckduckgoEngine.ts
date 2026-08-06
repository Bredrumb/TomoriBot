/**
 * DuckDuckGoEngine : wraps DuckDuckGoHandler.executeWebSearchInternal().
 *
 * Text-only engine. When DDG itself rate-limits, the underlying
 * processWebSearch() already cascades to IAsk automatically, so this engine
 * doesn't need to chain to IAskEngine itself. IAskEngine is
 * a separate last-resort entry in the dispatcher chain for the case where
 * DDG can't even reach its MCP server.
 */

import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { getDuckDuckGoHandler } from "@/tools/mcpServers/duckduckgo-search/duckduckgoHandler";
import { getMCPManager } from "@/utils/mcp/mcpManager";
import { log } from "@/utils/misc/logger";
import type { SearchCategory, WebSearchEngine } from "./types";

export class DuckDuckGoEngine implements WebSearchEngine {
  readonly name = "duckduckgo" as const;

  private readonly handler = getDuckDuckGoHandler();

  async available(_context: ToolContext): Promise<boolean> {
    // DDG availability == MCP manager is ready and the web-search function exists.
    const mgr = getMCPManager();
    if (!mgr.isReady()) return false;
    try {
      const tools = mgr.getMCPTools();
      for (const t of tools) {
        const gem = await t.tool();
        if (gem.functionDeclarations?.some((d) => d.name === "web-search")) {
          return true;
        }
      }
    } catch (error) {
      log.warn("DuckDuckGoEngine availability probe failed:", error as Error);
    }
    return false;
  }

  supportsCategory(category: SearchCategory): boolean {
    return category === "text";
  }

  async search(query: string, _category: SearchCategory, context: ToolContext): Promise<ToolResult> {
    const result = await this.handler.executeWebSearchInternal(query, context);
    if (!result) {
      return {
        success: false,
        error: "DuckDuckGo MCP server unreachable",
        message: "DuckDuckGo search was unavailable.",
      };
    }
    return result;
  }
}

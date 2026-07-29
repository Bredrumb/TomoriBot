/**
 * FeloEngine : last-resort text search using Felo AI via the DDG MCP server.
 *
 * Only invoked when both Brave and DuckDuckGo proper have failed. Felo is
 * already used inside DuckDuckGoHandler.processWebSearch as a transparent
 * fallback for DDG rate limits , so this engine exists for the rarer case
 * where DDG itself cannot even reach its MCP server but Felo can.
 */

import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { getDuckDuckGoHandler } from "@/tools/mcpServers/duckduckgo-search/duckduckgoHandler";
import { getMCPManager } from "@/utils/mcp/mcpManager";
import { log } from "@/utils/misc/logger";
import type { SearchCategory, WebSearchEngine } from "./types";

export class FeloEngine implements WebSearchEngine {
  readonly name = "felo" as const;

  private readonly handler = getDuckDuckGoHandler();

  async available(_context: ToolContext): Promise<boolean> {
    const mgr = getMCPManager();
    if (!mgr.isReady()) return false;
    try {
      const tools = mgr.getMCPTools();
      for (const t of tools) {
        const gem = await t.tool();
        if (gem.functionDeclarations?.some((d) => d.name === "felo-search")) {
          return true;
        }
      }
    } catch (error) {
      log.warn("FeloEngine availability probe failed:", error as Error);
    }
    return false;
  }

  supportsCategory(category: SearchCategory): boolean {
    return category === "text";
  }

  async search(query: string, _category: SearchCategory, context: ToolContext): Promise<ToolResult> {
    const result = await this.handler.executeFeloSearchInternal(query, context);
    if (!result) {
      return {
        success: false,
        error: "Felo MCP function unreachable",
        message: "Felo fallback search was unavailable.",
      };
    }
    return result;
  }
}

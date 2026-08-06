import { getDuckDuckGoHandler } from "@/tools/mcpServers/duckduckgo-search/duckduckgoHandler";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { getMCPManager } from "@/utils/mcp/mcpManager";
import { log } from "@/utils/misc/logger";
import type { SearchCategory, WebSearchEngine } from "./types";

export class IAskEngine implements WebSearchEngine {
  readonly name = "iask" as const;

  private readonly handler = getDuckDuckGoHandler();

  async available(_context: ToolContext): Promise<boolean> {
    const manager = getMCPManager();
    if (!manager.isReady()) return false;

    try {
      for (const tool of manager.getMCPTools()) {
        const declaration = await tool.tool();
        if (declaration.functionDeclarations?.some((item) => item.name === "iask-search")) {
          return true;
        }
      }
    } catch (error) {
      log.warn("IAskEngine availability probe failed:", error as Error);
    }

    return false;
  }

  supportsCategory(category: SearchCategory): boolean {
    return category === "text";
  }

  async search(query: string, _category: SearchCategory, context: ToolContext): Promise<ToolResult> {
    const result = await this.handler.executeIAskSearchInternal(query, context);
    if (!result) {
      return {
        success: false,
        error: "IAsk MCP function unreachable",
        message: "IAsk fallback search was unavailable.",
      };
    }

    return result;
  }
}

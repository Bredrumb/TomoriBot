import { getFetchHandler } from "@/tools/mcpServers/fetch/fetchHandler";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { getMCPManager } from "@/utils/mcp/mcpManager";
import { log } from "@/utils/misc/logger";
import type { FetchEngine, FetchOpts } from "./types";

export class McpFetchEngine implements FetchEngine {
  readonly name = "mcp_fetch" as const;

  private readonly handler = getFetchHandler();

  async available(_context: ToolContext): Promise<boolean> {
    const mcpManager = getMCPManager();
    if (!mcpManager.isReady()) {
      return false;
    }

    try {
      const mcpTools = mcpManager.getMCPTools();
      for (const mcpTool of mcpTools) {
        const geminiTool = await mcpTool.tool();
        if (geminiTool.functionDeclarations?.some((declaration) => declaration.name === "fetch")) {
          return true;
        }
      }
    } catch (error) {
      log.warn("McpFetchEngine availability probe failed:", error as Error);
    }

    return false;
  }

  async fetch(url: string, opts: FetchOpts, context: ToolContext): Promise<ToolResult> {
    const args: Record<string, unknown> = {
      url,
    };

    if (opts.maxLength !== undefined) {
      args.max_length = opts.maxLength;
    }

    if (opts.startIndex !== undefined) {
      args.start_index = opts.startIndex;
    }

    if (opts.raw !== undefined) {
      args.raw = opts.raw;
    }

    const result = await this.handler.executeFetchInternal(args, context);
    if (!result) {
      return {
        success: false,
        error: "Bundled MCP fetch server is unavailable",
        message: "URL fetching is currently unavailable.",
      };
    }

    return result;
  }
}

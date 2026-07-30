/**
 * Fetch MCP Server Behavior Handler
 * Provider-agnostic logic for handling Fetch MCP server responses
 * Handles URL content retrieval and markdown conversion
 */

import { log } from "../../../utils/misc/logger";
import type { ToolContext } from "../../../types/tool/interfaces";
import type {
  MCPServerBehaviorHandler,
  MCPExecutionContext,
  MCPServerResponse,
  FetchMCPResponse,
  TypedMCPToolResult,
} from "../../../types/tool/mcpTypes";
import { MCPTypeGuards } from "../../../types/tool/mcpTypes";
import { getMCPManager } from "../../../utils/mcp/mcpManager";

/**
 * Fetch MCP Server Behavior Handler
 * Handles URL content fetching and processing
 */
export class FetchHandler implements MCPServerBehaviorHandler {
  public readonly serverName = "fetch";

  /**
   * Supported Fetch functions
   */
  private readonly SUPPORTED_FUNCTIONS = ["fetch"];

  /**
   * Check if this handler supports a specific function
   * @param functionName - Function name to check
   * @returns True if this handler supports the function
   */
  public supportsFunction(functionName: string): boolean {
    return this.SUPPORTED_FUNCTIONS.includes(functionName);
  }

  /**
   * Execute the bundled MCP `fetch` function internally and reuse the same
   * result processing used by normal MCP dispatch.
   *
   * This is consumed by `fetchUrl/McpFetchEngine` so the raw global MCP
   * function can stay hidden from the LLM while preserving formatting,
   * pagination, error envelopes, and metadata.
   */
  public async executeFetchInternal(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<TypedMCPToolResult | null> {
    const mcpManager = getMCPManager();
    if (!mcpManager.isReady()) {
      return null;
    }

    const functionName = "fetch";
    const mcpTools = mcpManager.getMCPTools();

    for (const mcpTool of mcpTools) {
      try {
        const geminiTool = await mcpTool.tool();
        const functionNames = geminiTool.functionDeclarations?.map((declaration) => declaration.name) ?? [];
        if (!functionNames.includes(functionName)) {
          continue;
        }

        const callResult = await mcpTool.callTool([{ name: functionName, args }]);
        if (!callResult || callResult.length === 0) {
          return null;
        }

        const mcpContext: MCPExecutionContext = {
          ...context,
          serverName: this.serverName,
          functionName,
          originalArgs: args,
          modifiedArgs: args,
          executionStartTime: Date.now(),
        };

        return (await this.processResult(functionName, callResult[0], mcpContext, args)) as TypedMCPToolResult;
      } catch (error) {
        log.warn("Internal MCP fetch invocation failed:", error as Error);
        return null;
      }
    }

    return null;
  }

  /**
   * Process MCP function result before returning to LLM
   * @param mcpResult - Raw result from MCP server
   * @param context - Execution context with Discord channel access
   */
  public async processResult(
    functionName: string,
    mcpResult: MCPServerResponse,
    context: MCPExecutionContext,
    args: Record<string, unknown>,
  ): Promise<TypedMCPToolResult> {
    try {
      if (functionName === "fetch") {
        return await this.processFetchResult(mcpResult, context, args);
      }

      // Fallback for unknown functions (shouldn't happen)
      return this.processStandardResult(functionName, mcpResult, context, args);
    } catch (error) {
      log.error(`Failed to process ${functionName} result:`, error as Error);
      return {
        success: false,
        message: "Failed to process Fetch result",
        error: error instanceof Error ? error.message : String(error),
        data: {
          source: "mcp",
          functionName,
          serverName: this.serverName,
          rawResult: mcpResult,
          executionTime: Date.now() - context.executionStartTime,
          status: "failed",
        },
      };
    }
  }

  /**
   * Process Fetch MCP server results
   * @param mcpResult - The raw MCP result from fetch
   * @param args - The arguments used for the fetch (contains URL)
   */
  private async processFetchResult(
    mcpResult: MCPServerResponse,
    context: MCPExecutionContext,
    args: Record<string, unknown>,
  ): Promise<TypedMCPToolResult> {
    try {
      // Type guard to check if this is a fetch response
      const isFetchResponse = MCPTypeGuards.isFetchResponse(mcpResult);
      const fetchResult = mcpResult as FetchMCPResponse;

      let resultText = "";
      let url = "";
      let title = "";
      let statusCode = 200;

      if (isFetchResponse) {
        resultText = fetchResult.markdown || fetchResult.text || "";
        url = fetchResult.url || (args.url as string) || "";
        title = fetchResult.title || "";
        statusCode = fetchResult.status_code || 200;

        if (fetchResult.error || statusCode >= 400) {
          return {
            success: false,
            message: `Failed to fetch content from ${url}: ${fetchResult.error || `HTTP ${statusCode}`}`,
            error: fetchResult.error || `HTTP error ${statusCode}`,
            data: {
              source: "mcp",
              functionName: "fetch",
              serverName: this.serverName,
              rawResult: mcpResult,
              executionTime: Date.now() - context.executionStartTime,
              status: "failed",
            },
          };
        }
      } else {
        if (mcpResult.text) {
          resultText = mcpResult.text;
        } else if (mcpResult.functionResponse?.response?.text) {
          resultText = mcpResult.functionResponse.response.text;
        } else if (mcpResult.functionResponse?.response?.content?.[0]?.text) {
          // Gemini SDK wraps successful MCP text results in functionResponse.response.content
          resultText = mcpResult.functionResponse.response.content[0].text ?? "";
        } else {
          // Fallback: try to stringify the result
          resultText = JSON.stringify(mcpResult, null, 2);
        }
        url = (args.url as string) || "";
      }

      if (mcpResult.isError) {
        return {
          success: false,
          message: `Failed to fetch content from ${url}: ${resultText}`,
          error: resultText || "Unknown fetch error",
          data: {
            source: "mcp",
            functionName: "fetch",
            serverName: this.serverName,
            rawResult: mcpResult,
            executionTime: Date.now() - context.executionStartTime,
            status: "failed",
          },
        };
      }

      // Check for the Gemini SDK nested error envelope: functionResponse.response.error.isError
      const nestedError = mcpResult.functionResponse?.response?.error;
      if (nestedError?.isError) {
        const nestedErrorText = nestedError.content?.[0]?.text ?? "Unknown fetch error";
        return {
          success: false,
          message: `Failed to fetch content from ${url}: ${nestedErrorText}`,
          error: nestedErrorText,
          data: {
            source: "mcp",
            functionName: "fetch",
            serverName: this.serverName,
            rawResult: mcpResult,
            executionTime: Date.now() - context.executionStartTime,
            status: "failed",
          },
        };
      }

      // When start_index is past the content end, the fetch server returns an empty body.
      // Return a clear end-of-content signal so the LLM knows reading is complete.
      if (!resultText.trim()) {
        const startIndex = Number(args.start_index) || 0;
        const endOfContentMessage =
          startIndex > 0
            ? `[End of page content. No further content found at character offset ${startIndex}. All sections of this page have been read.]`
            : `[The page returned no readable content.]`;

        return {
          success: true,
          message: endOfContentMessage,
          data: {
            source: "mcp",
            functionName: "fetch",
            serverName: this.serverName,
            rawResult: mcpResult,
            executionTime: Date.now() - context.executionStartTime,
            status: "completed",
            contentLength: 0,
            url: url,
            title: title,
            statusCode: statusCode,
          },
        };
      }

      // Successful fetch - format the response for the LLM
      let formattedMessage = "";
      if (title) {
        formattedMessage = `# ${title}\n\n`;
      }
      if (url) {
        formattedMessage += `**URL:** ${url}\n\n`;
      }
      formattedMessage += resultText;

      // Truncate if the content is extremely long (to avoid token limits)
      const MAX_CONTENT_LENGTH = 50000; // Matches MCP server maxLength capability
      if (formattedMessage.length > MAX_CONTENT_LENGTH) {
        formattedMessage = `${formattedMessage.substring(0, MAX_CONTENT_LENGTH)}\n\n[Content truncated due to length - this represents a portion of the full page content]`;
      }

      log.info(`Fetch completed successfully for ${url} - Content length: ${resultText.length} characters`);

      return {
        success: true,
        message: formattedMessage,
        data: {
          source: "mcp",
          functionName: "fetch",
          serverName: this.serverName,
          rawResult: mcpResult,
          executionTime: Date.now() - context.executionStartTime,
          status: "completed",
          contentLength: resultText.length,
          url: url,
          title: title,
          statusCode: statusCode,
        },
      };
    } catch (error) {
      log.error("Error processing fetch result:", error as Error);
      return {
        success: false,
        message: "Failed to process fetch result",
        error: error instanceof Error ? error.message : String(error),
        data: {
          source: "mcp",
          functionName: "fetch",
          serverName: this.serverName,
          rawResult: mcpResult,
          executionTime: Date.now() - context.executionStartTime,
          status: "failed",
        },
      };
    }
  }

  /**
   * Process standard results for unknown functions
   * @param mcpResult - Raw result from MCP server
   */
  private processStandardResult(
    functionName: string,
    mcpResult: MCPServerResponse,
    context: MCPExecutionContext,
    _args: Record<string, unknown>,
  ): TypedMCPToolResult {
    try {
      // Extract result text from various possible locations in MCP response
      let resultText = "";
      if (mcpResult.text) {
        resultText = mcpResult.text;
      } else if (mcpResult.functionResponse?.response?.text) {
        resultText = mcpResult.functionResponse.response.text;
      } else {
        // Fallback: try to stringify the result
        resultText = JSON.stringify(mcpResult, null, 2);
      }

      if (mcpResult.isError) {
        return {
          success: false,
          message: resultText || `${functionName} execution failed`,
          error: resultText || "Unknown MCP error",
          data: {
            source: "mcp",
            functionName,
            serverName: this.serverName,
            rawResult: mcpResult,
            executionTime: Date.now() - context.executionStartTime,
            status: "failed",
          },
        };
      }

      return {
        success: true,
        message: resultText || `${functionName} executed successfully`,
        data: {
          source: "mcp",
          functionName,
          serverName: this.serverName,
          rawResult: mcpResult,
          executionTime: Date.now() - context.executionStartTime,
          status: "completed",
        },
      };
    } catch (error) {
      log.error(`Error processing standard Fetch result for ${functionName}:`, error as Error);
      return {
        success: false,
        message: `Failed to process ${functionName} result`,
        error: error instanceof Error ? error.message : String(error),
        data: {
          source: "mcp",
          functionName,
          serverName: this.serverName,
          rawResult: mcpResult,
          executionTime: Date.now() - context.executionStartTime,
          status: "failed",
        },
      };
    }
  }
}

/**
 * Export convenience function for getting the handler instance
 */
export function getFetchHandler(): FetchHandler {
  return new FetchHandler();
}

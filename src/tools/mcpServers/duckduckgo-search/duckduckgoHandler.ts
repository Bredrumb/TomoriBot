/**
 * DuckDuckGo Search MCP Server Behavior Handler
 * Provider-agnostic logic for handling DuckDuckGo Search MCP server responses
 * Future implementation for free web search functionality
 */

import { log } from "../../../utils/misc/logger";
import { sendStandardEmbed } from "../../../utils/discord/embedHelper";
import { sendToolNotice } from "../../../utils/discord/toolProgressNotice";
import { getMCPManager } from "../../../utils/mcp/mcpManager";
import type {
  DuckDuckGoWebSearchResponse,
  MCPServerBehaviorHandler,
  MCPExecutionContext,
  MCPServerResponse,
  TypedMCPToolResult,
} from "../../../types/tool/mcpTypes";

/**
 * DuckDuckGo Search MCP Server Behavior Handler
 * Handles free web search functionality as an alternative to Brave Search
 * Future implementation - structure prepared for when DuckDuckGo MCP server is integrated
 */
export class DuckDuckGoHandler implements MCPServerBehaviorHandler {
  public readonly serverName = "duckduckgo-search";

  /**
   * Supported DuckDuckGo Search functions
   * Note: felo-search remains hidden from providers and is only used as an
   * internal fallback when DuckDuckGo web-search hits rate limits or returns
   * no usable results.
   */
  private readonly SUPPORTED_FUNCTIONS = [
    "web-search", // DuckDuckGo web search with HTML scraping
    "felo-search", // Internal AI fallback for DuckDuckGo rate limits
    "url-metadata", // URL metadata extraction (title, description, images)
  ];

  /**
   * Check if this handler supports a specific function
   * @param functionName - Function name to check
   * @returns True if this handler supports the function
   */
  public supportsFunction(functionName: string): boolean {
    return this.SUPPORTED_FUNCTIONS.includes(functionName);
  }

  /**
   * Process MCP function result before returning to LLM
   * @param functionName - Name of the executed function
   * @param mcpResult - Raw result from MCP server
   * @param context - Execution context with Discord channel access
   * @param args - Function arguments used
   * @returns Processed tool result
   */
  public async processResult(
    functionName: string,
    mcpResult: MCPServerResponse,
    context: MCPExecutionContext,
    args: Record<string, unknown>,
  ): Promise<TypedMCPToolResult> {
    try {
      // Handle DuckDuckGo web search with fetch capability reminder
      if (functionName === "web-search") {
        return await this.processWebSearch(mcpResult, args, context);
      }

      // Handle URL metadata extraction
      if (functionName === "url-metadata") {
        return await this.processUrlMetadata(mcpResult, args);
      }

      // Handle Felo AI fallback/search results
      if (functionName === "felo-search") {
        return this.processFeloSearch(mcpResult, args, context);
      }

      // Fallback for any unhandled functions
      return this.processStandardDuckDuckGoResult(functionName, mcpResult, context, args);
    } catch (error) {
      log.error(`Failed to process ${functionName} result:`, error as Error);
      return {
        success: false,
        message: "Failed to process DuckDuckGo & Felo AI Search result",
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
   * Process DuckDuckGo web search results with fetch capability reminder
   * Enhanced HTML scraping provides comprehensive search results
   * @param mcpResult - The raw MCP result from DuckDuckGo web search
   * @param args - The modified arguments used for the search (contains query)
   * @returns Promise<TypedMCPToolResult> - Enhanced result with fetch capability reminder
   */
  private async processWebSearch(
    mcpResult: MCPServerResponse,
    args: Record<string, unknown>,
    context: MCPExecutionContext,
  ): Promise<TypedMCPToolResult> {
    try {
      const query = String(args.query || args.q || "your search");

      // Send search status embed to Discord (consistent with Brave Search UX)
      // Non-fatal: missing permissions should not prevent search results from reaching the AI
      try {
        await sendToolNotice(
          context,
          "web_search",
          {
            titleKey: "tools.search.web_search_title",
            titleVars: { query },
            descriptionKey: "tools.search.disclaimer_description",
          },
          "DuckDuckGoSearchHandler",
        );
      } catch (embedError) {
        log.warn("Failed to send DuckDuckGo search status embed (non-fatal)", embedError as Error);
      }

      const fallbackReason = this.getFeloFallbackReason(mcpResult);
      if (fallbackReason) {
        const fallbackResult = await this.tryFeloSearchFallback(query, context, fallbackReason);
        if (fallbackResult) {
          return fallbackResult;
        }

        if (fallbackReason === "duckduckgo_rate_limit") {
          await this.sendDuckDuckGoRateLimitEmbed(context);
        }

        return {
          success: false,
          message:
            fallbackReason === "duckduckgo_rate_limit"
              ? "DuckDuckGo search failed due to rate limiting, and Felo fallback was unavailable."
              : "DuckDuckGo search returned no usable results, and Felo fallback was unavailable.",
          error: this.extractResultText(mcpResult),
          data: {
            source: "mcp",
            functionName: "web-search",
            serverName: this.serverName,
            rawResult: mcpResult,
            executionTime: Date.now() - context.executionStartTime,
            status: "failed",
            errorType: fallbackReason,
          },
        };
      }

      // Surface non-rate-limit MCP errors without mislabeling them as throttling.
      if (mcpResult.isError) {
        const errorText = this.extractResultText(mcpResult);
        return {
          success: false,
          message: "DuckDuckGo web search failed",
          error: errorText,
          data: {
            source: "mcp",
            functionName: "web-search",
            serverName: this.serverName,
            rawResult: mcpResult,
            executionTime: Date.now() - context.executionStartTime,
            status: "failed",
            errorType: "duckduckgo_web_search_error",
          },
        };
      }

      const originalText = this.extractResultText(mcpResult);

      // Extract URLs from the search results for logging
      const urlPattern = /https?:\/\/[^\s)]+/g;
      const foundUrls = originalText.match(urlPattern) || [];
      const urlCount = foundUrls.length;

      // Add a note that this is from DuckDuckGo search
      const prefixMessage = `[DuckDuckGo Web Search Results]\n\n${originalText}`;

      // Log the search response
      log.info(`DuckDuckGo search response: ${prefixMessage.substring(0, 200)}...`);
      log.info(`DuckDuckGo search - Found ${urlCount} URLs`);

      return {
        success: true,
        message: prefixMessage,
        data: {
          source: "mcp",
          functionName: "web-search",
          serverName: this.serverName,
          rawResult: mcpResult,
          executionTime: 0, // Will be set by caller
          urlsFound: urlCount,
          status: "completed",
          // DuckDuckGo specific metadata
          searchProvider: "DuckDuckGo (Enhanced HTML Scraping)",
        },
      };
    } catch (error) {
      log.error("Error processing DuckDuckGo web search result:", error as Error);
      // Fall back to original behavior
      return {
        success: true,
        message: this.extractResultText(mcpResult) || "DuckDuckGo web search completed successfully",
        data: {
          source: "mcp",
          functionName: "web-search",
          serverName: this.serverName,
          rawResult: mcpResult,
          executionTime: 0, // Will be set by caller
          status: "completed",
          searchProvider: "DuckDuckGo (Enhanced HTML Scraping)",
        },
      };
    }
  }

  /**
   * Process URL metadata extraction results
   * Provides structured metadata including title, description, and images
   * @param mcpResult - The raw MCP result from URL metadata extraction
   * @param args - The modified arguments used (contains url)
   * @returns Promise<TypedMCPToolResult> - Structured metadata result
   */
  private async processUrlMetadata(
    mcpResult: MCPServerResponse,
    args: Record<string, unknown>,
  ): Promise<TypedMCPToolResult> {
    try {
      const metadataContent = this.extractResultText(mcpResult);

      const url = (args.url as string) || "unknown URL";

      // Format the result message
      const prefixMessage = `[URL Metadata for: ${url}]\n\n${metadataContent}`;

      // Log the metadata result
      log.info(`URL metadata for ${url}: ${metadataContent.substring(0, 150)}...`);

      return {
        success: true,
        message: prefixMessage,
        data: {
          source: "mcp",
          functionName: "url-metadata",
          serverName: this.serverName,
          rawResult: mcpResult,
          executionTime: 0, // Will be set by caller
          status: "completed",
          url: url,
          searchProvider: "DuckDuckGo MCP (URL Metadata Extraction)",
        },
      };
    } catch (error) {
      log.error("Error processing URL metadata result:", error as Error);
      return {
        success: true,
        message: mcpResult.text || "URL metadata extraction completed successfully",
        data: {
          source: "mcp",
          functionName: "url-metadata",
          serverName: this.serverName,
          rawResult: mcpResult,
          executionTime: 0, // Will be set by caller
          status: "completed",
          searchProvider: "DuckDuckGo MCP (URL Metadata Extraction)",
        },
      };
    }
  }

  /**
   * Process Felo AI search results.
   * This remains available to the handler even when providers do not expose the
   * raw MCP function directly.
   */
  private processFeloSearch(
    mcpResult: MCPServerResponse,
    args: Record<string, unknown>,
    context: MCPExecutionContext,
  ): TypedMCPToolResult {
    const baseResult = this.processStandardDuckDuckGoResult("felo-search", mcpResult, context, args);
    if (!baseResult.success) {
      return baseResult;
    }

    if (!baseResult.data) {
      return baseResult;
    }

    const resultText = this.extractResultText(mcpResult);
    const urlsFound = this.countUrls(resultText);
    const query = String(args.query || args.q || "your search");

    return {
      ...baseResult,
      message: `[Felo AI Search Fallback Results for: ${query}]\n\n${resultText}`,
      data: {
        ...baseResult.data,
        functionName: "felo-search",
        rawResult: mcpResult,
        urlsFound,
        searchProvider: "Felo AI Search (DuckDuckGo rate-limit fallback)",
        fallbackFrom: "web-search",
      },
    };
  }

  /**
   * Retry a rate-limited DuckDuckGo web search with Felo AI.
   */
  private async tryFeloSearchFallback(
    query: string,
    context: MCPExecutionContext,
    reason: "duckduckgo_rate_limit" | "duckduckgo_empty_results",
  ): Promise<TypedMCPToolResult | null> {
    if (!query || query === "your search") {
      return null;
    }

    try {
      const mcpManager = getMCPManager();
      if (!mcpManager.isReady()) {
        return null;
      }

      const mcpTools = mcpManager.getMCPTools();
      for (const mcpTool of mcpTools) {
        const geminiTool = await mcpTool.tool();
        const functionNames = geminiTool.functionDeclarations?.map((declaration) => declaration.name) || [];

        if (!functionNames.includes("felo-search")) {
          continue;
        }

        log.warn(`DuckDuckGo web-search fallback triggered (${reason}) for "${query}". Retrying with felo-search.`);

        const fallbackArgs = {
          query,
          stream: false,
        };
        const fallbackResult = await mcpTool.callTool([{ name: "felo-search", args: fallbackArgs }]);
        if (!fallbackResult || fallbackResult.length === 0) {
          log.warn(`Felo fallback returned no results after DuckDuckGo web-search fallback (${reason}).`);
          return null;
        }

        const processedResult = this.processFeloSearch(fallbackResult[0], fallbackArgs, context);
        if (!processedResult.success) {
          log.warn(
            `Felo fallback failed after DuckDuckGo fallback (${reason}): ${processedResult.error || processedResult.message || "unknown error"}`,
          );
          return null;
        }

        if (processedResult.data) {
          processedResult.data.fallbackReason = reason;
        }

        log.info(`Felo fallback succeeded for DuckDuckGo query "${query}" after ${reason}.`);
        return processedResult;
      }
    } catch (error) {
      log.warn(`Felo fallback execution failed after DuckDuckGo fallback (${reason}).`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  }

  /**
   * Send the standard DuckDuckGo rate-limit embed when all fallbacks are exhausted.
   */
  private async sendDuckDuckGoRateLimitEmbed(context: MCPExecutionContext): Promise<void> {
    await sendStandardEmbed(
      context.channel,
      context.locale,
      {
        titleKey: "general.errors.duckduckgo_rate_limit.title",
        descriptionKey: "general.errors.duckduckgo_rate_limit.description",
        footerKey: "general.errors.duckduckgo_rate_limit.footer",
      },
      {
        webhook: context.webhook,
        personaUsername: context.personaUsername,
        personaAvatarUrl: context.personaAvatarUrl,
      },
    );
  }

  /**
   * Process standard DuckDuckGo Search results for other functions
   * @param functionName - Name of the executed function
   * @param mcpResult - Raw result from MCP server
   * @param context - Execution context
   * @param args - Function arguments used
   * @returns TypedMCPToolResult - Standard processed result
   */
  private processStandardDuckDuckGoResult(
    functionName: string,
    mcpResult: MCPServerResponse,
    context: MCPExecutionContext,
    _args: Record<string, unknown>,
  ): TypedMCPToolResult {
    try {
      const resultText = this.extractResultText(mcpResult);

      // Check if this is an error result
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

      // Successful execution - add DuckDuckGo & Felo AI branding
      const enhancedMessage = `[DuckDuckGo & Felo AI Search Results]\n\n${resultText}`;

      return {
        success: true,
        message: enhancedMessage,
        data: {
          source: "mcp",
          functionName,
          serverName: this.serverName,
          rawResult: mcpResult,
          executionTime: Date.now() - context.executionStartTime,
          status: "completed",
          searchProvider: "DuckDuckGo & Felo AI Search MCP",
        },
      };
    } catch (error) {
      log.error(`Error processing standard DuckDuckGo result for ${functionName}:`, error as Error);
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

  /**
   * Extract a readable text payload from an MCP result.
   */
  private extractResultText(mcpResult: MCPServerResponse): string {
    if (mcpResult.text) {
      return mcpResult.text;
    }

    if (mcpResult.functionResponse?.response?.text) {
      return mcpResult.functionResponse.response.text;
    }

    return JSON.stringify(mcpResult, null, 2);
  }

  /**
   * Count URL-like strings in a search response.
   */
  private countUrls(resultText: string): number {
    const urlPattern = /https?:\/\/[^\s)]+/g;
    return (resultText.match(urlPattern) || []).length;
  }

  /**
   * Decide whether DuckDuckGo should fall back to Felo AI.
   */
  private getFeloFallbackReason(
    mcpResult: MCPServerResponse,
  ): "duckduckgo_rate_limit" | "duckduckgo_empty_results" | null {
    if (this.isRateLimitError(mcpResult)) {
      return "duckduckgo_rate_limit";
    }

    if (this.hasNoUsableSearchResults(mcpResult)) {
      return "duckduckgo_empty_results";
    }

    return null;
  }

  /**
   * Detect clearly empty or unusable DuckDuckGo web-search responses.
   */
  private hasNoUsableSearchResults(mcpResult: MCPServerResponse): boolean {
    const duckDuckGoResult = mcpResult as Partial<DuckDuckGoWebSearchResponse>;
    if (Array.isArray(duckDuckGoResult.results)) {
      return duckDuckGoResult.results.length === 0;
    }

    const resultText = this.extractResultText(mcpResult).trim();
    if (!resultText || resultText === "{}" || resultText === "[]" || resultText === "null") {
      return true;
    }

    const normalizedText = resultText.toLowerCase();
    const noResultIndicators = [
      "no results",
      "0 results",
      "no search results",
      "no relevant results",
      "no matches found",
      "nothing found",
      "could not find any results",
      "couldn't find any results",
      "did not return any results",
    ];

    if (noResultIndicators.some((indicator) => normalizedText.includes(indicator))) {
      return true;
    }

    return this.countUrls(resultText) === 0 && normalizedText.length < 40;
  }

  /**
   * Detect if an MCP result indicates a rate limit error.
   */
  private isRateLimitError(mcpResult: MCPServerResponse): boolean {
    const errorIndicators = [
      "rate limit",
      "too many requests",
      "429",
      "throttled",
      "rate limited",
      "failed to fetch search results",
      "http 202",
    ];
    const resultText = this.extractResultText(mcpResult).toLowerCase();

    // Treat any MCP-level error (isError: true) as a rate-limit-class failure
    // so the felo fallback has a chance to recover the search.
    if (mcpResult.isError) {
      return true;
    }

    return errorIndicators.some((indicator) => resultText.includes(indicator));
  }
}

/**
 * Export convenience function for getting the handler instance
 */
export function getDuckDuckGoHandler(): DuckDuckGoHandler {
  return new DuckDuckGoHandler();
}

/**
 * DuckDuckGo Search MCP Server Behavior Handler
 * Provider-agnostic logic for handling DuckDuckGo Search MCP server responses
 * Future implementation for free web search functionality
 */

import { log } from "../../../utils/misc/logger";
import { sendStandardEmbed } from "../../../utils/discord/embedHelper";
import type {
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
	 * Note: felo-search and fetch-url are disabled at the adapter level
	 */
	private readonly SUPPORTED_FUNCTIONS = [
		"web-search", // DuckDuckGo web search with HTML scraping
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

			// Fallback for any unhandled functions
			return this.processStandardDuckDuckGoResult(
				functionName,
				mcpResult,
				context,
				args,
			);
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
			// Send search status embed to Discord (consistent with Brave Search UX)
			await sendStandardEmbed(context.channel, context.locale, {
				titleKey: "genai.search.web_search_title",
				titleVars: { query: String(args.query || args.q || "your search") },
				descriptionKey: "genai.search.disclaimer_description",
			});

			// Check for errors or rate limits before processing
			if (mcpResult.isError || this.isRateLimitError(mcpResult)) {
				await sendStandardEmbed(context.channel, context.locale, {
					titleKey: "general.errors.duckduckgo_rate_limit.title",
					descriptionKey: "general.errors.duckduckgo_rate_limit.description",
					footerKey: "general.errors.duckduckgo_rate_limit.footer",
				});
				return {
					success: false,
					message:
						"DuckDuckGo search failed due to rate limiting. Consider using Brave Search for more reliable results.",
					error: mcpResult.text || "Rate limit error",
					data: {
						source: "mcp",
						functionName: "web-search",
						serverName: this.serverName,
						rawResult: mcpResult,
						executionTime: Date.now() - context.executionStartTime,
						status: "failed",
						errorType: "duckduckgo_rate_limit",
					},
				};
			}
			// Extract the original search result text
			let originalText = "";
			if (mcpResult.text) {
				originalText = mcpResult.text;
			} else if (mcpResult.functionResponse?.response?.text) {
				originalText = mcpResult.functionResponse.response.text;
			} else {
				// Fallback: try to stringify the result
				originalText = JSON.stringify(mcpResult, null, 2);
			}

			// Extract URLs from the search results for logging
			const urlPattern = /https?:\/\/[^\s)]+/g;
			const foundUrls = originalText.match(urlPattern) || [];
			const urlCount = foundUrls.length;

			// Add a note that this is from DuckDuckGo search
			const prefixMessage = `[DuckDuckGo Web Search Results]\n\n${originalText}`;

			// Log the search response
			log.info(
				`DuckDuckGo search response: ${prefixMessage.substring(0, 200)}...`,
			);
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
			log.error(
				"Error processing DuckDuckGo web search result:",
				error as Error,
			);
			// Fall back to original behavior
			return {
				success: true,
				message:
					mcpResult.text || "DuckDuckGo web search completed successfully",
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
			// Extract the metadata
			let metadataContent = "";
			if (mcpResult.text) {
				metadataContent = mcpResult.text;
			} else if (mcpResult.functionResponse?.response?.text) {
				metadataContent = mcpResult.functionResponse.response.text;
			} else {
				metadataContent = JSON.stringify(mcpResult, null, 2);
			}

			const url = (args.url as string) || "unknown URL";

			// Format the result message
			const prefixMessage = `[URL Metadata for: ${url}]\n\n${metadataContent}`;

			// Log the metadata result
			log.info(
				`URL metadata for ${url}: ${metadataContent.substring(0, 150)}...`,
			);

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
				message:
					mcpResult.text || "URL metadata extraction completed successfully",
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
			log.error(
				`Error processing standard DuckDuckGo result for ${functionName}:`,
				error as Error,
			);
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
	 * Detect if an MCP result indicates a rate limit error
	 * @param mcpResult - The MCP server response to check
	 * @returns True if the result indicates rate limiting
	 */
	private isRateLimitError(mcpResult: MCPServerResponse): boolean {
		const errorIndicators = [
			"rate limit",
			"too many requests",
			"429",
			"throttled",
			"rate limited",
		];
		const resultText = mcpResult.text || JSON.stringify(mcpResult);
		return errorIndicators.some((indicator) =>
			resultText.toLowerCase().includes(indicator),
		);
	}
}

/**
 * Export convenience function for getting the handler instance
 */
export function getDuckDuckGoHandler(): DuckDuckGoHandler {
	return new DuckDuckGoHandler();
}

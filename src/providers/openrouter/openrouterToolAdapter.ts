/**
 * OpenRouter Tool Adapter
 * Converts generic tools to OpenAI-compatible function format and back
 * OpenRouter uses the OpenAI function calling specification
 */

import { log } from "../../utils/misc/logger";
import type {
	Tool,
	MCPCapableToolAdapter,
	ToolContext,
	ToolResult,
} from "../../types/tool/interfaces";
import type { TypedMCPToolResult } from "../../types/tool/mcpTypes";
import { getMCPManager } from "../../utils/mcp/mcpManager";
import { getMCPExecutor } from "../../utils/mcp/mcpExecutor";
import { isBraveSearchAvailable } from "../../tools/restAPIs/brave/braveSearchService";

/**
 * OpenAI-compatible function declaration format (used by OpenRouter)
 */
interface OpenAIFunctionDeclaration extends Record<string, unknown> {
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<
			string,
			{
				type: "string" | "number" | "boolean" | "array" | "object";
				description: string;
				enum?: string[];
				items?: {
					type: "string" | "number" | "boolean" | "object";
				};
			}
		>;
		required: string[];
	};
}

/**
 * OpenRouter tool adapter implementation with MCP capabilities
 */
export class OpenrouterToolAdapter implements MCPCapableToolAdapter {
	private static instance: OpenrouterToolAdapter;

	/**
	 * Get singleton instance
	 */
	static getInstance(): OpenrouterToolAdapter {
		if (!OpenrouterToolAdapter.instance) {
			OpenrouterToolAdapter.instance = new OpenrouterToolAdapter();
		}
		return OpenrouterToolAdapter.instance;
	}

	/**
	 * Get the provider name this adapter supports
	 * @returns Provider identifier
	 */
	getProviderName(): string {
		return "openrouter";
	}

	/**
	 * Convert a generic tool to OpenAI function declaration format
	 * @param tool - The generic tool to convert
	 * @returns OpenAI-compatible function declaration
	 */
	convertTool(tool: Tool): Record<string, unknown> {
		try {
			// Convert parameter schema to OpenAI format
			const openaiProperties: Record<
				string,
				{
					type: "string" | "number" | "boolean" | "array" | "object";
					description: string;
					enum?: string[];
					items?: {
						type: "string" | "number" | "boolean" | "object";
					};
				}
			> = {};

			for (const [paramName, paramSchema] of Object.entries(
				tool.parameters.properties,
			)) {
				openaiProperties[paramName] = {
					type: this.convertParameterType(
						paramSchema.type as
							| "string"
							| "number"
							| "boolean"
							| "array"
							| "object",
					),
					description: paramSchema.description,
				};

				// Add enum if specified
				if (paramSchema.enum) {
					openaiProperties[paramName].enum = paramSchema.enum;
				}

				// Add items for array type
				if (paramSchema.type === "array" && paramSchema.items) {
					const itemType = this.convertParameterType(
						paramSchema.items.type as
							| "string"
							| "number"
							| "boolean"
							| "object",
					);
					openaiProperties[paramName].items = {
						type: itemType as "string" | "number" | "boolean" | "object",
					};
				}
			}

			const openaiFunction: OpenAIFunctionDeclaration = {
				name: tool.name,
				description: tool.description,
				parameters: {
					type: "object",
					properties: openaiProperties,
					required: tool.parameters.required,
				},
			};

			log.info(
				`Converted tool '${tool.name}' (${tool.category}) to OpenAI format with ${Object.keys(openaiProperties).length} parameters`,
			);

			return openaiFunction;
		} catch (error) {
			log.error(
				`Failed to convert tool '${tool.name}' (${tool.category}) to OpenAI format`,
				error as Error,
			);
			throw error;
		}
	}

	/**
	 * Convert tool result back to OpenAI-specific format
	 * @param result - The generic tool result
	 * @returns OpenAI-specific result format (text content)
	 */
	convertResult(result: ToolResult): Record<string, unknown> {
		try {
			// OpenAI expects text content in tool responses
			if (result.success) {
				// Successful execution - provide meaningful result text
				let resultText = result.message || "Tool executed successfully";

				if (result.data && typeof result.data === "object") {
					const data = result.data as Record<string, unknown>;

					// Format the result based on the data structure
					if (data.summary && typeof data.summary === "string") {
						resultText = data.summary;
					} else if (data.message && typeof data.message === "string") {
						resultText = data.message;
					} else if (
						data.selectionReason &&
						typeof data.selectionReason === "string"
					) {
						resultText = data.selectionReason;
					} else {
						// Include relevant data in the result text
						const relevantData = this.extractRelevantData(data);
						if (relevantData) {
							resultText = `${resultText}\n\nResult: ${relevantData}`;
						}
					}
				}

				return {
					content: resultText,
				};
			}

			// Failed execution - provide error information
			const errorText =
				result.message || result.error || "Tool execution failed";

			return {
				content: `Error: ${errorText}`,
			};
		} catch (error) {
			log.error(
				`Failed to convert tool result to OpenAI format (success: ${result.success}, hasData: ${!!result.data})`,
				error as Error,
			);

			return {
				content: "Error: Failed to process tool result",
			};
		}
	}

	/**
	 * Convert multiple tools to OpenAI tools array format
	 * @param tools - Array of generic tools
	 * @returns OpenAI tools configuration
	 */
	convertToolsArray(tools: Tool[]): Array<Record<string, unknown>> {
		if (tools.length === 0) {
			return [];
		}

		try {
			// Convert each tool to OpenAI function declaration
			// OpenAI expects each tool wrapped in a {type: "function", function: {...}} structure
			return tools.map((tool) => ({
				type: "function",
				function: this.convertTool(tool),
			}));
		} catch (error) {
			log.error(
				`Failed to convert tools array to OpenAI format (${tools.length} tools: ${tools.map((t) => t.name).join(", ")})`,
				error as Error,
			);
			return [];
		}
	}

	/**
	 * Get all available tools (built-in + MCP) in provider-specific format
	 * Implementation of MCPCapableToolAdapter interface
	 * @param builtInTools - Array of built-in tools
	 * @param serverId - Optional Discord server ID for server-specific tool selection
	 * @param allowedMCPFunctions - Optional pre-filtered list of MCP function names to include
	 * @returns Combined provider-specific tools configuration
	 */
	async getAllToolsInProviderFormat(
		builtInTools: Tool[],
		serverId?: number,
		allowedMCPFunctions?: string[],
	): Promise<Array<Record<string, unknown>>> {
		return this.getAllToolsInOpenrouterFormat(
			builtInTools,
			serverId,
			allowedMCPFunctions,
		);
	}

	/**
	 * Get all available tools (built-in + MCP) in OpenRouter (OpenAI) tools format
	 * @param builtInTools - Array of built-in tools
	 * @param serverId - Optional Discord server ID for server-specific tool selection
	 * @param allowedMCPFunctions - Optional pre-filtered list of MCP function names to include
	 * @returns Combined OpenAI tools configuration
	 */
	async getAllToolsInOpenrouterFormat(
		builtInTools: Tool[],
		serverId?: number,
		allowedMCPFunctions?: string[],
	): Promise<Array<Record<string, unknown>>> {
		try {
			const allTools: Record<string, unknown>[] = [];

			// Check if Brave Search is available for conditional tool selection
			const hasBraveApiKey = await isBraveSearchAvailable(serverId);
			log.info(
				`Brave Search ${hasBraveApiKey ? "available" : "not available"} for server ${serverId || "global"} - implementing conditional search tool selection`,
			);

			// Brave search tool names for filtering
			const braveSearchToolNames = [
				"brave_web_search",
				"brave_image_search",
				"brave_video_search",
				"brave_news_search",
			];

			// Filter built-in tools based on Brave API key availability
			let filteredBuiltInTools = builtInTools;
			if (!hasBraveApiKey) {
				// No Brave API key - exclude Brave search tools
				filteredBuiltInTools = builtInTools.filter(
					(tool) => !braveSearchToolNames.includes(tool.name),
				);
				const excludedCount = builtInTools.length - filteredBuiltInTools.length;
				if (excludedCount > 0) {
					log.info(
						`Excluded ${excludedCount} Brave search tools (no API key available)`,
					);
				}
			}

			// Convert filtered built-in tools
			if (filteredBuiltInTools.length > 0) {
				const builtInToolsFormatted =
					this.convertToolsArray(filteredBuiltInTools);
				allTools.push(...builtInToolsFormatted);
				log.info(
					`Converted ${filteredBuiltInTools.length} built-in tools to OpenAI format`,
				);
			}

			// Add MCP tools if available (using pre-filtered list or legacy filtering)
			const mcpManager = getMCPManager();
			if (mcpManager.isReady()) {
				let addedMCPToolsCount = 0;

				// Disabled DuckDuckGo functions (always filtered out)
				// felo-search: Streaming not compatible with Discord
				// fetch-url: Use dedicated Fetch MCP server instead
				// url-metadata: Redundant with Fetch MCP server
				const disabledDDGFunctions = [
					"felo-search",
					"fetch-url",
					"url-metadata",
				];
				let disabledFunctionsCount = 0;

				if (allowedMCPFunctions) {
					// Use pre-filtered list from centralized filtering (preferred path)
					const mcpTools = mcpManager.getMCPTools();
					const allowedFunctionSet = new Set(allowedMCPFunctions);

					for (const mcpTool of mcpTools) {
						try {
							const geminiTool = await mcpTool.tool();
							if (geminiTool.functionDeclarations) {
								// Filter declarations to only include allowed functions and exclude disabled DDG functions
								const declarations = (
									geminiTool.functionDeclarations as Record<string, unknown>[]
								).filter((declaration) => {
									const functionName = declaration.name as string;

									// Exclude disabled DuckDuckGo functions
									if (disabledDDGFunctions.includes(functionName)) {
										disabledFunctionsCount++;
										return false;
									}

									return allowedFunctionSet.has(functionName);
								});

								if (declarations.length > 0) {
									// Wrap each MCP function in OpenAI tool format
									for (const declaration of declarations) {
										// Convert MCP schema format to OpenAI format
										// MCP uses "parametersJsonSchema", OpenAI uses "parameters"
										const openAIDeclaration: Record<string, unknown> = {
											...declaration,
										};
										if ("parametersJsonSchema" in declaration) {
											delete openAIDeclaration.parametersJsonSchema;
											openAIDeclaration.parameters =
												declaration.parametersJsonSchema;
										}

										allTools.push({
											type: "function",
											function: openAIDeclaration,
										});
									}
									addedMCPToolsCount++;
								}
							}
						} catch (error) {
							log.warn(
								"Failed to extract functions from MCP tool:",
								error as Error,
							);
						}
					}

					log.info(
						`Added ${addedMCPToolsCount} MCP tools using centralized filtering (${allowedMCPFunctions.length} functions allowed)`,
					);
					if (disabledFunctionsCount > 0) {
						log.info(
							`Excluded ${disabledFunctionsCount} disabled DuckDuckGo functions (${disabledDDGFunctions.join(", ")})`,
						);
					}
				}
			}

			log.info(`Total tools for OpenRouter: ${allTools.length}`);
			return allTools;
		} catch (error) {
			log.error(
				`Failed to get all tools in OpenRouter format (${builtInTools.length} built-in tools)`,
				error as Error,
			);
			return [];
		}
	}

	/**
	 * Check if a function name belongs to an MCP server
	 * @param functionName - The function name to check
	 * @returns Promise<boolean> - True if the function is from an MCP server
	 */
	async isMCPFunction(functionName: string): Promise<boolean> {
		try {
			const mcpManager = getMCPManager();
			if (!mcpManager.isReady()) {
				return false;
			}

			const mcpTools = mcpManager.getMCPTools();
			for (const mcpTool of mcpTools) {
				const geminiTool = await mcpTool.tool();
				if (geminiTool.functionDeclarations) {
					const hasFunction = (
						geminiTool.functionDeclarations as Record<string, unknown>[]
					).some((declaration) => declaration.name === functionName);
					if (hasFunction) {
						return true;
					}
				}
			}

			return false;
		} catch (error) {
			log.warn(`Error checking if function ${functionName} is MCP function:`, {
				error: error as Error,
			});
			return false;
		}
	}

	/**
	 * Execute an MCP function and return the result
	 * @param functionName - The MCP function to execute
	 * @param args - Function arguments
	 * @param context - Optional tool context for additional information
	 * @returns Promise<TypedMCPToolResult> - Typed MCP tool execution result
	 */
	async executeMCPFunction(
		functionName: string,
		args: Record<string, unknown>,
		context?: ToolContext,
	): Promise<TypedMCPToolResult> {
		try {
			log.info(
				`Executing MCP function: ${functionName} with args: ${JSON.stringify(args)}`,
			);

			const executor = getMCPExecutor();
			const result = await executor.executeMCPFunction(
				functionName,
				args,
				context,
			);

			log.info(
				`MCP function ${functionName} completed successfully (imagesSent: ${result.data?.imagesSent || 0})`,
			);

			return result;
		} catch (error) {
			log.error(
				`Failed to execute MCP function ${functionName}`,
				error as Error,
			);

			// Return typed error result matching TypedMCPToolResult structure
			return {
				success: false,
				message: `Failed to execute MCP function: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	/**
	 * Validate that a tool is compatible with this provider
	 * @param tool - The tool to validate
	 * @returns boolean - True if compatible
	 */
	validateToolCompatibility(tool: Tool): boolean {
		try {
			// Basic validation: check required fields
			if (!tool.name || !tool.description || !tool.parameters) {
				log.warn(
					`Tool validation failed: missing required fields (name: ${!!tool.name}, description: ${!!tool.description}, parameters: ${!!tool.parameters})`,
				);
				return false;
			}

			// Validate parameter types are supported
			for (const [paramName, paramSchema] of Object.entries(
				tool.parameters.properties,
			)) {
				const paramType = paramSchema.type as string;
				if (
					!["string", "number", "boolean", "array", "object"].includes(
						paramType,
					)
				) {
					log.warn(
						`Tool '${tool.name}' has unsupported parameter type: ${paramType} (param: ${paramName})`,
					);
					return false;
				}

				// Validate array items if present
				if (paramType === "array" && paramSchema.items) {
					const itemType = paramSchema.items.type as string;
					if (!["string", "number", "boolean", "object"].includes(itemType)) {
						log.warn(
							`Tool '${tool.name}' has unsupported array item type: ${itemType} (param: ${paramName})`,
						);
						return false;
					}
				}
			}

			return true;
		} catch (error) {
			log.error(`Tool validation error for '${tool.name}'`, error as Error);
			return false;
		}
	}

	/**
	 * Convert generic parameter type to OpenAI type
	 */
	private convertParameterType(
		genericType: "string" | "number" | "boolean" | "array" | "object",
	): "string" | "number" | "boolean" | "array" | "object" {
		// OpenAI uses the same type strings, so direct mapping
		return genericType;
	}

	/**
	 * Extract relevant data from a complex object for result text
	 */
	private extractRelevantData(data: Record<string, unknown>): string | null {
		try {
			// Try to extract meaningful data
			const keys = Object.keys(data);
			if (keys.length === 0) {
				return null;
			}

			// Limit to first few keys to avoid overwhelming the model
			const relevantKeys = keys.slice(0, 5);
			const relevantData: Record<string, unknown> = {};
			for (const key of relevantKeys) {
				relevantData[key] = data[key];
			}

			return JSON.stringify(relevantData, null, 2);
		} catch (error) {
			log.warn("Failed to extract relevant data from tool result", {
				error: error as Error,
			});
			return null;
		}
	}
}

/**
 * Singleton accessor for the OpenRouter tool adapter
 */
export function getOpenrouterToolAdapter(): OpenrouterToolAdapter {
	return OpenrouterToolAdapter.getInstance();
}

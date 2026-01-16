/**
 * Custom Provider Tool Adapter
 *
 * Converts generic tools to OpenAI-compatible function format.
 * This adapter is nearly identical to the OpenRouter adapter since both use
 * the OpenAI function calling specification.
 *
 * The main difference is the provider name and logging context.
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
 * OpenAI-compatible function declaration format
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
 * Custom provider tool adapter implementation with MCP capabilities
 */
export class CustomToolAdapter implements MCPCapableToolAdapter {
	private static instance: CustomToolAdapter;

	/**
	 * Get singleton instance
	 */
	static getInstance(): CustomToolAdapter {
		if (!CustomToolAdapter.instance) {
			CustomToolAdapter.instance = new CustomToolAdapter();
		}
		return CustomToolAdapter.instance;
	}

	/**
	 * Get the provider name this adapter supports
	 * @returns Provider identifier
	 */
	getProviderName(): string {
		return "custom";
	}

	/**
	 * Convert a generic tool to OpenAI function declaration format
	 * @param tool - The generic tool to convert
	 * @returns OpenAI-compatible function declaration
	 */
	convertTool(tool: Tool): Record<string, unknown> {
		try {
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

				if (paramSchema.enum) {
					openaiProperties[paramName].enum = paramSchema.enum;
				}

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
				`Custom adapter: Converted tool '${tool.name}' to OpenAI format`,
			);

			return openaiFunction;
		} catch (error) {
			log.error(
				`Custom adapter: Failed to convert tool '${tool.name}'`,
				error as Error,
			);
			throw error;
		}
	}

	/**
	 * Convert tool result back to OpenAI-specific format
	 * @param result - The generic tool result
	 * @returns OpenAI-specific result format
	 */
	convertResult(result: ToolResult): Record<string, unknown> {
		try {
			if (result.success) {
				let resultText = result.message || "Tool executed successfully";

				if (result.data && typeof result.data === "object") {
					const data = result.data as Record<string, unknown>;

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

			const errorText =
				result.message || result.error || "Tool execution failed";

			return {
				content: `Error: ${errorText}`,
			};
		} catch (error) {
			log.error(
				"Custom adapter: Failed to convert tool result",
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
			return tools.map((tool) => ({
				type: "function",
				function: this.convertTool(tool),
			}));
		} catch (error) {
			log.error(
				"Custom adapter: Failed to convert tools array",
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
		return this.getAllToolsInOpenAIFormat(
			builtInTools,
			serverId,
			allowedMCPFunctions,
		);
	}

	/**
	 * Get all available tools (built-in + MCP) in OpenAI tools format
	 * @param builtInTools - Array of built-in tools
	 * @param serverId - Optional Discord server ID for server-specific tool selection
	 * @param allowedMCPFunctions - Optional pre-filtered list of MCP function names to include
	 * @returns Combined OpenAI tools configuration
	 */
	async getAllToolsInOpenAIFormat(
		builtInTools: Tool[],
		serverId?: number,
		allowedMCPFunctions?: string[],
	): Promise<Array<Record<string, unknown>>> {
		try {
			const allTools: Record<string, unknown>[] = [];

			// Check if Brave Search is available
			const hasBraveApiKey = await isBraveSearchAvailable(serverId);
			log.info(
				`Custom adapter: Brave Search ${hasBraveApiKey ? "available" : "not available"} for server ${serverId || "global"}`,
			);

			const braveSearchToolNames = [
				"brave_web_search",
				"brave_image_search",
				"brave_video_search",
				"brave_news_search",
			];

			// Filter built-in tools based on Brave API key availability
			let filteredBuiltInTools = builtInTools;
			if (!hasBraveApiKey) {
				filteredBuiltInTools = builtInTools.filter(
					(tool) => !braveSearchToolNames.includes(tool.name),
				);
				const excludedCount = builtInTools.length - filteredBuiltInTools.length;
				if (excludedCount > 0) {
					log.info(
						`Custom adapter: Excluded ${excludedCount} Brave search tools (no API key)`,
					);
				}
			}

			// Convert filtered built-in tools
			if (filteredBuiltInTools.length > 0) {
				const builtInToolsFormatted =
					this.convertToolsArray(filteredBuiltInTools);
				allTools.push(...builtInToolsFormatted);
				log.info(
					`Custom adapter: Converted ${filteredBuiltInTools.length} built-in tools`,
				);
			}

			// Add MCP tools if available
			const mcpManager = getMCPManager();
			if (mcpManager.isReady() && allowedMCPFunctions) {
				let addedMCPToolsCount = 0;

				const disabledDDGFunctions = [
					"felo-search",
					"fetch-url",
					"url-metadata",
				];

				const mcpTools = mcpManager.getMCPTools();
				const allowedFunctionSet = new Set(allowedMCPFunctions);

				for (const mcpTool of mcpTools) {
					try {
						const geminiTool = await mcpTool.tool();
						if (geminiTool.functionDeclarations) {
							const declarations = (
								geminiTool.functionDeclarations as Record<string, unknown>[]
							).filter((declaration) => {
								const functionName = declaration.name as string;

								if (disabledDDGFunctions.includes(functionName)) {
									return false;
								}

								return allowedFunctionSet.has(functionName);
							});

							if (declarations.length > 0) {
								for (const declaration of declarations) {
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
							"Custom adapter: Failed to extract functions from MCP tool:",
							error as Error,
						);
					}
				}

				log.info(
					`Custom adapter: Added ${addedMCPToolsCount} MCP tools using centralized filtering`,
				);
			}

			log.info(`Custom adapter: Total tools: ${allTools.length}`);
			return allTools;
		} catch (error) {
			log.error(
				"Custom adapter: Failed to get all tools in OpenAI format",
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
			log.warn(
				`Custom adapter: Error checking if function ${functionName} is MCP function`,
				{
					error: error as Error,
				},
			);
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
				`Custom adapter: Executing MCP function: ${functionName} with args: ${JSON.stringify(args)}`,
			);

			const executor = getMCPExecutor();
			const result = await executor.executeMCPFunction(
				functionName,
				args,
				context,
			);

			log.info(
				`Custom adapter: MCP function ${functionName} completed successfully`,
			);

			return result;
		} catch (error) {
			log.error(
				`Custom adapter: Failed to execute MCP function ${functionName}`,
				error as Error,
			);

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
			if (!tool.name || !tool.description || !tool.parameters) {
				log.warn(
					"Custom adapter: Tool validation failed: missing required fields",
				);
				return false;
			}

			for (const [_paramName, paramSchema] of Object.entries(
				tool.parameters.properties,
			)) {
				const paramType = paramSchema.type as string;
				if (
					!["string", "number", "boolean", "array", "object"].includes(
						paramType,
					)
				) {
					log.warn(
						`Custom adapter: Tool '${tool.name}' has unsupported parameter type: ${paramType}`,
					);
					return false;
				}

				if (paramType === "array" && paramSchema.items) {
					const itemType = paramSchema.items.type as string;
					if (!["string", "number", "boolean", "object"].includes(itemType)) {
						log.warn(
							`Custom adapter: Tool '${tool.name}' has unsupported array item type: ${itemType}`,
						);
						return false;
					}
				}
			}

			return true;
		} catch (error) {
			log.error(
				`Custom adapter: Tool validation error for '${tool.name}'`,
				error as Error,
			);
			return false;
		}
	}

	/**
	 * Convert generic parameter type to OpenAI type
	 */
	private convertParameterType(
		genericType: "string" | "number" | "boolean" | "array" | "object",
	): "string" | "number" | "boolean" | "array" | "object" {
		return genericType;
	}

	/**
	 * Extract relevant data from a complex object for result text
	 */
	private extractRelevantData(data: Record<string, unknown>): string | null {
		try {
			const keys = Object.keys(data);
			if (keys.length === 0) {
				return null;
			}

			const relevantKeys = keys.slice(0, 5);
			const relevantData: Record<string, unknown> = {};
			for (const key of relevantKeys) {
				relevantData[key] = data[key];
			}

			return JSON.stringify(relevantData, null, 2);
		} catch (error) {
			log.warn("Custom adapter: Failed to extract relevant data", {
				error: error as Error,
			});
			return null;
		}
	}
}

/**
 * Singleton accessor for the Custom tool adapter
 */
export function getCustomToolAdapter(): CustomToolAdapter {
	return CustomToolAdapter.getInstance();
}

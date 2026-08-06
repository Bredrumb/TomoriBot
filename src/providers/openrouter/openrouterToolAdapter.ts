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
  ToolParameterPropertySchema,
  ToolParameterType,
} from "../../types/tool/interfaces";
import type { TypedMCPToolResult } from "../../types/tool/mcpTypes";
import { getMCPManager } from "../../utils/mcp/mcpManager";
import { getMCPExecutor } from "../../utils/mcp/mcpExecutor";
import { getGuildMcpManager } from "../../utils/mcp/guildMcpManager";

/**
 * OpenAI-compatible function declaration format (used by OpenRouter)
 */
interface OpenAIFunctionDeclaration extends Record<string, unknown> {
  name: string;
  description: string;
  parameters: OpenAIObjectSchema;
}

interface OpenAIParameterSchema extends Record<string, unknown> {
  type: ToolParameterType;
  description?: string;
  enum?: string[];
  items?: OpenAIParameterSchema;
  properties?: Record<string, OpenAIParameterSchema>;
  required?: string[];
}

interface OpenAIObjectSchema extends OpenAIParameterSchema {
  type: "object";
  properties: Record<string, OpenAIParameterSchema>;
  required: string[];
}

/**
 * OpenRouter tool adapter implementation with MCP capabilities
 */
export class OpenrouterToolAdapter implements MCPCapableToolAdapter {
  private static instance: OpenrouterToolAdapter;

  static getInstance(): OpenrouterToolAdapter {
    if (!OpenrouterToolAdapter.instance) {
      OpenrouterToolAdapter.instance = new OpenrouterToolAdapter();
    }
    return OpenrouterToolAdapter.instance;
  }

  getProviderName(): string {
    return "openrouter";
  }

  /**
   * Convert a generic tool to OpenAI function declaration format
   */
  convertTool(tool: Tool): Record<string, unknown> {
    try {
      const openaiFunction: OpenAIFunctionDeclaration = {
        name: tool.name,
        description: tool.description,
        parameters: this.cloneParameterSchema(tool.parameters),
      };

      log.info(
        `Converted tool '${tool.name}' (${tool.category}) to OpenAI format with ${Object.keys(tool.parameters.properties).length} parameters`,
      );

      return openaiFunction;
    } catch (error) {
      log.error(`Failed to convert tool '${tool.name}' (${tool.category}) to OpenAI format`, error as Error);
      throw error;
    }
  }

  /**
   * Convert tool result back to OpenAI-specific format
   * @returns OpenAI-specific result format (text content)
   */
  convertResult(result: ToolResult): Record<string, unknown> {
    try {
      // OpenAI expects text content in tool responses
      if (result.success) {
        let resultText = result.message || "Tool executed successfully";

        if (result.data && typeof result.data === "object") {
          const data = result.data as Record<string, unknown>;

          if (data.summary && typeof data.summary === "string") {
            resultText = data.summary;
          } else if (data.message && typeof data.message === "string") {
            resultText = data.message;
          } else if (data.selectionReason && typeof data.selectionReason === "string") {
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

      const errorText = result.message || result.error || "Tool execution failed";

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
        `Failed to convert tools array to OpenAI format (${tools.length} tools: ${tools.map((t) => t.name).join(", ")})`,
        error as Error,
      );
      return [];
    }
  }

  /**
   * Get all available tools (built-in + MCP) in provider-specific format
   * Implementation of MCPCapableToolAdapter interface
   * @param serverId - Optional Discord server ID for server-specific tool selection
   * @param allowedMCPFunctions - Optional pre-filtered list of MCP function names to include
   */
  async getAllToolsInProviderFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    return this.getAllToolsInOpenrouterFormat(builtInTools, serverId, allowedMCPFunctions);
  }

  /**
   * Get all available tools (built-in + MCP) in OpenRouter (OpenAI) tools format
   * @param serverId - Optional Discord server ID for server-specific tool selection
   * @param allowedMCPFunctions - Optional pre-filtered list of MCP function names to include
   */
  async getAllToolsInOpenrouterFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const allTools: Record<string, unknown>[] = [];

      // Brave-key dance removed: unified web_search is gated centrally.
      if (builtInTools.length > 0) {
        const builtInToolsFormatted = this.convertToolsArray(builtInTools);
        allTools.push(...builtInToolsFormatted);
        log.info(`Converted ${builtInTools.length} built-in tools to OpenAI format`);
      }

      // Add MCP tools if available (using pre-filtered list or legacy filtering)
      const mcpManager = getMCPManager();
      if (mcpManager.isReady()) {
        let addedMCPToolsCount = 0;

        // Raw AI-search modes stay internal to the unified web_search dispatcher.
        const disabledDDGFunctions = ["iask-search", "monica-search"];
        let disabledFunctionsCount = 0;

        if (allowedMCPFunctions) {
          const mcpTools = mcpManager.getMCPTools();
          const allowedFunctionSet = new Set(allowedMCPFunctions);

          for (const mcpTool of mcpTools) {
            try {
              const geminiTool = await mcpTool.tool();
              if (geminiTool.functionDeclarations) {
                // Filter declarations to only include allowed functions and exclude disabled DDG functions
                const declarations = (geminiTool.functionDeclarations as Record<string, unknown>[]).filter(
                  (declaration) => {
                    const functionName = declaration.name as string;

                    if (disabledDDGFunctions.includes(functionName)) {
                      disabledFunctionsCount++;
                      return false;
                    }

                    return allowedFunctionSet.has(functionName);
                  },
                );

                if (declarations.length > 0) {
                  // Wrap each MCP function in OpenAI tool format
                  for (const declaration of declarations) {
                    // MCP uses "parametersJsonSchema", OpenAI uses "parameters"
                    const openAIDeclaration: Record<string, unknown> = {
                      ...declaration,
                    };
                    if ("parametersJsonSchema" in declaration) {
                      delete openAIDeclaration.parametersJsonSchema;
                      openAIDeclaration.parameters = declaration.parametersJsonSchema;
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
              log.warn("Failed to extract functions from MCP tool:", error as Error);
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

      // Add guild MCP tools (per-guild remote servers)
      if (serverId && allowedMCPFunctions) {
        try {
          const guildMcpManager = getGuildMcpManager();
          const guildTools = await guildMcpManager.getGuildMCPTools(serverId);
          const allowedFunctionSet = new Set(allowedMCPFunctions);

          for (const guildTool of guildTools) {
            try {
              const geminiTool = await guildTool.tool();
              if (geminiTool.functionDeclarations) {
                const declarations = (geminiTool.functionDeclarations as Record<string, unknown>[]).filter((decl) =>
                  allowedFunctionSet.has(decl.name as string),
                );

                for (const declaration of declarations) {
                  const openAIDeclaration: Record<string, unknown> = {
                    ...declaration,
                  };
                  if ("parametersJsonSchema" in declaration) {
                    delete openAIDeclaration.parametersJsonSchema;
                    openAIDeclaration.parameters = declaration.parametersJsonSchema;
                  }

                  allTools.push({
                    type: "function",
                    function: openAIDeclaration,
                  });
                }

                log.info(`Added ${declarations.length} guild MCP tool(s) to OpenRouter format`);
              }
            } catch (error) {
              log.warn("Failed to extract guild MCP tool declarations:", error as Error);
            }
          }
        } catch (error) {
          log.warn("Failed to get guild MCP tools for OpenRouter format:", error as Error);
        }
      }

      log.info(`Total tools for OpenRouter: ${allTools.length}`);
      return allTools;
    } catch (error) {
      log.error(`Failed to get all tools in OpenRouter format (${builtInTools.length} built-in tools)`, error as Error);
      return [];
    }
  }

  /**
   * Check if a function name belongs to an MCP server
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
          const hasFunction = (geminiTool.functionDeclarations as Record<string, unknown>[]).some(
            (declaration) => declaration.name === functionName,
          );
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
   * @param context - Optional tool context for additional information
   */
  async executeMCPFunction(
    functionName: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<TypedMCPToolResult> {
    try {
      log.info(`Executing MCP function: ${functionName} with args: ${JSON.stringify(args)}`);

      const executor = getMCPExecutor();
      const result = await executor.executeMCPFunction(functionName, args, context);

      log.info(`MCP function ${functionName} completed successfully (imagesSent: ${result.data?.imagesSent || 0})`);

      return result;
    } catch (error) {
      log.error(`Failed to execute MCP function ${functionName}`, error as Error);

      return {
        success: false,
        message: `Failed to execute MCP function: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate that a tool is compatible with this provider
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

      for (const [paramName, paramSchema] of Object.entries(tool.parameters.properties)) {
        if (!this.isSupportedParameterSchema(paramSchema)) {
          log.warn(`Tool '${tool.name}' has unsupported parameter schema (param: ${paramName})`);
          return false;
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
  private cloneParameterSchema(schema: Tool["parameters"]): OpenAIObjectSchema {
    return JSON.parse(JSON.stringify(schema)) as OpenAIObjectSchema;
  }

  private isSupportedParameterSchema(schema: ToolParameterPropertySchema): boolean {
    const supportedTypes: ToolParameterType[] = ["string", "number", "boolean", "array", "object"];

    if (!supportedTypes.includes(schema.type)) {
      return false;
    }

    if (schema.type === "array") {
      return this.isSupportedParameterSchema(schema.items);
    }

    if (schema.type === "object") {
      return Object.values(schema.properties).every((propertySchema) =>
        this.isSupportedParameterSchema(propertySchema),
      );
    }

    return true;
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

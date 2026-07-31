/**
 * Google Tool Adapter
 * Converts generic tools to Google's function declaration format and back
 */

import { Type } from "@google/genai";
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
 * Google-specific function declaration format
 */
interface GoogleFunctionDeclaration extends Record<string, unknown> {
  name: string;
  description: string;
  parameters: GoogleObjectSchema;
}

type GoogleTypeValue =
  | typeof Type.STRING
  | typeof Type.NUMBER
  | typeof Type.BOOLEAN
  | typeof Type.ARRAY
  | typeof Type.OBJECT;

interface GoogleParameterSchema extends Record<string, unknown> {
  type: GoogleTypeValue;
  description?: string;
  enum?: string[];
  items?: GoogleParameterSchema;
  properties?: Record<string, GoogleParameterSchema>;
  required?: string[];
}

interface GoogleObjectSchema extends GoogleParameterSchema {
  type: typeof Type.OBJECT;
  properties: Record<string, GoogleParameterSchema>;
  required: string[];
}

/**
 * Google tool adapter implementation with MCP capabilities
 */
export class GoogleToolAdapter implements MCPCapableToolAdapter {
  private static instance: GoogleToolAdapter;

  /**
   * Get singleton instance
   */
  static getInstance(): GoogleToolAdapter {
    if (!GoogleToolAdapter.instance) {
      GoogleToolAdapter.instance = new GoogleToolAdapter();
    }
    return GoogleToolAdapter.instance;
  }

  /**
   * Get the provider name this adapter supports
   */
  getProviderName(): string {
    return "google";
  }

  /**
   * Convert a generic tool to Google's function declaration format
   * @param tool - The generic tool to convert
   */
  convertTool(tool: Tool): Record<string, unknown> {
    try {
      const googleFunction: GoogleFunctionDeclaration = {
        name: tool.name,
        description: tool.description,
        parameters: this.convertObjectSchema(tool.parameters),
      };

      log.info(
        `Converted tool '${tool.name}' (${tool.category}) to Google format with ${Object.keys(tool.parameters.properties).length} parameters`,
      );

      return googleFunction;
    } catch (error) {
      log.error(`Failed to convert tool '${tool.name}' (${tool.category}) to Google format`, error as Error);
      throw error;
    }
  }

  /**
   * Convert tool result back to Google-specific format
   * This is used when the tool execution result needs to be fed back to Gemini
   * @param result - The generic tool result
   */
  convertResult(result: ToolResult): Record<string, unknown> {
    try {
      // Google expects a Part object with text content
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
          text: resultText,
        };
      }

      const errorText = result.message || result.error || "Tool execution failed";

      return {
        text: `Error: ${errorText}`,
      };
    } catch (error) {
      log.error(
        `Failed to convert tool result to Google format (success: ${result.success}, hasData: ${!!result.data})`,
        error as Error,
      );

      return {
        text: "Error: Failed to process tool result",
      };
    }
  }

  /**
   * Convert multiple tools to Google's tools array format
   */
  convertToolsArray(tools: Tool[]): Array<Record<string, unknown>> {
    if (tools.length === 0) {
      return [];
    }

    try {
      const functionDeclarations = tools.map((tool) => this.convertTool(tool));

      // Google expects tools in this specific format
      return [
        {
          functionDeclarations: functionDeclarations,
        },
      ];
    } catch (error) {
      log.error(
        `Failed to convert tools array to Google format (${tools.length} tools: ${tools.map((t) => t.name).join(", ")})`,
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
    return this.getAllToolsInGoogleFormat(builtInTools, serverId, allowedMCPFunctions);
  }

  /**
   * Get all available tools (built-in + MCP) in Google tools format
   * This provides a unified interface for the provider to get all tools
   * @param serverId - Optional Discord server ID for server-specific tool selection
   * @param allowedMCPFunctions - Optional pre-filtered list of MCP function names to include
   * @returns Combined Google tools configuration with conditional search tool filtering
   */
  async getAllToolsInGoogleFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const allFunctionDeclarations: Record<string, unknown>[] = [];

      // Brave-key dance removed: the unified `web_search` tool is gated centrally
      // in `availability.ts` via `requiresFeatureFlag = "web_search"`, and the
      // engine chain inside the tool decides Brave-vs-DDG-vs-Felo at call time.
      if (builtInTools.length > 0) {
        const builtInDeclarations = builtInTools.map((tool) => this.convertTool(tool));
        allFunctionDeclarations.push(...builtInDeclarations);
        log.info(`Converted ${builtInTools.length} built-in tools to Google format`);
      }

      const mcpManager = getMCPManager();
      if (mcpManager.isReady()) {
        let addedMCPToolsCount = 0;
        let excludedDDGFunctionsCount = 0;

        // Disabled DuckDuckGo functions (always filtered out)
        // felo-search: Streaming not compatible with Discord
        // iask-search / monica-search: unsupported or low-quality search modes
        // fetch-url: Use dedicated Fetch MCP server instead
        // url-metadata: Redundant with Fetch MCP server
        const disabledDDGFunctions = ["felo-search", "iask-search", "monica-search", "fetch-url", "url-metadata"];
        let disabledFunctionsCount = 0;

        if (allowedMCPFunctions) {
          // Use pre-filtered list from centralized filtering (preferred path)
          const mcpTools = mcpManager.getMCPTools();
          const allowedFunctionSet = new Set(allowedMCPFunctions);

          for (const mcpTool of mcpTools) {
            try {
              const geminiTool = await mcpTool.tool();
              if (geminiTool.functionDeclarations) {
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
                  allFunctionDeclarations.push(...declarations);
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
        } else {
          // Legacy path with Brave API key filtering (for backward compatibility)
          const mcpTools = mcpManager.getMCPTools();

          const duckduckgoSearchFunctions = ["web-search", "iask-search", "monica-search", "url-metadata"];

          for (const mcpTool of mcpTools) {
            try {
              const geminiTool = await mcpTool.tool();
              if (geminiTool.functionDeclarations) {
                // Cast FunctionDeclaration to Record<string, unknown> for type compatibility
                let declarations = geminiTool.functionDeclarations as Record<string, unknown>[];

                const originalCount = declarations.length;
                declarations = declarations.filter((declaration: Record<string, unknown>) => {
                  const functionName = declaration.name as string;

                  if (disabledDDGFunctions.includes(functionName)) {
                    disabledFunctionsCount++;
                    return false;
                  }

                  // Post-refactor: DDG/Felo MCP function names are unconditionally
                  // hidden in `availability.ts` and consumed only via the unified
                  // `web_search` tool. The legacy Brave-key gate here is a no-op now.
                  if (duckduckgoSearchFunctions.includes(functionName)) {
                    return false;
                  }

                  return true;
                });

                excludedDDGFunctionsCount += originalCount - declarations.length - disabledFunctionsCount;

                if (declarations.length > 0) {
                  allFunctionDeclarations.push(...declarations);
                  addedMCPToolsCount++;
                }
              }
            } catch (error) {
              log.warn("Failed to extract functions from MCP tool:", error as Error);
            }
          }

          if (addedMCPToolsCount > 0) {
            log.info(`Added ${addedMCPToolsCount} MCP tools to Google format`);
          }
          if (disabledFunctionsCount > 0) {
            log.info(
              `Excluded ${disabledFunctionsCount} disabled DuckDuckGo functions (${disabledDDGFunctions.join(", ")})`,
            );
          }
          if (excludedDDGFunctionsCount > 0) {
            log.info(`Excluded ${excludedDDGFunctionsCount} DuckDuckGo search functions (Brave API key available)`);
          }
        }
      }

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

                if (declarations.length > 0) {
                  allFunctionDeclarations.push(...declarations);
                  log.info(`Added ${declarations.length} guild MCP tool declaration(s) to Google format`);
                }
              }
            } catch (error) {
              log.warn("Failed to extract guild MCP tool declarations:", error as Error);
            }
          }
        } catch (error) {
          log.warn("Failed to get guild MCP tools for Google format:", error as Error);
        }
      }

      if (allFunctionDeclarations.length === 0) {
        return [];
      }

      return [
        {
          functionDeclarations: allFunctionDeclarations,
        },
      ];
    } catch (error) {
      log.error("Failed to get all tools in Google format:", error as Error);
      return this.convertToolsArray(builtInTools);
    }
  }

  /**
   * Check if a function name belongs to an MCP tool (global or guild)
   * Delegates to the provider-agnostic MCP executor for global,
   * and checks guild MCP manager for per-guild tools
   */
  async isMCPFunction(functionName: string): Promise<boolean> {
    const mcpExecutor = getMCPExecutor();
    return mcpExecutor.isMCPFunction(functionName);
    // Note: Guild MCP is checked separately in toolRegistry.executeTool()
    // because isMCPFunction here doesn't have serverId context
  }

  /**
   * Execute an MCP tool function
   * Delegates to the provider-agnostic MCP executor for all processing
   */
  async executeMCPFunction(
    functionName: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<TypedMCPToolResult> {
    const mcpExecutor = getMCPExecutor();
    return mcpExecutor.executeMCPFunction(functionName, args, context);
  }

  /**
   * Convert generic parameter type to Google Type enum
   */
  private convertParameterType(genericType: ToolParameterType): GoogleTypeValue {
    switch (genericType) {
      case "string":
        return Type.STRING;
      case "number":
        return Type.NUMBER;
      case "boolean":
        return Type.BOOLEAN;
      case "array":
        return Type.ARRAY;
      case "object":
        return Type.OBJECT;
      default:
        log.warn(`Unknown parameter type: ${genericType}, defaulting to STRING`);
        return Type.STRING;
    }
  }

  private convertParameterSchema(schema: ToolParameterPropertySchema): GoogleParameterSchema {
    const convertedSchema: GoogleParameterSchema = {
      type: this.convertParameterType(schema.type),
    };

    if (schema.description) {
      convertedSchema.description = schema.description;
    }

    if (schema.enum) {
      convertedSchema.enum = [...schema.enum];
    }

    if (schema.type === "array") {
      convertedSchema.items = this.convertParameterSchema(schema.items);
    }

    if (schema.type === "object") {
      convertedSchema.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([key, nestedSchema]) => [
          key,
          this.convertParameterSchema(nestedSchema),
        ]),
      );

      if (schema.required?.length) {
        convertedSchema.required = [...schema.required];
      }
    }

    return convertedSchema;
  }

  private convertObjectSchema(schema: Tool["parameters"]): GoogleObjectSchema {
    const convertedSchema = this.convertParameterSchema(schema);
    return {
      ...convertedSchema,
      type: Type.OBJECT,
      properties: convertedSchema.properties ?? {},
      required: [...schema.required],
    };
  }

  /**
   * Extract relevant data from tool result for Google response
   */
  private extractRelevantData(data: Record<string, unknown>): string | null {
    try {
      const relevantFields = ["summary", "preview", "selectionReason", "query", "resultLength"];
      const extractedData: Record<string, unknown> = {};

      for (const field of relevantFields) {
        if (data[field] !== undefined && data[field] !== null) {
          extractedData[field] = data[field];
        }
      }

      if (Object.keys(extractedData).length === 0) {
        return null;
      }

      const entries = Object.entries(extractedData)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(", ");

      return entries.length > 200 ? `${entries.substring(0, 200)}...` : entries;
    } catch (error) {
      log.warn("Failed to extract relevant data from tool result", error as Error);
      return null;
    }
  }

  /**
   * Validate that a tool can be converted to Google format
   */
  validateToolCompatibility(tool: Tool): boolean {
    try {
      if (!tool.name || !tool.description || !tool.parameters) {
        return false;
      }

      if (!tool.parameters.properties || !Array.isArray(tool.parameters.required)) {
        return false;
      }

      for (const paramSchema of Object.values(tool.parameters.properties)) {
        if (!this.isSupportedParameterSchema(paramSchema)) return false;
      }

      return true;
    } catch (error) {
      log.warn(`Tool compatibility validation failed for '${tool.name}'`, error as Error);
      return false;
    }
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
}

export function getGoogleToolAdapter(): GoogleToolAdapter {
  return GoogleToolAdapter.getInstance();
}

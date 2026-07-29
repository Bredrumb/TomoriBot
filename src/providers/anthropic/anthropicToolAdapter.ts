/**
 * Anthropic tool adapter for converting TomoriBot's generic tool definitions
 * to Anthropic's tool-use format and handling MCP tool integration.
 *
 * Key difference from OpenAI-compatible format:
 * - Anthropic uses {name, description, input_schema} instead of
 *   {type: "function", function: {name, description, parameters}}
 * - Tool results are sent as {type: "tool_result", tool_use_id, content}
 *   wrapped inside a user message, not as a separate role
 */

import type { MCPCapableToolAdapter, Tool, ToolContext, ToolResult } from "@/types/tool/interfaces";
import type { TypedMCPToolResult } from "@/types/tool/mcpTypes";
import { getGuildMcpManager } from "@/utils/mcp/guildMcpManager";
import { getMCPExecutor } from "@/utils/mcp/mcpExecutor";
import { getMCPManager } from "@/utils/mcp/mcpManager";
import { log } from "@/utils/misc/logger";

export class AnthropicToolAdapter implements MCPCapableToolAdapter {
  private static instance: AnthropicToolAdapter;

  private constructor() {}

  static getInstance(): AnthropicToolAdapter {
    if (!AnthropicToolAdapter.instance) {
      AnthropicToolAdapter.instance = new AnthropicToolAdapter();
    }
    return AnthropicToolAdapter.instance;
  }

  getProviderName(): string {
    return "anthropic";
  }

  /**
   * Convert a single tool to Anthropic's tool definition format.
   * Anthropic uses `input_schema` instead of `parameters` and has no
   * `type: "function"` wrapper.
   */
  convertTool(tool: Tool): Record<string, unknown> {
    try {
      const anthropicTool: Record<string, unknown> = {
        name: tool.name,
        description: tool.description,
        input_schema: JSON.parse(JSON.stringify(tool.parameters)),
      };

      log.info(`Anthropic adapter: Converted tool '${tool.name}' to Anthropic format`);
      return anthropicTool;
    } catch (error) {
      log.error(`Anthropic adapter: Failed to convert tool '${tool.name}'`, error as Error);
      throw error;
    }
  }

  /**
   * Convert tool result to Anthropic's tool_result content block format.
   * Note: The caller must wrap this in a user message with the appropriate
   * tool_use_id.
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
          type: "tool_result",
          content: resultText,
        };
      }

      const errorText = result.message || result.error || "Tool execution failed";

      return {
        type: "tool_result",
        content: `Error: ${errorText}`,
        is_error: true,
      };
    } catch (error) {
      log.error("Anthropic adapter: Failed to convert tool result", error as Error);

      return {
        type: "tool_result",
        content: "Error: Failed to process tool result",
        is_error: true,
      };
    }
  }

  /**
   * Convert an array of tools to Anthropic format (flat array, no wrapper)
   */
  convertToolsArray(tools: Tool[]): Array<Record<string, unknown>> {
    if (tools.length === 0) {
      return [];
    }

    try {
      return tools.map((tool) => this.convertTool(tool));
    } catch (error) {
      log.error("Anthropic adapter: Failed to convert tools array", error as Error);
      return [];
    }
  }

  /**
   * Get all available tools (built-in + MCP + guild MCP) in Anthropic format.
   * Follows the same filtering pattern as OpenAICompatibleToolAdapter.
   */
  async getAllToolsInProviderFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    try {
      const allTools: Record<string, unknown>[] = [];

      // The unified `web_search` tool is gated centrally in `availability.ts`
      //    via its `requiresFeatureFlag = "web_search"`. No per-adapter Brave-key
      //    filtering needed here anymore — the dispatcher inside the tool itself
      //    decides which engine (Brave/DDG/Felo) serves the request at call time.
      if (builtInTools.length > 0) {
        allTools.push(...this.convertToolsArray(builtInTools));
        log.info(`Anthropic adapter: Converted ${builtInTools.length} built-in tools`);
      }

      const mcpManager = getMCPManager();
      if (mcpManager.isReady() && allowedMCPFunctions) {
        let addedMCPToolsCount = 0;
        const disabledDDGFunctions = ["felo-search", "iask-search", "monica-search", "fetch-url", "url-metadata"];
        const allowedFunctionSet = new Set(allowedMCPFunctions);

        for (const mcpTool of mcpManager.getMCPTools()) {
          try {
            const geminiTool = await mcpTool.tool();
            if (!geminiTool.functionDeclarations) {
              continue;
            }

            const declarations = (geminiTool.functionDeclarations as Record<string, unknown>[]).filter(
              (declaration) => {
                const functionName = declaration.name as string;
                if (disabledDDGFunctions.includes(functionName)) {
                  return false;
                }
                return allowedFunctionSet.has(functionName);
              },
            );

            if (declarations.length === 0) {
              continue;
            }

            for (const declaration of declarations) {
              const anthropicDeclaration: Record<string, unknown> = {
                name: declaration.name,
                description: declaration.description,
              };

              // MCP tools use `parametersJsonSchema`, rename to `input_schema`.
              // Anthropic requires `input_schema` on every tool — fall back to an
              // empty object schema if the declaration provides no parameters.
              if ("parametersJsonSchema" in declaration) {
                anthropicDeclaration.input_schema = declaration.parametersJsonSchema;
              } else if ("parameters" in declaration) {
                anthropicDeclaration.input_schema = declaration.parameters;
              } else {
                anthropicDeclaration.input_schema = { type: "object", properties: {} };
              }

              allTools.push(anthropicDeclaration);
            }
            addedMCPToolsCount++;
          } catch (error) {
            log.warn("Anthropic adapter: Failed to extract functions from MCP tool", error as Error);
          }
        }

        log.info(`Anthropic adapter: Added ${addedMCPToolsCount} MCP tools using centralized filtering`);
      }

      if (serverId && allowedMCPFunctions) {
        try {
          const guildMcpManager = getGuildMcpManager();
          const guildTools = await guildMcpManager.getGuildMCPTools(serverId);
          const allowedFunctionSet = new Set(allowedMCPFunctions);
          let addedGuildToolsCount = 0;

          for (const guildTool of guildTools) {
            try {
              const geminiTool = await guildTool.tool();
              if (!geminiTool.functionDeclarations) {
                continue;
              }

              const declarations = (geminiTool.functionDeclarations as Record<string, unknown>[]).filter((decl) =>
                allowedFunctionSet.has(decl.name as string),
              );

              for (const declaration of declarations) {
                const anthropicDeclaration: Record<string, unknown> = {
                  name: declaration.name,
                  description: declaration.description,
                };

                // Same fallback as global MCP: `input_schema` is required by Anthropic
                if ("parametersJsonSchema" in declaration) {
                  anthropicDeclaration.input_schema = declaration.parametersJsonSchema;
                } else if ("parameters" in declaration) {
                  anthropicDeclaration.input_schema = declaration.parameters;
                } else {
                  anthropicDeclaration.input_schema = { type: "object", properties: {} };
                }

                allTools.push(anthropicDeclaration);
                addedGuildToolsCount++;
              }
            } catch (error) {
              log.warn("Anthropic adapter: Failed to extract guild MCP tool declarations", error as Error);
            }
          }

          if (addedGuildToolsCount > 0) {
            log.info(`Anthropic adapter: Added ${addedGuildToolsCount} guild MCP tool(s)`);
          }
        } catch (error) {
          log.warn("Anthropic adapter: Failed to get guild MCP tools", error as Error);
        }
      }

      log.info(`Anthropic adapter: Total tools: ${allTools.length}`);
      return allTools;
    } catch (error) {
      log.error("Anthropic adapter: Failed to get all tools in Anthropic format", error as Error);
      return [];
    }
  }

  /**
   * Check if a function name belongs to an MCP tool (global or guild)
   */
  async isMCPFunction(functionName: string): Promise<boolean> {
    try {
      const mcpManager = getMCPManager();
      if (!mcpManager.isReady()) {
        return false;
      }

      for (const mcpTool of mcpManager.getMCPTools()) {
        const geminiTool = await mcpTool.tool();
        if (!geminiTool.functionDeclarations) {
          continue;
        }

        const hasFunction = (geminiTool.functionDeclarations as Record<string, unknown>[]).some(
          (declaration) => declaration.name === functionName,
        );
        if (hasFunction) {
          return true;
        }
      }

      return false;
    } catch (error) {
      log.warn(`Anthropic adapter: Error checking if function ${functionName} is MCP function`, {
        error: error as Error,
      });
      return false;
    }
  }

  /**
   * Execute an MCP function by name with the given arguments
   */
  async executeMCPFunction(
    functionName: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<TypedMCPToolResult> {
    try {
      log.info(`Anthropic adapter: Executing MCP function: ${functionName} with args: ${JSON.stringify(args)}`);

      const executor = getMCPExecutor();
      const result = await executor.executeMCPFunction(functionName, args, context);

      log.info(`Anthropic adapter: MCP function ${functionName} completed successfully`);
      return result;
    } catch (error) {
      log.error(`Anthropic adapter: Failed to execute MCP function ${functionName}`, error as Error);
      return {
        success: false,
        message: `Failed to execute MCP function: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate that a tool has the required fields for Anthropic format
   */
  validateToolCompatibility(tool: Tool): boolean {
    try {
      if (!tool.name || !tool.description || !tool.parameters) {
        log.warn("Anthropic adapter: Tool validation failed: missing required fields");
        return false;
      }
      return true;
    } catch (error) {
      log.error(`Anthropic adapter: Tool validation error for '${tool.name}'`, error as Error);
      return false;
    }
  }

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
      log.warn("Anthropic adapter: Failed to extract relevant data", { error: error as Error });
      return null;
    }
  }
}

export function getAnthropicToolAdapter(): AnthropicToolAdapter {
  return AnthropicToolAdapter.getInstance();
}

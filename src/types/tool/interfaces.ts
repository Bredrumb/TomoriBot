/**
 * Generic tool interface for provider-agnostic function calling
 * This abstracts tools away from specific LLM provider formats
 */

import type { LlmRow, TomoriState } from "../db/schema";
import type { StructuredContextItem } from "../misc/context";
import type {
  BaseGuildTextChannel,
  BaseGuildVoiceChannel,
  Client,
  Message,
  DMChannel,
  NewsChannel,
  TextChannel,
  AnyThreadChannel,
  Webhook,
} from "discord.js";
import type { MCPServerResponse, EnhancedMCPServerConfig, TypedMCPToolResult, MCPExecutionContext } from "./mcpTypes";
import type { FunctionResponseImageMetadata } from "../provider/interfaces";
import type { MessageIdMap } from "@/utils/text/messageIdMap";

/**
 * Tool parameter schema definition
 * Provider-agnostic parameter specification
 */
export type ToolParameterType = "string" | "number" | "boolean" | "array" | "object";

interface ToolParameterSchemaBase {
  type: ToolParameterType;
  description?: string;
  enum?: string[];
}

export interface ToolStringParameterSchema extends ToolParameterSchemaBase {
  type: "string";
}

export interface ToolNumberParameterSchema extends ToolParameterSchemaBase {
  type: "number";
}

export interface ToolBooleanParameterSchema extends ToolParameterSchemaBase {
  type: "boolean";
}

export interface ToolArrayParameterSchema extends ToolParameterSchemaBase {
  type: "array";
  items: ToolParameterPropertySchema;
}

export interface ToolObjectParameterSchema extends ToolParameterSchemaBase {
  type: "object";
  properties: Record<string, ToolParameterPropertySchema>;
  required?: string[];
}

export type ToolParameterPropertySchema =
  | ToolStringParameterSchema
  | ToolNumberParameterSchema
  | ToolBooleanParameterSchema
  | ToolArrayParameterSchema
  | ToolObjectParameterSchema;

export interface ToolParameterSchema extends ToolObjectParameterSchema {
  type: "object";
  properties: Record<string, ToolParameterPropertySchema>;
  required: string[];
}

/**
 * Streaming context for enhanced functionality during streaming
 */
export interface StreamingContext {
  disableYouTubeProcessing: boolean; // Flag to temporarily disable YouTube function during enhanced context restart
  disableProfilePictureProcessing?: boolean; // Flag to temporarily disable profile picture processing during enhanced context restart
  disableGifProcessing?: boolean; // Flag to temporarily disable GIF processing during enhanced context restart
  disableShortTermMemoryUpdate?: boolean; // Flag to prevent update_short_term_memory from being called more than once per turn
  disableCrossChannelMessage?: boolean; // Flag to prevent nested cross-channel dispatch during tool-driven cross-channel turns
  explicitLongTermMemoryIntent?: boolean; // Flag to suppress STM tool nudges when the current user message explicitly asks for persistent memory
  disableMessageMetadataContext?: boolean; // Flag to prevent reveal_message_metadata from being called more than once per turn
  disableRecentMessageReplyTool?: boolean; // Allow reactions but block tool-sent replies when the stream is already replying
  forceReason?: boolean; // Flag to indicate reasoning mode for enhanced AI responses
  isManuallyTriggered?: boolean; // Flag to indicate this stream was triggered by a manual command
  suppressUserErrors?: boolean; // Suppress user-facing error embeds during key-rotation retries
  forceModelFallback?: boolean; // Force suppress errors regardless of key availability (model fallback retries)
  rotationKeyRetriesUsed?: boolean; // True if one or more rotation-key retries were attempted
  disableAllTools?: boolean; // Flag to disable all tool calling (e.g., during user impersonation)
  deliberateToolAllowedNames?: string[]; // Optional per-turn allowlist when deliberate tool mode detects scoped intent
  disableReminderTool?: boolean; // Flag to prevent create_task from being called during a reminder-triggered turn
  outputPrefill?: string; // Optional prefill to output before streaming (hybrid prefix)
  outputPrefillState?: { sent: boolean }; // Tracks if prefill was already output (avoid duplicates on retry)
  replyNoticeState?: { attempted: boolean; sent: boolean }; // Tracks the standalone alter reply notice across tool-call stream retries
  forcedMentions?: Array<{
    handle: string;
    userId: string;
  }>; // Additional mention handles to force-resolve (e.g., reminder recipients)
  suppressTextOutput?: boolean; // Suppress text output to Discord (NAI tool retry mode — keeps model state coherent but hides repeated text)
  /** NAI GLM-4.6: incomplete trailing fragment from previous stream, to append as prompt continuation on retry */
  naiContinuationPrefill?: string;
  /** AbortSignal to cancel the underlying HTTP request when the SDK call timeout fires */
  abortSignal?: AbortSignal;
  /** Called when streaming makes visible or provider-side progress, so outer watchdogs can refresh their timers. */
  onStreamProgress?: () => void;
  /**
   * Tool names that should return `endTurn: true` on success.
   * Used by hidden agent turns (e.g., the hidden image agent) to terminate the streaming
   * loop cleanly after their target tool completes, without hardcoding a specific "mode".
   * Any tool whose name appears in this list will end the turn immediately on success.
   */
  endTurnAfterTools?: string[];

  // Opaque message ID map — threaded from tomoriChat through to StreamContext and ToolContext
  messageIdMap?: MessageIdMap;
}

/**
 * Context passed to tool execution
 * Contains all necessary Discord and Tomori state information
 */
export interface ToolContext {
  // Discord context
  channel: BaseGuildTextChannel | BaseGuildVoiceChannel | DMChannel | NewsChannel | TextChannel | AnyThreadChannel;
  client: Client;
  message?: Message;

  // Tomori context
  tomoriState: TomoriState;
  locale: string;

  // Provider context
  provider: string;

  // Optional additional context
  emojiStrings?: string[];
  userId?: string;
  internalUserId?: number;
  guildId?: string;
  streamContext?: StreamingContext; // Optional streaming context for enhanced functionality

  // Optional persona webhook context (for alter persona embeds/tools)
  webhook?: Webhook;
  personaUsername?: string;
  personaAvatarUrl?: string; // URL or data URI for the active persona/user identity
  activePersonaId?: number; // Active responding persona for tool-driven follow-up turns
  isUserImpersonation?: boolean; // True when the active turn is a user impersonation session
  impersonatedUserId?: string; // Discord user ID currently being impersonated, if any
  suppressProgressNotices?: boolean; // Skip public "working..." embeds for fire-and-forget flows
  showKillHint?: boolean; // When true, tool notice footers include the /bot kill hint (set after SOFT_WARN_ITERATION_THRESHOLD)
  contextItems?: StructuredContextItem[]; // Current LLM context for tools that need hidden resolution metadata

  // Opaque message ID map for resolving media_N/ref_N keys back to Discord snowflake IDs
  messageIdMap?: MessageIdMap;
}

/**
 * Result returned by tool execution
 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
  imageMetadata?: FunctionResponseImageMetadata;
  /** When true, the streaming loop should end the LLM's turn immediately after processing
   *  this tool result. Used by tools that trigger async follow-up work (e.g., boomerang). */
  endTurn?: boolean;
}

/**
 * Tool category classification
 */
export type ToolCategory = "discord" | "search" | "memory" | "utility" | "mcp";

/**
 * Model capability flags that tools may require to be exposed.
 */
export type ToolModelCapabilityKey =
  | "has_tools"
  | "sees_images"
  | "sees_videos"
  | "sees_youtube"
  | "supports_structoutput";

export type ToolModelCapabilityRequirements = Partial<Pick<LlmRow, ToolModelCapabilityKey>>;

export type ToolAvailabilityLlmState = Pick<LlmRow, "llm_codename" | ToolModelCapabilityKey>;

/**
 * Generic tool interface
 * All tools must implement this interface regardless of provider
 */
export interface Tool {
  // Metadata
  name: string;
  description: string;
  category: ToolCategory;

  // Provider-agnostic parameter schema
  parameters: ToolParameterSchema;

  // Execution method
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;

  // Provider compatibility check
  isAvailableFor(provider: string): boolean;

  // Optional tool configuration
  requiredModelCapabilities?: ToolModelCapabilityRequirements;
  requiresPermissions?: string[];
  requiresFeatureFlag?: string;
  requiresFollowUp?: boolean; // If true, always allow follow-up generation after tool execution (e.g., search/fetch tools)
}

/**
 * Abstract base tool class with common functionality
 */
export abstract class BaseTool implements Tool {
  abstract name: string;
  abstract description: string;
  abstract category: ToolCategory;
  abstract parameters: ToolParameterSchema;
  requiredModelCapabilities?: ToolModelCapabilityRequirements;

  // Default implementation - available for all providers
  isAvailableFor(_provider: string): boolean {
    return true;
  }

  // Abstract execution method to be implemented by each tool
  abstract execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;

  /**
   * Helper method to validate required parameters
   * @param args - Arguments provided to the tool
   * @returns ValidationResult indicating if parameters are valid
   */
  protected validateParameters(args: Record<string, unknown>): {
    isValid: boolean;
    missingParams?: string[];
    errors?: string[];
  } {
    const missingParams: string[] = [];
    const errors: string[] = [];

    // Check required parameters
    for (const requiredParam of this.parameters.required) {
      if (!(requiredParam in args) || args[requiredParam] === undefined || args[requiredParam] === null) {
        missingParams.push(requiredParam);
      }
    }

    // Check parameter types
    for (const [paramName, paramValue] of Object.entries(args)) {
      if (paramValue === undefined || paramValue === null) continue;

      const paramSchema = this.parameters.properties[paramName];
      if (paramSchema) {
        errors.push(...this.validateParameterValue(paramValue, paramSchema, paramName));
      }
    }

    return {
      isValid: missingParams.length === 0 && errors.length === 0,
      missingParams: missingParams.length > 0 ? missingParams : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private validateParameterValue(value: unknown, schema: ToolParameterPropertySchema, path: string): string[] {
    const errors: string[] = [];
    const actualType = Array.isArray(value) ? "array" : typeof value;

    if (schema.type !== actualType) {
      errors.push(`Parameter '${path}' expected type '${schema.type}' but got '${actualType}'`);
      return errors;
    }

    if (schema.enum && typeof value === "string") {
      if (!schema.enum.includes(value)) {
        errors.push(`Parameter '${path}' must be one of: ${schema.enum.join(", ")}`);
      }
    }

    if (schema.type === "array") {
      for (const [index, item] of (value as unknown[]).entries()) {
        errors.push(...this.validateParameterValue(item, schema.items, `${path}[${index}]`));
      }
      return errors;
    }

    if (schema.type === "object") {
      const objectValue = value as Record<string, unknown>;

      for (const requiredParam of schema.required ?? []) {
        if (
          !(requiredParam in objectValue) ||
          objectValue[requiredParam] === undefined ||
          objectValue[requiredParam] === null
        ) {
          errors.push(`Parameter '${path}.${requiredParam}' is required`);
        }
      }

      for (const [key, nestedValue] of Object.entries(objectValue)) {
        const nestedSchema = schema.properties[key];
        if (!nestedSchema || nestedValue === undefined || nestedValue === null) {
          continue;
        }

        errors.push(...this.validateParameterValue(nestedValue, nestedSchema, `${path}.${key}`));
      }
    }

    return errors;
  }

  /**
   * Helper method to check if tool is enabled based on Tomori configuration
   * @param _context - Tool context containing Tomori state
   * @returns True if the tool should be available
   */
  protected isEnabled(_context: ToolContext): boolean {
    // Subclasses should override this method to check specific feature flags
    return true;
  }
}

/**
 * Tool adapter interface for converting between generic tools and provider-specific formats
 */
export interface ToolAdapter {
  /**
   * Convert a generic tool to provider-specific format
   * @param tool - The generic tool to convert
   * @returns Provider-specific tool definition
   */
  convertTool(tool: Tool): Record<string, unknown>;

  /**
   * Convert tool result back to provider-specific format
   * @param result - The generic tool result
   * @returns Provider-specific result format
   */
  convertResult(result: ToolResult): Record<string, unknown>;

  /**
   * Get the provider name this adapter supports
   * @returns Provider identifier
   */
  getProviderName(): string;
}

/**
 * Enhanced tool adapter interface that includes MCP capabilities
 * Provides provider-agnostic access to both built-in and MCP tools
 */
export interface MCPCapableToolAdapter extends ToolAdapter {
  /**
   * Get all available tools (built-in + MCP) in provider-specific format
   * @param builtInTools - Array of built-in tools
   * @param serverId - Optional Discord server ID for server-specific tool selection
   * @param allowedMCPFunctions - Optional pre-filtered list of MCP function names to include
   * @returns Combined provider-specific tool configuration
   */
  getAllToolsInProviderFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>>;

  /**
   * Check if a function name belongs to an MCP tool
   * @param functionName - Name of the function to check
   * @returns Promise<boolean> - True if this is an MCP tool function
   */
  isMCPFunction(functionName: string): Promise<boolean>;

  /**
   * Execute an MCP tool function
   * @param functionName - Name of the MCP function to execute
   * @param args - Arguments for the function
   * @param context - Tool execution context for Discord operations
   * @returns Promise<TypedMCPToolResult> - Enhanced typed tool result
   */
  executeMCPFunction(
    functionName: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<TypedMCPToolResult>;
}

/**
 * MCP tool execution context
 * Additional context specific to MCP tool execution
 */
export interface MCPToolContext extends ToolContext {
  // MCP-specific context
  mcpServerName?: string;
  mcpFunctionName: string;

  // Provider-specific MCP data
  providerMcpData?: Record<string, unknown>;
}

/**
 * MCP tool result with additional metadata
 * Extends ToolResult with MCP-specific information
 * @deprecated Use TypedMCPToolResult from mcpTypes.ts for better type safety
 */
export interface MCPToolResult extends ToolResult {
  // MCP source information
  source: "mcp";
  functionName: string;
  serverName?: string;

  // Raw MCP result for debugging/logging
  rawResult?: MCPServerResponse;

  // Execution metadata
  executionTime?: number;
  providerFormat?: Record<string, unknown>;
}

/**
 * MCP server configuration interface
 * Provider-agnostic configuration for MCP servers
 * @deprecated Use EnhancedMCPServerConfig from mcpTypes.ts for better type safety
 */
export interface MCPServerConfig {
  name: string;
  displayName: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  requiresApiKey?: boolean;
  apiKeyEnvVar?: string;
  timeout?: number;
}

/**
 * MCP manager interface for provider-agnostic MCP management
 * Defines the contract for managing MCP servers regardless of LLM provider
 */
export interface MCPManagerInterface {
  /**
   * Initialize all available MCP servers during application startup
   * @returns Promise<void>
   */
  initializeMCPServers(): Promise<void>;

  /**
   * Check if MCP manager is ready (initialization completed)
   * @returns boolean
   */
  isReady(): boolean;

  /**
   * Get count of connected MCP servers
   * @returns number
   */
  getConnectedServerCount(): number;

  /**
   * Get connection status for all MCP servers
   * @returns Record<string, boolean>
   */
  getConnectionStatus(): Record<string, boolean>;

  /**
   * Get MCP tools available for a specific provider
   * @param provider - Provider name (google, openai, anthropic, etc.)
   * @returns Promise<unknown[]> - Provider-specific MCP tools
   */
  getMCPToolsForProvider(provider: string): Promise<unknown[]>;

  /**
   * Execute an MCP function with provider-agnostic result
   * @param functionName - Name of the function to execute
   * @param args - Function arguments
   * @param context - Optional execution context for Discord operations
   * @returns Promise<TypedMCPToolResult> - Enhanced typed result
   */
  executeMCPFunction(
    functionName: string,
    args: Record<string, unknown>,
    context?: MCPExecutionContext,
  ): Promise<TypedMCPToolResult>;

  /**
   * Get available MCP function names across all connected servers
   * @returns Promise<string[]>
   */
  getAvailableMCPFunctions(): Promise<string[]>;

  /**
   * Get MCP server configurations
   * @returns Promise<EnhancedMCPServerConfig[]>
   */
  getServerConfigurations(): Promise<EnhancedMCPServerConfig[]>;

  /**
   * Check if a specific MCP function is available
   * @param functionName - Name of the function to check
   * @returns Promise<boolean>
   */
  isFunctionAvailable(functionName: string): Promise<boolean>;

  /**
   * Get the server name that provides a specific function
   * @param functionName - Name of the function
   * @returns Promise<string | null>
   */
  getServerForFunction(functionName: string): Promise<string | null>;

  /**
   * Cleanup all MCP connections (for graceful shutdown)
   * @returns Promise<void>
   */
  cleanup(): Promise<void>;
}

/**
 * Tool execution event for monitoring and debugging
 */
export interface ToolExecutionEvent {
  toolName: string;
  provider: string;
  serverId: string;
  userId?: string;
  parameters: Record<string, unknown>;
  result: ToolResult;
  executionTime: number;
  timestamp: Date;
}

/**
 * Tool registry interface for managing all available tools
 */
export interface ToolRegistryInterface {
  /**
   * Register a new tool
   * @param tool - The tool to register
   */
  registerTool(tool: Tool): void;

  /**
   * Get a tool by name
   * @param name - Tool name
   * @returns The tool instance or undefined if not found
   */
  getTool(name: string): Tool | undefined;

  /**
   * Get all tools available for a specific provider
   * @param provider - Provider name
   * @param context - Tool context for feature flag checking
   * @returns Array of available tools
   */
  getAvailableTools(provider: string, context: ToolContext): Tool[];

  /**
   * Get all registered tools
   * @returns Array of all tools
   */
  getAllTools(): Tool[];

  /**
   * Execute a tool by name
   * @param toolName - Name of the tool to execute
   * @param args - Arguments for the tool
   * @param context - Execution context
   * @returns Tool execution result
   */
  executeTool(toolName: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

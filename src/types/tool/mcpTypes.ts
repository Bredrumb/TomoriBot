/**
 * MCP (Model Context Protocol) Type Definitions
 * Comprehensive TypeScript interfaces for MCP server integration
 * Replaces 'any' declarations with proper type safety
 */

import type { ToolResult } from "./interfaces";

/**
 * Base MCP server response structure
 * Common interface for all MCP server responses
 */
export interface MCPServerResponse {
  text?: string;
  isError?: boolean;
  functionResponse?: {
    response?: {
      text?: string;
      content?: MCPContentItem[];
      /** Error envelope used by the Gemini SDK when an MCP tool call fails */
      error?: {
        content?: MCPContentItem[];
        isError?: boolean;
      };
    };
  };
  content?: MCPContentItem[];
  response?: {
    content?: MCPContentItem[];
    text?: string;
  };
  data?: MCPContentItem[];
}

/**
 * MCP content item structure
 * Represents individual content items in MCP responses
 */
interface MCPContentItem {
  type: "text" | "image" | "audio" | "video";
  text?: string;
  image_url?: string;
  url?: string;
  source_url?: string;
  original_url?: string;
  src?: string;
  metadata?: Record<string, unknown>;
}

/**
 * MCP tool result with enhanced typing
 * Specific result format for MCP function executions
 */
export interface TypedMCPToolResult extends ToolResult {
  data?: {
    source: "mcp";
    functionName: string;
    serverName: string;
    rawResult: MCPServerResponse;
    executionTime: number;
    overridesApplied?: string[];

    imagesSent?: number;
    urlsFound?: number;
    fetchCapabilityReminder?: boolean;
    agentInstructions?: string;

    status: "completed" | "completed_and_sent" | "failed" | "partial";
    completionMessage?: string;

    error?: string; // For error scenarios
    searchProvider?: string; // For search-specific information
    contentLength?: number; // For fetch-specific information

    [key: string]: unknown;
  };
}

/**
 * Guild MCP connection state : represents an active remote MCP connection
 * for a specific guild. Managed by GuildMcpManager's connection pool.
 *
 * @property guildMcpId - Database row PK (guild_mcp_servers.guild_mcp_id)
 * @property serverId - TomoriBot internal server_id (FK to servers table)
 * @property name - Human-readable server name (unique per guild)
 * @property client - MCP SDK Client instance for this connection
 * @property callableTool - Google GenAI CallableTool from mcpToTool()
 * @property functionNames - Discovered tool names after listTools()
 * @property connectedAt - Epoch ms when the connection was established
 * @property lastUsedAt - Epoch ms of last tool execution (for TTL eviction)
 */
export interface GuildMCPConnection {
  guildMcpId: number;
  serverId: number;
  name: string;
  client: unknown; // MCP Client : typed as unknown to avoid coupling mcpTypes to SDK imports
  callableTool: unknown; // CallableTool from @google/genai : same reason
  functionNames: string[];
  connectedAt: number;
  lastUsedAt: number;
}

/**
 * Result from GuildMcpManager.testConnection() : used by MCP registration surfaces
 * to validate a remote MCP server before persisting the registration.
 */
export interface GuildMCPTestResult {
  success: boolean;
  toolCount: number;
  functionNames: string[];
  error?: string;
}

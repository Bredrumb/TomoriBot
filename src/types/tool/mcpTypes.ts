import type { ToolResult } from "@/types/tool/interfaces";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type MCPServerResponse = CallToolResult;

export interface TypedMCPToolResult extends ToolResult {
  data?: {
    source: "mcp";
    functionName: string;
    serverName: string;
    rawResult?: MCPServerResponse;
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

export interface McpAuthorizationChallenge {
  resourceMetadataUrl?: string;
  scope?: string;
}

export interface GuildMCPTestResult {
  success: boolean;
  toolCount: number;
  functionNames: string[];
  error?: string;
  unauthorized?: McpAuthorizationChallenge;
}

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

    error?: string;
    searchProvider?: string;
    contentLength?: number;

    [key: string]: unknown;
  };
}

export interface GuildMCPConnection {
  guildMcpId: number;
  serverId: number;
  name: string;
  // Typed as unknown (actually MCP Client) to avoid coupling mcpTypes to SDK imports.
  client: unknown;
  // Typed as unknown (CallableTool from @google/genai) to avoid coupling mcpTypes to SDK imports.
  callableTool: unknown;
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

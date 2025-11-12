/**
 * NovelAI Tool Adapter
 * No-op implementation since NovelAI doesn't support function calling
 *
 * This adapter satisfies the MCPCapableToolAdapter interface but returns
 * empty arrays and null values since NovelAI is a text-only roleplay provider
 * without native function calling capabilities.
 */

import { log } from "@/utils/misc/logger";
import type {
	Tool,
	MCPCapableToolAdapter,
	ToolContext,
	ToolResult,
} from "@/types/tool/interfaces";
import type { TypedMCPToolResult } from "@/types/tool/mcpTypes";

/**
 * NovelAI tool adapter implementation (no-op)
 * NovelAI doesn't support function calling, so all methods return empty/null values
 */
export class NovelaiToolAdapter implements MCPCapableToolAdapter {
	private static instance: NovelaiToolAdapter;

	/**
	 * Get singleton instance
	 */
	static getInstance(): NovelaiToolAdapter {
		if (!NovelaiToolAdapter.instance) {
			NovelaiToolAdapter.instance = new NovelaiToolAdapter();
		}
		return NovelaiToolAdapter.instance;
	}

	/**
	 * Get the provider name this adapter supports
	 * @returns Provider identifier
	 */
	getProviderName(): string {
		return "novelai";
	}

	/**
	 * Convert a generic tool to NovelAI format
	 * NovelAI doesn't support tools, so this returns an empty object
	 * @param _tool - The generic tool to convert (unused)
	 * @returns Empty object
	 */
	convertTool(_tool: Tool): Record<string, unknown> {
		return {};
	}

	/**
	 * Convert a tool result back to NovelAI format
	 * NovelAI doesn't support tools, so this returns an empty object
	 * @param _result - The tool execution result (unused)
	 * @returns Empty object
	 */
	convertResult(_result: ToolResult): Record<string, unknown> {
		return {};
	}

	/**
	 * Convert an array of tools to NovelAI format
	 * NovelAI doesn't support tools, so this returns an empty array
	 * @param _tools - Array of generic tools (unused)
	 * @returns Empty array
	 */
	convertToolsArray(_tools: Tool[]): Array<Record<string, unknown>> {
		return [];
	}

	/**
	 * Get all tools in NovelAI format (built-in + MCP)
	 * NovelAI doesn't support tools, so this returns an empty array
	 * @param _builtInTools - Built-in tools (unused)
	 * @param _serverId - Server ID (unused)
	 * @param _allowedMCPFunctions - MCP function names (unused)
	 * @returns Empty array
	 */
	async getAllToolsInProviderFormat(
		_builtInTools: Tool[],
		_serverId?: number,
		_allowedMCPFunctions?: string[],
	): Promise<Array<Record<string, unknown>>> {
		log.info(
			"NovelAIToolAdapter: Tools not supported for NovelAI (function calling not available)",
		);
		return [];
	}

	/**
	 * Check if a function name is from an MCP server
	 * NovelAI doesn't support tools, so this always returns false
	 * @param _functionName - Function name to check (unused)
	 * @returns Always false
	 */
	async isMCPFunction(_functionName: string): Promise<boolean> {
		return false;
	}

	/**
	 * Execute an MCP function
	 * NovelAI doesn't support tools, so this throws an error
	 * @param functionName - Function name
	 * @param _args - Function arguments (unused)
	 * @param _context - Execution context (unused)
	 * @throws Always throws an error
	 */
	async executeMCPFunction(
		functionName: string,
		_args: Record<string, unknown>,
		_context?: ToolContext,
	): Promise<TypedMCPToolResult> {
		log.error(
			`NovelAIToolAdapter: Attempted to execute MCP function "${functionName}" but NovelAI doesn't support function calling`,
		);
		throw new Error(
			"NovelAI doesn't support function calling. This should never be called.",
		);
	}
}

/**
 * Get singleton instance of the NovelAI tool adapter
 * @returns NovelAI tool adapter instance
 */
export function getNovelaiToolAdapter(): NovelaiToolAdapter {
	return NovelaiToolAdapter.getInstance();
}

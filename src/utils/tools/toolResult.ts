import type { ToolResult } from "@/types/tool/interfaces";

export function buildFailedToolResponse(result: ToolResult, toolName: string): Record<string, unknown> {
  return {
    status: "tool_execution_failed",
    reason: result.failure?.reason || result.message || result.error || "Tool execution failed without specific error",
    tool_name: toolName,
    code: result.failure?.code ?? "tool_error",
    suggested_actions: result.failure?.suggestedActions ?? [],
  };
}

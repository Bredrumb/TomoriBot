import type { AssembledServerConfig, TomoriState } from "@/types/db/schema";

export const VERBATIM_TOOL_CALLING_CONTEXT_DEPTH = 3;

export const VERBATIM_TOOL_CALLING_NUDGE =
  'Experimental verbatim tool calling is enabled. If you need a tool and normal function calling is unavailable, make your entire assistant message exactly one tool call inside a Markdown inline code span or fenced code block. Use `tool_name({"arg":"value"})`. For complex tools, put every argument in one valid JSON object; do not use comma-separated positional arguments. JSON can include multiple named arguments, arrays, or nested objects when the exposed tool schema requires them. For tools with exactly one required string argument you may use `tool_name("value")`; for no-argument tools use `tool_name()`. Examples: `read_file("media_1")`, `select_sticker_for_response("gong")`, `web_search({"query":"latest current news","category":"news","count":5})`, `generate_image({"prompt":"blue raincoat","media_id":"media_1","inpaint":true,"clothing_segment_categories":["Upper-clothes"]})`. Nested-schema template, replacing tool_name with the exact exposed tool name: `tool_name({"query":"cats","filters":{"site":"example.com"},"tags":["cute","gif"]})`. Do not add prose before or after the call. Wait for the tool result, then continue normally.';

export function shouldInjectVerbatimToolCallingNudge(
  tomoriConfig: AssembledServerConfig,
  tomoriState: TomoriState | null | undefined,
): boolean {
  return Boolean(tomoriConfig.verbatim_tool_calling_enabled && tomoriState?.llm?.has_tools);
}

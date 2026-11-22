import type { TomoriState } from "@/types/db/schema";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";

export const VERBATIM_TOOL_CALLING_CONTEXT_DEPTH = 3;

export const VERBATIM_TOOL_CALLING_NUDGE =
  'If you need a tool and normal function calling is unavailable, write the tool call as exactly one Markdown inline code span or fenced code block, and make it the very last thing in your message. A short line of in-character narration before the call is fine, but write nothing after it. Use `tool_name({"arg":"value"})`. For complex tools, put every argument in one valid JSON object; do not use comma-separated positional arguments. JSON can include multiple named arguments, arrays, or nested objects when the exposed tool schema requires them. For tools with exactly one required string argument you may use `tool_name("value")`; for no-argument tools use `tool_name()`. Examples: `read_file("media_1")`, `select_sticker_for_response("gong")`, `web_search({"query":"latest current news","category":"news","count":5})`, `generate_image({"prompt":"A blue raincoat on a coat rack","aspect_ratio":"3:2"})`. Nested-schema template, replacing tool_name with the exact exposed tool name: `tool_name({"query":"cats","filters":{"site":"example.com"},"tags":["cute","gif"]})`. End your message with the call, then wait for the tool result before continuing.';

// Gated on the custom provider per attempt because only CustomStreamAdapter runs VerbatimToolCallParser, so native
// fallbacks must not see the nudge.
export function shouldInjectVerbatimToolCallingNudge(tomoriState: TomoriState | null | undefined): boolean {
  const llm = tomoriState?.llm;
  if (!llm?.verbatim_tool_calling || !llm.has_tools) {
    return false;
  }

  // Registered custom endpoints are named `custom:<connection_id>`, so an exact
  // match against "custom" would miss every one of them.
  const provider = llm.llm_provider ?? "";
  return isCustomProvider(provider) || provider.trim().toLowerCase() === "custom";
}

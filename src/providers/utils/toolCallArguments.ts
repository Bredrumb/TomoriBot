import { log } from "@/utils/misc/logger";
import { tryRepairIncompleteJson } from "@/utils/text/jsonRepair";

export interface ParseToolCallArgumentsInput {
  adapterName: string;
  toolName: string;
  rawArguments: string;
}

export interface ParsedToolCallArguments {
  args: Record<string, unknown>;
  parsed: boolean;
  truncated: boolean;
}

// Endpoints can truncate argument JSON while reporting a finished tool call, so repaired keys are returned with
// truncated set for the tool loop to gate dispatch.
export function parseAccumulatedToolArguments({
  adapterName,
  toolName,
  rawArguments,
}: ParseToolCallArgumentsInput): ParsedToolCallArguments {
  if (!rawArguments) {
    return { args: {}, parsed: false, truncated: false };
  }

  try {
    return { args: JSON.parse(rawArguments) as Record<string, unknown>, parsed: true, truncated: false };
  } catch (parseError) {
    const repaired = tryRepairIncompleteJson(rawArguments);
    if (!repaired) {
      log.error(`${adapterName}: Failed to parse tool arguments for ${toolName}: ${rawArguments}`, parseError as Error);
      return { args: {}, parsed: false, truncated: false };
    }

    // A metric rather than a warning: `log.warn` is filtered out whenever RUN_ENV=production,
    // which is the only environment this truncation happens in.
    log.metric("tool_arguments_truncated", {
      adapter: adapterName,
      tool_name: toolName,
      recovered_keys: Object.keys(repaired).length,
      argument_chars: rawArguments.length,
    });
    return { args: repaired, parsed: false, truncated: true };
  }
}

import { log } from "@/utils/misc/logger";
import { tryRepairIncompleteJson } from "@/utils/text/jsonRepair";

export interface ParseToolCallArgumentsInput {
  /** Adapter name used as both the failure-log prefix and the metric's `adapter` field. */
  adapterName: string;
  toolName: string;
  rawArguments: string;
}

export interface ParsedToolCallArguments {
  /** Recovered arguments, or an empty object when the payload could not be parsed or repaired. */
  args: Record<string, unknown>;
  /** True when the payload decoded as JSON without repair. */
  parsed: boolean;
  /** True when the endpoint cut the payload short, so the call reaches the tool loop incomplete. */
  truncated: boolean;
}

/**
 * Recover the arguments of one streamed tool call, repairing a payload the endpoint cut short.
 *
 * Endpoints can truncate the argument JSON and still report a finished tool call. The repaired
 * keys are real, so they are kept, and `truncated` travels with the call because the tool loop
 * decides whether to dispatch on that flag. An unrecoverable payload logs and yields empty
 * arguments, which is the same fallback the adapters previously took inline.
 *
 * Providers differ in how arguments stream in, but not in what a recovered payload means: the
 * adapters share this so one of them cannot approve a dispatch the others refuse.
 */
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

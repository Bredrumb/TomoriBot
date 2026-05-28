/**
 * Browserless function wrappers.
 *
 * These are intentionally hidden from LLM discovery. `fetchUrl/browserlessEngine`
 * calls this wrapper so the REST integration follows the same shape as other
 * sibling REST tool implementation modules.
 */

import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import { browserlessContent } from "./browserlessService";

function createToolResult(
  success: boolean,
  message: string,
  dataOrError?: Record<string, unknown> | string,
  error?: string,
): ToolResult {
  if (typeof dataOrError === "string") {
    return { success, message, error: dataOrError };
  }

  return {
    success,
    message,
    ...(dataOrError && { data: dataOrError }),
    ...(error && { error }),
  };
}

export async function browserless_fetch_url(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    if (typeof args.url !== "string" || args.url.trim().length === 0) {
      return createToolResult(false, "Invalid or missing URL parameter", "URL is required");
    }

    const url = args.url.trim();
    const result = await browserlessContent({ url }, { signal: context?.abortSignal });

    if (!result.success || result.data === undefined) {
      return createToolResult(false, "Browserless URL fetch failed", result.error ?? "Unknown Browserless error");
    }

    return createToolResult(true, "Browserless URL fetch completed", {
      source: "http",
      functionName: "browserless_fetch_url",
      serverName: "http-browserless",
      rawResult: result.data,
      executionTime: Date.now() - startTime,
      status: "completed",
      statusCode: result.statusCode ?? 200,
      url,
      html: result.data,
      contentLength: result.data.length,
    });
  } catch (error) {
    log.error("Error in browserless_fetch_url:", error as Error);
    return createToolResult(false, "Unexpected error during Browserless URL fetch", (error as Error).message);
  }
}

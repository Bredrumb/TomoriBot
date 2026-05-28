/**
 * Crawl4AI function wrappers.
 *
 * These are intentionally hidden from LLM discovery. `fetchUrl/crawl4aiEngine`
 * calls this wrapper so the REST integration follows the same shape as other
 * sibling REST tool implementation modules.
 */

import { log } from "@/utils/misc/logger";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import {
  crawl4aiCrawlWithCookies,
  crawl4aiMarkdown,
  getCrawl4aiCookies,
  getCrawl4aiFilterMode,
} from "./crawl4aiService";
import type { Crawl4aiFilterMode } from "./types";

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

function resolveFilterMode(args: Record<string, unknown>): Crawl4aiFilterMode {
  if (args.raw === true) {
    return "raw";
  }

  if (typeof args.filter_mode === "string") {
    return getCrawl4aiFilterMode(args.filter_mode);
  }

  return getCrawl4aiFilterMode();
}

export async function crawl4ai_fetch_url(args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    if (typeof args.url !== "string" || args.url.trim().length === 0) {
      return createToolResult(false, "Invalid or missing URL parameter", "URL is required");
    }

    const filterMode = resolveFilterMode(args);
    const request = { url: args.url.trim(), f: filterMode };
    const cookies = getCrawl4aiCookies();
    // 1. Use /crawl with browser_config when cookies are configured — /md
    //    does not expose a cookies field so injection requires /crawl.
    const result =
      cookies.length > 0
        ? await crawl4aiCrawlWithCookies(request, cookies, { signal: context?.abortSignal })
        : await crawl4aiMarkdown(request, { signal: context?.abortSignal });

    if (!result.success || !result.data) {
      return createToolResult(false, "Crawl4AI URL fetch failed", result.error ?? "Unknown Crawl4AI error");
    }

    return createToolResult(true, "Crawl4AI URL fetch completed", {
      source: "http",
      functionName: "crawl4ai_fetch_url",
      serverName: "http-crawl4ai",
      rawResult: result.data,
      executionTime: Date.now() - startTime,
      status: "completed",
      statusCode: result.statusCode ?? 200,
      url: result.data.url,
      filterMode: result.data.filter,
      markdown: result.data.markdown,
      contentLength: result.data.markdown.length,
    });
  } catch (error) {
    log.error("Error in crawl4ai_fetch_url:", error as Error);
    return createToolResult(false, "Unexpected error during Crawl4AI URL fetch", (error as Error).message);
  }
}

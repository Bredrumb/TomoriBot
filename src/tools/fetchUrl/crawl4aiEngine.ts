import { isCrawl4aiAvailable } from "@/tools/restAPIs/crawl4ai/crawl4aiService";
import { crawl4ai_fetch_url } from "@/tools/restAPIs/crawl4ai/toolImplementations";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import type { FetchEngine, FetchOpts } from "./types";

const MAX_CONTENT_LENGTH = 50000;

interface Crawl4aiToolData {
  source: "http";
  functionName: "crawl4ai_fetch_url";
  serverName: "http-crawl4ai";
  rawResult: unknown;
  executionTime: number;
  status: string;
  statusCode: number;
  url: string;
  filterMode: string;
  markdown: string;
  contentLength: number;
}

function isCrawl4aiToolData(data: unknown): data is Crawl4aiToolData {
  if (!data || typeof data !== "object") {
    return false;
  }

  const record = data as Record<string, unknown>;
  return (
    record.source === "http" &&
    record.functionName === "crawl4ai_fetch_url" &&
    typeof record.url === "string" &&
    typeof record.markdown === "string" &&
    typeof record.executionTime === "number"
  );
}

function sliceMarkdown(markdown: string, opts: FetchOpts): { text: string; startIndex: number; nextIndex?: number } {
  const startIndex = opts.startIndex ?? 0;
  if (startIndex >= markdown.length) {
    return { text: "", startIndex };
  }

  const maxLength = Math.min(opts.maxLength ?? MAX_CONTENT_LENGTH, MAX_CONTENT_LENGTH);
  const endIndex = Math.min(startIndex + maxLength, markdown.length);
  return {
    text: markdown.slice(startIndex, endIndex),
    startIndex,
    nextIndex: endIndex < markdown.length ? endIndex : undefined,
  };
}

export class Crawl4aiEngine implements FetchEngine {
  readonly name = "crawl4ai" as const;

  async available(_context: ToolContext): Promise<boolean> {
    return isCrawl4aiAvailable();
  }

  async fetch(url: string, opts: FetchOpts, context: ToolContext): Promise<ToolResult> {
    const result = await crawl4ai_fetch_url({ url, raw: opts.raw }, context);

    if (!result.success) {
      return result;
    }

    if (!isCrawl4aiToolData(result.data)) {
      return {
        success: false,
        error: "Crawl4AI returned an unexpected response shape",
        message: "Crawl4AI URL fetch failed",
      };
    }

    let toolData = result.data;
    let sliced = sliceMarkdown(toolData.markdown, opts);

    // When the fit filter returns empty on an initial (non-paginated) fetch, retry with
    // raw filter. fit's PruningContentFilter skips NavigableString nodes, so plain-text
    // responses (e.g. raw.githubusercontent.com) always yield empty fit_markdown.
    if (!sliced.text.trim() && !opts.raw && (opts.startIndex ?? 0) === 0) {
      log.info("crawl4ai fit filter returned empty; retrying with raw filter");
      const rawResult = await crawl4ai_fetch_url({ url, raw: true }, context);
      if (rawResult.success && isCrawl4aiToolData(rawResult.data) && rawResult.data.markdown.trim()) {
        toolData = rawResult.data;
        sliced = sliceMarkdown(toolData.markdown, opts);
      }
    }

    if (!sliced.text.trim()) {
      // Paginated past the end: expected, report it as success so the model stops paginating.
      if ((opts.startIndex ?? 0) > 0) {
        return {
          success: true,
          message: `[End of page content. No further content found at character offset ${sliced.startIndex}. All sections of this page have been read.]`,
          data: {
            source: "http",
            functionName: "crawl4ai_fetch_url",
            serverName: "http-crawl4ai",
            rawResult: toolData.rawResult,
            executionTime: toolData.executionTime,
            status: "completed",
            contentLength: 0,
            url: toolData.url,
            statusCode: toolData.statusCode,
            filterMode: toolData.filterMode,
          },
        };
      }

      // Initial fetch with no content: let the dispatcher fall through to the next engine.
      return {
        success: false,
        error: "Crawl4AI returned no readable content",
        message: "Crawl4AI URL fetch returned no readable content",
      };
    }

    let message = `**URL:** ${toolData.url}\n\n${sliced.text}`;
    if (sliced.nextIndex !== undefined) {
      message += `\n\n[Content truncated. Continue reading from character offset ${sliced.nextIndex} with start_index=${sliced.nextIndex}.]`;
    }

    return {
      success: true,
      message,
      data: {
        source: "http",
        functionName: "crawl4ai_fetch_url",
        serverName: "http-crawl4ai",
        rawResult: toolData.rawResult,
        executionTime: toolData.executionTime,
        status: "completed",
        contentLength: toolData.contentLength,
        returnedContentLength: sliced.text.length,
        startIndex: sliced.startIndex,
        nextIndex: sliced.nextIndex,
        url: toolData.url,
        statusCode: toolData.statusCode,
        filterMode: toolData.filterMode,
      },
    };
  }
}

import { isCrawl4aiAvailable } from "@/tools/restAPIs/crawl4ai/crawl4aiService";
import { crawl4ai_fetch_url } from "@/tools/restAPIs/crawl4ai/toolImplementations";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
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
    const result = await crawl4ai_fetch_url(
      {
        url,
        raw: opts.raw,
      },
      context,
    );

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

    const sliced = sliceMarkdown(result.data.markdown, opts);
    if (!sliced.text.trim()) {
      const message =
        sliced.startIndex > 0
          ? `[End of page content. No further content found at character offset ${sliced.startIndex}. All sections of this page have been read.]`
          : "[The page returned no readable content.]";

      return {
        success: true,
        message,
        data: {
          source: "http",
          functionName: "crawl4ai_fetch_url",
          serverName: "http-crawl4ai",
          rawResult: result.data.rawResult,
          executionTime: result.data.executionTime,
          status: "completed",
          contentLength: 0,
          url: result.data.url,
          statusCode: result.data.statusCode,
          filterMode: result.data.filterMode,
        },
      };
    }

    let message = `**URL:** ${result.data.url}\n\n${sliced.text}`;
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
        rawResult: result.data.rawResult,
        executionTime: result.data.executionTime,
        status: "completed",
        contentLength: result.data.contentLength,
        returnedContentLength: sliced.text.length,
        startIndex: sliced.startIndex,
        nextIndex: sliced.nextIndex,
        url: result.data.url,
        statusCode: result.data.statusCode,
        filterMode: result.data.filterMode,
      },
    };
  }
}

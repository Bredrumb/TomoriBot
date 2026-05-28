import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { isBrowserlessAvailable } from "@/tools/restAPIs/browserless/browserlessService";
import { browserless_fetch_url } from "@/tools/restAPIs/browserless/toolImplementations";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import type { FetchEngine, FetchOpts } from "./types";

const MAX_CONTENT_LENGTH = 50000;

interface BrowserlessToolData {
  source: "http";
  functionName: "browserless_fetch_url";
  serverName: "http-browserless";
  rawResult: unknown;
  executionTime: number;
  status: string;
  statusCode: number;
  url: string;
  html: string;
  contentLength: number;
}

function isBrowserlessToolData(data: unknown): data is BrowserlessToolData {
  if (!data || typeof data !== "object") {
    return false;
  }

  const record = data as Record<string, unknown>;
  return (
    record.source === "http" &&
    record.functionName === "browserless_fetch_url" &&
    typeof record.url === "string" &&
    typeof record.html === "string" &&
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

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function htmlToMarkdown(html: string, url: string, raw: boolean): string {
  const { document } = parseHTML(html);
  const base = document.createElement("base");
  base.href = url;
  document.head?.prepend(base);

  const turndown = new TurndownService({
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });

  turndown.remove(["script", "style", "noscript", "template"]);
  turndown.addRule("removeSvg", {
    filter: (node) => node.nodeName.toLowerCase() === "svg",
    replacement: () => "",
  });

  if (raw) {
    return normalizeMarkdown(turndown.turndown(document.body?.innerHTML || html));
  }

  const article = new Readability(document as unknown as Document, { charThreshold: 20 }).parse();
  const title = article?.title?.trim() || document.querySelector("title")?.textContent?.trim();
  const contentHtml = article?.content || document.body?.innerHTML || html;
  const markdown = normalizeMarkdown(turndown.turndown(contentHtml));

  if (!title || markdown.startsWith(`# ${title}`)) {
    return markdown;
  }

  return normalizeMarkdown(`# ${title}\n\n${markdown}`);
}

export class BrowserlessEngine implements FetchEngine {
  readonly name = "browserless" as const;

  async available(_context: ToolContext): Promise<boolean> {
    return isBrowserlessAvailable();
  }

  async fetch(url: string, opts: FetchOpts, context: ToolContext): Promise<ToolResult> {
    const result = await browserless_fetch_url({ url }, context);

    if (!result.success) {
      return result;
    }

    if (!isBrowserlessToolData(result.data)) {
      return {
        success: false,
        error: "Browserless returned an unexpected response shape",
        message: "Browserless URL fetch failed",
      };
    }

    const markdown = htmlToMarkdown(result.data.html, result.data.url, opts.raw === true);
    const sliced = sliceMarkdown(markdown, opts);
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
          functionName: "browserless_fetch_url",
          serverName: "http-browserless",
          rawResult: result.data.rawResult,
          executionTime: result.data.executionTime,
          status: "completed",
          contentLength: 0,
          url: result.data.url,
          statusCode: result.data.statusCode,
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
        functionName: "browserless_fetch_url",
        serverName: "http-browserless",
        rawResult: result.data.rawResult,
        executionTime: result.data.executionTime,
        status: "completed",
        contentLength: markdown.length,
        returnedContentLength: sliced.text.length,
        startIndex: sliced.startIndex,
        nextIndex: sliced.nextIndex,
        url: result.data.url,
        statusCode: result.data.statusCode,
      },
    };
  }
}

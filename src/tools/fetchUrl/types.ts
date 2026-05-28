import type { ToolContext, ToolResult } from "@/types/tool/interfaces";

export type FetchEngineName = "crawl4ai" | "browserless" | "mcp_fetch";

export interface FetchOpts {
  maxLength?: number;
  startIndex?: number;
  raw?: boolean;
}

export interface FetchEngine {
  readonly name: FetchEngineName;
  available(context: ToolContext): Promise<boolean>;
  fetch(url: string, opts: FetchOpts, context: ToolContext): Promise<ToolResult>;
}

/**
 * SearxngEngine — wraps the SearXNG REST service into a uniform WebSearchEngine.
 *
 * Supports all 4 categories (text/image/video/news).
 * Availability gates on SEARXNG_BASE_URL being configured AND the
 * instance responding healthy (cached probe — see `isSearxngAvailable`).
 *
 * Sits between Brave and DuckDuckGo in the dispatcher chain: when a Brave key
 * isn't configured but a self-hosted SearXNG sidecar is, queries are routed
 * here instead of falling through to DDG/Felo.
 */

import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { sendToolNotice } from "@/utils/discord/toolProgressNotice";
import { isSearxngAvailable } from "@/tools/restAPIs/searxng/searxngService";
import {
  searxng_web_search,
  searxng_image_search,
  searxng_video_search,
  searxng_news_search,
} from "@/tools/restAPIs/searxng/toolImplementations";
import type { SearchCategory, WebSearchEngine } from "./types";

export class SearxngEngine implements WebSearchEngine {
  readonly name = "searxng" as const;

  async available(_context: ToolContext): Promise<boolean> {
    // 1. SEARXNG_BASE_URL must be set AND the /healthz probe must succeed (cached).
    return await isSearxngAvailable();
  }

  supportsCategory(_category: SearchCategory): boolean {
    return true;
  }

  async search(query: string, category: SearchCategory, context: ToolContext, count?: number): Promise<ToolResult> {
    // 2. Surface a "searching..." notice in Discord — parallel to the Brave engine's
    //    Internal*Tool classes that call sendToolNotice themselves.
    const noticeMeta = this.noticeMetaForCategory(category, query);
    await sendToolNotice(
      context,
      noticeMeta.kind,
      {
        titleKey: noticeMeta.titleKey,
        titleVars: { query },
        descriptionKey: "tools.search.disclaimer_description",
      },
      "SearxngEngine",
    );

    const args: Record<string, unknown> = { query, ...(count !== undefined && { count }) };
    switch (category) {
      case "text":
        return await searxng_web_search(args, context);
      case "image":
        return await searxng_image_search(args, context);
      case "video":
        return await searxng_video_search(args, context);
      case "news":
        return await searxng_news_search(args, context);
    }
  }

  /**
   * Map our internal SearchCategory onto the appropriate toolProgressNotice key
   * + tool-kind discriminator (used by the notice helper to scope concurrency).
   */
  private noticeMetaForCategory(
    category: SearchCategory,
    _query: string,
  ): { kind: "web_search" | "image_search" | "video_search" | "news_search"; titleKey: string } {
    switch (category) {
      case "text":
        return { kind: "web_search", titleKey: "tools.search.web_search_title" };
      case "image":
        return { kind: "image_search", titleKey: "tools.search.image_search_title" };
      case "video":
        return { kind: "video_search", titleKey: "tools.search.video_search_title" };
      case "news":
        return { kind: "news_search", titleKey: "tools.search.news_search_title" };
    }
  }
}

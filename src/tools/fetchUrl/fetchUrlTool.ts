import { BaseTool, type ToolContext, type ToolResult } from "@/types/tool/interfaces";
import { sendFetchProgressNotice, validateFetchSize } from "@/utils/mcp/mcpExecutor";
import { log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { executeFetchUrlWithFallback } from "./dispatcher";
import type { FetchOpts } from "./types";

export class FetchUrlTool extends BaseTool {
  name = "fetch_url";
  description =
    "Fetch and read a specific URL or webpage. Supports pagination with start_index, " +
    "optional max_length, and raw content when available.";

  category = "search" as const;
  requiresFeatureFlag = "web_search";
  requiresFollowUp = true;

  parameters = {
    type: "object" as const,
    properties: {
      url: {
        type: "string" as const,
        description: "The URL to fetch and read.",
      },
      max_length: {
        type: "number" as const,
        description: "Maximum number of characters to return. Optional.",
      },
      start_index: {
        type: "number" as const,
        description: "Start reading from this character offset for pagination. Optional.",
      },
      raw: {
        type: "boolean" as const,
        description: "Return less-filtered page content when supported. Optional.",
      },
    },
    required: ["url"],
  };

  isAvailableFor(provider: string): boolean {
    return provider.toLowerCase() !== "novelai";
  }

  protected isEnabled(context: ToolContext): boolean {
    return context.tomoriState.config.web_search_enabled;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    try {
      if (!this.isEnabled(context)) {
        return {
          success: false,
          error: "URL fetching is disabled for this server",
          message: "URL fetching is not enabled for this server.",
        };
      }

      const normalized = this.normalizeArgs(args);
      if (!normalized.success) {
        return {
          success: false,
          error: normalized.error,
          message: normalized.error,
        };
      }

      const sizeValidation = await validateFetchSize(normalized.url);
      if (!sizeValidation.allowed) {
        return {
          success: false,
          error: sizeValidation.reason ?? "Fetch size validation failed",
          message: localizer(context.locale, "tools.fetch.fetch_failed_description", {
            error: sizeValidation.reason ?? "Fetch size validation failed",
          }),
        };
      }

      await sendFetchProgressNotice(context, normalized.url, "FetchUrlTool", normalized.opts.startIndex);

      log.info(`fetch_url invoked: url="${normalized.url}"`);
      return await executeFetchUrlWithFallback(normalized.url, normalized.opts, context);
    } catch (error) {
      log.error("Error in fetch_url tool:", error as Error);
      return {
        success: false,
        error: `Failed to execute URL fetch: ${(error as Error).message}`,
        message: localizer(context.locale, "tools.fetch.fetch_failed_description", {
          error: (error as Error).message,
        }),
      };
    }
  }

  private normalizeArgs(
    args: Record<string, unknown>,
  ): { success: true; url: string; opts: FetchOpts } | { success: false; error: string } {
    if (typeof args.url !== "string" || args.url.trim().length === 0) {
      return { success: false, error: "URL is required and must be a non-empty string" };
    }

    const url = args.url.trim();
    const opts: FetchOpts = {};

    if (args.max_length !== undefined) {
      if (typeof args.max_length !== "number" || !Number.isFinite(args.max_length) || args.max_length <= 0) {
        return { success: false, error: "max_length must be a positive number" };
      }
      opts.maxLength = Math.floor(args.max_length);
    }

    if (args.start_index !== undefined) {
      if (typeof args.start_index !== "number" || !Number.isFinite(args.start_index) || args.start_index < 0) {
        return { success: false, error: "start_index must be a non-negative number" };
      }
      opts.startIndex = Math.floor(args.start_index);
    }

    if (args.raw !== undefined) {
      if (typeof args.raw !== "boolean") {
        return { success: false, error: "raw must be a boolean" };
      }
      opts.raw = args.raw;
    }

    return { success: true, url, opts };
  }
}

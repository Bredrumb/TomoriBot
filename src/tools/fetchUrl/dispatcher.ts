import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { localizer } from "@/utils/text/localizer";
import { log } from "@/utils/misc/logger";
import { McpFetchEngine } from "./mcpFetchEngine";
import type { FetchEngine, FetchOpts } from "./types";

const ENGINE_CHAIN: readonly FetchEngine[] = [new McpFetchEngine()];

export async function getActiveFetchUrlEngine(context: ToolContext): Promise<FetchEngine | null> {
  for (const engine of ENGINE_CHAIN) {
    if (await engine.available(context)) {
      return engine;
    }
  }

  return null;
}

export async function executeFetchUrlWithFallback(
  url: string,
  opts: FetchOpts,
  context: ToolContext,
): Promise<ToolResult> {
  let lastError: string | undefined;

  for (const engine of ENGINE_CHAIN) {
    if (!(await engine.available(context))) {
      continue;
    }

    log.info(`fetch_url dispatch: trying engine "${engine.name}" for url="${url}"`);

    try {
      const result = await engine.fetch(url, opts, context);
      if (result.success) {
        log.success(`fetch_url dispatch: engine "${engine.name}" succeeded`);
        return result;
      }

      lastError = result.error ?? result.message ?? `${engine.name} returned unsuccessful result`;
      log.warn(`fetch_url dispatch: engine "${engine.name}" failed: ${lastError}`);
    } catch (error) {
      lastError = (error as Error).message;
      log.warn(`fetch_url dispatch: engine "${engine.name}" threw: ${lastError}`);
    }
  }

  return {
    success: false,
    error: lastError ?? "No URL fetch engine is available",
    message: localizer(context.locale, "tools.fetch.fetch_failed_description", {
      error: lastError ?? "No URL fetch engine is available",
    }),
  };
}

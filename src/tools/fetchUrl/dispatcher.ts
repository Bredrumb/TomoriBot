import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { localizer } from "@/utils/text/localizer";
import { log } from "@/utils/misc/logger";
import { Crawl4aiEngine } from "./crawl4aiEngine";
import { SafeHttpFetchEngine } from "./mcpFetchEngine";
import type { FetchEngine, FetchEngineName, FetchOpts } from "./types";
import { isPrivateNetworkFetchAllowed } from "./urlSafety";

const DEFAULT_ENGINE_ORDER: readonly FetchEngineName[] = ["safe_http"];
const REQUIRED_FALLBACK_ENGINE: FetchEngineName = "safe_http";

function createEngine(name: FetchEngineName): FetchEngine {
  switch (name) {
    case "crawl4ai":
      return new Crawl4aiEngine();
    case "safe_http":
      return new SafeHttpFetchEngine();
  }
}

export function parseFetchUrlEngineOrder(raw = process.env.FETCH_URL_ENGINE_ORDER): FetchEngineName[] {
  const parsedNames = raw?.trim().length
    ? raw.split(",").map((name) => name.trim().toLowerCase())
    : [...DEFAULT_ENGINE_ORDER];

  const order: FetchEngineName[] = [];
  const seen = new Set<FetchEngineName>();

  for (const name of parsedNames) {
    if (!name) {
      continue;
    }

    const normalizedName = name === "mcp_fetch" ? REQUIRED_FALLBACK_ENGINE : name;
    if (normalizedName !== "crawl4ai" && normalizedName !== REQUIRED_FALLBACK_ENGINE) {
      log.warn(`Ignoring unknown fetch_url engine name "${name}" from FETCH_URL_ENGINE_ORDER`);
      continue;
    }

    if (normalizedName === REQUIRED_FALLBACK_ENGINE) {
      continue;
    }

    // Crawl4AI follows redirects outside this process, so it is only admitted
    // where private-network fetches are permitted: any non-production runtime,
    // or production with an explicit FETCH_URL_ALLOW_PRIVATE_NETWORK opt-in.
    // Elsewhere the secure default uses the per-hop validated in-process engine.
    if (normalizedName === "crawl4ai" && !isPrivateNetworkFetchAllowed()) {
      log.warn(
        "Ignoring crawl4ai fetch_url engine: private-network fetching is disabled (production without FETCH_URL_ALLOW_PRIVATE_NETWORK)",
      );
      continue;
    }

    if (seen.has(normalizedName)) continue;

    seen.add(normalizedName);
    order.push(normalizedName);
  }

  order.push(REQUIRED_FALLBACK_ENGINE);

  return order;
}

function buildEngineChain(): FetchEngine[] {
  return parseFetchUrlEngineOrder().map((name) => createEngine(name));
}

export async function getActiveFetchUrlEngine(context: ToolContext): Promise<FetchEngine | null> {
  for (const engine of buildEngineChain()) {
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

  for (const engine of buildEngineChain()) {
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

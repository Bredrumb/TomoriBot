import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import { reportProviderFailure } from "@/utils/provider/providerErrorMetrics";
import { localizer } from "@/utils/text/localizer";
import { BraveEngine } from "./braveEngine";
import { SearxngEngine } from "./searxngEngine";
import { DuckDuckGoEngine } from "./duckduckgoEngine";
import { OpenRouterEngine } from "@/tools/webSearch/openrouterEngine";
import { getSearchCategoryLabel } from "./categoryMetadata";
import type { SearchCategory, WebSearchEngine, WebSearchEngineFailure } from "./types";

// Rate limits, bot challenges, credential or credit refusals, and empty results are treated as expected refusals, so
// they do not trigger outage reporting.
const REFUSAL_FAILURES = new Set(["missing_key", "challenge", "rate_limited", "empty_results"]);
const REFUSAL_STATUSES = new Set([401, 402, 403, 429]);

function isEngineRefusal(data: unknown): boolean {
  if (!data || typeof data !== "object" || !("failure" in data)) return false;
  const { failure, status } = data as WebSearchEngineFailure;
  return REFUSAL_FAILURES.has(failure) || (status !== undefined && REFUSAL_STATUSES.has(status));
}

// Engines are stateless, so one shared chain instance is safely reused across all tool invocations.
const ENGINE_CHAIN: readonly WebSearchEngine[] = [
  new BraveEngine(),
  new SearxngEngine(),
  new OpenRouterEngine(),
  new DuckDuckGoEngine(),
];

export async function executeWebSearchWithFallback(
  query: string,
  category: SearchCategory,
  context: ToolContext,
  count?: number,
): Promise<ToolResult> {
  let lastError: string | undefined;
  const failures: Array<{ engine: string; error: string; refusal: boolean }> = [];
  const searchContext: ToolContext = { ...context, progressNoticeState: { attempted: false } };

  for (const engine of ENGINE_CHAIN) {
    if (context.abortSignal?.aborted) break;
    if (!engine.supportsCategory(category)) continue;
    if (!(await engine.available(context))) continue;
    if (context.abortSignal?.aborted) break;

    log.info(`web_search dispatch: trying engine "${engine.name}" for category="${category}"`);

    try {
      const result = await engine.search(query, category, searchContext, count);
      if (result.endTurn) return result;
      if (context.abortSignal?.aborted) break;
      if (result.success) {
        log.success(`web_search dispatch: engine "${engine.name}" succeeded`);
        return result;
      }
      lastError = result.error ?? result.message ?? `${engine.name} returned unsuccessful result`;
      log.warn(`web_search dispatch: engine "${engine.name}" failed: ${lastError}`);
      failures.push({ engine: engine.name, error: lastError, refusal: isEngineRefusal(result.data) });
    } catch (error) {
      lastError = (error as Error).message;
      log.warn(`web_search dispatch: engine "${engine.name}" threw: ${lastError}`);
      failures.push({ engine: engine.name, error: lastError, refusal: false });
    }
  }

  if (context.abortSignal?.aborted) {
    return { success: false, error: "Web search was cancelled." };
  }

  // A category no available engine serves is the expected "unavailable" reply, so only a chain whose
  // every attempted engine failed is reported.
  if (failures.length > 0) {
    await reportProviderFailure({
      summary: "Every web search engine failed",
      errorType: "WebSearchFailed",
      error: undefined,
      expected: failures.every(({ refusal }) => refusal),
      detail: failures.map(({ engine, error }) => `${engine}: ${error}`).join("; "),
      serverId: context.tomoriState.server_id,
      userId: context.internalUserId ?? null,
      dimensions: { operation: "web-search", category, attempted: failures.length },
    });
  }

  const description = localizer(context.locale, "tools.search.category_unavailable_description", {
    category: getSearchCategoryLabel(context.locale, category),
  });

  return {
    success: false,
    error: lastError ?? `No engine available for category "${category}"`,
    message: description,
  };
}

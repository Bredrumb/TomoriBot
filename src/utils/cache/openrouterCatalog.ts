import { log } from "@/utils/misc/logger";
import { readBoundedResponse } from "@/utils/security/boundedResponse";
import { buildOpenRouterAttributionHeaders } from "@/utils/provider/openrouterAttribution";
import { z } from "zod";

export const openRouterPriceSchema = z
  .union([z.string().trim().min(1).transform(Number), z.number()])
  .pipe(z.number().finite().nonnegative());

const DEFAULT_MIN_REFRESH_INTERVAL_MS = 60 * 1000;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

// Cooldown counts attempts (not successes) so failing endpoints or invalid codenames cannot amplify requests; passing
// 0 disables it.
function getOpenRouterCatalogMinRefreshIntervalMs(catalogMinRefreshIntervalMs?: number): number {
  return catalogMinRefreshIntervalMs ?? DEFAULT_MIN_REFRESH_INTERVAL_MS;
}

export function getOpenRouterCatalogTtlMs(catalogTtlMs?: number): number {
  return catalogTtlMs ?? DEFAULT_TTL_MS;
}

export function normalizeOpenRouterCodename(codename: string): string {
  return codename.trim().toLowerCase();
}

export interface OpenRouterCatalogSource<TEntry> {
  label: string;
  url: string;
  // Production catalogs leave this unset to use the shared window, while tests pass 0 so lookups can bypass the
  // cooldown and reach the network.
  minRefreshIntervalMs?: number;
  ttlMs?: number;
  // Implementations throw on malformed payloads so the catalog treats invalid responses as failed refreshes.
  parse(payload: unknown): TEntry[];
  keyOf(entry: TEntry): string;
}

interface OpenRouterCatalogStatus {
  ready: boolean;
  size: number;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  stale: boolean;
}

export interface OpenRouterCatalog<TEntry> {
  initialize(): Promise<void>;
  // Boolean result reflects whether a usable catalog is in memory, refreshed or not, so a failed refresh with cached
  // data still resolves true.
  refresh(options?: { force?: boolean }): Promise<boolean>;
  refreshIfStale(): Promise<boolean>;
  get(codename: string): TEntry | undefined;
  // Yielded snapshot entries are shared and immutable by convention, so callers must not mutate them in place.
  values(): IterableIterator<TEntry>;
  // Unknown codenames refresh once subject to cooldown, whereas `fresh` refreshes before lookup without honoring the
  // cooldown.
  getOrFetch(codename: string, options?: { fresh?: boolean }): Promise<TEntry | undefined>;
  isReady(): boolean;
  size(): number;
  getStatus(): OpenRouterCatalogStatus;
  reset(): void;
}

export function createOpenRouterCatalog<TEntry>(source: OpenRouterCatalogSource<TEntry>): OpenRouterCatalog<TEntry> {
  let entries = new Map<string, TEntry>();
  let ready = false;
  let lastAttemptAt: number | null = null;
  let lastSuccessAt: number | null = null;
  let inFlight: Promise<boolean> | null = null;
  let httpStatus: number | undefined;
  let stage: "transport" | "response" = "transport";

  async function fetchCatalog(): Promise<Map<string, TEntry>> {
    const bounded =
      source.label === "decision" ||
      source.label === "video" ||
      source.label === "speech" ||
      source.label === "transcription" ||
      source.label === "image pricing";
    const response = await fetch(source.url, {
      ...(bounded ? { signal: AbortSignal.timeout(30_000) } : {}),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...buildOpenRouterAttributionHeaders(),
      },
    });
    httpStatus = response.status;

    if (!response.ok) {
      if (bounded) await response.body?.cancel();
      throw new Error(`OpenRouter ${source.label} catalog returned ${response.status}: ${response.statusText}`);
    }

    stage = "response";
    const parsed = source.parse(
      bounded
        ? JSON.parse((await readBoundedResponse(response, 5 * 1024 * 1024)).toString("utf8"))
        : await response.json(),
    );
    const next = new Map<string, TEntry>();
    for (const entry of parsed) {
      const key = normalizeOpenRouterCodename(source.keyOf(entry));
      if (key.length > 0) {
        next.set(key, entry);
      }
    }

    if (next.size === 0) {
      throw new Error(`OpenRouter ${source.label} catalog returned no usable models`);
    }

    return next;
  }

  async function runRefresh(): Promise<boolean> {
    lastAttemptAt = Date.now();
    httpStatus = undefined;
    stage = "transport";
    const correlation = source.label === "decision" ? crypto.randomUUID() : undefined;
    try {
      const next = await fetchCatalog();

      // Swapping the built map atomically keeps readers on a complete snapshot, so a failed fetch leaves cached data
      // intact.
      entries = next;
      ready = true;
      lastSuccessAt = Date.now();
      if (source.label === "decision") {
        log.info(
          `Decision discovery ${JSON.stringify({ operation: "decision-discovery", provider: "openrouter", correlation, modelCount: entries.size, elapsedMs: Date.now() - lastAttemptAt, outcome: "validated" })}`,
        );
      } else {
        log.success(`OpenRouter ${source.label} catalog refreshed: ${entries.size} models`);
      }
      return true;
    } catch (error) {
      if (source.label === "decision") {
        await log.error("Decision operation failed", new Error("Decision discovery failed"), {
          errorType: "DecisionOperationFailed",
          metadata: {
            operation: "decision-discovery",
            provider: "openrouter",
            correlation,
            stage,
            category:
              error instanceof Error && error.name === "TimeoutError"
                ? "timeout"
                : httpStatus && httpStatus >= 400
                  ? "http"
                  : httpStatus
                    ? "malformed"
                    : "network",
            httpStatus,
            elapsedMs: Date.now() - lastAttemptAt,
          },
        });
      } else
        log.warn(
          `Failed to refresh OpenRouter ${source.label} catalog (non-critical); keeping ${entries.size} cached models`,
          error as Error,
        );
      return ready;
    } finally {
      inFlight = null;
    }
  }

  function isStale(): boolean {
    if (!ready || lastSuccessAt === null) {
      return true;
    }
    return Date.now() - lastSuccessAt >= getOpenRouterCatalogTtlMs(source.ttlMs);
  }

  function refresh(options?: { force?: boolean }): Promise<boolean> {
    if (inFlight) {
      return inFlight;
    }

    if (!options?.force && lastAttemptAt !== null) {
      const elapsed = Date.now() - lastAttemptAt;
      if (elapsed < getOpenRouterCatalogMinRefreshIntervalMs(source.minRefreshIntervalMs)) {
        return Promise.resolve(ready);
      }
    }

    inFlight = runRefresh();
    return inFlight;
  }

  return {
    async initialize(): Promise<void> {
      await refresh({ force: true });
    },
    refresh,
    refreshIfStale(): Promise<boolean> {
      return isStale() ? refresh() : Promise.resolve(ready);
    },
    get(codename: string): TEntry | undefined {
      return entries.get(normalizeOpenRouterCodename(codename));
    },
    values(): IterableIterator<TEntry> {
      return entries.values();
    },
    async getOrFetch(codename: string, options?: { fresh?: boolean }): Promise<TEntry | undefined> {
      const key = normalizeOpenRouterCodename(codename);
      if (options?.fresh) {
        await refresh({ force: true });
        return entries.get(key);
      }

      const cached = entries.get(key);
      if (cached) {
        return cached;
      }

      // Never return early on `!ready`, because both an unready catalog and a cache miss must reach the network to
      // recover without a restart.
      await refresh();
      return entries.get(key);
    },
    isReady(): boolean {
      return ready;
    },
    size(): number {
      return entries.size;
    },
    getStatus(): OpenRouterCatalogStatus {
      return {
        ready,
        size: entries.size,
        lastSuccessAt,
        lastAttemptAt,
        stale: isStale(),
      };
    },
    reset(): void {
      entries = new Map();
      ready = false;
      lastAttemptAt = null;
      lastSuccessAt = null;
      inFlight = null;
    },
  };
}

export interface OpenRouterCatalogModelEntry {
  id: string;
  name: string | null;
  description: string | null;
  pricing?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function parseOpenRouterCatalogModelList(label: string, payload: unknown): OpenRouterCatalogModelEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error(`Unexpected OpenRouter ${label} catalog response: missing data array`);
  }

  const models: OpenRouterCatalogModelEntry[] = [];
  for (const entry of payload.data) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.trim().length === 0) {
      continue;
    }

    models.push({
      id: normalizeOpenRouterCodename(entry.id),
      name: readOptionalString(entry.name),
      description: readOptionalString(entry.description),
      ...(entry.pricing === undefined ? {} : { pricing: entry.pricing }),
    });
  }

  return models;
}

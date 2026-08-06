import type { SQL } from "bun";
import { sql, withTransientDbRetry } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

/** Cached result of pgvector availability check; null means no probe has succeeded yet. */
let cachedResult: boolean | null = null;

/**
 * Checks whether the pgvector extension is available in the connected PostgreSQL server.
 *
 * Queries `pg_available_extensions` rather than `pg_extension` so that the check
 * succeeds even if `CREATE EXTENSION vector` hasn't been run yet, so the RAG schema
 * will handle that via `CREATE EXTENSION IF NOT EXISTS`.
 *
 * Only a completed probe is cached. A probe that failed to reach the server says nothing
 * about whether pgvector exists, and caching that as `false` disabled every RAG command
 * for the lifetime of the process: this is the sole probe and `isRagAvailable` has no
 * invalidation path. Production hit exactly that on 2026-08-06, reporting "Document RAG
 * Disabled" against a database with pgvector 0.8.2 installed.
 *
 * @returns `true` if pgvector is available, `false` if absent or currently undeterminable
 */
export async function detectRagAvailability(client: SQL = sql): Promise<boolean> {
  const shouldUseCache = client === sql;
  if (shouldUseCache && cachedResult !== null) return cachedResult;

  try {
    const [row] = await withTransientDbRetry(
      async () =>
        await client<{ available: boolean }[]>`
				SELECT EXISTS(
					SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
				) AS available
			`,
      "detect pgvector availability",
    );
    const available = Boolean(row?.available);
    if (shouldUseCache) cachedResult = available;
    return available;
  } catch (error) {
    log.warn("Could not determine pgvector availability; RAG stays gated until a probe succeeds", error);
    return false;
  }
}

/**
 * Re-probes while availability is unknown, additionally requiring that the RAG schema
 * exists. Driven by `ragAvailabilityMonitor`, not by the read path.
 *
 * Unknown state means the startup probe never completed, which is also the case where
 * `initializeDatabase` skipped `executeSqlFile(ragSchemaPath)`. Reporting availability on
 * the extension alone could then hand RAG commands a database with no `document_chunks`
 * table, so the schema is confirmed before the flag flips.
 *
 * @returns `true` once RAG is confirmed usable, which is the monitor's signal to stop
 */
export async function probeRagUsable(client: SQL = sql): Promise<boolean> {
  try {
    const [row] = await withTransientDbRetry(
      async () =>
        await client<{ usable: boolean }[]>`
				SELECT (
					EXISTS(SELECT 1 FROM pg_available_extensions WHERE name = 'vector')
					AND to_regclass('public.document_chunks') IS NOT NULL
				) AS usable
			`,
      "re-probe pgvector availability",
    );
    if (!row?.usable) return false;
    if (client === sql) {
      cachedResult = true;
      log.info("pgvector re-probe succeeded; RAG features are now enabled");
    }
    return true;
  } catch {
    // Stay unknown so the next gated command tries again.
    return false;
  }
}

/**
 * Returns the cached RAG availability flag. Synchronous and side-effect free.
 *
 * **Must** call `detectRagAvailability()` during startup before using this.
 * Returns `false` if detection hasn't run yet, which is the honest answer while
 * availability is unknown. `ragAvailabilityMonitor` owns recovering from that state.
 */
export function isRagAvailable(): boolean {
  return cachedResult === true;
}

/**
 * Distinguishes "probed, and pgvector is absent" (`false`) from "no probe has completed"
 * (`null`), which `isRagAvailable` collapses into a single `false`. Only the latter is
 * worth re-probing.
 */
export function getRagAvailabilityState(): boolean | null {
  return cachedResult;
}

/** Clears probe state so the next check re-queries. Intended for tests. */
export function resetRagAvailabilityCache(): void {
  cachedResult = null;
}

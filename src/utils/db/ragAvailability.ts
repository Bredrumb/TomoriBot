import type { SQL } from "bun";
import { sql, withTransientDbRetry } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

// Sentinel null means no probe has succeeded yet, distinguishing unknown state from confirmed false so callers know
// when to re-probe.
let cachedResult: boolean | null = null;

// This queries pg_available_extensions before CREATE EXTENSION runs and skips caching failed probes so transient
// errors cannot disable RAG permanently.
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

// Startup skips RAG schema init if the initial probe failed, so this checks document_chunks exists before enabling
// RAG rather than trusting the extension alone.
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

// Startup must call detectRagAvailability before reading this flag because unprobed state returns false until
// detection or ragAvailabilityMonitor runs.
export function isRagAvailable(): boolean {
  return cachedResult === true;
}

// Unlike isRagAvailable (which collapses null to false), this preserves null so the monitor only re-probes unknown
// state.
export function getRagAvailabilityState(): boolean | null {
  return cachedResult;
}

export function resetRagAvailabilityCache(): void {
  cachedResult = null;
}

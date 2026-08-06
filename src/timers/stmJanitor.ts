/**
 * STM Janitor
 *
 * Periodically purges durable `short_term_memories` rows whose `updated_at`
 * timestamp is older than `STM_JANITOR_RETENTION_DAYS` (default 90 days).
 * This prevents unbounded table growth from abandoned channels while leaving
 * recently-touched rows fully intact.
 *
 * The janitor is intentionally lightweight: one DELETE per run, triggered by
 * a setInterval on the existing timer infrastructure. It does NOT touch the
 * in-process cache: those entries expire via the normal TTL path.
 */

import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { log } from "@/utils/misc/logger";

const STM_JANITOR_RETENTION_DAYS = Number.parseInt(process.env.STM_JANITOR_RETENTION_DAYS || "90", 10);

/** Default run interval: once per day. */
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

let intervalId: NodeJS.Timeout | null = null;

/**
 * Runs one janitor cycle, logging the outcome.
 * Errors are caught so a failed purge never kills the interval.
 */
async function tick(): Promise<void> {
  try {
    const deleted = await shortTermMemoryRepository.purgeStaleEntries(STM_JANITOR_RETENTION_DAYS);
    if (deleted > 0) {
      log.info(`[STM janitor] Purged ${deleted} stale short_term_memories row${deleted === 1 ? "" : "s"}`);
    }
  } catch (error) {
    log.error("[STM janitor] Purge cycle failed", error as Error, { errorType: "STMJanitorError" });
  }
}

/**
 * Starts the STM janitor interval. Safe to call multiple times: subsequent
 * calls are no-ops if already running.
 *
 * @param intervalMs - Optional override; defaults to once per day.
 */
export function initializeStmJanitor(intervalMs?: number): void {
  if (intervalId !== null) {
    log.warn("[STM janitor] Already initialized");
    return;
  }

  const finalInterval = intervalMs ?? DEFAULT_INTERVAL_MS;

  // Run an initial purge shortly after startup to catch backlog without blocking boot.
  const STARTUP_DELAY_MS = 60 * 1000;
  setTimeout(() => void tick(), STARTUP_DELAY_MS);

  intervalId = setInterval(() => void tick(), finalInterval);
  log.success(
    `[STM janitor] Initialized (retention: ${STM_JANITOR_RETENTION_DAYS} days, interval: ${finalInterval / 1000 / 60} min)`,
  );
}

export function stopStmJanitor(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    log.info("[STM janitor] Stopped");
  }
}

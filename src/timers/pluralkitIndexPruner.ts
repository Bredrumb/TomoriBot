import { pluralKitRepository } from "@/utils/db/repositories/PluralKitRepository";
import { log } from "../utils/misc/logger";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_PRUNE_INTERVAL_HOURS = 24;
const MS_PER_HOUR = 3_600_000;

let pruneInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Parses a positive-integer environment variable, falling back to the given
 * default when unset, non-numeric, or non-positive.
 *
 * @param name     - Environment variable name
 * @param fallback - Default used when the variable is missing or invalid
 * @returns The parsed positive integer, or the fallback
 */
function parsePositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || `${fallback}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Runs one retention sweep over pluralkit_message_index. Errors are already
 * absorbed by the repository (which logs and returns 0), so a failed pass
 * never disturbs the interval schedule.
 *
 * @param retentionDays - Rows older than this many days are deleted
 */
async function runPrunePass(retentionDays: number): Promise<void> {
  const deleted = await pluralKitRepository.pruneMessageIndexOlderThanDays(retentionDays);
  if (deleted > 0) {
    log.info(`Pruned ${deleted} PluralKit message-index row(s) older than ${retentionDays} day(s)`);
  }
}

/**
 * Starts the PluralKit message-index retention pruner.
 *
 * The pluralkit_message_index table only needs rows as far back as context
 * building can read (see plans/pluralkit-integration.md §6), so this timer:
 * 1. Sweeps once at startup, catching any backlog accumulated while the bot
 *    was offline.
 * 2. Re-sweeps on a fixed interval (PLURALKIT_MESSAGE_INDEX_PRUNE_INTERVAL_HOURS,
 *    default 24h), deleting rows older than
 *    PLURALKIT_MESSAGE_INDEX_RETENTION_DAYS (default 30).
 */
export function initializePluralKitIndexPruner(): void {
  if (pruneInterval) {
    log.warn("PluralKit index pruner is already running");
    return;
  }

  const retentionDays = parsePositiveIntEnv("PLURALKIT_MESSAGE_INDEX_RETENTION_DAYS", DEFAULT_RETENTION_DAYS);
  const intervalHours = parsePositiveIntEnv(
    "PLURALKIT_MESSAGE_INDEX_PRUNE_INTERVAL_HOURS",
    DEFAULT_PRUNE_INTERVAL_HOURS,
  );

  // 1. Startup sweep — never awaited, so a slow DB cannot delay readiness.
  void runPrunePass(retentionDays);

  // 2. Recurring sweep on the configured cadence.
  pruneInterval = setInterval(() => {
    void runPrunePass(retentionDays);
  }, intervalHours * MS_PER_HOUR);

  log.info(`PluralKit index pruner started (retention ${retentionDays} day(s), sweep every ${intervalHours} hour(s))`);
}

/** Stops the recurring sweep (used by tests/shutdown paths). */
export function stopPluralKitIndexPruner(): void {
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
}

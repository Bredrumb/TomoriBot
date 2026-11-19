import { oauthStateRepository } from "@/utils/db/repositories/OAuthStateRepository";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { log } from "@/utils/misc/logger";
import { isPrimaryProcess } from "@/utils/cluster/shardLeases";

const STM_JANITOR_RETENTION_DAYS = Number.parseInt(process.env.STM_JANITOR_RETENTION_DAYS || "90", 10);

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

let intervalId: NodeJS.Timeout | null = null;

async function tick(): Promise<void> {
  if (!isPrimaryProcess()) return;
  try {
    const deleted = await shortTermMemoryRepository.purgeStaleEntries(STM_JANITOR_RETENTION_DAYS);
    if (deleted > 0) {
      log.info(`[STM janitor] Purged ${deleted} stale short_term_memories row${deleted === 1 ? "" : "s"}`);
    }
  } catch (error) {
    log.error("[STM janitor] Purge cycle failed", error as Error, { errorType: "STMJanitorError" });
  }
  if (!isPrimaryProcess()) return;
  try {
    const { purgedStates } = await oauthStateRepository.purgeFinishedStates();
    if (purgedStates > 0) {
      log.info(`[STM janitor] Purged ${purgedStates} finished oauth_states row${purgedStates === 1 ? "" : "s"}`);
    }
  } catch (error) {
    log.error("[STM janitor] OAuth state purge failed", error as Error, { errorType: "STMJanitorError" });
  }
}

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

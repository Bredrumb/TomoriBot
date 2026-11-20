import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import { parsePositiveIntegerEnv } from "@/utils/misc/envFlags";
import { log } from "@/utils/misc/logger";
import { isPrimaryProcess } from "@/utils/cluster/shardLeases";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_PRUNE_INTERVAL_HOURS = 24;
const MS_PER_HOUR = 3_600_000;

let pruneInterval: ReturnType<typeof setInterval> | null = null;

// The repository logs failures and returns 0, so a failed pass never disturbs the interval.
async function runPrunePass(retentionDays: number): Promise<void> {
  if (!isPrimaryProcess()) return;
  const deleted = await messageProxyRepository.pruneMessageIndexOlderThanDays(retentionDays);
  if (deleted > 0) {
    log.info(`Pruned ${deleted} message-proxy message-index row(s) older than ${retentionDays} day(s)`);
  }
}

export function initializeMessageProxyIndexPruner(): void {
  if (pruneInterval) {
    log.warn("Message proxy index pruner is already running");
    return;
  }

  const retentionDays =
    parsePositiveIntegerEnv(process.env.MESSAGE_PROXY_MESSAGE_INDEX_RETENTION_DAYS) ?? DEFAULT_RETENTION_DAYS;
  const intervalHours =
    parsePositiveIntegerEnv(process.env.MESSAGE_PROXY_MESSAGE_INDEX_PRUNE_INTERVAL_HOURS) ??
    DEFAULT_PRUNE_INTERVAL_HOURS;

  // Sweep at startup without awaiting so downtime backlogs clear immediately while a slow DB cannot delay readiness.
  void runPrunePass(retentionDays);

  pruneInterval = setInterval(() => {
    void runPrunePass(retentionDays);
  }, intervalHours * MS_PER_HOUR);

  log.info(
    `Message-proxy index pruner started (retention ${retentionDays} day(s), sweep every ${intervalHours} hour(s))`,
  );
}

export function stopMessageProxyIndexPruner(): void {
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
}

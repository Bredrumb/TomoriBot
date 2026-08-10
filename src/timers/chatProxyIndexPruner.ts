import { chatProxyRepository } from "@/utils/db/repositories/ChatProxyRepository";
import { log } from "@/utils/misc/logger";

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_PRUNE_INTERVAL_HOURS = 24;
const MS_PER_HOUR = 3_600_000;

let pruneInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Parses a positive-integer environment variable, falling back to the given
 * default when unset, non-numeric, or non-positive.
 */
function parsePositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || `${fallback}`, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Runs one retention sweep over chat_proxy_message_index. Errors are already
 * absorbed by the repository (which logs and returns 0), so a failed pass
 * never disturbs the interval schedule.
 */
async function runPrunePass(retentionDays: number): Promise<void> {
  const deleted = await chatProxyRepository.pruneMessageIndexOlderThanDays(retentionDays);
  if (deleted > 0) {
    log.info(`Pruned ${deleted} chat-proxy message-index row(s) older than ${retentionDays} day(s)`);
  }
}

/**
 * Starts the chat-proxy message-index retention pruner.
 *
 * The chat_proxy_message_index table only needs rows as far back as context
 * building can read. A startup sweep catches downtime backlog, while a fixed
 * interval keeps entries within CHAT_PROXY_MESSAGE_INDEX_RETENTION_DAYS.
 */
export function initializeChatProxyIndexPruner(): void {
  if (pruneInterval) {
    log.warn("Chat proxy index pruner is already running");
    return;
  }

  const retentionDays = parsePositiveIntEnv("CHAT_PROXY_MESSAGE_INDEX_RETENTION_DAYS", DEFAULT_RETENTION_DAYS);
  const intervalHours = parsePositiveIntEnv(
    "CHAT_PROXY_MESSAGE_INDEX_PRUNE_INTERVAL_HOURS",
    DEFAULT_PRUNE_INTERVAL_HOURS,
  );

  // Never awaited: a slow DB must not delay startup readiness.
  void runPrunePass(retentionDays);

  pruneInterval = setInterval(() => {
    void runPrunePass(retentionDays);
  }, intervalHours * MS_PER_HOUR);

  log.info(`Chat-proxy index pruner started (retention ${retentionDays} day(s), sweep every ${intervalHours} hour(s))`);
}

/** Stops the recurring sweep (used by tests/shutdown paths). */
export function stopChatProxyIndexPruner(): void {
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
}

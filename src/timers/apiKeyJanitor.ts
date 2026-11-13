import { clearInactiveApiKeys } from "@/utils/db/repositories/ApiKeyRetentionRepository";
import { isPrimaryProcess } from "@/utils/cluster/shardLeases";
import { isDraining } from "@/utils/misc/shutdownState";
import { log } from "@/utils/misc/logger";
import { readApiKeyInactivityDays } from "@/utils/security/apiKeyRetention";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let interval: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running || !interval || isDraining() || !isPrimaryProcess()) return;
  const days = readApiKeyInactivityDays();
  if (days === null) return;
  running = true;
  try {
    const retired = await clearInactiveApiKeys(days);
    if (retired.length > 0) log.metric("api_key_retention_cleanup", { retired_entries: retired.length });
  } catch {
    log.error("Inactive API key cleanup failed", undefined, { errorType: "ApiKeyRetentionCleanupError" });
  } finally {
    running = false;
  }
}

export function initializeApiKeyJanitor(): void {
  if (interval || readApiKeyInactivityDays() === null) return;
  interval = setInterval(() => void tick(), CLEANUP_INTERVAL_MS);
  interval.unref();
  void tick();
}

export function stopApiKeyJanitor(): void {
  if (interval) clearInterval(interval);
  interval = null;
}

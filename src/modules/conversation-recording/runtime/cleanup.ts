import { conversationRecordingRepository } from "@/modules/conversation-recording/db/repositories";
import { isPrimaryProcess } from "@/utils/cluster/shardLeases";
import { isDraining } from "@/utils/misc/shutdownState";
import { log } from "@/utils/misc/logger";

const CLEANUP_INTERVAL_MS = 60_000;
let interval: ReturnType<typeof setInterval> | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running || !interval || isDraining() || !isPrimaryProcess()) return;
  running = true;
  try {
    await conversationRecordingRepository.cleanup();
  } catch {
    log.error("Conversation recording cleanup failed", undefined, { errorType: "RecordingCleanupError" });
  } finally {
    running = false;
  }
}

export function initializeRecordingCleanup(): void {
  if (interval) return;
  interval = setInterval(() => void tick(), CLEANUP_INTERVAL_MS);
  interval.unref();
  void tick();
}

export function stopRecordingCleanup(): void {
  if (interval) clearInterval(interval);
  interval = null;
}

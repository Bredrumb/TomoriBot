import { getRagAvailabilityState, probeRagUsable } from "@/utils/db/ragAvailability";
import { log } from "@/utils/misc/logger";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

// This runs only when boot probing missed the DB and stops once settled, because completed probes are cached and
// polling absent pgvector wastes DB round-trips.
class RagAvailabilityMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly intervalMs: number;

  constructor(intervalMs = DEFAULT_INTERVAL_MS) {
    this.intervalMs = intervalMs;
  }

  public start(): void {
    if (this.isRunning) {
      log.warn("RAG availability monitor is already running");
      return;
    }

    if (getRagAvailabilityState() !== null) {
      return;
    }

    log.info(`RAG availability undetermined at startup; re-probing every ${this.intervalMs / 1000}s`);
    this.isRunning = true;
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  public stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async tick(): Promise<void> {
    try {
      if (getRagAvailabilityState() !== null) {
        this.stop();
        return;
      }
      if (await probeRagUsable()) {
        this.stop();
      }
    } catch (error) {
      log.error("Error during scheduled RAG availability re-probe:", error);
    }
  }

  public getStatus(): { isRunning: boolean; intervalMs: number } {
    return { isRunning: this.isRunning, intervalMs: this.intervalMs };
  }
}

let monitorInstance: RagAvailabilityMonitor | null = null;

/** @public Dynamically loaded by `src/init/timers.ts` on main and release. */
export function initializeRagAvailabilityMonitor(intervalMs?: number): void {
  if (monitorInstance) {
    log.warn("RAG availability monitor already initialized");
    return;
  }

  const resolved = intervalMs ?? DEFAULT_INTERVAL_MS;

  monitorInstance = new RagAvailabilityMonitor(Math.max(1000, resolved));
  monitorInstance.start();
}

/** @public Dynamically loaded by `src/init/timers.ts` on main and release. */
export function stopRagAvailabilityMonitor(): void {
  if (monitorInstance) {
    monitorInstance.stop();
    monitorInstance = null;
  }
}

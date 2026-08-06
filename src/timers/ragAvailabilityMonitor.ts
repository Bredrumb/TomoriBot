/**
 * RAG Availability Monitor
 * Re-probes pgvector when startup detection never reached the database, then stops.
 */

import { getRagAvailabilityState, probeRagUsable } from "@/utils/db/ragAvailability";
import { log } from "@/utils/misc/logger";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Recovers RAG from an undetermined startup probe without a restart.
 *
 * `detectRagAvailability` caches only a probe that completed, so a connection that died
 * during boot leaves the flag unset and every RAG command gated. This retries on an
 * interval and stops on the first success. It deliberately does not run when startup
 * settled the question either way: a definitive "pgvector absent" needs no polling, and
 * the probe is a database round-trip that would otherwise repeat forever.
 */
export class RagAvailabilityMonitor {
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

export function initializeRagAvailabilityMonitor(intervalMs?: number): void {
  if (monitorInstance) {
    log.warn("RAG availability monitor already initialized");
    return;
  }

  const resolved =
    intervalMs ?? (Number.parseInt(process.env.RAG_AVAILABILITY_REPROBE_INTERVAL_MS || "", 10) || DEFAULT_INTERVAL_MS);

  monitorInstance = new RagAvailabilityMonitor(Math.max(1000, resolved));
  monitorInstance.start();
}

export function stopRagAvailabilityMonitor(): void {
  if (monitorInstance) {
    monitorInstance.stop();
    monitorInstance = null;
  }
}

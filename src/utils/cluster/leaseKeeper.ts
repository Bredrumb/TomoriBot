import { setTimeout as delay } from "node:timers/promises";
import { clusterLeaseRepository, type ClusterLeaseRepository } from "@/utils/db/repositories/ClusterLeaseRepository";
import { log } from "@/utils/misc/logger";

const LEASE_TTL_MS = 30_000;
export const LEASE_RENEW_MS = 10_000;
// Query send time leaves five seconds for transport delay and event-loop scheduling before database expiry.
const LEASE_SAFETY_MS = 25_000;
const ACQUIRE_WAIT_MS = 35_000;
const ACQUIRE_RETRY_MS = 250;

export interface CoordinationClock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  schedule(callback: () => void, ms: number): () => void;
}

export const coordinationClock: CoordinationClock = {
  now: () => performance.now(),
  sleep: async (ms, signal) => {
    await delay(ms, undefined, { signal });
  },
  schedule: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

export type LeaseState = "idle" | "acquiring" | "active" | "uncertain" | "lost" | "stopped";
export type LeaseStore = Pick<ClusterLeaseRepository, "takeIfExpired" | "renew" | "release">;

export interface LeaseCallbacks {
  onLost(): void;
  onStateChange(state: LeaseState): void;
}

interface HeldLease {
  token: string;
  safeUntil: number;
}

export class LeaseKeeper {
  private state: LeaseState = "idle";
  private readonly held = new Map<string, HeldLease>();
  private readonly lifetime = new AbortController();
  private work = new AbortController();
  private cancelRenewal?: () => void;
  private cancelDeadline?: () => void;
  private acquisition?: Promise<boolean>;
  private renewal?: Promise<void>;
  private cleanup?: Promise<void>;

  constructor(
    private readonly names: readonly string[],
    private readonly holder: string,
    private readonly callbacks: LeaseCallbacks,
    private readonly repository: LeaseStore = clusterLeaseRepository,
    private readonly clock: CoordinationClock = coordinationClock,
  ) {
    if (names.length === 0 || new Set(names).size !== names.length) throw new Error("Invalid lease selection");
    this.work.abort();
  }

  get safetyDeadline(): number | null {
    return this.held.size === 0 ? null : Math.min(...Array.from(this.held.values(), (lease) => lease.safeUntil));
  }

  get workSignal(): AbortSignal {
    this.isValid();
    return this.work.signal;
  }

  getState(): LeaseState {
    this.isValid();
    return this.state;
  }

  isValid(): boolean {
    if (this.state === "active" && this.clock.now() >= (this.safetyDeadline ?? 0)) this.transition("uncertain");
    return this.state === "active";
  }

  acquire(signal: AbortSignal): Promise<boolean> {
    this.acquisition ??= this.acquireAll(AbortSignal.any([signal, this.lifetime.signal]));
    return this.acquisition;
  }

  stop(): Promise<void> {
    this.cleanup ??= this.stopAndRelease();
    return this.cleanup;
  }

  private async acquireAll(signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    this.transition("acquiring");
    const end = this.clock.now() + ACQUIRE_WAIT_MS;
    try {
      while (this.clock.now() < end) {
        signal.throwIfAborted();
        for (const name of this.names) {
          const sentAt = this.clock.now();
          const grant = await this.repository.takeIfExpired(name, this.holder, LEASE_TTL_MS, signal);
          if (!grant) break;
          this.held.set(name, { token: grant.token, safeUntil: sentAt + LEASE_SAFETY_MS });
          signal.throwIfAborted();
        }
        if (this.held.size === this.names.length && this.clock.now() < Math.min(end, this.safetyDeadline ?? 0)) {
          this.transition("active");
          this.armDeadline();
          this.scheduleRenewal();
          return true;
        }
        await this.releaseHeld();
        await this.clock.sleep(Math.min(ACQUIRE_RETRY_MS, Math.max(0, end - this.clock.now())), signal);
      }
      this.transition("stopped");
      return false;
    } catch (error) {
      if (this.state !== "stopped") this.transition("stopped");
      await this.releaseHeld();
      throw error;
    }
  }

  private scheduleRenewal(): void {
    this.cancelRenewal = this.clock.schedule(() => {
      this.renewal = this.renewAll();
    }, LEASE_RENEW_MS);
  }

  private async renewAll(): Promise<void> {
    try {
      for (const [name, lease] of this.held) {
        const sentAt = this.clock.now();
        const grant = await this.repository.renew(name, this.holder, lease.token, LEASE_TTL_MS, this.lifetime.signal);
        if (this.lifetime.signal.aborted) return;
        if (!grant) {
          this.transition("lost");
          this.cancelDeadline?.();
          this.callbacks.onLost();
          return;
        }
        lease.safeUntil = sentAt + LEASE_SAFETY_MS;
      }
      if (!this.lifetime.signal.aborted) {
        if (this.clock.now() < (this.safetyDeadline ?? 0)) this.transition("active");
        else this.transition("uncertain");
        this.armDeadline();
      }
    } catch (error) {
      if (!this.lifetime.signal.aborted && this.state !== "lost") {
        this.transition("uncertain");
        log.warn("Cluster lease renewal is uncertain", undefined, {
          metadata: { holder: this.holder, code: error instanceof Error ? error.name : "unknown" },
        });
      }
    } finally {
      if (!this.lifetime.signal.aborted && this.state !== "lost") this.scheduleRenewal();
    }
  }

  private armDeadline(): void {
    this.cancelDeadline?.();
    this.cancelDeadline = this.clock.schedule(
      () => {
        this.isValid();
      },
      Math.max(0, (this.safetyDeadline ?? 0) - this.clock.now()),
    );
  }

  private transition(state: LeaseState): void {
    if (this.state === state) return;
    this.state = state;
    if (state === "active") {
      if (this.work.signal.aborted) this.work = new AbortController();
    } else {
      this.work.abort();
    }
    this.callbacks.onStateChange(state);
  }

  private async releaseHeld(): Promise<void> {
    const leases = [...this.held];
    this.held.clear();
    const results = await Promise.allSettled(
      leases.map(([name, lease]) => this.repository.release(name, this.holder, lease.token)),
    );
    if (results.some((result) => result.status === "rejected")) {
      log.warn("Cluster lease release could not be confirmed; ownership must expire", undefined, {
        metadata: { holder: this.holder },
      });
    }
  }

  private async stopAndRelease(): Promise<void> {
    this.transition("stopped");
    this.lifetime.abort();
    this.cancelRenewal?.();
    this.cancelDeadline?.();
    await Promise.allSettled([this.acquisition]);
    await Promise.allSettled([this.renewal, this.releaseHeld()]);
  }
}

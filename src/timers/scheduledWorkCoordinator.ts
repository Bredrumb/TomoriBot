import type { Client } from "discord.js";
import { getShardTopology, type ShardTopology } from "@/utils/discord/shardOwnership";
import { getOwnerWorkSignal, hasShardLeaseOwnership } from "@/utils/cluster/shardLeases";
import { canRunScheduledWork, type ScheduledWorkContext } from "@/timers/scheduledWorkContext";
import { log } from "../utils/misc/logger";
import { serverScheduleRepository } from "@/utils/db/repositories";
import { RandomTriggerProcessor } from "./randomTriggerProcessor";
import { ReminderProcessor } from "./reminderProcessor";
import { NaturalNudgeProcessor } from "@/modules/natural-nudges/runtime/processor";
import { clearScheduledWorkNudgeHandler, registerScheduledWorkNudgeHandler } from "./scheduledWorkSignals";
import {
  getScheduledWorkLaneServerIds,
  isScheduledWorkLaneCapacityFull,
  startScheduledWorkLanes,
} from "@/timers/scheduledWorkLanes";

const MAX_TIMEOUT_MS = 2_147_483_647;
const SCHEDULED_WORK_RECONCILE_INTERVAL_MS = 60_000;

export interface ScheduledWorkOwner {
  hasOwnership: () => boolean;
  getWorkSignal: () => AbortSignal | undefined;
}

type ScheduledWorkStatus = {
  isRunning: boolean;
  isProcessing: boolean;
  reconcileIntervalMs: number;
  nextWakeAt: Date | null;
  lastRunAt: Date | null;
};

export class ScheduledWorkCoordinator {
  private readonly reminderProcessor: ReminderProcessor;
  private readonly randomTriggerProcessor: RandomTriggerProcessor;
  private readonly naturalNudgeProcessor: NaturalNudgeProcessor;
  private readonly reconcileIntervalMs: number;
  private wakeTimeout: NodeJS.Timeout | null = null;
  private reconcileInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isProcessing = false;
  private rerunRequested = false;
  private nextWakeAt: Date | null = null;
  private lastRunAt: Date | null = null;
  private lifetime = new AbortController();

  constructor(
    client: Client,
    reconcileIntervalMs = SCHEDULED_WORK_RECONCILE_INTERVAL_MS,
    private readonly topology: ShardTopology = getShardTopology(),
    private readonly owner: ScheduledWorkOwner = {
      hasOwnership: hasShardLeaseOwnership,
      getWorkSignal: () => (topology.ownsAllShards() ? undefined : getOwnerWorkSignal()),
    },
  ) {
    this.reconcileIntervalMs = reconcileIntervalMs;
    this.reminderProcessor = new ReminderProcessor(client, topology);
    this.randomTriggerProcessor = new RandomTriggerProcessor(client, topology);
    this.naturalNudgeProcessor = new NaturalNudgeProcessor(client, topology);
  }

  public start(): void {
    if (this.isRunning) {
      log.warn("Scheduled work coordinator is already running");
      return;
    }

    this.isRunning = true;
    this.lifetime = new AbortController();
    registerScheduledWorkNudgeHandler((reason) => {
      this.requestImmediateRun(reason ? `nudge:${reason}` : "nudge");
    });

    this.reconcileInterval = setInterval(() => {
      this.requestImmediateRun("reconcile");
    }, this.reconcileIntervalMs);

    log.info(`Starting scheduled work coordinator (reconcile every ${this.reconcileIntervalMs}ms)`);
    this.requestImmediateRun("startup");
    log.success("Scheduled work coordinator started successfully");
  }

  public stop(): void {
    if (!this.isRunning) {
      log.warn("Scheduled work coordinator is not running");
      return;
    }

    this.isRunning = false;
    this.lifetime.abort();
    this.rerunRequested = false;
    clearScheduledWorkNudgeHandler();
    this.clearWakeTimeout();

    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval);
      this.reconcileInterval = null;
    }

    this.nextWakeAt = null;
    log.success("Scheduled work coordinator stopped successfully");
  }

  public requestImmediateRun(reason = "manual"): void {
    if (!this.isRunning) {
      return;
    }

    if (this.isProcessing) {
      this.rerunRequested = true;
      return;
    }

    this.clearWakeTimeout();
    this.nextWakeAt = new Date();
    this.wakeTimeout = setTimeout(() => {
      this.wakeTimeout = null;
      this.runCycle(reason).catch((error) => {
        log.error(`Scheduled work cycle failed (${reason})`, error);
      });
    }, 0);
  }

  public async runNow(reason = "manual"): Promise<void> {
    if (!this.isRunning) {
      throw new Error("Scheduled work coordinator not initialized");
    }

    await this.runCycle(reason);
  }

  public getStatus(): ScheduledWorkStatus {
    return {
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
      reconcileIntervalMs: this.reconcileIntervalMs,
      nextWakeAt: this.nextWakeAt,
      lastRunAt: this.lastRunAt,
    };
  }

  private clearWakeTimeout(): void {
    if (this.wakeTimeout) {
      clearTimeout(this.wakeTimeout);
      this.wakeTimeout = null;
    }
  }

  private async runCycle(reason: string): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    if (this.isProcessing) {
      this.rerunRequested = true;
      return;
    }

    this.clearWakeTimeout();
    this.nextWakeAt = null;
    const work = this.createWorkContext();
    this.isProcessing = true;

    try {
      do {
        this.rerunRequested = false;
        if (!canRunScheduledWork(work)) return;
        if (reason !== "reconcile") {
          log.info(`Running scheduled work cycle (${reason})`);
        }
        await this.dispatchDueWork(work);
        if (!canRunScheduledWork(work)) return;
        // Natural Nudges has no due-time column to wake on, so the 60 s reconcile is its only clock.
        await this.naturalNudgeProcessor.processDueIdleNudges(work);
        if (!canRunScheduledWork(work)) return;
        this.lastRunAt = new Date();
        reason = "rerun";
      } while (this.rerunRequested && this.isRunning);
    } finally {
      this.isProcessing = false;
    }

    await this.scheduleNextWake(work);
  }

  private createWorkContext(): ScheduledWorkContext {
    const ownerSignal = this.owner.getWorkSignal();
    return {
      signal: ownerSignal ? AbortSignal.any([this.lifetime.signal, ownerSignal]) : this.lifetime.signal,
      ownerSignal: ownerSignal ?? new AbortController().signal,
      hasOwnership: this.owner.hasOwnership,
    };
  }

  private async dispatchDueWork(work: ScheduledWorkContext): Promise<void> {
    const reminders = await this.reminderProcessor.loadDueReminders(work);
    if (!canRunScheduledWork(work)) return;
    const triggers = await this.randomTriggerProcessor.loadDueTriggers(work);
    if (!canRunScheduledWork(work)) return;
    startScheduledWorkLanes(
      [
        ...reminders.map((reminder) => ({
          serverId: reminder.server_id,
          dueAt: (reminder.next_attempt_at ?? reminder.reminder_time).getTime(),
          run: () => this.reminderProcessor.executeReminder(reminder, work),
        })),
        ...triggers.map((trigger) => ({
          serverId: trigger.server_id,
          dueAt: trigger.next_trigger_at.getTime(),
          run: () => this.randomTriggerProcessor.executeTrigger(trigger, work),
        })),
      ],
      work,
      () => this.handleLaneSettled(),
    );
  }

  // After a lease swap, a settling lane waits at most one reconcile tick unless routed through a module-level callback.
  private handleLaneSettled(): void {
    if (!this.isRunning || this.isProcessing) return;
    this.scheduleNextWake(this.createWorkContext()).catch((error) => {
      log.error("Scheduled work wake failed after a lane settled", error);
    });
  }

  private async scheduleNextWake(work: ScheduledWorkContext): Promise<void> {
    if (!canRunScheduledWork(work)) {
      return;
    }

    if (isScheduledWorkLaneCapacityFull()) return;

    // Running lanes are skipped because their still-due rows would arm a zero-delay spin until each lane settles.
    const busyServerIds = getScheduledWorkLaneServerIds();
    const nextReminderTime = await serverScheduleRepository.getNextReminderTime(this.topology, busyServerIds);
    const nextRandomTriggerTime = await serverScheduleRepository.getNextTriggerTime(this.topology, busyServerIds);
    if (!canRunScheduledWork(work) || this.isProcessing || isScheduledWorkLaneCapacityFull()) return;
    const nextDueTime = this.getEarliestDate(nextReminderTime, nextRandomTriggerTime);
    if (!nextDueTime) return;

    const delayMs = Math.max(0, nextDueTime.getTime() - Date.now());
    const clampedDelayMs = Math.min(delayMs, MAX_TIMEOUT_MS);
    const wakeAt = Date.now() + clampedDelayMs;
    // Overlapping refreshes may only move an armed wake earlier, never push it back.
    if (this.wakeTimeout && this.nextWakeAt && this.nextWakeAt.getTime() <= wakeAt) return;

    this.clearWakeTimeout();
    this.nextWakeAt = new Date(wakeAt);
    log.info(
      `Scheduled work coordinator next wake scheduled for ${nextDueTime.toISOString()} (in ${clampedDelayMs}ms)`,
    );

    this.wakeTimeout = setTimeout(() => {
      this.wakeTimeout = null;
      this.runCycle("due").catch((error) => {
        log.error("Scheduled work cycle failed (due)", error);
      });
    }, clampedDelayMs);
  }

  private getEarliestDate(...dates: Array<Date | null>): Date | null {
    const validDates = dates.filter((date): date is Date => date instanceof Date);
    if (validDates.length === 0) {
      return null;
    }

    return validDates.reduce((earliest, current) => {
      return current.getTime() < earliest.getTime() ? current : earliest;
    });
  }
}

let scheduledWorkCoordinatorInstance: ScheduledWorkCoordinator | null = null;

export function initializeScheduledWorkCoordinator(client: Client): void {
  if (scheduledWorkCoordinatorInstance) {
    log.warn("Scheduled work coordinator already initialized");
    return;
  }

  scheduledWorkCoordinatorInstance = new ScheduledWorkCoordinator(client);
  scheduledWorkCoordinatorInstance.start();
}

export function stopScheduledWorkCoordinator(): void {
  if (!scheduledWorkCoordinatorInstance) {
    return;
  }

  scheduledWorkCoordinatorInstance.stop();
  scheduledWorkCoordinatorInstance = null;
}

export async function runScheduledWorkNow(reason?: string): Promise<void> {
  if (!scheduledWorkCoordinatorInstance) {
    throw new Error("Scheduled work coordinator not initialized");
  }

  await scheduledWorkCoordinatorInstance.runNow(reason);
}

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Client } from "discord.js";
import { NaturalNudgeProcessor } from "@/modules/natural-nudges/runtime/processor";
import { RandomTriggerProcessor } from "@/timers/randomTriggerProcessor";
import { ReminderProcessor } from "@/timers/reminderProcessor";
import { ScheduledWorkCoordinator } from "@/timers/scheduledWorkCoordinator";
import { serverScheduleRepository } from "@/utils/db/repositories";
import { parseShardTopology } from "@/utils/discord/shardOwnership";
import { log } from "@/utils/misc/logger";

const topology = parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "1,3" });
const spies: Array<{ mockRestore(): void }> = [];
let coordinator: ScheduledWorkCoordinator;
let client: Client;
let delays: number[];

beforeEach(() => {
  client = new Client({ intents: [] });
  delays = [];
  const nativeTimeout = globalThis.setTimeout;
  spies.push(
    spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => {
      delays.push(delay ?? 0);
      return nativeTimeout(callback, 86_400_000).unref();
    }) as typeof setTimeout),
  );
  for (const method of ["info", "success", "warn"] as const) {
    spies.push(spyOn(log, method).mockImplementation(() => {}));
  }
  spies.push(spyOn(ReminderProcessor.prototype, "processDueReminders").mockResolvedValue());
  spies.push(spyOn(RandomTriggerProcessor.prototype, "processDueRandomTriggers").mockResolvedValue());
  spies.push(spyOn(NaturalNudgeProcessor.prototype, "processDueIdleNudges").mockResolvedValue());
  coordinator = new ScheduledWorkCoordinator(client, 60_000, topology, {
    hasOwnership: () => true,
    getWorkSignal: () => undefined,
  });
});

afterEach(async () => {
  coordinator.stop();
  for (const spy of spies.splice(0).reverse()) spy.mockRestore();
  await client.destroy();
});

describe("shard-owned wake scheduling", () => {
  it("leaves only reconciliation when this owner has no scheduled rows", async () => {
    spies.push(spyOn(serverScheduleRepository, "getNextReminderTime").mockResolvedValue(null));
    spies.push(spyOn(serverScheduleRepository, "getNextTriggerTime").mockResolvedValue(null));
    coordinator.start();
    await coordinator.runNow();
    expect(coordinator.getStatus()).toMatchObject({ isProcessing: false, nextWakeAt: null });
    expect(delays).toEqual([0]);
  });

  it("wakes for the earliest owned row with the same topology used for due selection", async () => {
    const reminderTime = new Date(Date.now() + 60_000);
    const triggerTime = new Date(Date.now() + 120_000);
    const reminder = spyOn(serverScheduleRepository, "getNextReminderTime").mockResolvedValue(reminderTime);
    const trigger = spyOn(serverScheduleRepository, "getNextTriggerTime").mockResolvedValue(triggerTime);
    spies.push(reminder, trigger);
    coordinator.start();
    await coordinator.runNow();
    expect(reminder).toHaveBeenCalledWith(topology);
    expect(trigger).toHaveBeenCalledWith(topology);
    expect(coordinator.getStatus().nextWakeAt?.getTime()).toBe(reminderTime.getTime());
    expect(delays.at(-1)).toBeGreaterThan(0);
  });

  it("does not dispatch the next processor after the coordinator stops during a cycle", async () => {
    const reminder = spyOn(ReminderProcessor.prototype, "processDueReminders").mockImplementation(async () => {
      coordinator.stop();
    });
    const trigger = spyOn(RandomTriggerProcessor.prototype, "processDueRandomTriggers");
    const nudge = spyOn(NaturalNudgeProcessor.prototype, "processDueIdleNudges");
    spies.push(reminder, trigger, nudge);
    coordinator.start();
    await coordinator.runNow();
    expect(trigger).not.toHaveBeenCalled();
    expect(nudge).not.toHaveBeenCalled();
    expect(coordinator.getStatus()).toMatchObject({ isRunning: false, isProcessing: false, nextWakeAt: null });
  });

  it("does not re-arm a wake when shutdown overlaps the next-wake database read", async () => {
    let releaseRead: (value: Date) => void = () => {};
    let readStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const pending = new Promise<Date>((resolve) => {
      releaseRead = resolve;
    });
    spies.push(
      spyOn(serverScheduleRepository, "getNextReminderTime").mockImplementation(() => {
        readStarted();
        return pending;
      }),
    );
    spies.push(spyOn(serverScheduleRepository, "getNextTriggerTime").mockResolvedValue(null));
    coordinator.start();
    const cycle = coordinator.runNow();
    await started;
    coordinator.stop();
    releaseRead(new Date(Date.now() + 60_000));
    await cycle;
    expect(coordinator.getStatus().nextWakeAt).toBeNull();
    expect(delays).toEqual([0]);
  });
});

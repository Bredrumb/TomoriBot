import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Client } from "discord.js";
import { NaturalNudgeProcessor } from "@/modules/natural-nudges/runtime/processor";
import { RandomTriggerProcessor } from "@/timers/randomTriggerProcessor";
import { ReminderProcessor } from "@/timers/reminderProcessor";
import { ScheduledWorkCoordinator } from "@/timers/scheduledWorkCoordinator";
import { MAX_SCHEDULED_WORK_LANES, waitForScheduledWorkLanes } from "@/timers/scheduledWorkLanes";
import { reminderSchema } from "@/types/db/schema";
import { serverScheduleRepository } from "@/utils/db/repositories";
import { parseShardTopology } from "@/utils/discord/shardOwnership";
import { log } from "@/utils/misc/logger";

const topology = parseShardTopology({ SHARD_COUNT: "4", SHARD_IDS: "1,3" });
const spies: Array<{ mockRestore(): void }> = [];
const heldLanes: Array<PromiseWithResolvers<void>> = [];
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
  spies.push(spyOn(ReminderProcessor.prototype, "loadDueReminders").mockResolvedValue([]));
  spies.push(spyOn(RandomTriggerProcessor.prototype, "loadDueTriggers").mockResolvedValue([]));
  spies.push(spyOn(NaturalNudgeProcessor.prototype, "processDueIdleNudges").mockResolvedValue());
  coordinator = new ScheduledWorkCoordinator(client, 60_000, topology, {
    hasOwnership: () => true,
    getWorkSignal: () => undefined,
  });
});

afterEach(async () => {
  for (const gate of heldLanes.splice(0)) gate.resolve();
  await waitForScheduledWorkLanes();
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
    expect(reminder).toHaveBeenCalledWith(topology, []);
    expect(trigger).toHaveBeenCalledWith(topology, []);
    expect(coordinator.getStatus().nextWakeAt?.getTime()).toBe(reminderTime.getTime());
    expect(delays.at(-1)).toBeGreaterThan(0);
  });

  it("does not dispatch the next processor after the coordinator stops during a cycle", async () => {
    const reminder = spyOn(ReminderProcessor.prototype, "loadDueReminders").mockImplementation(async () => {
      coordinator.stop();
      return [];
    });
    const trigger = spyOn(RandomTriggerProcessor.prototype, "loadDueTriggers");
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

  it("leaves servers with a running lane out of the next-wake reads", async () => {
    const reminder = spyOn(serverScheduleRepository, "getNextReminderTime").mockResolvedValue(null);
    const trigger = spyOn(serverScheduleRepository, "getNextTriggerTime").mockResolvedValue(null);
    spies.push(reminder, trigger);
    holdDueReminders([5]);
    coordinator.start();
    await coordinator.runNow();
    expect(reminder).toHaveBeenCalledWith(topology, [5]);
    expect(trigger).toHaveBeenCalledWith(topology, [5]);
  });

  it("arms no wake while every lane is busy and re-arms when one settles", async () => {
    const reminder = spyOn(serverScheduleRepository, "getNextReminderTime").mockResolvedValue(null);
    spies.push(reminder, spyOn(serverScheduleRepository, "getNextTriggerTime").mockResolvedValue(null));
    const held = holdDueReminders(Array.from({ length: MAX_SCHEDULED_WORK_LANES }, (_, index) => index + 1));
    coordinator.start();
    await coordinator.runNow();
    expect(reminder).not.toHaveBeenCalled();
    expect(coordinator.getStatus().nextWakeAt).toBeNull();
    expect(delays).toEqual([0]);
    await held.release();
    expect(reminder).toHaveBeenCalled();
  });

  it("keeps an immediate run armed when a settling lane's wake refresh resolves later", async () => {
    const refresh = Promise.withResolvers<Date | null>();
    const nextReminder = spyOn(serverScheduleRepository, "getNextReminderTime").mockResolvedValue(null);
    nextReminder.mockResolvedValueOnce(null).mockReturnValueOnce(refresh.promise);
    spies.push(nextReminder, spyOn(serverScheduleRepository, "getNextTriggerTime").mockResolvedValue(null));
    const held = holdDueReminders([5]);
    coordinator.start();
    await coordinator.runNow();
    await held.release();
    coordinator.requestImmediateRun("nudge");
    const immediate = coordinator.getStatus().nextWakeAt;
    refresh.resolve(new Date(Date.now() + 3_600_000));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(nextReminder).toHaveBeenCalledTimes(2);
    expect(coordinator.getStatus().nextWakeAt).toEqual(immediate);
    expect(delays.at(-1)).toBe(0);
  });
});

function holdDueReminders(serverIds: number[]) {
  const gate = Promise.withResolvers<void>();
  heldLanes.push(gate);
  const rows = serverIds.map((serverId) =>
    reminderSchema.parse({
      reminder_id: serverId,
      server_id: serverId,
      channel_disc_id: "1400000000000000000",
      user_discord_id: "1300000000000000000",
      user_nickname: "Juno",
      reminder_purpose: "Check the oven",
      reminder_time: new Date(Date.now() - 1_000),
      created_by_user_id: 1,
    }),
  );
  spies.push(
    spyOn(ReminderProcessor.prototype, "loadDueReminders").mockResolvedValue(rows),
    spyOn(ReminderProcessor.prototype, "executeReminder").mockImplementation(() => gate.promise),
  );
  return {
    async release() {
      gate.resolve();
      await waitForScheduledWorkLanes();
    },
  };
}

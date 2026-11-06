import { afterEach, beforeAll, beforeEach, expect, it, mock, spyOn } from "bun:test";
import { EventEmitter } from "node:events";
import { ChannelType, Client, ClientUser, Collection, Guild, Message, TextChannel, User } from "discord.js";
import { registerShutdown } from "@/init/shutdown";
import * as chat from "@/events/messageCreate/tomoriChat";
import { ScheduledWorkCoordinator } from "@/timers/scheduledWorkCoordinator";
import { reminderSchema, randomTriggerSchema } from "@/types/db/schema";
import { LEASE_RENEW_MS, type LeaseStore } from "@/utils/cluster/leaseKeeper";
import { ShardLeaseCoordinator } from "@/utils/cluster/shardLeases";
import * as personaCache from "@/utils/cache/tomoriStateCache";
import * as userCache from "@/utils/cache/userCache";
import { serverScheduleRepository } from "@/utils/db/repositories";
import { parseShardTopology } from "@/utils/discord/shardOwnership";
import { log } from "@/utils/misc/logger";
import * as shutdownState from "@/utils/misc/shutdownState";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const spies: Array<{ mockRestore(): void }> = [];
let draining = false;

beforeAll(initializeLocalizer);
beforeEach(() => {
  draining = false;
  spies.push(spyOn(shutdownState, "isDraining").mockImplementation(() => draining));
  spies.push(
    spyOn(shutdownState, "beginDrain").mockImplementation(() => {
      draining = true;
    }),
  );
  for (const method of ["info", "success", "warn"] as const)
    spies.push(spyOn(log, method).mockImplementation(() => {}));
  spies.push(spyOn(log, "error").mockResolvedValue());
});
afterEach(() => {
  for (const spy of spies.splice(0).reverse()) spy.mockRestore();
});

async function fixture() {
  const topology = parseShardTopology({ SHARD_COUNT: "2", SHARD_IDS: "0" });
  const client = new Client({ intents: [] });
  const guild: Guild = Reflect.construct(Guild, [client, { id: "1200000000004194304", name: "Fixture" }]);
  const channel: TextChannel = Reflect.construct(TextChannel, [
    guild,
    {
      id: "1400000000000000000",
      type: ChannelType.GuildText,
      name: "reminders",
    },
    client,
  ]);
  const reminder = reminderSchema.parse({
    reminder_id: 42,
    server_id: 1,
    server_disc_id: guild.id,
    server_is_dm_channel: false,
    channel_disc_id: channel.id,
    user_discord_id: "1300000000000000000",
    user_nickname: "Juno",
    reminder_purpose: "Check the oven",
    reminder_time: new Date(Date.now() - 1_000),
    created_by_user_id: 1,
  });
  const sentMessage: Message<true> = Reflect.construct(Message, [
    client,
    { id: "1500000000000000000", content: "", type: 0 },
    channel,
  ]);
  const send = spyOn(channel, "send").mockResolvedValue(sentMessage);
  const fetch = spyOn(client.channels, "fetch").mockResolvedValue(channel);
  const messages = spyOn(channel.messages, "fetch").mockResolvedValue(new Collection());
  const due = spyOn(serverScheduleRepository, "getDueReminders").mockResolvedValue([reminder]);
  const deleted = spyOn(serverScheduleRepository, "deleteReminderById").mockResolvedValue(true);
  const retried = spyOn(serverScheduleRepository, "scheduleReminderRetry").mockResolvedValue(null);
  const rescheduled = spyOn(serverScheduleRepository, "rescheduleReminder").mockResolvedValue(null);
  const triggers = spyOn(serverScheduleRepository, "getDueTriggers").mockResolvedValue([]);
  const triggerWrite = spyOn(serverScheduleRepository, "rescheduleTrigger").mockResolvedValue(true);
  const nextReminder = spyOn(serverScheduleRepository, "getNextReminderTime").mockResolvedValue(null);
  const nextTrigger = spyOn(serverScheduleRepository, "getNextTriggerTime").mockResolvedValue(null);
  const user = spyOn(userCache, "getCachedUserRow").mockResolvedValue(createUserRow({ language_pref: "en-US" }));
  const destroy = spyOn(client, "destroy").mockResolvedValue();
  const chatCall = spyOn(chat, "tomoriChat").mockResolvedValue("blocked");
  const timers = new Map<number, () => void>();
  let renewalState: "lost" | "uncertain" | "active" = "active";
  let renewalFinished: (() => void) | undefined;
  const renew = mock<LeaseStore["renew"]>(async () => {
    if (renewalState === "uncertain") throw new Error("Controlled renewal failure");
    return renewalState === "lost" ? null : { token: "1" };
  });
  const heldStats = Promise.withResolvers<void>();
  let shutdown: Promise<void> | undefined;
  const leases = new ShardLeaseCoordinator(
    topology,
    {
      onLost: () => {
        shutdown = controller.shutdown({ immediate: true, exitCode: 1 });
        renewalFinished?.();
      },
      onStateChange: () => {},
    },
    {
      takeIfExpired: async () => ({ token: "1" }),
      renew,
      release: async () => true,
    },
    {
      now: () => 0,
      sleep: async () => {},
      schedule: (callback, ms) => {
        timers.set(ms, callback);
        if (ms === LEASE_RENEW_MS) renewalFinished?.();
        return () => {
          timers.delete(ms);
        };
      },
    },
  );
  const coordinator = new ScheduledWorkCoordinator(client, 60_000, topology, {
    hasOwnership: () => leases.hasOwnership(),
    getWorkSignal: () => leases.workSignal,
  });
  const events = new EventEmitter();
  const controller = registerShutdown(
    client,
    {
      stopScheduledWork: () => coordinator.stop(),
      flushStats: () => heldStats.promise,
      cleanupMcp: async () => {},
      cleanupCoordination: () => leases.stop(),
    },
    { on: events.on.bind(events), exit: () => {} },
  );
  expect(await leases.acquire(new AbortController().signal)).toBe(true);
  spies.push(
    send,
    fetch,
    messages,
    due,
    deleted,
    retried,
    rescheduled,
    triggers,
    triggerWrite,
    nextReminder,
    nextTrigger,
    user,
    destroy,
    chatCall,
  );
  coordinator.start();
  return {
    client,
    channel,
    reminder,
    send,
    fetch,
    messages,
    due,
    deleted,
    retried,
    rescheduled,
    triggers,
    triggerWrite,
    user,
    chatCall,
    coordinator,
    leases,
    async transition(state: "lost" | "uncertain" | "active") {
      renewalState = state;
      const callback = timers.get(LEASE_RENEW_MS);
      if (!callback) throw new Error("Missing renewal timer");
      const observed = Promise.withResolvers<void>();
      renewalFinished = observed.resolve;
      callback();
      await observed.promise;
      renewalFinished = undefined;
      expect(leases.hasOwnership()).toBe(state === "active");
    },
    expectUnconsumed() {
      expect(deleted).not.toHaveBeenCalled();
      expect(retried).not.toHaveBeenCalled();
      expect(rescheduled).not.toHaveBeenCalled();
    },
    async close() {
      coordinator.stop();
      heldStats.resolve();
      await shutdown;
      await leases.stop();
      destroy.mockRestore();
      await client.destroy();
    },
  };
}

it("preserves the pending reminder in Task 07's immediate owner-loss shutdown reproduction", async () => {
  const f = await fixture();
  const reached = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<never>();
  f.fetch.mockImplementationOnce(() => {
    reached.resolve();
    return pending.promise;
  });
  const work = f.coordinator.runNow();
  try {
    await reached.promise;
    await f.transition("lost");
    expect(draining).toBe(true);
    expect(f.coordinator.getStatus().isRunning).toBe(false);
    pending.reject(new Error("Controlled channel lookup failure"));
    await work;
    expect(f.send).not.toHaveBeenCalled();
    f.expectUnconsumed();
  } finally {
    await f.close();
  }
});

it.each([
  "channel",
  "locale",
] as const)("cancels a fallback suspended at %s across uncertainty and recovery", async (stage) => {
  const f = await fixture();
  const reached = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  f.fetch.mockRejectedValueOnce(new Error("Controlled lookup failure"));
  if (stage === "channel")
    f.fetch.mockImplementationOnce(async () => {
      reached.resolve();
      await resume.promise;
      return f.channel;
    });
  else
    f.user.mockImplementationOnce(async () => {
      reached.resolve();
      await resume.promise;
      return createUserRow();
    });
  const work = f.coordinator.runNow();
  try {
    await reached.promise;
    await f.transition("uncertain");
    await f.transition("active");
    resume.resolve();
    await work;
    expect(draining).toBe(false);
    expect(f.send).not.toHaveBeenCalled();
    f.expectUnconsumed();
    f.fetch.mockRejectedValueOnce(new Error("Controlled lookup failure after recovery"));
    await f.coordinator.runNow();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.deleted).toHaveBeenCalledWith(f.reminder.reminder_id);
  } finally {
    await f.close();
  }
});

it.each([
  "reminder",
  "trigger",
] as const)("cancels an empty-channel %s before seeding its pre-chat anchor", async (kind) => {
  const f = await fixture();
  const reached = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  if (kind === "trigger") {
    f.due.mockResolvedValue([]);
    f.triggers.mockResolvedValue([
      randomTriggerSchema.parse({
        trigger_id: 7,
        server_id: 1,
        channel_disc_id: f.channel.id,
        timer_hours: 1,
        chance_percent: 100,
        next_trigger_at: new Date(),
      }),
    ]);
  }
  f.messages.mockImplementationOnce((async () => {
    reached.resolve();
    await resume.promise;
    return new Collection<string, Message<true>>();
  }) as typeof f.channel.messages.fetch);
  const work = f.coordinator.runNow();
  try {
    await reached.promise;
    await f.transition("uncertain");
    resume.resolve();
    await work;
    expect(f.send).not.toHaveBeenCalled();
    expect(f.chatCall).not.toHaveBeenCalled();
    expect(f.triggerWrite).not.toHaveBeenCalled();
    f.expectUnconsumed();
  } finally {
    await f.close();
  }
});

it.each([
  false,
  true,
])("settles a delivered random trigger during drain only with its captured owner (%s)", async (lostOwner) => {
  const f = await fixture();
  f.due.mockResolvedValue([]);
  f.triggers.mockResolvedValue([
    randomTriggerSchema.parse({
      trigger_id: 7,
      server_id: 1,
      channel_disc_id: f.channel.id,
      timer_hours: 1,
      chance_percent: 100,
      next_trigger_at: new Date(),
    }),
  ]);
  const persona = createPersona({ persona_id: 1, server_id: 1 });
  spies.push(spyOn(personaCache, "getCachedAllPersonas").mockResolvedValue([persona]));
  const anchor: Message<true> = Reflect.construct(Message, [
    f.client,
    {
      id: "1500000000000000001",
      content: "Hello",
      type: 0,
      author: { id: f.reminder.user_discord_id, username: "Juno", bot: false },
    },
    f.channel,
  ]);
  f.messages.mockResolvedValue(new Collection([[anchor.id, anchor]]));
  f.chatCall.mockImplementationOnce(async (input) => {
    f.coordinator.stop();
    if (lostOwner) await f.transition("uncertain");
    await input.onGenerationResult?.({
      status: "completed",
      streamResults: [],
      personaResponses: [{ personaName: "Tomori", text: "Hello", personaId: 1 }],
    });
    return "run";
  });
  try {
    await f.coordinator.runNow();
    expect(f.triggerWrite).toHaveBeenCalledTimes(lostOwner ? 0 : 1);
  } finally {
    await f.close();
  }
});

it("does not DM the recipient when ownership becomes uncertain during recipient lookup", async () => {
  const f = await fixture();
  const recipient: User = Reflect.construct(User, [f.client, { id: f.reminder.user_discord_id, username: "Juno" }]);
  const dm = spyOn(recipient, "send");
  const reached = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const fetchUser = spyOn(f.client.users, "fetch").mockImplementation(async () => {
    reached.resolve();
    await resume.promise;
    return recipient;
  });
  spies.push(dm, fetchUser);
  f.reminder.repetition_interval_hours = 1;
  f.reminder.failed_occurrence_count = 24;
  f.fetch.mockRejectedValueOnce(new Error("Controlled lookup failure")).mockResolvedValue(null);
  const work = f.coordinator.runNow();
  try {
    await reached.promise;
    await f.transition("uncertain");
    resume.resolve();
    await work;
    expect(dm).not.toHaveBeenCalled();
    expect(f.deleted).toHaveBeenCalledWith(f.reminder.reminder_id);
  } finally {
    await f.close();
  }
});

it("does not spend an exhausted retry budget after its generation callback is cancelled", async () => {
  const f = await fixture();
  const reached = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  f.reminder.delivery_retry_count = 5;
  const anchor: Message<true> = Reflect.construct(Message, [
    f.client,
    {
      id: "1500000000000000001",
      content: "Hello",
      type: 0,
      author: { id: f.reminder.user_discord_id, username: "Juno", bot: false },
    },
    f.channel,
  ]);
  f.messages.mockResolvedValue(new Collection([[anchor.id, anchor]]));
  f.chatCall.mockImplementationOnce(async (input) => {
    reached.resolve();
    await resume.promise;
    await input.onGenerationResult?.({ status: "stopped_by_user", streamResults: [], personaResponses: [] });
    return "run";
  });
  const work = f.coordinator.runNow();
  try {
    await reached.promise;
    await f.transition("uncertain");
    resume.resolve();
    await work;
    expect(f.send).not.toHaveBeenCalled();
    f.expectUnconsumed();
    await f.transition("active");
    await f.coordinator.runNow();
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.deleted).toHaveBeenCalledWith(f.reminder.reminder_id);
  } finally {
    await f.close();
  }
});

it("does not send a recipient mention after cancellation during mention verification", async () => {
  const f = await fixture();
  f.client.user = Reflect.construct(ClientUser, [f.client, { id: "1100000000000000000", username: "Tomori" }]);
  const anchor: Message<true> = Reflect.construct(Message, [
    f.client,
    {
      id: "1500000000000000001",
      content: "Hello",
      type: 0,
      author: { id: f.reminder.user_discord_id, username: "Juno", bot: false },
    },
    f.channel,
  ]);
  const reached = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  f.messages.mockResolvedValueOnce(new Collection([[anchor.id, anchor]]));
  f.messages.mockImplementationOnce((async () => {
    reached.resolve();
    await resume.promise;
    return new Collection<string, Message<true>>();
  }) as typeof f.channel.messages.fetch);
  f.chatCall.mockImplementationOnce(async (input) => {
    await input.onGenerationResult?.({ status: "completed", streamResults: [], personaResponses: [] });
    return "run";
  });
  const work = f.coordinator.runNow();
  try {
    await reached.promise;
    await f.transition("uncertain");
    resume.resolve();
    await work;
    expect(f.send).not.toHaveBeenCalled();
    f.expectUnconsumed();
  } finally {
    await f.close();
  }
});

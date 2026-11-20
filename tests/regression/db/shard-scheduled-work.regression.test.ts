import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { Client, ShardClientUtil } from "discord.js";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { ScheduledWorkCoordinator } from "@/timers/scheduledWorkCoordinator";
import { ReminderProcessor } from "@/timers/reminderProcessor";
import { serverScheduleRepository } from "@/utils/db/repositories/ServerScheduleRepository";
import { statRepository } from "@/utils/db/repositories/StatRepository";
import { parseShardTopology } from "@/utils/discord/shardOwnership";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

type Server = { server_id: number; server_disc_id: string; is_dm_channel: boolean };

const sorted = (values: (string | number | undefined)[]) => [...values].sort();
const owner = (total: number, ids: number[]) =>
  parseShardTopology({ SHARD_COUNT: String(total), SHARD_IDS: ids.join(",") });

describe.skipIf(!DB_TESTS_AVAILABLE)("shard-owned scheduled work", () => {
  let refs: FixtureRefs;
  const servers: Server[] = [];
  const now = new Date();
  const overdue = new Date(now.getTime() - 60_000);

  async function addServer(discId: string, isDm = false) {
    const [server] = await testSql<Server[]>`
      INSERT INTO servers (server_disc_id, is_dm_channel)
      VALUES (${discId}, ${isDm}) RETURNING server_id, server_disc_id, is_dm_channel
    `;
    servers.push(server);
    return server;
  }

  async function addReminder(serverId: number, time = overdue) {
    const reminder = await serverScheduleRepository.addReminder({
      server_id: serverId,
      channel_disc_id: "1400000000000000001",
      user_discord_id: "1200000000000000001",
      user_nickname: "Juno",
      reminder_purpose: "Water the plants.",
      reminder_time: time,
      created_by_user_id: refs.userId,
      repetition: { unit: "months", interval: 1 },
    });
    if (!reminder?.reminder_id) throw new Error("Reminder fixture creation failed");
    return reminder;
  }

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    await testSql`UPDATE servers SET server_disc_id = '1600000000000000001' WHERE server_id = ${refs.serverId}`;
    for (let index = 0; index < 12; index++) {
      await addServer(String(1000000000000000001n + BigInt(index) * 4194304n));
    }
    await addServer("1300000000000000001", true);
    await addServer("1300000000004194305", true);
    for (const [index, server] of servers.entries()) {
      await addReminder(server.server_id, new Date(overdue.getTime() - index * 1000));
      const trigger = await serverScheduleRepository.insertTrigger({
        serverId: server.server_id,
        channelDiscId: "1400000000000000001",
        personaId: null,
        timerHours: 2,
        randomOffsetRange: null,
        chancePercent: 100,
        silenceThresholdHours: null,
        respondToSelf: false,
        customPrompt: null,
        failureThreshold: 3,
      });
      if (!trigger?.trigger_id) throw new Error("Trigger fixture creation failed");
      await testSql`
        UPDATE random_triggers SET next_trigger_at = ${new Date(overdue.getTime() - index * 1000)},
          consecutive_failures = 2 WHERE trigger_id = ${trigger.trigger_id}
      `;
      await naturalNudgeRepository.recordDirectChat(server.server_id);
      for (const metric of ["message_sent", "presence_seen", "command_used"]) {
        await testSql`
          INSERT INTO stat_counters (server_id, user_id, persona_lineage_id, metric, metric_key, bucket, count)
          VALUES (${server.server_id}, ${refs.userId}, 0, ${metric}, '', CURRENT_DATE, 1)
        `;
      }
    }
    const disabled = await addServer("1200000000000000001");
    await naturalNudgeRepository.recordDirectChat(disabled.server_id);
    expect(await naturalNudgeRepository.saveServerConfig(disabled.server_id, { idle_nudges_enabled: false })).toBe(
      true,
    );
    const dormant = await addServer("1200000000004194305");
    await testSql`
      INSERT INTO server_natural_nudge_runtime_state (server_id, last_direct_chat_at)
      VALUES (${dormant.server_id}, ${new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000)})
    `;
    await testSql`
      INSERT INTO stat_counters (server_id, user_id, persona_lineage_id, metric, metric_key, bucket, count)
      VALUES (${disabled.server_id}, ${refs.userId}, 0, 'command_used', '', CURRENT_DATE, 1)
    `;
  });

  afterAll(async () => {
    await testSql`DELETE FROM servers WHERE server_id = ANY(${testSql.array(
      servers.map((s) => s.server_id),
      "INT",
    )})`;
    await testSql`DELETE FROM servers WHERE server_id = ${refs.serverId}`;
    await cleanupFixtures(testSql);
  });

  it("keeps all-owner selection before automatic gateway discovery resolves", async () => {
    const topology = parseShardTopology({});
    expect(await serverScheduleRepository.getDueReminders(topology)).toEqual(
      await serverScheduleRepository.getDueReminders(),
    );
    expect(await serverScheduleRepository.getDueTriggers(topology)).toEqual(
      await serverScheduleRepository.getDueTriggers(),
    );
    expect(await serverScheduleRepository.getNextReminderTime(topology)).toEqual(
      await serverScheduleRepository.getNextReminderTime(),
    );
    expect(await serverScheduleRepository.getNextTriggerTime(topology)).toEqual(
      await serverScheduleRepository.getNextTriggerTime(),
    );
    expect(await naturalNudgeRepository.listEnabledIdleNudgeServers(now, topology)).toEqual(
      await naturalNudgeRepository.listEnabledIdleNudgeServers(now),
    );
    expect(
      sorted(
        (await statRepository.getPresenceRetentionPairs(topology)).map((p) => `${p.server_disc_id}:${p.user_disc_id}`),
      ),
    ).toEqual(
      sorted((await statRepository.getPresenceRetentionPairs()).map((p) => `${p.server_disc_id}:${p.user_disc_id}`)),
    );
  });

  it.each([
    1, 2, 3, 4, 7,
  ])("partitions due rows and next wakes exactly like discord.js with %i shards", async (total) => {
    const allReminders = await serverScheduleRepository.getDueReminders();
    const allTriggers = await serverScheduleRepository.getDueTriggers();
    expect(allReminders).not.toBeNull();
    expect(allReminders?.length).toBeGreaterThan(0);
    expect(allTriggers.length).toBeGreaterThan(0);
    const reminderUnion: (number | undefined)[] = [];
    const triggerUnion: (number | undefined)[] = [];
    for (let shard = 0; shard < total; shard++) {
      const topology = owner(total, [shard]);
      const expectedServers = servers.filter((s) =>
        s.is_dm_channel ? shard === 0 : ShardClientUtil.shardIdForGuildId(s.server_disc_id, total) === shard,
      );
      const ids = new Set(expectedServers.map((s) => s.server_id));
      const expectedReminders = (allReminders ?? []).filter((r) => ids.has(r.server_id));
      const expectedTriggers = allTriggers.filter((t) => ids.has(t.server_id));
      const reminders = await serverScheduleRepository.getDueReminders(topology);
      const triggers = await serverScheduleRepository.getDueTriggers(topology);
      expect(reminders?.map((r) => r.reminder_id)).toEqual(expectedReminders.map((r) => r.reminder_id));
      expect(triggers.map((t) => t.trigger_id)).toEqual(expectedTriggers.map((t) => t.trigger_id));
      expect(await serverScheduleRepository.getNextReminderTime(topology)).toEqual(
        expectedReminders[0]?.reminder_time ?? null,
      );
      expect(await serverScheduleRepository.getNextTriggerTime(topology)).toEqual(
        expectedTriggers[0]?.next_trigger_at ?? null,
      );
      reminderUnion.push(...(reminders ?? []).map((r) => r.reminder_id));
      triggerUnion.push(...triggers.map((t) => t.trigger_id));
    }
    expect(sorted(reminderUnion)).toEqual(sorted((allReminders ?? []).map((r) => r.reminder_id)));
    expect(sorted(triggerUnion)).toEqual(sorted(allTriggers.map((t) => t.trigger_id)));
  });

  it("partitions enabled idle nudges and unique presence pairs across shard groups", async () => {
    const allNudges = await naturalNudgeRepository.listEnabledIdleNudgeServers(now);
    const allPairs = await statRepository.getPresenceRetentionPairs();
    expect(sorted(allNudges.map((s) => s.server_disc_id))).toEqual(
      sorted(servers.slice(0, 12).map((s) => s.server_disc_id)),
    );
    expect(sorted(allPairs.map((p) => p.server_disc_id))).toEqual(
      sorted(servers.slice(0, 12).map((s) => s.server_disc_id)),
    );
    const nudgeUnion: number[] = [];
    const pairUnion: string[] = [];
    for (const shards of [
      [0, 2],
      [1, 3],
    ]) {
      const topology = owner(4, shards);
      const nudges = await naturalNudgeRepository.listEnabledIdleNudgeServers(now, topology);
      const pairs = await statRepository.getPresenceRetentionPairs(topology);
      const belongs = (discId: string) => shards.includes(ShardClientUtil.shardIdForGuildId(discId, 4));
      expect(sorted(nudges.map((s) => s.server_id))).toEqual(
        sorted(allNudges.filter((s) => belongs(s.server_disc_id)).map((s) => s.server_id)),
      );
      expect(pairs.every((p) => p.user_disc_id === allPairs[0]?.user_disc_id)).toBe(true);
      expect(sorted(pairs.map((p) => p.server_disc_id))).toEqual(
        sorted(allPairs.filter((p) => belongs(p.server_disc_id)).map((p) => p.server_disc_id)),
      );
      nudgeUnion.push(...nudges.map((s) => s.server_id));
      pairUnion.push(...pairs.map((p) => `${p.server_disc_id}:${p.user_disc_id}`));
    }
    expect(sorted(nudgeUnion)).toEqual(sorted(allNudges.map((s) => s.server_id)));
    expect(sorted(pairUnion)).toEqual(sorted(allPairs.map((p) => `${p.server_disc_id}:${p.user_disc_id}`)));
  });

  it("keeps canonical recurrence, delivery retries, ordering and trigger failure state within the owner", async () => {
    const server = servers[0];
    const shard = ShardClientUtil.shardIdForGuildId(server.server_disc_id, 4);
    const topology = owner(4, [shard]);
    const otherOwner = owner(4, [(shard + 1) % 4]);
    const reminder = await addReminder(server.server_id);
    const retryTime = new Date(now.getTime() + 60 * 60 * 1000);
    const id = reminder.reminder_id;
    if (!id) throw new Error("Missing reminder ID");
    const retried = await serverScheduleRepository.scheduleReminderRetry(id, retryTime, 2);
    expect(retried).toMatchObject({
      reminder_time: overdue,
      next_attempt_at: retryTime,
      delivery_retry_count: 2,
      repetition_interval_months: 1,
    });
    expect((await serverScheduleRepository.getDueReminders(topology))?.some((r) => r.reminder_id === id)).toBe(false);
    const retryDue = new Date(now.getTime() - 10_000);
    await serverScheduleRepository.scheduleReminderRetry(id, retryDue, 3);
    const due = await serverScheduleRepository.getDueReminders(topology);
    expect(due?.at(-1)).toMatchObject({
      reminder_id: id,
      reminder_time: overdue,
      next_attempt_at: retryDue,
      delivery_retry_count: 3,
    });
    expect((await serverScheduleRepository.getDueReminders(otherOwner))?.some((r) => r.reminder_id === id)).toBe(false);
    const nextOccurrence = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(
      await serverScheduleRepository.rescheduleReminder(id, { time: nextOccurrence, anchorDay: 31 }, 1),
    ).toMatchObject({
      next_attempt_at: null,
      delivery_retry_count: 0,
      repetition_anchor_day: 31,
      failed_occurrence_count: 1,
    });
    const trigger = (await serverScheduleRepository.getDueTriggers(topology)).find(
      (t) => t.server_id === server.server_id,
    );
    if (!trigger?.trigger_id) throw new Error("Missing trigger");
    expect(trigger.consecutive_failures).toBe(2);
    expect(await serverScheduleRepository.rescheduleTrigger(trigger.trigger_id, 2, null, 3)).toBe(true);
    expect(
      (await serverScheduleRepository.getServerTriggers(server.server_id)).find(
        (t) => t.trigger_id === trigger.trigger_id,
      ),
    ).toMatchObject({ consecutive_failures: 3 });
    expect(
      (await serverScheduleRepository.getDueTriggers(topology)).some((t) => t.trigger_id === trigger.trigger_id),
    ).toBe(false);
  });

  it("does not wake immediately for another owner's overdue reminders or random triggers", async () => {
    const topology = owner(32, [20]);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    let discId = 1500000000000000001n;
    while (ShardClientUtil.shardIdForGuildId(String(discId), 32) !== 20) discId += 4194304n;
    const server = await addServer(String(discId));
    const client = new Client({ intents: [] });
    const fetch = spyOn(client.channels, "fetch");
    const nativeTimeout = globalThis.setTimeout;
    const delays: number[] = [];
    const timeout = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay?: number) => {
      delays.push(delay ?? 0);
      return nativeTimeout(callback, 86_400_000).unref();
    }) as typeof setTimeout);
    const coordinator = new ScheduledWorkCoordinator(client, 60_000, topology, {
      hasOwnership: () => true,
      getWorkSignal: () => undefined,
    });
    try {
      expect((await serverScheduleRepository.getDueReminders())?.length).toBeGreaterThan(0);
      expect((await serverScheduleRepository.getDueTriggers()).length).toBeGreaterThan(0);
      expect(await serverScheduleRepository.getDueReminders(topology)).toEqual([]);
      expect(await serverScheduleRepository.getDueTriggers(topology)).toEqual([]);
      expect(await serverScheduleRepository.getNextReminderTime(topology)).toBeNull();
      expect(await serverScheduleRepository.getNextTriggerTime(topology)).toBeNull();
      coordinator.start();
      await coordinator.runNow();
      expect(coordinator.getStatus().nextWakeAt).toBeNull();
      expect(delays).toEqual([0]);
      await addReminder(server.server_id, future);
      await coordinator.runNow();
      expect(coordinator.getStatus().nextWakeAt?.getTime()).toBe(future.getTime());
      expect(delays.at(-1)).toBeGreaterThan(0);
      const [reminder] =
        (await serverScheduleRepository.getPendingRemindersForUser("1200000000000000001", server.server_disc_id)) ?? [];
      if (!reminder?.reminder_id) throw new Error("Missing future reminder");
      const retryTime = new Date(future.getTime() + 60 * 60 * 1000);
      await serverScheduleRepository.scheduleReminderRetry(reminder.reminder_id, retryTime, 2);
      expect(await serverScheduleRepository.getNextReminderTime(topology)).toEqual(retryTime);
      const trigger = await serverScheduleRepository.insertTrigger({
        serverId: server.server_id,
        channelDiscId: "1400000000000000001",
        personaId: null,
        timerHours: 1,
        randomOffsetRange: null,
        chancePercent: 100,
        silenceThresholdHours: null,
        respondToSelf: false,
        customPrompt: null,
        failureThreshold: null,
      });
      if (!trigger?.trigger_id) throw new Error("Missing future trigger");
      await testSql`UPDATE random_triggers SET next_trigger_at = ${future} WHERE trigger_id = ${trigger.trigger_id}`;
      expect(await serverScheduleRepository.getNextTriggerTime(topology)).toEqual(future);
      await coordinator.runNow();
      expect(coordinator.getStatus().nextWakeAt?.getTime()).toBe(future.getTime());
      expect(delays.at(-1)).toBeGreaterThan(0);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      coordinator.stop();
      timeout.mockRestore();
      fetch.mockRestore();
      await client.destroy();
    }
  });
  it("preserves the stored occurrence and retry budget when owner cancellation interrupts delivery", async () => {
    let discId = 1700000000000000001n;
    while (ShardClientUtil.shardIdForGuildId(String(discId), 32) !== 17) discId += 4194304n;
    const server = await addServer(String(discId));
    const reminder = await addReminder(server.server_id);
    const topology = owner(32, [17]);
    const client = new Client({ intents: [] });
    const reached = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<never>();
    const fetch = spyOn(client.channels, "fetch").mockImplementation(() => {
      reached.resolve();
      return pending.promise;
    });
    const controller = new AbortController();
    const processor = new ReminderProcessor(client, topology);
    const work = processor.processDueReminders({ signal: controller.signal, hasOwnership: () => true });
    try {
      await reached.promise;
      controller.abort();
      pending.reject(new Error("Controlled lookup failure after cancellation"));
      await work;
      expect(fetch).toHaveBeenCalledTimes(1);
      if (!reminder.reminder_id) throw new Error("Missing reminder ID");
      expect(await serverScheduleRepository.getReminderById(reminder.reminder_id)).toMatchObject({
        reminder_time: reminder.reminder_time,
        next_attempt_at: null,
        delivery_retry_count: 0,
        failed_occurrence_count: 0,
        repetition_interval_months: 1,
      });
    } finally {
      fetch.mockRestore();
      await client.destroy();
    }
  });
});

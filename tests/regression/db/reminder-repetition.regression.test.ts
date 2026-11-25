import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { serverScheduleRepository } from "@/utils/db/repositories/ServerScheduleRepository";
import { cleanupFixtures, FIXTURE_IDS, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("reminder repetition", () => {
  let refs: FixtureRefs;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    await testSql`
      INSERT INTO server_chat_configs (server_id, timezone_offset) VALUES (${refs.serverId}, 9)
      ON CONFLICT (server_id) DO UPDATE SET timezone_offset = EXCLUDED.timezone_offset
    `;
  });

  afterAll(async () => {
    await testSql`DELETE FROM reminders WHERE server_id = ${refs.serverId}`;
    await cleanupFixtures(testSql);
  });

  it("keeps a finite minute schedule when edited and decrements its count when a delivery advances it", async () => {
    const reminderTime = new Date("2099-01-02T03:30:00Z");
    const created = await serverScheduleRepository.addReminder({
      server_id: refs.serverId,
      channel_disc_id: "100000000000000001",
      user_discord_id: "200000000000000001",
      user_nickname: "Juno",
      reminder_purpose: "Check the queue.",
      reminder_time: reminderTime,
      repetition: { unit: "minutes", interval: 15 },
      recurrenceOptions: { limit: { remaining: 3 }, window: { start: 540, end: 1020, timezoneOffset: 5.5 } },
      created_by_user_id: null,
    });
    expect(created).toMatchObject({
      repetition_interval_minutes: 15,
      repetition_interval_hours: null,
      repetition_interval_months: null,
      repeat_remaining_count: 3,
      daily_window_timezone_offset: 5.5,
    });
    const reminderId = created?.reminder_id as number;
    const advanced = await serverScheduleRepository.rescheduleReminder(reminderId, {
      time: new Date("2099-01-02T03:45:00Z"),
      anchorDay: null,
      consumeRepeatCount: true,
    });
    expect(advanced?.repeat_remaining_count).toBe(2);

    const unchanged = await serverScheduleRepository.updateReminder({
      reminder_id: reminderId,
      server_id: refs.serverId,
      reminder_purpose: "Recheck the queue.",
      reminder_time: reminderTime,
      repetition: { unit: "minutes", interval: 15 },
      self_reminder: false,
      user_discord_id: "200000000000000001",
      user_nickname: "Juno",
    });
    expect(unchanged).toMatchObject({ repeat_remaining_count: 2, daily_window_start_minutes: 540 });
  });

  it("carries the server offset and creator to the scheduler and keeps the anchor while edits stay on the same local day", async () => {
    const created = await serverScheduleRepository.addReminder({
      server_id: refs.serverId,
      channel_disc_id: "100000000000000001",
      user_discord_id: "200000000000000001",
      user_nickname: "Juno",
      reminder_purpose: "Pay rent.",
      reminder_time: new Date(Date.now() - 1_000),
      repetition: { unit: "months", interval: 1 },
      created_by_user_id: refs.userId,
    });
    const reminderId = created?.reminder_id as number;
    expect(created).toMatchObject({ repetition_interval_months: 1, repetition_interval_hours: null });

    const due = (await serverScheduleRepository.getDueReminders())?.find((row) => row.reminder_id === reminderId);
    expect(due?.server_timezone_offset).toBe(9);
    expect(due?.created_by_user_disc_id).toBe(FIXTURE_IDS.userDiscId);

    // Relative-time reminders store seconds; at UTC+9 this is Feb 28 09:00:37 on the server's calendar.
    const clampedOccurrence = new Date("2099-02-28T00:00:37.123Z");
    const rescheduled = await serverScheduleRepository.rescheduleReminder(reminderId, {
      time: clampedOccurrence,
      anchorDay: 31,
    });
    expect(rescheduled?.repetition_anchor_day).toBe(31);

    const edit = (reminderTime: Date) =>
      serverScheduleRepository.updateReminder({
        reminder_id: reminderId,
        server_id: refs.serverId,
        reminder_purpose: "Pay rent and utilities.",
        reminder_time: reminderTime,
        repetition: { unit: "months", interval: 1 },
        self_reminder: false,
        user_discord_id: "200000000000000001",
        user_nickname: "Juno",
      });

    expect((await edit(new Date("2099-02-28T00:00:00Z")))?.repetition_anchor_day).toBe(31);
    expect((await edit(new Date("2099-02-28T05:00:00Z")))?.repetition_anchor_day).toBe(31);
    // Still Feb 28 in UTC, but Mar 1 01:00 at UTC+9, so the series moved to a new day.
    expect((await edit(new Date("2099-02-28T16:00:00Z")))?.repetition_anchor_day).toBeNull();
  });
});

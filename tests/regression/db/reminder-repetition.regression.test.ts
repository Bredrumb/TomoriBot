import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { serverScheduleRepository } from "@/utils/db/repositories/ServerScheduleRepository";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("monthly reminder repetition", () => {
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

  it("carries the server offset to the scheduler and keeps the anchor while edits stay on the same local day", async () => {
    const created = await serverScheduleRepository.addReminder({
      server_id: refs.serverId,
      channel_disc_id: "100000000000000001",
      user_discord_id: "200000000000000001",
      user_nickname: "Juno",
      reminder_purpose: "Pay rent.",
      reminder_time: new Date(Date.now() - 1_000),
      repetition: { unit: "months", interval: 1 },
      created_by_user_id: null,
    });
    const reminderId = created?.reminder_id as number;
    expect(created).toMatchObject({ repetition_interval_months: 1, repetition_interval_hours: null });

    const due = (await serverScheduleRepository.getDueReminders())?.find((row) => row.reminder_id === reminderId);
    expect(due?.server_timezone_offset).toBe(9);

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

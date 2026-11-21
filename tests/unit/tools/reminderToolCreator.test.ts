import { afterEach, beforeAll, describe, expect, it, setSystemTime, spyOn } from "bun:test";
import type { ToolContext } from "@/types/tool/interfaces";
import type { ReminderRow } from "@/types/db/schema";
import { ReminderTool } from "@/tools/functionCalls/reminderTool";
import { serverScheduleRepository, userRepository } from "@/utils/db/repositories";
import * as expandableEmbedNotice from "@/utils/discord/expandableEmbedNotice";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { formatTimeWithOffset } from "@/utils/text/timezoneHelper";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";
import { stubLogMembers } from "../../helpers/mockSurface";

beforeAll(initializeLocalizer);
afterEach(() => setSystemTime());
stubLogMembers({ info: () => undefined, success: () => undefined });

const ANCHOR_AUTHOR = createUserRow({ user_id: 11, user_disc_id: "fixture-juno" });

async function executeTaskCreation(
  context: Partial<ToolContext>,
  timing: Record<string, unknown> = { minutes_from_now: 30, repetition_interval_hours: 0 },
) {
  const addReminder = spyOn(serverScheduleRepository, "addReminder").mockImplementation(
    async (row) => ({ ...row, reminder_id: 5 }) as unknown as ReminderRow,
  );
  const sendNotice = spyOn(expandableEmbedNotice, "sendTaskEmbedWithExpand").mockResolvedValue(undefined as never);
  const spies = [addReminder, spyOn(userRepository, "loadByDiscordId").mockResolvedValue(ANCHOR_AUTHOR), sendNotice];
  try {
    const result = await new ReminderTool().execute(
      { reminder_purpose: "Check the build.", self_reminder: true, ...timing },
      {
        channel: { id: "fixture-channel" },
        client: { user: { id: "fixture-bot", username: "Tomori" } },
        tomoriState: createPersona(),
        locale: "en-US",
        provider: "google",
        userId: ANCHOR_AUTHOR.user_disc_id,
        ...context,
      } as ToolContext,
    );
    return { result, row: addReminder.mock.calls[0]?.[0], notice: sendNotice.mock.calls[0]?.[1] };
  } finally {
    for (const spy of spies.reverse()) spy.mockRestore();
  }
}

async function createTaskAndReadCreator(context: Partial<ToolContext>): Promise<number | null | undefined> {
  const { result, row } = await executeTaskCreation(context);
  expect(result.success).toBeTrue();
  return row?.created_by_user_id;
}

describe("create_task recurrence", () => {
  it("defaults the first hourly trigger to one interval and honors an explicit delay", async () => {
    setSystemTime(new Date("2030-06-10T10:00:00Z"));
    const context = { internalUserId: ANCHOR_AUTHOR.user_id };
    const hourly = await executeTaskCreation(context, { repetition_interval_hours: 1 });
    const explicit = await executeTaskCreation(context, { repetition_interval_hours: 1, minutes_from_now: 5 });

    expect(hourly.result.success).toBeTrue();
    expect(hourly.row?.reminder_time.toISOString()).toBe("2030-06-10T11:00:00.000Z");
    expect(explicit.result.success).toBeTrue();
    expect(explicit.row?.reminder_time.toISOString()).toBe("2030-06-10T10:05:00.000Z");
  });

  it("shows the cutoff and daily window together on the creation notice", async () => {
    setSystemTime(new Date("2030-06-10T10:00:00Z"));
    const context = { internalUserId: ANCHOR_AUTHOR.user_id };
    const timing = {
      repetition_interval_hours: 1,
      repeat_until_time: "2030-06-10_16:00",
      daily_window_start_time: "12:00",
      daily_window_end_time: "15:00",
    };
    const reminder = await executeTaskCreation(context, { ...timing, self_reminder: false });
    const selfTask = await executeTaskCreation(context, timing);

    expect(reminder.result.success).toBeTrue();
    expect(reminder.row?.reminder_time.toISOString()).toBe("2030-06-10T12:00:00.000Z");
    expect(selfTask.result.success).toBeTrue();
    const reminderFooter = localizer("en-US", reminder.notice?.footerKey ?? "", reminder.notice?.footerVars);
    const selfTaskBody = localizer("en-US", selfTask.notice?.descriptionKey ?? "", selfTask.notice?.descriptionVars);
    const cutoff = formatTimeWithOffset(new Date("2030-06-10T16:00:00Z"), 0, { month: "short" }, "en-US");
    for (const text of [reminderFooter, selfTaskBody]) {
      expect(text).toContain(
        localizedCopy("en-US", "reminders.task_update_repeat_hours", { repetition_interval_hours: 1 }),
      );
      expect(text).toContain(
        localizedCopy("en-US", "reminders.task_update_repeat_until", { time: cutoff, offset: "UTC+0" }),
      );
      expect(text).toContain(
        localizedCopy("en-US", "reminders.task_update_repeat_window", {
          start: "12:00",
          end: "15:00",
          offset: "UTC+0",
        }),
      );
    }
  });

  it("starts a minute schedule after one interval and saves its finite limit", async () => {
    const before = Date.now();
    const { result, row } = await executeTaskCreation(
      {
        internalUserId: ANCHOR_AUTHOR.user_id,
      },
      { repetition_interval_hours: 0, repetition_interval_minutes: 15, repeat_count: 2 },
    );
    expect(result.success).toBeTrue();
    expect(row).toMatchObject({
      repetition: { unit: "minutes", interval: 15 },
      recurrenceOptions: { limit: { remaining: 2 } },
    });
    expect(row?.reminder_time.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000);
    expect(row?.reminder_time.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
  });
});

describe("create_task creator attribution", () => {
  it("allows a task created within its private destination channel", async () => {
    expect(
      await createTaskAndReadCreator({
        tomoriState: createPersona({ config: { private_channel_ids: ["fixture-channel"] } }),
        internalUserId: ANCHOR_AUTHOR.user_id,
      }),
    ).toBe(ANCHOR_AUTHOR.user_id);
  });

  it("credits the requester on an ordinary turn", async () => {
    expect(await createTaskAndReadCreator({ internalUserId: ANCHOR_AUTHOR.user_id })).toBe(ANCHOR_AUTHOR.user_id);
  });

  it("credits a borrowed turn's billed owner, or nobody, never the anchor message's author", async () => {
    expect(await createTaskAndReadCreator({ borrowsTriggerMessage: true, internalUserId: 77 })).toBe(77);
    expect(await createTaskAndReadCreator({ borrowsTriggerMessage: true })).toBeNull();
  });
});

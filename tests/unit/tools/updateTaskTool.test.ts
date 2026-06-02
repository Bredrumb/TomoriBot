import { describe, expect, it } from "bun:test";
import { canReminderActorModifyReminder, parseUpdateTaskArguments } from "@/tools/functionCalls/updateTaskTool";
import { formatPendingReminderForContext } from "@/utils/text/context/participants";

describe("update_task helpers", () => {
  it("parses blank reminder_purpose as delete and ignores scheduling fields", () => {
    const result = parseUpdateTaskArguments(
      {
        reminder_id: 42,
        reminder_purpose: "   ",
        minutes_from_now: -1,
        repetition_interval_hours: -1,
      },
      0,
    );

    expect(result).toEqual({
      ok: true,
      reminderId: 42,
      newPurpose: "",
      isDeleteRequested: true,
      hasRepetitionIntervalUpdate: false,
    });
  });

  it("parses a content-only update without forcing time or interval changes", () => {
    const result = parseUpdateTaskArguments(
      {
        reminder_id: 7,
        reminder_purpose: "Bring up the deployment checklist.",
      },
      9,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reminderId).toBe(7);
    expect(result.newPurpose).toBe("Bring up the deployment checklist.");
    expect(result.isDeleteRequested).toBe(false);
    expect(result.newReminderTime).toBeUndefined();
    expect(result.hasRepetitionIntervalUpdate).toBe(false);
  });

  it("parses relative reschedules and clears recurrence with interval 0", () => {
    const before = Date.now();
    const result = parseUpdateTaskArguments(
      {
        reminder_id: 9,
        reminder_purpose: "Review the new logs.",
        hours_from_now: 2,
        repetition_interval_hours: 0,
      },
      0,
    );
    const after = Date.now();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newReminderTime?.getTime()).toBeGreaterThanOrEqual(before + 2 * 60 * 60 * 1000);
    expect(result.newReminderTime?.getTime()).toBeLessThanOrEqual(after + 2 * 60 * 60 * 1000 + 10);
    expect(result.hasRepetitionIntervalUpdate).toBe(true);
    expect(result.repetitionIntervalHours).toBeNull();
  });

  it("rejects invalid IDs, intervals, and past absolute times", () => {
    expect(
      parseUpdateTaskArguments(
        {
          reminder_id: 0,
          reminder_purpose: "Update this.",
        },
        0,
      ),
    ).toMatchObject({ ok: false, status: "task_update_failed_invalid_args" });

    expect(
      parseUpdateTaskArguments(
        {
          reminder_id: 1,
          reminder_purpose: "Update this.",
          repetition_interval_hours: -1,
        },
        0,
      ),
    ).toMatchObject({ ok: false, status: "task_update_failed_invalid_args" });

    expect(
      parseUpdateTaskArguments(
        {
          reminder_id: 1,
          reminder_purpose: "Update this.",
          reminder_time: "2000-01-01_00:00",
        },
        0,
      ),
    ).toMatchObject({ ok: false, status: "task_update_failed_invalid_time" });
  });

  it("authorizes creator and non-self target edits, but not unrelated users", () => {
    const reminder = {
      created_by_user_id: 10,
      self_reminder: false,
      user_discord_id: "target-user",
    };

    expect(canReminderActorModifyReminder(reminder, { requesterUserId: 10 })).toBe(true);
    expect(canReminderActorModifyReminder(reminder, { requesterDiscordId: "target-user" })).toBe(true);
    expect(canReminderActorModifyReminder(reminder, { requesterDiscordId: "other-user" })).toBe(false);
  });

  it("requires creator ownership for self tasks", () => {
    const reminder = {
      created_by_user_id: 10,
      self_reminder: true,
      user_discord_id: "bot-user",
    };

    expect(canReminderActorModifyReminder(reminder, { requesterUserId: 10 })).toBe(true);
    expect(canReminderActorModifyReminder(reminder, { requesterDiscordId: "bot-user" })).toBe(false);
  });

  it("authorizes Matrix relay targets by bridge user ID", () => {
    const reminder = {
      created_by_user_id: null,
      self_reminder: false,
      user_discord_id: "@alice:matrix.example",
    };

    expect(canReminderActorModifyReminder(reminder, { requesterBridgeUserId: "@alice:matrix.example" })).toBe(true);
    expect(canReminderActorModifyReminder(reminder, { requesterBridgeUserId: "@bob:matrix.example" })).toBe(false);
  });

  it("formats pending reminders with ID and recurrence details for context", () => {
    const formatted = formatPendingReminderForContext(
      {
        reminder_id: 42,
        reminder_purpose: "Take meds",
        reminder_time: new Date("2026-05-21T17:00:00.000Z"),
        repetition_interval_hours: 24,
      },
      -7,
    );

    expect(formatted).toContain('ID:42 "Take meds"');
    expect(formatted).toContain("UTC-7");
    expect(formatted).toContain("repeats every 24 hour(s)");
  });
});

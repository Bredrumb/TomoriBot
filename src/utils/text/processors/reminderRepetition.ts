import type { ReminderRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { addMonthsWithOffset, getDayOfMonthWithOffset } from "@/utils/text/timezoneHelper";

const MILLISECONDS_PER_HOUR = 3_600_000;

/** How a reminder repeats after it fires; null fires once. */
export type ReminderRepetition = { unit: "hours" | "months"; interval: number } | null;

export type ReminderOccurrence = {
  time: Date;
  /** Monthly target day to store with the occurrence; null for hourly series. */
  anchorDay: number | null;
};

export type RepetitionArgsResult =
  | { ok: true; provided: false }
  | { ok: true; provided: true; repetition: ReminderRepetition }
  | { ok: false; reason: string };

export function getReminderRepetition(
  row: Pick<ReminderRow, "repetition_interval_hours" | "repetition_interval_months">,
): ReminderRepetition {
  if (typeof row.repetition_interval_months === "number" && row.repetition_interval_months >= 1) {
    return { unit: "months", interval: row.repetition_interval_months };
  }
  if (typeof row.repetition_interval_hours === "number" && row.repetition_interval_hours >= 1) {
    return { unit: "hours", interval: row.repetition_interval_hours };
  }
  return null;
}

export function toRepetitionColumns(repetition: ReminderRepetition): {
  repetition_interval_hours: number | null;
  repetition_interval_months: number | null;
} {
  return {
    repetition_interval_hours: repetition?.unit === "hours" ? repetition.interval : null,
    repetition_interval_months: repetition?.unit === "months" ? repetition.interval : null,
  };
}

function isProvided(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isRepetitionCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validates the model's `repetition_interval_hours` and `repetition_interval_months` arguments,
 * where 0 means one-time and at most one unit may be positive.
 */
export function parseRepetitionArgs(hoursArg: unknown, monthsArg: unknown): RepetitionArgsResult {
  if (!isProvided(hoursArg) && !isProvided(monthsArg)) {
    return { ok: true, provided: false };
  }
  if (isProvided(hoursArg) && !isRepetitionCount(hoursArg)) {
    return { ok: false, reason: "The 'repetition_interval_hours' must be 0 (for one-time) or an integer >= 1." };
  }
  if (isProvided(monthsArg) && !isRepetitionCount(monthsArg)) {
    return { ok: false, reason: "The 'repetition_interval_months' must be 0 (for one-time) or an integer >= 1." };
  }

  const hours = isRepetitionCount(hoursArg) ? hoursArg : 0;
  const months = isRepetitionCount(monthsArg) ? monthsArg : 0;
  if (hours > 0 && months > 0) {
    return {
      ok: false,
      reason: "Set only one of 'repetition_interval_hours' or 'repetition_interval_months'; use 0 for the other.",
    };
  }

  if (months > 0) return { ok: true, provided: true, repetition: { unit: "months", interval: months } };
  if (hours > 0) return { ok: true, provided: true, repetition: { unit: "hours", interval: hours } };
  return { ok: true, provided: true, repetition: null };
}

/**
 * Finds the first occurrence after `referenceTimeMs`, skipping occurrences missed while the bot was
 * down. Monthly series step in the server's calendar and aim for `anchorDay` (or the current
 * occurrence's day), so a series on the 31st clamps to Feb 28 and then returns to Mar 31.
 */
export function getNextReminderOccurrence(
  reminderTime: Date,
  repetition: NonNullable<ReminderRepetition>,
  anchorDay: number | null | undefined,
  timezoneOffset: number,
  referenceTimeMs = Date.now(),
): ReminderOccurrence {
  if (repetition.unit === "hours") {
    const intervalMs = repetition.interval * MILLISECONDS_PER_HOUR;
    const scheduledTimeMs = reminderTime.getTime();
    const intervalsElapsed = Math.max(1, Math.floor((referenceTimeMs - scheduledTimeMs) / intervalMs) + 1);
    return { time: new Date(scheduledTimeMs + intervalsElapsed * intervalMs), anchorDay: null };
  }

  const targetDay = anchorDay ?? getDayOfMonthWithOffset(reminderTime, timezoneOffset);
  let next = reminderTime;
  do {
    next = addMonthsWithOffset(next, repetition.interval, timezoneOffset, targetDay);
  } while (next.getTime() <= referenceTimeMs);
  return { time: next, anchorDay: targetDay };
}

export function formatReminderRepetition(locale: string, repetition: ReminderRepetition): string {
  if (!repetition) {
    return localizer(locale, "reminders.task_update_repeat_none");
  }
  return repetition.unit === "months"
    ? localizer(locale, "reminders.task_update_repeat_months", { repetition_interval_months: repetition.interval })
    : localizer(locale, "reminders.task_update_repeat_hours", { repetition_interval_hours: repetition.interval });
}

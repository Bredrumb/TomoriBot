import type { ReminderRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import {
  addMonthsWithOffset,
  formatTimeWithOffset,
  formatUTCOffset,
  getDayOfMonthWithOffset,
  parseTimeWithOffset,
} from "@/utils/text/timezoneHelper";

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

export type ReminderRepetition = { unit: "minutes" | "hours" | "months"; interval: number } | null;

export type ReminderOccurrence = {
  time: Date;
  anchorDay: number | null;
};

export type RepetitionArgsResult =
  | { ok: true; provided: false }
  | { ok: true; provided: true; repetition: ReminderRepetition }
  | { ok: false; reason: string };

export function getReminderRepetition(
  row: Pick<ReminderRow, "repetition_interval_hours" | "repetition_interval_months" | "repetition_interval_minutes">,
): ReminderRepetition {
  if (typeof row.repetition_interval_months === "number" && row.repetition_interval_months >= 1) {
    return { unit: "months", interval: row.repetition_interval_months };
  }
  if (typeof row.repetition_interval_minutes === "number" && row.repetition_interval_minutes >= 1) {
    return { unit: "minutes", interval: row.repetition_interval_minutes };
  }
  if (typeof row.repetition_interval_hours === "number" && row.repetition_interval_hours >= 1) {
    return { unit: "hours", interval: row.repetition_interval_hours };
  }
  return null;
}

export function toRepetitionColumns(repetition: ReminderRepetition): {
  repetition_interval_hours: number | null;
  repetition_interval_months: number | null;
  repetition_interval_minutes: number | null;
} {
  return {
    repetition_interval_hours: repetition?.unit === "hours" ? repetition.interval : null,
    repetition_interval_months: repetition?.unit === "months" ? repetition.interval : null,
    repetition_interval_minutes: repetition?.unit === "minutes" ? repetition.interval : null,
  };
}

function isReminderCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_POSTGRES_INTEGER;
}

export function parseRepetitionArgs(hoursArg: unknown, monthsArg: unknown, minutesArg?: unknown): RepetitionArgsResult {
  const units = [
    { key: "repetition_interval_hours", unit: "hours", value: hoursArg },
    { key: "repetition_interval_months", unit: "months", value: monthsArg },
    { key: "repetition_interval_minutes", unit: "minutes", value: minutesArg },
  ] as const;
  let repetition: ReminderRepetition = null;
  let provided = false;

  for (const { key, unit, value } of units) {
    if (value == null) continue;
    provided = true;
    if (!isReminderCount(value)) {
      return { ok: false, reason: `'${key}' must be 0 or a positive integer up to ${MAX_POSTGRES_INTEGER}.` };
    }
    if (value === 0) continue;
    if (repetition) {
      return { ok: false, reason: "Set only one positive repeat interval in minutes, hours, or months." };
    }
    repetition = { unit, interval: value };
  }

  return provided ? { ok: true, provided: true, repetition } : { ok: true, provided: false };
}

export type ReminderRepeatLimit = { remaining: number } | { until: Date };
export type ReminderDailyWindow = { start: number; end: number; timezoneOffset: number };
export type ReminderRecurrenceOptions = {
  limit?: ReminderRepeatLimit | null;
  window?: ReminderDailyWindow | null;
};

export function getReminderRepeatLimit(
  row: Pick<ReminderRow, "repeat_remaining_count" | "repeat_until_time">,
): ReminderRepeatLimit | null {
  if (row.repeat_remaining_count != null) return { remaining: row.repeat_remaining_count };
  if (row.repeat_until_time) return { until: row.repeat_until_time };
  return null;
}

export function getReminderDailyWindow(
  row: Pick<ReminderRow, "daily_window_start_minutes" | "daily_window_end_minutes" | "daily_window_timezone_offset">,
): ReminderDailyWindow | null {
  const {
    daily_window_start_minutes: start,
    daily_window_end_minutes: end,
    daily_window_timezone_offset: timezoneOffset,
  } = row;
  return start == null || end == null || timezoneOffset == null ? null : { start, end, timezoneOffset };
}

type RecurrenceOptionResult<T> = { ok: true; value: T | null | undefined } | { ok: false; reason: string };

export function parseReminderRepeatLimit(
  count: unknown,
  until: unknown,
  clear: unknown,
  timezoneOffset: number,
): RecurrenceOptionResult<ReminderRepeatLimit> {
  if ((clear === true && (count != null || until != null)) || (count != null && until != null)) {
    return { ok: false, reason: "Choose a repeat count, a cutoff, or clear the limit." };
  }
  if (clear === true) return { ok: true, value: null };
  if (count != null) {
    return isReminderCount(count) && count > 0
      ? { ok: true, value: { remaining: count } }
      : { ok: false, reason: "Repeat count must be a positive integer within the database range." };
  }
  if (until != null) {
    const date =
      typeof until === "string" ? parseTimeWithOffset(until.trim().replace(/[ T]/, "_"), timezoneOffset) : null;
    return date
      ? { ok: true, value: { until: new Date(date.getTime() + MILLISECONDS_PER_MINUTE - 1) } }
      : { ok: false, reason: "Use YYYY-MM-DD_HH:MM for the repeat cutoff." };
  }
  return { ok: true, value: undefined };
}

function parseDailyWindowMinute(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(value.trim());
  if (!match) return null;
  const meridiem = match[3]?.toLowerCase();
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : !match[2] || hour > 23)) return null;
  return (meridiem ? (hour % 12) + (meridiem === "pm" ? 12 : 0) : hour) * 60 + minute;
}

export function parseReminderDailyWindow(
  start: unknown,
  end: unknown,
  clear: unknown,
  timezoneOffset: number,
): RecurrenceOptionResult<ReminderDailyWindow> {
  if (clear === true) {
    return start == null && end == null
      ? { ok: true, value: null }
      : { ok: false, reason: "Clear the daily window separately from setting its start and end." };
  }
  if (start == null && end == null) return { ok: true, value: undefined };
  const startMinute = parseDailyWindowMinute(start);
  const endMinute = parseDailyWindowMinute(end);
  return startMinute !== null && endMinute !== null && startMinute < endMinute
    ? { ok: true, value: { start: startMinute, end: endMinute, timezoneOffset } }
    : { ok: false, reason: "Enter a start and end on the same day, such as 05:00 and 22:00." };
}

export function alignReminderToDailyWindow(date: Date, window: ReminderDailyWindow | null | undefined): Date {
  if (!window) return date;
  const timezoneMs = window.timezoneOffset * MILLISECONDS_PER_HOUR;
  const utcMs = date.getTime();
  const localMs = utcMs + timezoneMs;
  const localDay = Math.floor(localMs / MILLISECONDS_PER_DAY) * MILLISECONDS_PER_DAY;
  const localMinute = Math.floor((localMs - localDay) / MILLISECONDS_PER_MINUTE);
  if (localMinute >= window.start && localMinute <= window.end) return date;
  const nextLocalDay = localDay + (localMinute > window.end ? MILLISECONDS_PER_DAY : 0);
  return new Date(nextLocalDay + window.start * MILLISECONDS_PER_MINUTE - timezoneMs);
}

// Monthly series carry anchorDay across occurrences because clamping a 31st reminder to Feb 28 would otherwise lose
// the original day for Mar 31.
export function getNextReminderOccurrence(
  reminderTime: Date,
  repetition: NonNullable<ReminderRepetition>,
  anchorDay: number | null | undefined,
  timezoneOffset: number,
  referenceTimeMs = Date.now(),
): ReminderOccurrence {
  if (repetition.unit !== "months") {
    const intervalMs =
      repetition.interval * (repetition.unit === "hours" ? MILLISECONDS_PER_HOUR : MILLISECONDS_PER_MINUTE);
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

export function formatReminderRepetition(
  locale: string,
  repetition: ReminderRepetition,
  limit?: ReminderRepeatLimit | null,
  window?: ReminderDailyWindow | null,
  timezoneOffset = 0,
): string {
  if (!repetition) {
    return localizer(locale, "reminders.task_update_repeat_none");
  }
  const recurrence =
    repetition.unit === "minutes"
      ? localizer(locale, "reminders.task_update_repeat_minutes", { repetition_interval_minutes: repetition.interval })
      : repetition.unit === "months"
        ? localizer(locale, "reminders.task_update_repeat_months", { repetition_interval_months: repetition.interval })
        : localizer(locale, "reminders.task_update_repeat_hours", { repetition_interval_hours: repetition.interval });
  const details = [recurrence];
  if (limit) {
    details.push(
      "remaining" in limit
        ? localizer(locale, "reminders.task_update_repeat_count", { count: limit.remaining })
        : localizer(locale, "reminders.task_update_repeat_until", {
            time: formatTimeWithOffset(limit.until, timezoneOffset, { month: "short" }, locale),
            offset: formatUTCOffset(timezoneOffset),
          }),
    );
  }
  if (window) {
    const clock = (minute: number) =>
      `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    details.push(
      localizer(locale, "reminders.task_update_repeat_window", {
        start: clock(window.start),
        end: clock(window.end),
        offset: formatUTCOffset(window.timezoneOffset),
      }),
    );
  }
  return details.join(" · ");
}

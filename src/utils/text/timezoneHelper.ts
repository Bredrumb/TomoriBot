import { UTC_OFFSET_MAX, UTC_OFFSET_MIN, UTC_OFFSET_STEP_HOURS } from "@/constants/utcOffset";
import { resolveSupportedLocale } from "@/utils/text/localizer";

const UTC_OFFSET_PREFIX_PATTERN = /^(?:utc|gmt)\s*/i;
const UTC_OFFSET_DECIMAL_PATTERN = /^[+-]?\d{1,2}(?:\.\d+)?$/;
const UTC_OFFSET_CLOCK_PATTERN = /^([+-]?)(\d{1,2}):([0-5]\d)$/;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;
// Only fractional month remainders use this 30.44-day Gregorian average because a fraction of a calendar month has no
// fixed length.
const AVERAGE_MONTH_MS = 30.44 * MILLISECONDS_PER_DAY;

export function isValidUtcOffset(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value / UTC_OFFSET_STEP_HOURS) &&
    value >= UTC_OFFSET_MIN &&
    value <= UTC_OFFSET_MAX
  );
}

export function parseUtcOffsetInput(raw: string): number | null {
  const text = raw.trim().replace(UTC_OFFSET_PREFIX_PATTERN, "").replaceAll(" ", "");
  let offset: number | null = null;

  if (UTC_OFFSET_DECIMAL_PATTERN.test(text)) {
    offset = Number(text);
  } else {
    const clock = text.match(UTC_OFFSET_CLOCK_PATTERN);
    if (clock) {
      const [, sign, hours, minutes] = clock;
      offset = (sign === "-" ? -1 : 1) * (Number(hours) + Number(minutes) / 60);
    }
  }

  return isValidUtcOffset(offset) ? offset : null;
}

function splitUtcOffset(offset: number): { sign: "+" | "-"; hours: number; minutes: number } {
  const totalMinutes = Math.round(Math.abs(offset) * 60);
  return { sign: offset < 0 ? "-" : "+", hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

export function formatUTCOffset(offset: number): string {
  return `UTC${formatUtcOffsetInput(offset, true)}`;
}

export function formatUtcOffsetInput(offset: number, forceSign = false): string {
  const { sign, hours, minutes } = splitUtcOffset(offset);
  const prefix = sign === "-" ? "-" : forceSign ? "+" : "";
  const minuteSuffix = minutes === 0 ? "" : `:${String(minutes).padStart(2, "0")}`;
  return `${prefix}${hours}${minuteSuffix}`;
}

export function getCurrentTimeWithOffset(offsetHours: number): string {
  const now = new Date();
  const offsetTime = new Date(now.getTime() + offsetHours * MILLISECONDS_PER_HOUR);

  const weekday = getDayOfWeek(offsetTime);
  const day = offsetTime.getUTCDate();
  const year = offsetTime.getUTCFullYear();
  const month = MONTH_NAMES[offsetTime.getUTCMonth()];

  let hour = offsetTime.getUTCHours();
  const minutes = offsetTime.getUTCMinutes().toString().padStart(2, "0");
  let meridiem = "AM";

  if (hour === 0) {
    hour = 12;
  } else if (hour === 12) {
    meridiem = "PM";
  } else if (hour > 12) {
    hour = hour % 12;
    meridiem = "PM";
  }

  return `${month} ${day}, ${year} | ${hour}:${minutes} ${meridiem} | ${weekday}`;
}

// Epoch day index in the fixed offset (not day of month), so subtracting two values gives calendar-day differences
// instead of 24-hour elapsed periods.
export function getCalendarDayWithOffset(epochMs: number, offsetHours: number): number {
  const offsetDate = new Date(epochMs + offsetHours * MILLISECONDS_PER_HOUR);
  return Math.floor(
    Date.UTC(offsetDate.getUTCFullYear(), offsetDate.getUTCMonth(), offsetDate.getUTCDate()) / MILLISECONDS_PER_DAY,
  );
}

// Optional dayOfMonth preserves the series anchor before month-end clamping so a schedule clamped to Feb 28 can
// return to the 31st.
export function addMonthsWithOffset(from: Date, months: number, offsetHours: number, dayOfMonth?: number): Date {
  const wholeMonths = Math.trunc(months);
  const offsetMs = offsetHours * MILLISECONDS_PER_HOUR;
  const local = new Date(from.getTime() + offsetMs);
  const targetDay = dayOfMonth ?? local.getUTCDate();
  const targetMonth = local.getUTCMonth() + wholeMonths;
  const lastDayOfTargetMonth = new Date(Date.UTC(local.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  local.setUTCFullYear(local.getUTCFullYear(), targetMonth, Math.min(targetDay, lastDayOfTargetMonth));
  return new Date(local.getTime() - offsetMs + (months - wholeMonths) * AVERAGE_MONTH_MS);
}

export function getDayOfMonthWithOffset(date: Date, offsetHours: number): number {
  return new Date(date.getTime() + offsetHours * MILLISECONDS_PER_HOUR).getUTCDate();
}

export function formatDateWithOffset(epochMs: number, offsetHours: number): string {
  const offsetDate = new Date(epochMs + offsetHours * MILLISECONDS_PER_HOUR);
  const month = MONTH_NAMES[offsetDate.getUTCMonth()];
  return `${month} ${offsetDate.getUTCDate()}, ${offsetDate.getUTCFullYear()}`;
}

function getDayOfWeek(date: Date): string {
  const dayOfWeek = date.getUTCDay();
  return Number.isNaN(dayOfWeek)
    ? ""
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayOfWeek];
}

// Default locale stays en-US because model-facing callers omit it to keep English, while user-facing callers pass
// locale to match localized text.
export function formatTimeWithOffset(
  date: Date,
  offsetHours: number,
  options?: Intl.DateTimeFormatOptions,
  locale = "en-US",
): string {
  const utcTime = date.getTime();
  const offsetTime = new Date(utcTime + offsetHours * MILLISECONDS_PER_HOUR);

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    // Use UTC because the offset was already applied to offsetTime.
    timeZone: "UTC",
    ...options,
  };

  return offsetTime.toLocaleString(resolveSupportedLocale(locale), defaultOptions);
}

export function parseTimeWithOffset(timeStr: string, offsetHours: number): Date | null {
  const timePattern = /^(\d{4})-(\d{2})-(\d{2})_(\d{2}):(\d{2})$/;
  const match = timeStr.match(timePattern);

  if (!match) {
    return null;
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10) - 1;
  const day = Number.parseInt(dayStr, 10);
  const hour = Number.parseInt(hourStr, 10);
  const minute = Number.parseInt(minuteStr, 10);

  if (month < 0 || month > 11 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const localDate = Date.UTC(year, month, day, hour, minute, 0, 0);
  const calendarDate = new Date(localDate);
  if (calendarDate.getUTCMonth() !== month || calendarDate.getUTCDate() !== day) {
    return null;
  }

  const utcDate = new Date(localDate - offsetHours * MILLISECONDS_PER_HOUR);

  return utcDate;
}

export function getTimeOfDayPhrase(offsetHours: number): string {
  const now = new Date();
  const offsetTime = new Date(now.getTime() + offsetHours * MILLISECONDS_PER_HOUR);
  const hour = offsetTime.getUTCHours();

  if (hour >= 0 && hour < 4) {
    return "It's very late at night";
  }
  if (hour >= 4 && hour < 7) {
    return "It's early in the morning";
  }
  if (hour >= 7 && hour < 12) {
    return "It's morning";
  }
  if (hour === 12) {
    return "It's around midday";
  }
  if (hour >= 13 && hour < 17) {
    return "It's afternoon";
  }
  if (hour >= 17 && hour < 20) {
    return "It's evening";
  }
  return "It's late at night";
}

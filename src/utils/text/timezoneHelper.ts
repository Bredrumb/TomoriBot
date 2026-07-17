/**
 * Timezone Utility Functions
 * Handles UTC offset-based timezone conversions for TomoriBot
 */

/**
 * Valid UTC offset bounds (UTC-12 through UTC+14, matching real-world timezones
 * and the /server timezone and /personal timezone command ranges)
 */
export const UTC_OFFSET_MIN = -12;
export const UTC_OFFSET_MAX = 14;

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

/**
 * Validates that a value is a usable UTC offset in hours
 * @param value - The value to validate (accepts fractional offsets like 5.5 for UTC+5:30)
 * @returns True if the value is a finite number within [UTC_OFFSET_MIN, UTC_OFFSET_MAX]
 *
 * @example
 * ```ts
 * isValidUtcOffset(8)     // true
 * isValidUtcOffset(5.5)   // true (UTC+5:30)
 * isValidUtcOffset(20)    // false (out of range)
 * isValidUtcOffset("8")   // false (not a number)
 * ```
 */
export function isValidUtcOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= UTC_OFFSET_MIN && value <= UTC_OFFSET_MAX;
}

/**
 * Formats a UTC offset number into a display string
 * @param offset - The UTC offset in hours (e.g., 8, -5, 0)
 * @returns Formatted string (e.g., "UTC+8", "UTC-5", "UTC+0")
 *
 * @example
 * ```ts
 * formatUTCOffset(8)   // "UTC+8"
 * formatUTCOffset(-5)  // "UTC-5"
 * formatUTCOffset(0)   // "UTC+0"
 * ```
 */
export function formatUTCOffset(offset: number): string {
  // 1. Handle the special case of UTC+0
  if (offset === 0) {
    return "UTC+0";
  }

  // 2. Format positive offsets with + sign
  if (offset > 0) {
    return `UTC+${offset}`;
  }

  // 3. Format negative offsets (already includes minus sign)
  return `UTC${offset}`;
}

/**
 * Gets the current time formatted with a UTC offset applied
 * @param offsetHours - The UTC offset in hours to apply
 * @returns Formatted time string in the format "Month Day, Year | Hour:Minutes AM/PM | Weekday"
 *
 * @example
 * ```ts
 * getCurrentTimeWithOffset(8)   // "January 23, 2025 | 3:45 PM | Thursday"
 * getCurrentTimeWithOffset(-5)  // "January 23, 2025 | 2:45 AM | Thursday"
 * ```
 */
export function getCurrentTimeWithOffset(offsetHours: number): string {
  // 1. Get current UTC time and apply offset
  const now = new Date();
  // getTime() already returns UTC milliseconds, so we just add the offset directly
  const offsetTime = new Date(now.getTime() + offsetHours * MILLISECONDS_PER_HOUR);

  // 2. Extract date components
  const weekday = getDayOfWeek(offsetTime);
  const day = offsetTime.getUTCDate();
  const year = offsetTime.getUTCFullYear();
  const month = MONTH_NAMES[offsetTime.getUTCMonth()];

  // 3. Format time (12-hour format with AM/PM)
  let hour = offsetTime.getUTCHours();
  const minutes = offsetTime.getUTCMinutes().toString().padStart(2, "0");
  let meridiem = "AM";

  if (hour === 0) {
    // Midnight case
    hour = 12;
  } else if (hour === 12) {
    // Noon case
    meridiem = "PM";
  } else if (hour > 12) {
    // Afternoon/Evening case
    hour = hour % 12;
    meridiem = "PM";
  }

  // 4. Return formatted string
  return `${month} ${day}, ${year} | ${hour}:${minutes} ${meridiem} | ${weekday}`;
}

/**
 * Returns a stable integer for the calendar day containing an instant after a
 * fixed UTC offset is applied. Subtract two returned values to get a calendar-
 * day difference without relying on elapsed 24-hour periods.
 */
export function getCalendarDayWithOffset(epochMs: number, offsetHours: number): number {
  const offsetDate = new Date(epochMs + offsetHours * MILLISECONDS_PER_HOUR);
  return Math.floor(
    Date.UTC(offsetDate.getUTCFullYear(), offsetDate.getUTCMonth(), offsetDate.getUTCDate()) / MILLISECONDS_PER_DAY,
  );
}

/** Formats an instant as an English absolute date after a fixed UTC offset. */
export function formatDateWithOffset(epochMs: number, offsetHours: number): string {
  const offsetDate = new Date(epochMs + offsetHours * MILLISECONDS_PER_HOUR);
  const month = MONTH_NAMES[offsetDate.getUTCMonth()];
  return `${month} ${offsetDate.getUTCDate()}, ${offsetDate.getUTCFullYear()}`;
}

/**
 * Gets the day name for a given date
 * @param date - Date object to get day name from
 * @returns The name of the day (e.g., "Monday")
 */
function getDayOfWeek(date: Date): string {
  const dayOfWeek = date.getUTCDay();
  return Number.isNaN(dayOfWeek)
    ? ""
    : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayOfWeek];
}

/**
 * Formats a Date object with a UTC offset applied
 * @param date - The Date object to format
 * @param offsetHours - The UTC offset in hours to apply
 * @param options - Optional Intl.DateTimeFormatOptions for custom formatting
 * @returns Formatted date string
 *
 * @example
 * ```ts
 * const date = new Date('2025-09-05T14:30:00Z');
 * formatTimeWithOffset(date, 8);  // Custom formatting in UTC+8
 * ```
 */
export function formatTimeWithOffset(date: Date, offsetHours: number, options?: Intl.DateTimeFormatOptions): string {
  // 1. Apply offset to the date
  const utcTime = date.getTime();
  const offsetTime = new Date(utcTime + offsetHours * MILLISECONDS_PER_HOUR);

  // 2. Use default formatting if no options provided
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC", // Use UTC since we already applied offset
    ...options,
  };

  // 3. Format and return the date string
  return offsetTime.toLocaleString("en-US", defaultOptions);
}

/**
 * Parses a time string in YYYY-MM-DD_HH:MM format with UTC offset applied
 * Converts the time to UTC Date object for database storage
 * @param timeStr - Time string in format "YYYY-MM-DD_HH:MM" (e.g., "2025-09-05_14:30")
 * @param offsetHours - The UTC offset in hours that the time string represents
 * @returns Date object in UTC, or null if parsing fails
 *
 * @example
 * ```ts
 * // Parse "2025-09-05_14:30" in UTC+8 timezone
 * parseTimeWithOffset("2025-09-05_14:30", 8);  // Returns UTC Date
 * ```
 */
export function parseTimeWithOffset(timeStr: string, offsetHours: number): Date | null {
  // 1. Validate format using regex
  const timePattern = /^(\d{4})-(\d{2})-(\d{2})_(\d{2}):(\d{2})$/;
  const match = timeStr.match(timePattern);

  if (!match) {
    return null; // Invalid format
  }

  // 2. Extract components
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10) - 1; // Months are 0-indexed
  const day = Number.parseInt(dayStr, 10);
  const hour = Number.parseInt(hourStr, 10);
  const minute = Number.parseInt(minuteStr, 10);

  // 3. Validate ranges
  if (month < 0 || month > 11 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null; // Invalid values
  }

  // 4. Create date in the offset timezone (treat as UTC, then subtract offset)
  const localDate = Date.UTC(year, month, day, hour, minute, 0, 0);

  // 5. Convert to UTC by subtracting the offset
  const utcDate = new Date(localDate - offsetHours * MILLISECONDS_PER_HOUR);

  return utcDate;
}

/**
 * Adds hours to a Date object
 * @param date - The base Date object
 * @param hours - Number of hours to add (can be negative)
 * @returns New Date object with hours added
 *
 * @example
 * ```ts
 * const now = new Date();
 * const later = addHoursToDate(now, 5);  // 5 hours from now
 * ```
 */
export function addHoursToDate(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * MILLISECONDS_PER_HOUR);
}

/**
 * Gets a descriptive phrase about the current time of day based on the hour
 * @param offsetHours - The UTC offset in hours to apply
 * @returns A descriptive phrase about the time of day
 *
 * @example
 * ```ts
 * getTimeOfDayPhrase(8)   // Might return "It's morning"
 * getTimeOfDayPhrase(-5)  // Might return "It's very late at night"
 * ```
 */
export function getTimeOfDayPhrase(offsetHours: number): string {
  // 1. Get current time with offset applied
  const now = new Date();
  // getTime() already returns UTC milliseconds, so we just add the offset directly
  const offsetTime = new Date(now.getTime() + offsetHours * MILLISECONDS_PER_HOUR);
  const hour = offsetTime.getUTCHours();

  // 2. Determine time of day based on hour ranges
  if (hour >= 0 && hour < 4) {
    // 12am-4am: Very late night/early morning
    return "It's very late at night";
  }
  if (hour >= 4 && hour < 7) {
    // 4am-7am: Early morning
    return "It's early in the morning";
  }
  if (hour >= 7 && hour < 12) {
    // 7am-12pm: Morning
    return "It's morning";
  }
  if (hour === 12) {
    // 12pm: Midday/Noon
    return "It's around midday";
  }
  if (hour >= 13 && hour < 17) {
    // 1pm-5pm: Afternoon
    return "It's afternoon";
  }
  if (hour >= 17 && hour < 20) {
    // 5pm-8pm: Evening
    return "It's evening";
  }
  // 8pm-12am: Night
  return "It's late at night";
}

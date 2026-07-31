import { formatTimeRemaining } from "./formatters";

/**
 * Parses reminder time string in YYYY-MM-DD_HH:MM format
 * @param timeString - Time string to parse (e.g., "2025-09-05_07:14")
 * @returns Date object if valid, null if invalid format
 */
export function parseReminderTime(timeString: string): Date | null {
  const timePattern = /^\d{4}-\d{2}-\d{2}_\d{2}:\d{2}$/;
  if (!timePattern.test(timeString)) {
    return null;
  }

  const [datePart, timePart] = timeString.split("_");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);

  if (
    year < 2024 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return date;
}

/**
 * Validates that a timestamp is in the future (compared to UTC now)
 * @param timestamp - Date to validate
 */
export function validateFutureTime(timestamp: Date): boolean {
  const now = new Date();
  return timestamp.getTime() > now.getTime();
}

/**
 * Calculates how late a reminder is and formats it
 * @param scheduledTime - When the reminder was supposed to trigger
 * @param currentTime - Current time (defaults to now)
 * @returns Formatted lateness string like "3 minutes late" or null if not late
 */
export function calculateLateness(scheduledTime: Date, currentTime: Date = new Date()): string | null {
  const diffMilliseconds = currentTime.getTime() - scheduledTime.getTime();

  if (diffMilliseconds <= 300000) {
    return null; // Not late if within 5 minutes
  }

  return `${formatTimeRemaining(diffMilliseconds)} late`;
}

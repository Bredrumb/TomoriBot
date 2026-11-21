import { formatTimeRemaining } from "./formatters";

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

import { formatTimeRemaining } from "./formatters";

export function validateFutureTime(timestamp: Date): boolean {
  const now = new Date();
  return timestamp.getTime() > now.getTime();
}

export function calculateLateness(scheduledTime: Date, currentTime: Date = new Date()): string | null {
  const diffMilliseconds = currentTime.getTime() - scheduledTime.getTime();

  if (diffMilliseconds <= 300000) {
    return null; // Not late if within 5 minutes
  }

  return `${formatTimeRemaining(diffMilliseconds)} late`;
}

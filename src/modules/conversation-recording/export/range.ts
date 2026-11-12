import type { RecordingRange } from "@/modules/conversation-recording/db/types";

export function parseRecordingRange(from: string, until: string): RecordingRange | null {
  const date = (value: string): Date | null => {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith("0000")) return null;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed : null;
  };
  const start = date(from);
  const end = date(until);
  return start && end && start < end ? { from: start, until: end } : null;
}

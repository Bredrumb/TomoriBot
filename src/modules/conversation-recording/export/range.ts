import type { RecordingRange } from "@/modules/conversation-recording/db/types";

export function parseRecordingRange(selection: string, now: number): RecordingRange | null {
  const days = new Map<string, number>([
    ["24h", 1],
    ["7d", 7],
    ["14d", 14],
    ["30d", 30],
    ["all", 0],
  ]).get(selection);
  return days === undefined
    ? null
    : {
        from: new Date(days === 0 ? 0 : now - days * 86_400_000),
        until: new Date(now),
      };
}

import { formatDateWithOffset, getCalendarDayWithOffset, isValidUtcOffset } from "@/utils/text/timezoneHelper";

const TIME_AWARENESS_REUNION_DAYS = 7;

// Depth 3 matches the verbatim tool-calling nudge so the note stays advisory, whereas depth 1 sits above the newest
// message and competes with the prompt.
export const TIME_AWARENESS_NOTE_DEPTH = 3;

export const SPACER_TEMPLATE =
  "[System: The messages above were sent on {date} ({relative}, server time).{{if tool:reveal_message_metadata}} Use the {message_metadata_tool} tool to learn the exact times of each message, if needed.{{/if}}]";

export interface BuildReunionNoteArgs {
  lastPreviousDayAt: Date | null;
  seenToday: boolean;
  personalOffset?: number | null;
  serverOffset?: number | null;
  displayName: string;
  nowMs?: number;
  reunionDays?: number;
  // Proxied identities share a host account where other members speak between turns, so absence wording must refer
  // only to displayName and never the account.
  isSharedAccount?: boolean;
}

// Raw note text omits [System: ...] wrapping because the dialogue-history consumer adds that wrapper.
export function buildReunionNote(args: BuildReunionNoteArgs): string | null {
  const reunionDays = args.reunionDays ?? TIME_AWARENESS_REUNION_DAYS;
  if (args.seenToday) return null;

  const offsetHours = resolvePersonalTimezoneOffset(args.personalOffset, args.serverOffset);

  if (args.lastPreviousDayAt === null) {
    if (args.isSharedAccount) {
      return `${args.displayName} is talking to you for the very first time, from an account you already know. Welcome them naturally and ask something friendly to get to know them.`;
    }
    return `${args.displayName} is talking to you directly for the very first time! Welcome them naturally and ask something friendly to get to know them.`;
  }

  const nowMs = args.nowMs ?? Date.now();
  const dayGap =
    getCalendarDayWithOffset(nowMs, offsetHours) -
    getCalendarDayWithOffset(args.lastPreviousDayAt.getTime(), offsetHours);
  if (dayGap < reunionDays) return null;

  const lastDate = formatDateWithOffset(args.lastPreviousDayAt.getTime(), offsetHours);
  if (args.isSharedAccount) {
    return `${args.displayName} hasn't interacted with you specifically since ${lastDate} (${dayGap} days ago). Acknowledge them interacting with you again.`;
  }
  return `${args.displayName} hasn't interacted with you specifically since ${lastDate} (${dayGap} days ago), though they may have been around the server. Acknowledge them interacting with you again.`;
}

export function buildDateSpacer(
  prevCreatedAt: number,
  nextCreatedAt: number,
  serverOffset: number | null | undefined,
  expandedTemplate: string,
  nowMs = Date.now(),
): string | null {
  const offsetHours = isValidUtcOffset(serverOffset) ? serverOffset : 0;
  const previousDay = getCalendarDayWithOffset(prevCreatedAt, offsetHours);
  const nextDay = getCalendarDayWithOffset(nextCreatedAt, offsetHours);
  if (previousDay === nextDay) return null;

  const dayGap = getCalendarDayWithOffset(nowMs, offsetHours) - previousDay;
  return expandedTemplate
    .replaceAll("{date}", formatDateWithOffset(prevCreatedAt, offsetHours))
    .replaceAll("{relative}", formatRelativeDay(dayGap));
}

function resolvePersonalTimezoneOffset(personalOffset?: number | null, serverOffset?: number | null): number {
  if (isValidUtcOffset(personalOffset)) return personalOffset;
  if (isValidUtcOffset(serverOffset)) return serverOffset;
  return 0;
}

function formatRelativeDay(dayGap: number): string {
  if (dayGap === 0) return "today";
  if (dayGap === 1) return "yesterday";
  if (dayGap > 1) return `${dayGap} days ago`;
  if (dayGap === -1) return "tomorrow";
  return `${Math.abs(dayGap)} days from now`;
}

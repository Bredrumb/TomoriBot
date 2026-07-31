import { formatDateWithOffset, getCalendarDayWithOffset, isValidUtcOffset } from "@/utils/text/timezoneHelper";

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const TIME_AWARENESS_REUNION_DAYS = readIntEnv("TIME_AWARENESS_REUNION_DAYS", 7);
const TIME_AWARENESS_GRACE_TRIGGERS = readIntEnv("TIME_AWARENESS_GRACE_TRIGGERS", 3);

/**
 * How many messages deep the reunion note is injected. Depth 1 (the original
 * value) put it directly above the newest message, where it competed with the
 * user's actual prompt for the model's attention; depth 3 matches the verbatim
 * tool-calling nudge and keeps it advisory rather than imperative.
 */
export const TIME_AWARENESS_NOTE_DEPTH = readIntEnv("TIME_AWARENESS_NOTE_DEPTH", 3);

/**
 * How many trailing messages count as "present in the conversation" when deciding
 * whose reunion is worth acknowledging. Independent of message_fetch_limit so a
 * large context window doesn't drag in people who left hours ago.
 */
export const TIME_AWARENESS_PRESENCE_WINDOW = readIntEnv("TIME_AWARENESS_PRESENCE_WINDOW", 20);

/**
 * Cap on reunion notes injected in a single turn, so a quiet channel waking up
 * doesn't bury the actual conversation under greetings.
 */
export const TIME_AWARENESS_MAX_REUNION_NOTES = readIntEnv("TIME_AWARENESS_MAX_REUNION_NOTES", 2);

export const SPACER_TEMPLATE =
  "[System: The messages above were sent on {date} ({relative}, server time). Use the {message_metadata_tool} tool to learn the exact times of each message, if needed.]";

export interface BuildReunionNoteArgs {
  lastPreviousDayAt: Date | null;
  todayCount: number;
  personalOffset?: number | null;
  serverOffset?: number | null;
  displayName: string;
  /**
   * Whether this person triggered the turn. People who are merely present in the
   * window get the returning-user note only, so never the first-timer welcome,
   * which would have Tomori introduce herself to someone talking past her.
   * Defaults to true (the original triggerer-only behavior).
   */
  isTriggerer?: boolean;
  isUserImpersonation?: boolean;
  nowMs?: number;
  reunionDays?: number;
  graceTriggers?: number;
}

/**
 * Builds the short-lived persona-reunion note as raw text (the dialogue-history
 * consumer wraps every note in `[System: ...]`). The note remains truthful for
 * the entire grace window, including turns after the first response today.
 *
 * @returns The note body, or null when no reunion applies to this person.
 */
export function buildReunionNote(args: BuildReunionNoteArgs): string | null {
  const reunionDays = args.reunionDays ?? TIME_AWARENESS_REUNION_DAYS;
  const graceTriggers = args.graceTriggers ?? TIME_AWARENESS_GRACE_TRIGGERS;
  const isTriggerer = args.isTriggerer ?? true;
  if (args.isUserImpersonation || args.todayCount >= graceTriggers) return null;

  const offsetHours = resolvePersonalTimezoneOffset(args.personalOffset, args.serverOffset);

  // No recorded history at all. Only the person actually addressing Tomori
  //    gets welcomed; a silent bystander with no history is just a stranger.
  if (args.lastPreviousDayAt === null) {
    if (!isTriggerer) return null;
    return `${args.displayName} is talking to you for the very first time! If you haven't already, welcome them naturally and ask something friendly to get to know them.`;
  }

  const nowMs = args.nowMs ?? Date.now();
  const dayGap =
    getCalendarDayWithOffset(nowMs, offsetHours) -
    getCalendarDayWithOffset(args.lastPreviousDayAt.getTime(), offsetHours);
  if (dayGap < reunionDays) return null;

  const lastDate = formatDateWithOffset(args.lastPreviousDayAt.getTime(), offsetHours);
  return isTriggerer
    ? `${args.displayName} is talking to you again for the first time since ${lastDate}. It's been ${dayGap} days! If you haven't already, acknowledge their return naturally and ask what they've been up to.`
    : `${args.displayName} is around again for the first time since ${lastDate}. It's been ${dayGap} days! If you haven't already, acknowledge their return naturally without derailing the current topic.`;
}

/**
 * Builds a separator for a server-calendar-day boundary. The tool macro must
 * already be expanded by the caller; this function only fills date fields.
 */
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

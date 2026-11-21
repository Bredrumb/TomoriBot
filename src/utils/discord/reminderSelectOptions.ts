import type { ReminderSelectionRow } from "@/utils/db/repositories";
import type { TomoriState } from "@/types/db/schema";
import { isBridgeUserId } from "@/utils/bridges";
import { localizer } from "@/utils/text/localizer";
import { getReminderRepetition } from "@/utils/text/processors/reminderRepetition";
import { formatTimeWithOffset, formatUTCOffset } from "@/utils/text/timezoneHelper";

// Field names stay snake_case because callers pass them directly into shared locale placeholder interpolation.
export interface ReminderOptionParts {
  persona_name: string;
  reminder_time: string;
  timezone: string;
  repeat_text: string;
  manager_created_by_text: string;
}

interface ReminderOptionPartsInput {
  reminder: ReminderSelectionRow;
  state: TomoriState;
  locale: string;
  timezoneOffset: number;
  hasManagePermission: boolean;
  viewerUserId: number | undefined;
  repeatTextKey: string;
  repeatMonthsTextKey: string;
  repeatMinutesTextKey: string;
  managerCreatedByKey: string;
}

// Main-persona rows have null persona_nickname and Matrix rows have null created_by_user_id with a bridge ID, so both
// need explicit fallbacks.
export function buildReminderOptionParts(input: ReminderOptionPartsInput): ReminderOptionParts {
  const { reminder } = input;
  const repetition = getReminderRepetition(reminder);
  const isMatrixReminder = reminder.created_by_user_id === null && isBridgeUserId(reminder.user_discord_id);
  const creatorName = isMatrixReminder
    ? `${reminder.user_nickname} (Matrix)`
    : (reminder.created_by_nickname ??
      (reminder.created_by_user_id ? `user #${reminder.created_by_user_id}` : "unknown"));

  return {
    persona_name: reminder.persona_nickname ?? input.state.persona_nickname,
    reminder_time: formatTimeWithOffset(
      new Date(reminder.reminder_time),
      input.timezoneOffset,
      {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      },
      input.locale,
    ),
    timezone: formatUTCOffset(input.timezoneOffset),
    repeat_text: !repetition
      ? ""
      : repetition.unit === "months"
        ? localizer(input.locale, input.repeatMonthsTextKey, { months: repetition.interval })
        : repetition.unit === "minutes"
          ? localizer(input.locale, input.repeatMinutesTextKey, { minutes: repetition.interval })
          : localizer(input.locale, input.repeatTextKey, { hours: repetition.interval }),
    manager_created_by_text:
      input.hasManagePermission && reminder.created_by_user_id !== input.viewerUserId
        ? localizer(input.locale, input.managerCreatedByKey, { creator_name: creatorName })
        : "",
  };
}

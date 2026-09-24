import type { ReminderSelectionRow } from "@/utils/db/repositories";
import type { TomoriState } from "@/types/db/schema";
import { isBridgeUserId } from "@/utils/bridges";
import { localizer } from "@/utils/text/localizer";
import { formatTimeWithOffset, formatUTCOffset } from "@/utils/text/timezoneHelper";

/** Option values both scheduled-task selectors share, keyed for the shared locale placeholders. */
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
  /** Locale key for the repeat suffix, which each command owns. */
  repeatTextKey: string;
  /** Locale key for the creator suffix, which each command owns. */
  managerCreatedByKey: string;
}

/**
 * Resolves the option text one reminder row contributes to a scheduled-task selector.
 *
 * `persona_nickname` is NULL for a reminder the main persona owns, so the option names that
 * persona rather than leaving the field empty.
 *
 * A Matrix-originated reminder has `created_by_user_id` NULL with a bridge ID as its Discord ID,
 * so it names its creator with a Matrix marker instead of reading as unowned.
 */
export function buildReminderOptionParts(input: ReminderOptionPartsInput): ReminderOptionParts {
  const { reminder } = input;
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
    repeat_text:
      typeof reminder.repetition_interval_hours === "number" && reminder.repetition_interval_hours >= 1
        ? localizer(input.locale, input.repeatTextKey, { hours: reminder.repetition_interval_hours })
        : "",
    manager_created_by_text:
      input.hasManagePermission && reminder.created_by_user_id !== input.viewerUserId
        ? localizer(input.locale, input.managerCreatedByKey, { creator_name: creatorName })
        : "",
  };
}

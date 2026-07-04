/**
 * Update Task Tool
 *
 * Replaces or deletes an existing scheduled reminder/task by ID.
 * The ID is shown in participant context as "ID:N".
 */

import { extractBridgeUserId, isMatrixBridgeWebhookUsername } from "@/utils/bridges";
import { sendTaskEmbedWithExpand } from "@/utils/discord/expandableEmbedNotice";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { validateFutureTime } from "@/utils/text/processors/timeUtils";
import {
  formatTimeWithOffset,
  formatUTCOffset,
  isValidUtcOffset,
  parseTimeWithOffset,
  UTC_OFFSET_MAX,
  UTC_OFFSET_MIN,
} from "@/utils/text/timezoneHelper";
import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import type { ReminderRow } from "@/types/db/schema";

const RELATIVE_TIME_MULTIPLIERS_MS = {
  minutes_from_now: 60 * 1000,
  hours_from_now: 60 * 60 * 1000,
  days_from_now: 24 * 60 * 60 * 1000,
  months_from_now: 30.44 * 24 * 60 * 60 * 1000,
} as const;

type RelativeTimeKey = keyof typeof RELATIVE_TIME_MULTIPLIERS_MS;

const RELATIVE_TIME_KEYS = Object.keys(RELATIVE_TIME_MULTIPLIERS_MS) as RelativeTimeKey[];

function parseDailyWindowTime(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  const amPmMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  const twentyFourHourMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);

  let hour: number;
  let minute: number;
  if (amPmMatch) {
    hour = Number.parseInt(amPmMatch[1], 10);
    minute = amPmMatch[2] ? Number.parseInt(amPmMatch[2], 10) : 0;
    if (hour < 1 || hour > 12) return null;
    hour = amPmMatch[3] === "am" ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
  } else if (twentyFourHourMatch) {
    hour = Number.parseInt(twentyFourHourMatch[1], 10);
    minute = Number.parseInt(twentyFourHourMatch[2], 10);
  } else {
    return null;
  }

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

export type UpdateTaskActor = {
  requesterUserId?: number;
  requesterDiscordId?: string;
  requesterBridgeUserId?: string;
};

export type UpdateTaskArgumentParseResult =
  | {
      ok: true;
      reminderId: number;
      newPurpose: string;
      isDeleteRequested: boolean;
      newReminderTime?: Date;
      hasRepetitionIntervalUpdate: boolean;
      repetitionIntervalHours?: number | null;
      repetitionIntervalMinutes?: number | null;
      hasRepeatLimitUpdate: boolean;
      repeatRemainingCount?: number | null;
      repeatUntilTime?: Date | null;
      hasDailyWindowUpdate: boolean;
      dailyWindowStartMinutes?: number | null;
      dailyWindowEndMinutes?: number | null;
      dailyWindowTimezoneOffset?: number | null;
    }
  | {
      ok: false;
      status: "task_update_failed_invalid_args" | "task_update_failed_invalid_time";
      reason: string;
    };

function truncateReminderPurpose(reminderPurpose: string, maxLength = 200): string {
  return reminderPurpose.length > maxLength ? `${reminderPurpose.substring(0, maxLength - 3)}...` : reminderPurpose;
}

function normalizeReminderTimeInput(reminderTime: string): string {
  let normalized = reminderTime.trim();
  normalized = normalized.replace(/^(\d{4})\/(\d{2})\/(\d{2})/, "$1-$2-$3");
  normalized = normalized.replace(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/, "$1_$2");
  return normalized;
}

function hasProvidedArg(args: Record<string, unknown>, key: string): boolean {
  return key in args && args[key] !== undefined && args[key] !== null;
}

export function parseUpdateTaskArguments(
  args: Record<string, unknown>,
  timezoneOffset: number,
): UpdateTaskArgumentParseResult {
  const reminderIdArg = args.reminder_id;
  if (typeof reminderIdArg !== "number" || !Number.isSafeInteger(reminderIdArg) || reminderIdArg <= 0) {
    return {
      ok: false,
      status: "task_update_failed_invalid_args",
      reason: "The 'reminder_id' argument was missing or invalid.",
    };
  }

  const reminderPurposeArg = args.reminder_purpose;
  if (typeof reminderPurposeArg !== "string") {
    return {
      ok: false,
      status: "task_update_failed_invalid_args",
      reason: "The 'reminder_purpose' argument was missing or not a string.",
    };
  }

  const newPurpose = reminderPurposeArg.trim();
  const isDeleteRequested = newPurpose.length === 0;
  if (isDeleteRequested) {
    return {
      ok: true,
      reminderId: Math.trunc(reminderIdArg),
      newPurpose,
      isDeleteRequested,
      hasRepetitionIntervalUpdate: false,
      hasRepeatLimitUpdate: false,
      hasDailyWindowUpdate: false,
    };
  }

  let newReminderTime: Date | undefined;
  const reminderTimeArg = args.reminder_time;
  if (typeof reminderTimeArg === "string" && reminderTimeArg.trim()) {
    // The model labels the timezone frame of reminder_time via utc_offset instead of
    // converting the time itself; fall back to the server timezone when unlabeled.
    let effectiveParseOffset = timezoneOffset;
    if (hasProvidedArg(args, "utc_offset")) {
      const utcOffsetArg = args.utc_offset;
      if (!isValidUtcOffset(utcOffsetArg)) {
        return {
          ok: false,
          status: "task_update_failed_invalid_args",
          reason: `Invalid 'utc_offset' value: '${utcOffsetArg}'. Expected a number of hours between ${UTC_OFFSET_MIN} and ${UTC_OFFSET_MAX}.`,
        };
      }
      effectiveParseOffset = utcOffsetArg;
    }

    const normalizedReminderTime = normalizeReminderTimeInput(reminderTimeArg);
    const parsedReminderTime = parseTimeWithOffset(normalizedReminderTime, effectiveParseOffset);
    if (!parsedReminderTime) {
      return {
        ok: false,
        status: "task_update_failed_invalid_time",
        reason: `Invalid reminder time format: '${reminderTimeArg}'. Expected YYYY-MM-DD_HH:MM format in ${formatUTCOffset(effectiveParseOffset)}.`,
      };
    }
    newReminderTime = parsedReminderTime;
  } else {
    const hasRelativeParams = RELATIVE_TIME_KEYS.some((key) => hasProvidedArg(args, key));
    if (hasRelativeParams) {
      let totalMilliseconds = 0;

      for (const key of RELATIVE_TIME_KEYS) {
        if (!hasProvidedArg(args, key)) continue;

        const value = args[key];
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          return {
            ok: false,
            status: "task_update_failed_invalid_time",
            reason: `The '${key}' argument must be a number greater than 0 when provided.`,
          };
        }

        totalMilliseconds += value * RELATIVE_TIME_MULTIPLIERS_MS[key];
      }

      if (totalMilliseconds <= 0) {
        return {
          ok: false,
          status: "task_update_failed_invalid_time",
          reason: "Relative time parameters must schedule the task in the future.",
        };
      }

      newReminderTime = new Date(Date.now() + totalMilliseconds);
    }
  }

  if (newReminderTime && !validateFutureTime(newReminderTime)) {
    return {
      ok: false,
      status: "task_update_failed_invalid_time",
      reason: "The updated reminder time must be in the future.",
    };
  }

  let hasRepetitionIntervalUpdate = false;
  let repetitionIntervalHours: number | null | undefined;
  let repetitionIntervalMinutes: number | null | undefined;
  if (hasProvidedArg(args, "repetition_interval_hours")) {
    const repetitionIntervalHoursArg = args.repetition_interval_hours;
    if (
      typeof repetitionIntervalHoursArg !== "number" ||
      !Number.isSafeInteger(repetitionIntervalHoursArg) ||
      repetitionIntervalHoursArg < 0
    ) {
      return {
        ok: false,
        status: "task_update_failed_invalid_args",
        reason: "The 'repetition_interval_hours' argument must be 0 or an integer greater than or equal to 1.",
      };
    }

    hasRepetitionIntervalUpdate = true;
    repetitionIntervalMinutes = repetitionIntervalHoursArg > 0 ? repetitionIntervalHoursArg * 60 : null;
    repetitionIntervalHours = repetitionIntervalMinutes !== null ? repetitionIntervalMinutes / 60 : null;
  }

  if (hasProvidedArg(args, "repetition_interval_minutes")) {
    const repetitionIntervalMinutesArg = args.repetition_interval_minutes;
    if (
      typeof repetitionIntervalMinutesArg !== "number" ||
      !Number.isSafeInteger(repetitionIntervalMinutesArg) ||
      repetitionIntervalMinutesArg < 0
    ) {
      return {
        ok: false,
        status: "task_update_failed_invalid_args",
        reason: "The 'repetition_interval_minutes' argument must be 0 or an integer greater than or equal to 1.",
      };
    }

    if (hasRepetitionIntervalUpdate && (repetitionIntervalMinutes ?? 0) > 0 && repetitionIntervalMinutesArg > 0) {
      return {
        ok: false,
        status: "task_update_failed_invalid_args",
        reason: "Use either 'repetition_interval_minutes' or 'repetition_interval_hours', not both.",
      };
    }

    hasRepetitionIntervalUpdate = true;
    repetitionIntervalMinutes =
      repetitionIntervalMinutesArg > 0 ? repetitionIntervalMinutesArg : (repetitionIntervalMinutes ?? null);
    repetitionIntervalHours =
      repetitionIntervalMinutes !== null && repetitionIntervalMinutes % 60 === 0 ? repetitionIntervalMinutes / 60 : null;
  }

  let hasRepeatLimitUpdate = false;
  let repeatRemainingCount: number | null | undefined;
  let repeatUntilTime: Date | null | undefined;

  if (args.clear_repeat_limit === true) {
    if (hasProvidedArg(args, "repeat_count") || hasProvidedArg(args, "repeat_until_time")) {
      return {
        ok: false,
        status: "task_update_failed_invalid_args",
        reason: "Use 'clear_repeat_limit' by itself, not with 'repeat_count' or 'repeat_until_time'.",
      };
    }

    hasRepeatLimitUpdate = true;
    repeatRemainingCount = null;
    repeatUntilTime = null;
  }

  if (hasProvidedArg(args, "repeat_count")) {
    const repeatCountArg = args.repeat_count;
    if (typeof repeatCountArg !== "number" || !Number.isSafeInteger(repeatCountArg) || repeatCountArg < 1) {
      return {
        ok: false,
        status: "task_update_failed_invalid_args",
        reason: "The 'repeat_count' argument must be an integer greater than or equal to 1.",
      };
    }
    if (hasRepeatLimitUpdate && repeatUntilTime !== null) {
      return {
        ok: false,
        status: "task_update_failed_invalid_args",
        reason: "Use either 'repeat_count' or 'repeat_until_time', not both.",
      };
    }
    hasRepeatLimitUpdate = true;
    repeatRemainingCount = repeatCountArg;
    repeatUntilTime = null;
  }

  if (hasProvidedArg(args, "repeat_until_time")) {
    const repeatUntilTimeArg = args.repeat_until_time;
    if (typeof repeatUntilTimeArg !== "string" || !repeatUntilTimeArg.trim()) {
      return {
        ok: false,
        status: "task_update_failed_invalid_args",
        reason: "The 'repeat_until_time' argument must be a non-empty string when provided.",
      };
    }
    if (hasRepeatLimitUpdate && repeatRemainingCount !== null) {
      return {
        ok: false,
        status: "task_update_failed_invalid_args",
        reason: "Use either 'repeat_count' or 'repeat_until_time', not both.",
      };
    }

    const normalizedRepeatUntilTime = normalizeReminderTimeInput(repeatUntilTimeArg);
    const parsedRepeatUntilTime = parseTimeWithOffset(normalizedRepeatUntilTime, timezoneOffset);
    if (!parsedRepeatUntilTime) {
      return {
        ok: false,
        status: "task_update_failed_invalid_time",
        reason: `Invalid repeat-until time format: '${repeatUntilTimeArg}'. Expected YYYY-MM-DD_HH:MM format in ${formatUTCOffset(timezoneOffset)}.`,
      };
    }

    hasRepeatLimitUpdate = true;
    repeatRemainingCount = null;
    repeatUntilTime = parsedRepeatUntilTime;
  }

  let hasDailyWindowUpdate = false;
  let dailyWindowStartMinutes: number | null | undefined;
  let dailyWindowEndMinutes: number | null | undefined;
  let dailyWindowTimezoneOffset: number | null | undefined;

  if (args.clear_daily_window === true) {
    hasDailyWindowUpdate = true;
    dailyWindowStartMinutes = null;
    dailyWindowEndMinutes = null;
    dailyWindowTimezoneOffset = null;
  }

  const hasDailyWindowStart = hasProvidedArg(args, "daily_window_start_time");
  const hasDailyWindowEnd = hasProvidedArg(args, "daily_window_end_time");
  if (args.clear_daily_window === true && (hasDailyWindowStart || hasDailyWindowEnd)) {
    return {
      ok: false,
      status: "task_update_failed_invalid_args",
      reason: "Use 'clear_daily_window' by itself, not with daily window start/end times.",
    };
  }

  if (hasDailyWindowStart || hasDailyWindowEnd) {
    if (!hasDailyWindowStart || !hasDailyWindowEnd) {
      return {
        ok: false,
        status: "task_update_failed_invalid_args",
        reason: "Both 'daily_window_start_time' and 'daily_window_end_time' must be provided together.",
      };
    }

    const dailyWindowStartArg = args.daily_window_start_time;
    const dailyWindowEndArg = args.daily_window_end_time;
    if (typeof dailyWindowStartArg !== "string" || typeof dailyWindowEndArg !== "string") {
      return {
        ok: false,
        status: "task_update_failed_invalid_args",
        reason: "Daily window times must be strings such as '05:00' or '10PM'.",
      };
    }

    const parsedStart = parseDailyWindowTime(dailyWindowStartArg);
    const parsedEnd = parseDailyWindowTime(dailyWindowEndArg);
    if (parsedStart === null || parsedEnd === null || parsedEnd <= parsedStart) {
      return {
        ok: false,
        status: "task_update_failed_invalid_args",
        reason: "Daily window times must be valid same-day times, and the end time must be after the start time.",
      };
    }

    hasDailyWindowUpdate = true;
    dailyWindowStartMinutes = parsedStart;
    dailyWindowEndMinutes = parsedEnd;
    dailyWindowTimezoneOffset = timezoneOffset;
  }

  return {
    ok: true,
    reminderId: Math.trunc(reminderIdArg),
    newPurpose,
    isDeleteRequested,
    newReminderTime,
    hasRepetitionIntervalUpdate,
    repetitionIntervalHours,
    repetitionIntervalMinutes,
    hasRepeatLimitUpdate,
    repeatRemainingCount,
    repeatUntilTime,
    hasDailyWindowUpdate,
    dailyWindowStartMinutes,
    dailyWindowEndMinutes,
    dailyWindowTimezoneOffset,
  };
}

export function canReminderActorModifyReminder(
  reminder: Pick<ReminderRow, "created_by_user_id" | "self_reminder" | "user_discord_id">,
  actor: UpdateTaskActor,
): boolean {
  if (
    typeof actor.requesterUserId === "number" &&
    typeof reminder.created_by_user_id === "number" &&
    reminder.created_by_user_id === actor.requesterUserId
  ) {
    return true;
  }

  if (reminder.self_reminder === true) {
    return false;
  }

  if (actor.requesterDiscordId && reminder.user_discord_id === actor.requesterDiscordId) {
    return true;
  }

  return Boolean(actor.requesterBridgeUserId && reminder.user_discord_id === actor.requesterBridgeUserId);
}

function buildFailureResult(
  status:
    | "task_update_failed_invalid_args"
    | "task_update_failed_invalid_time"
    | "task_update_failed_not_found"
    | "task_update_failed_unauthorized"
    | "task_update_failed_db_error"
    | "task_update_failed_internal_error"
    | "task_update_failed_user_not_found",
  reason: string,
): ToolResult {
  return {
    success: false,
    error: reason,
    data: {
      status,
      reason,
    },
  };
}

function formatReminderTime(reminderTime: Date, timezoneOffset: number): string {
  return `${formatTimeWithOffset(reminderTime, timezoneOffset, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })} (${formatUTCOffset(timezoneOffset)})`;
}

function formatRepeatText(locale: string, repetitionIntervalMinutes: number | null | undefined): string {
  if (typeof repetitionIntervalMinutes === "number" && repetitionIntervalMinutes >= 1) {
    if (repetitionIntervalMinutes % 60 !== 0) {
      return localizer(locale, "reminders.task_update_repeat_minutes", {
        repetition_interval_minutes: repetitionIntervalMinutes,
      });
    }

    return localizer(locale, "reminders.task_update_repeat_hours", {
      repetition_interval_hours: repetitionIntervalMinutes / 60,
    });
  }

  return localizer(locale, "reminders.task_update_repeat_none");
}

export class UpdateTaskTool extends BaseTool {
  name = "update_task";
  description =
    "Replace, reschedule, or delete an existing scheduled task/reminder by ID. Use the reminder ID shown in context (for example, ID:42). Set reminder_purpose to the full replacement content. If reminder_purpose is empty or blank, delete the targeted reminder instead. You may reschedule it with reminder_time in YYYY-MM-DD_HH:MM (pass the wall-clock time exactly as the user expressed it. NEVER convert between timezones yourself; it is interpreted in the server timezone unless you set utc_offset to the offset the user spoke in), or relative time parameters such as minutes_from_now/hours_from_now/days_from_now/months_from_now. If no time is provided, keep the existing trigger time. You may change recurrence with repetition_interval_minutes or repetition_interval_hours. You may change finite limits with repeat_count, repeat_until_time, or clear_repeat_limit. You may change daily active windows with daily_window_start_time/daily_window_end_time or clear_daily_window. Do not use this to change target user, target channel, or whether it is a self task.";
  category = "utility" as const;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      reminder_id: {
        type: "number",
        description: "The reminder/task ID shown in context, such as ID:42. Must be a positive integer.",
      },
      reminder_purpose: {
        type: "string",
        description:
          "The full replacement reminder/task content. If this is empty or blank, delete the targeted reminder/task instead.",
      },
      reminder_time: {
        type: "string",
        description:
          "OPTIONAL: Absolute replacement trigger time in YYYY-MM-DD_HH:MM format. Pass the wall-clock time exactly as the user expressed it. do NOT convert between timezones yourself. Without 'utc_offset', this is interpreted in the server's configured timezone. If provided, this takes priority over relative time parameters.",
      },
      utc_offset: {
        type: "number",
        description:
          "OPTIONAL: The UTC offset in hours that 'reminder_time' is expressed in (e.g., 8 for UTC+8, -5 for UTC-5, 5.5 for UTC+5:30). Set this to the target user's personal timezone offset (shown in the conversation context) when they expressed the time in their own local time. If omitted, the server's configured timezone is used. Only meaningful together with 'reminder_time'.",
      },
      minutes_from_now: {
        type: "number",
        description:
          "OPTIONAL: Minutes from now for the replacement trigger time. Can be combined with other relative parameters.",
      },
      hours_from_now: {
        type: "number",
        description:
          "OPTIONAL: Hours from now for the replacement trigger time. Can be combined with other relative parameters.",
      },
      days_from_now: {
        type: "number",
        description:
          "OPTIONAL: Days from now for the replacement trigger time. Can be combined with other relative parameters.",
      },
      months_from_now: {
        type: "number",
        description: "OPTIONAL: Months from now for the replacement trigger time. Uses calendar months as 30.44 days.",
      },
      repetition_interval_hours: {
        type: "number",
        description:
          "OPTIONAL: Set to 0 for a one-time task/reminder, or 1+ to make it recur every X hours. If omitted, the existing repeat interval is preserved.",
      },
      repetition_interval_minutes: {
        type: "number",
        description:
          "OPTIONAL: Set to 0 for a one-time task/reminder, or 1+ to make it recur every X minutes. Use this for sub-hour schedules.",
      },
      repeat_until_time: {
        type: "string",
        description:
          "OPTIONAL: Replace the finite recurring cutoff time in YYYY-MM-DD_HH:MM format using the server timezone. The task will auto-delete after the final run at or before this time.",
      },
      repeat_count: {
        type: "number",
        description:
          "OPTIONAL: Replace the finite remaining run count. Must be 1 or greater and requires a recurring repeat interval to be active.",
      },
      clear_repeat_limit: {
        type: "boolean",
        description: "OPTIONAL: Set true to clear repeat_count and repeat_until_time, making the recurring task indefinite.",
      },
      daily_window_start_time: {
        type: "string",
        description:
          "OPTIONAL: Replace the local daily active window start time, such as '05:00' or '5AM'. Must be used with daily_window_end_time.",
      },
      daily_window_end_time: {
        type: "string",
        description:
          "OPTIONAL: Replace the local daily active window end time, such as '22:00' or '10PM'. Must be used with daily_window_start_time.",
      },
      clear_daily_window: {
        type: "boolean",
        description: "OPTIONAL: Set true to clear the daily active window so the recurring task can run at any time.",
      },
    },
    required: ["reminder_id", "reminder_purpose"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  isAvailableForContext(_provider: string, context?: ToolContext): boolean {
    if (context?.streamContext?.disableReminderTool) return false;
    return true;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return buildFailureResult(
        "task_update_failed_invalid_args",
        `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
      );
    }

    const tomoriState = context.tomoriState;
    if (!tomoriState?.server_id) {
      log.error("Missing server_id in Tomori state for update_task");
      return buildFailureResult("task_update_failed_internal_error", "Internal bot error: Missing server context.");
    }

    const timezoneOffset = tomoriState.config.timezone_offset ?? 0;
    const parsedArgs = parseUpdateTaskArguments(args, timezoneOffset);
    if (!parsedArgs.ok) {
      return buildFailureResult(parsedArgs.status, parsedArgs.reason);
    }

    const { serverScheduleRepository, userRepository } = await import("@/utils/db/repositories");

    const isMatrixRelayRequester =
      !!context.message?.webhookId && isMatrixBridgeWebhookUsername(context.message.author.username ?? "");
    const requesterBridgeUserId = isMatrixRelayRequester
      ? (extractBridgeUserId(context.message?.author.username ?? "") ?? undefined)
      : undefined;
    const requesterDiscordId = requesterBridgeUserId ? undefined : context.message?.author?.id || context.userId;
    const requesterUserRow = requesterDiscordId ? await userRepository.loadByDiscordId(requesterDiscordId) : null;

    if (!requesterBridgeUserId && (!requesterDiscordId || !requesterUserRow?.user_id)) {
      return buildFailureResult(
        "task_update_failed_user_not_found",
        "The invoking user could not be resolved for reminder/task editing.",
      );
    }

    const actor: UpdateTaskActor = {
      requesterUserId: requesterUserRow?.user_id,
      requesterDiscordId,
      requesterBridgeUserId,
    };

    if (parsedArgs.isDeleteRequested) {
      const deleteResult = await serverScheduleRepository.deleteReminderForRequester({
        reminder_id: parsedArgs.reminderId,
        server_id: tomoriState.server_id,
        actor: {
          requester_user_id: actor.requesterUserId,
          requester_discord_id: actor.requesterDiscordId,
          requester_bridge_user_id: actor.requesterBridgeUserId,
        },
      });

      if (deleteResult.status === "not_found") {
        return buildFailureResult("task_update_failed_not_found", "Reminder/task ID not found in this server.");
      }
      if (deleteResult.status === "unauthorized") {
        return buildFailureResult(
          "task_update_failed_unauthorized",
          "You can only delete reminders/tasks you created, or non-self reminders targeted at you.",
        );
      }
      if (deleteResult.status !== "deleted") {
        return buildFailureResult("task_update_failed_db_error", "Database operation failed to delete reminder/task.");
      }

      const deletedPurpose = truncateReminderPurpose(deleteResult.reminder.reminder_purpose);
      const personaNickname =
        context.personaUsername || tomoriState.persona_nickname || context.client.user?.username || "TomoriBot";

      // Attach a "Show Full Task" button when the deleted purpose was truncated.
      await sendTaskEmbedWithExpand(
        context.channel,
        context.locale,
        {
          color: ColorCode.ERROR,
          titleKey: "reminders.task_deleted_title",
          titleVars: {
            persona_nickname: personaNickname,
          },
          descriptionKey: "reminders.task_deleted_description",
          descriptionVars: {
            reminder_id: parsedArgs.reminderId,
            reminder_purpose: deletedPurpose,
          },
          footerKey: "reminders.task_deleted_footer",
        },
        deleteResult.reminder.reminder_purpose,
        {
          webhook: context.webhook,
          personaUsername: context.personaUsername,
          personaAvatarUrl: context.personaAvatarUrl,
        },
      );

      return {
        success: true,
        message: "Reminder/task deleted successfully",
        data: {
          status: "task_deleted_successfully",
          reminder_id: parsedArgs.reminderId,
          reminder_purpose_deleted: deleteResult.reminder.reminder_purpose,
        },
      };
    }

    const existingReminder = await serverScheduleRepository.getReminderById(parsedArgs.reminderId);
    if (!existingReminder || existingReminder.server_id !== tomoriState.server_id) {
      return buildFailureResult("task_update_failed_not_found", "Reminder/task ID not found in this server.");
    }

    if (!canReminderActorModifyReminder(existingReminder, actor)) {
      return buildFailureResult(
        "task_update_failed_unauthorized",
        "You can only update reminders/tasks you created, or non-self reminders targeted at you.",
      );
    }

    const finalReminderTime = parsedArgs.newReminderTime ?? new Date(existingReminder.reminder_time);
    if (!validateFutureTime(finalReminderTime)) {
      return buildFailureResult("task_update_failed_invalid_time", "The updated reminder time must be in the future.");
    }

    const finalRepetitionIntervalHours = parsedArgs.hasRepetitionIntervalUpdate
      ? (parsedArgs.repetitionIntervalHours ?? null)
      : (existingReminder.repetition_interval_hours ?? null);
    const finalRepetitionIntervalMinutes = parsedArgs.hasRepetitionIntervalUpdate
      ? (parsedArgs.repetitionIntervalMinutes ?? null)
      : (existingReminder.repetition_interval_minutes ??
        (typeof existingReminder.repetition_interval_hours === "number"
          ? existingReminder.repetition_interval_hours * 60
          : null));

    const finalIsRecurring = finalRepetitionIntervalMinutes !== null && finalRepetitionIntervalMinutes >= 1;
    const isSettingRepeatLimit =
      parsedArgs.hasRepeatLimitUpdate &&
      (typeof parsedArgs.repeatRemainingCount === "number" || parsedArgs.repeatUntilTime instanceof Date);
    const isSettingDailyWindow =
      parsedArgs.hasDailyWindowUpdate &&
      (typeof parsedArgs.dailyWindowStartMinutes === "number" ||
        typeof parsedArgs.dailyWindowEndMinutes === "number" ||
        typeof parsedArgs.dailyWindowTimezoneOffset === "number");
    if (!finalIsRecurring && (isSettingRepeatLimit || isSettingDailyWindow)) {
      return buildFailureResult(
        "task_update_failed_invalid_args",
        "Repeat limits and daily windows can only be used with a recurring repeat interval.",
      );
    }

    let finalRepeatRemainingCount = parsedArgs.hasRepeatLimitUpdate
      ? (parsedArgs.repeatRemainingCount ?? null)
      : (existingReminder.repeat_remaining_count ?? null);
    let finalRepeatUntilTime = parsedArgs.hasRepeatLimitUpdate
      ? (parsedArgs.repeatUntilTime ?? null)
      : (existingReminder.repeat_until_time ?? null);

    let finalDailyWindowStartMinutes = parsedArgs.hasDailyWindowUpdate
      ? (parsedArgs.dailyWindowStartMinutes ?? null)
      : (existingReminder.daily_window_start_minutes ?? null);
    let finalDailyWindowEndMinutes = parsedArgs.hasDailyWindowUpdate
      ? (parsedArgs.dailyWindowEndMinutes ?? null)
      : (existingReminder.daily_window_end_minutes ?? null);
    let finalDailyWindowTimezoneOffset = parsedArgs.hasDailyWindowUpdate
      ? (parsedArgs.dailyWindowTimezoneOffset ?? null)
      : (existingReminder.daily_window_timezone_offset ?? null);

    if (!finalIsRecurring) {
      finalRepeatRemainingCount = null;
      finalRepeatUntilTime = null;
      finalDailyWindowStartMinutes = null;
      finalDailyWindowEndMinutes = null;
      finalDailyWindowTimezoneOffset = null;
    }

    if (finalRepeatUntilTime && finalRepeatUntilTime.getTime() < finalReminderTime.getTime()) {
      return buildFailureResult(
        "task_update_failed_invalid_time",
        "The repeat-until time must be at or after the next trigger time.",
      );
    }

    const hasAnyDailyWindowField =
      finalDailyWindowStartMinutes !== null ||
      finalDailyWindowEndMinutes !== null ||
      finalDailyWindowTimezoneOffset !== null;
    const hasCompleteDailyWindow =
      typeof finalDailyWindowStartMinutes === "number" &&
      typeof finalDailyWindowEndMinutes === "number" &&
      typeof finalDailyWindowTimezoneOffset === "number";
    if (hasAnyDailyWindowField && !hasCompleteDailyWindow) {
      return buildFailureResult(
        "task_update_failed_invalid_args",
        "Daily window data is incomplete. Set both start and end times, or clear the daily window.",
      );
    }

    if (hasCompleteDailyWindow) {
      const windowStartMinutes = finalDailyWindowStartMinutes as number;
      const windowEndMinutes = finalDailyWindowEndMinutes as number;

      if (
        windowStartMinutes < 0 ||
        windowStartMinutes > 1439 ||
        windowEndMinutes < 0 ||
        windowEndMinutes > 1439 ||
        windowEndMinutes <= windowStartMinutes
      ) {
        return buildFailureResult(
          "task_update_failed_invalid_args",
          "Daily window times must be valid same-day times, and the end time must be after the start time.",
        );
      }
    }

    const updateResult = await serverScheduleRepository.updateReminderCoreForRequester({
      reminder_id: parsedArgs.reminderId,
      server_id: tomoriState.server_id,
      reminder_purpose: parsedArgs.newPurpose,
      reminder_time: finalReminderTime,
      repetition_interval_hours: finalRepetitionIntervalHours,
      repetition_interval_minutes: finalRepetitionIntervalMinutes,
      repeat_remaining_count: finalRepeatRemainingCount,
      repeat_until_time: finalRepeatUntilTime,
      daily_window_start_minutes: finalDailyWindowStartMinutes,
      daily_window_end_minutes: finalDailyWindowEndMinutes,
      daily_window_timezone_offset: finalDailyWindowTimezoneOffset,
      actor: {
        requester_user_id: actor.requesterUserId,
        requester_discord_id: actor.requesterDiscordId,
        requester_bridge_user_id: actor.requesterBridgeUserId,
      },
    });

    if (updateResult.status === "not_found") {
      return buildFailureResult("task_update_failed_not_found", "Reminder/task ID not found in this server.");
    }
    if (updateResult.status === "unauthorized") {
      return buildFailureResult(
        "task_update_failed_unauthorized",
        "You can only update reminders/tasks you created, or non-self reminders targeted at you.",
      );
    }
    if (updateResult.status !== "updated") {
      return buildFailureResult("task_update_failed_db_error", "Database operation failed to update reminder/task.");
    }

    const personaNickname =
      context.personaUsername || tomoriState.persona_nickname || context.client.user?.username || "TomoriBot";
    const reminderPurposeText = truncateReminderPurpose(parsedArgs.newPurpose);

    // Show both clocks when the target user has a personal timezone (/personal timezone)
    // differing from the server's - lets the user spot a mislabeled/misconverted time.
    // Self tasks target the bot, which has no personal timezone.
    let targetPersonalOffset: number | null = null;
    if (!existingReminder.self_reminder) {
      const targetUserRow = await userRepository.loadByDiscordId(existingReminder.user_discord_id);
      targetPersonalOffset = targetUserRow?.timezone_offset ?? null;
    }
    const reminderTimeText =
      targetPersonalOffset != null && targetPersonalOffset !== timezoneOffset
        ? localizer(context.locale, "reminders.dual_time_display", {
            server_time: formatTimeWithOffset(finalReminderTime, timezoneOffset, {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
            server_offset: formatUTCOffset(timezoneOffset),
            user_time: formatTimeWithOffset(finalReminderTime, targetPersonalOffset, {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
            user_offset: formatUTCOffset(targetPersonalOffset),
            user_nickname: existingReminder.user_nickname,
          })
        : formatReminderTime(finalReminderTime, timezoneOffset);
    const repeatText = formatRepeatText(context.locale, finalRepetitionIntervalMinutes);

    // Attach a "Show Full Task" button when the new purpose was truncated.
    await sendTaskEmbedWithExpand(
      context.channel,
      context.locale,
      {
        color: ColorCode.MEMORY_UPDATE,
        titleKey: "reminders.task_updated_title",
        titleVars: {
          persona_nickname: personaNickname,
        },
        descriptionKey: "reminders.task_updated_description",
        descriptionVars: {
          reminder_id: parsedArgs.reminderId,
          reminder_purpose: reminderPurposeText,
          reminder_time: reminderTimeText,
          repeat_text: repeatText,
        },
        footerKey: "reminders.task_updated_footer",
      },
      parsedArgs.newPurpose,
      {
        webhook: context.webhook,
        personaUsername: context.personaUsername,
        personaAvatarUrl: context.personaAvatarUrl,
      },
    );

    return {
      success: true,
      message: "Reminder/task updated successfully",
      data: {
        status: "task_updated_successfully",
        reminder_id: parsedArgs.reminderId,
        reminder_purpose: parsedArgs.newPurpose,
        reminder_time: finalReminderTime.toISOString(),
        repetition_interval_hours: finalRepetitionIntervalHours,
        repetition_interval_minutes: finalRepetitionIntervalMinutes,
        repeat_remaining_count: finalRepeatRemainingCount,
        repeat_until_time: finalRepeatUntilTime?.toISOString() ?? null,
        daily_window_start_minutes: finalDailyWindowStartMinutes,
        daily_window_end_minutes: finalDailyWindowEndMinutes,
        daily_window_timezone_offset: finalDailyWindowTimezoneOffset,
        self_reminder: existingReminder.self_reminder ?? false,
        target_user: existingReminder.user_nickname,
        target_channel_id: existingReminder.channel_disc_id,
      },
    };
  }
}

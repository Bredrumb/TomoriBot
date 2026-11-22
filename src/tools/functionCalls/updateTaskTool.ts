import { PermissionFlagsBits } from "discord.js";
import { extractBridgeUserId } from "@/utils/bridges";
import { isMatrixRelayMessage } from "@/utils/chat/triggerProcessor";
import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import { sendTaskEmbedWithExpand } from "@/utils/discord/expandableEmbedNotice";
import { resolveTriggererDiscordId } from "@/utils/discord/targetResolver";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { validateFutureTime } from "@/utils/text/processors/timeUtils";
import {
  alignReminderToDailyWindow,
  formatReminderRepetition,
  getReminderDailyWindow,
  getReminderRepeatLimit,
  getReminderRepetition,
  parseReminderDailyWindow,
  parseReminderRepeatLimit,
  parseToolRepetitionArgs,
  type ReminderRecurrenceOptions,
  type ReminderRepetition,
  toRepetitionColumns,
} from "@/utils/text/processors/reminderRepetition";
import {
  addMonthsWithOffset,
  formatTimeWithOffset,
  formatUTCOffset,
  isValidUtcOffset,
  parseTimeWithOffset,
} from "@/utils/text/timezoneHelper";
import { UTC_OFFSET_MAX, UTC_OFFSET_MIN } from "@/constants/utcOffset";
import type { ToolContext, ToolResult } from "@/types/tool/interfaces";
import type { ReminderRow } from "@/types/db/schema";

const RELATIVE_TIME_KEYS = ["months_from_now", "minutes_from_now"] as const;

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
      hasRepetitionUpdate: boolean;
      repetition?: ReminderRepetition;
      recurrenceOptions?: ReminderRecurrenceOptions;
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

  if (args.action === "delete") {
    return {
      ok: true,
      reminderId: reminderIdArg,
      newPurpose: "",
      isDeleteRequested: true,
      hasRepetitionUpdate: false,
    };
  }

  const reminderPurposeArg = args.reminder_purpose;
  if (typeof reminderPurposeArg !== "string" || !reminderPurposeArg.trim()) {
    return {
      ok: false,
      status: "task_update_failed_invalid_args",
      reason: "Updating requires a nonblank reminder_purpose.",
    };
  }
  const newPurpose = reminderPurposeArg.trim();

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
      let baseTime = new Date();
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

        if (key === "months_from_now") {
          baseTime = addMonthsWithOffset(baseTime, value, timezoneOffset);
        } else {
          totalMilliseconds = value * 60_000;
        }
      }

      newReminderTime = new Date(baseTime.getTime() + totalMilliseconds);
    }
  }

  if (newReminderTime && !validateFutureTime(newReminderTime)) {
    return {
      ok: false,
      status: "task_update_failed_invalid_time",
      reason: "The updated reminder time must be in the future.",
    };
  }

  const repetitionArgs = parseToolRepetitionArgs(args);
  if (!repetitionArgs.ok) {
    return { ok: false, status: "task_update_failed_invalid_args", reason: repetitionArgs.reason };
  }

  const limit = parseReminderRepeatLimit(
    args.repeat_count,
    args.repeat_until_time,
    args.clear_repeat_limit,
    timezoneOffset,
  );
  if (!limit.ok) return { ok: false, status: "task_update_failed_invalid_args", reason: limit.reason };
  const window = parseReminderDailyWindow(
    args.daily_window_start_time,
    args.daily_window_end_time,
    args.clear_daily_window,
    timezoneOffset,
  );
  if (!window.ok) return { ok: false, status: "task_update_failed_invalid_args", reason: window.reason };

  return {
    ok: true,
    reminderId: Math.trunc(reminderIdArg),
    newPurpose,
    isDeleteRequested: false,
    newReminderTime,
    hasRepetitionUpdate: repetitionArgs.provided,
    repetition: repetitionArgs.provided ? repetitionArgs.repetition : undefined,
    ...(limit.value !== undefined || window.value !== undefined
      ? { recurrenceOptions: { limit: limit.value, window: window.value } }
      : {}),
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

function formatReminderTime(reminderTime: Date, timezoneOffset: number, locale: string): string {
  return `${formatTimeWithOffset(
    reminderTime,
    timezoneOffset,
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    locale,
  )} (${formatUTCOffset(timezoneOffset)})`;
}

export async function changeScheduledTask(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const tomoriState = context.tomoriState;
  if (!tomoriState?.server_id) {
    log.error("Missing server_id in Tomori state for task management");
    return buildFailureResult("task_update_failed_internal_error", "Internal bot error: Missing server context.");
  }

  const timezoneOffset = tomoriState.config.timezone_offset ?? 0;
  const parsedArgs = parseUpdateTaskArguments(args, timezoneOffset);
  if (!parsedArgs.ok) {
    return buildFailureResult(parsedArgs.status, parsedArgs.reason);
  }

  const { serverScheduleRepository, userRepository } = await import("@/utils/db/repositories");

  if (context.message) await verifyMessageWebhook(context.message);
  const isMatrixRelayRequester = !!context.message && isMatrixRelayMessage(context.message);
  const requesterBridgeUserId = isMatrixRelayRequester
    ? (extractBridgeUserId(context.message?.author.username ?? "") ?? undefined)
    : undefined;
  const requesterDiscordId = requesterBridgeUserId ? undefined : resolveTriggererDiscordId(context);
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
    // The message author is not necessarily the triggerer (proxied and relayed turns), so the
    // permission is read from the resolved triggerer's member record, never from the message.
    const requesterMember = requesterDiscordId
      ? await context.message?.guild?.members.fetch(requesterDiscordId).catch(() => null)
      : null;
    const deleteResult = await serverScheduleRepository.deleteReminderForRequester({
      reminder_id: parsedArgs.reminderId,
      server_id: tomoriState.server_id,
      actor: {
        requester_user_id: actor.requesterUserId,
        requester_discord_id: actor.requesterDiscordId,
        requester_bridge_user_id: actor.requesterBridgeUserId,
        requester_can_manage_server: requesterMember?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false,
      },
    });

    if (deleteResult.status === "not_found") {
      return buildFailureResult("task_update_failed_not_found", "Reminder/task ID not found in this server.");
    }
    if (deleteResult.status === "unauthorized") {
      return buildFailureResult(
        "task_update_failed_unauthorized",
        "You can only delete reminders/tasks you created, non-self reminders targeted at you, or any reminder if you have the Manage Server permission.",
      );
    }
    if (deleteResult.status !== "deleted") {
      return buildFailureResult("task_update_failed_db_error", "Database operation failed to delete reminder/task.");
    }

    const deletedPurpose = truncateReminderPurpose(deleteResult.reminder.reminder_purpose);
    const personaNickname =
      context.personaUsername || tomoriState.persona_nickname || context.client.user?.username || "TomoriBot";

    await sendTaskEmbedWithExpand(
      context,
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

  const { limit, window } = parsedArgs.recurrenceOptions ?? {};
  const finalRepetition = parsedArgs.hasRepetitionUpdate
    ? (parsedArgs.repetition ?? null)
    : getReminderRepetition(existingReminder);
  if (!finalRepetition && (limit || window)) {
    return buildFailureResult("task_update_failed_invalid_args", "Repeat limits and windows require recurrence.");
  }
  const finalWindow = finalRepetition
    ? window === undefined
      ? getReminderDailyWindow(existingReminder)
      : window
    : null;
  if (finalRepetition?.unit === "months" && finalWindow) {
    return buildFailureResult("task_update_failed_invalid_args", "Clear the daily window before switching to months.");
  }
  const finalReminderTime = alignReminderToDailyWindow(
    parsedArgs.newReminderTime ?? new Date(existingReminder.reminder_time),
    finalWindow,
  );
  if (!validateFutureTime(finalReminderTime)) {
    return buildFailureResult("task_update_failed_invalid_time", "The updated reminder time must be in the future.");
  }

  const finalLimit = finalRepetition ? (limit === undefined ? getReminderRepeatLimit(existingReminder) : limit) : null;
  if (finalLimit && "until" in finalLimit && finalReminderTime > finalLimit.until) {
    return buildFailureResult("task_update_failed_invalid_time", "The repeat cutoff must allow the next delivery.");
  }

  const updateResult = await serverScheduleRepository.updateReminderCoreForRequester({
    reminder_id: parsedArgs.reminderId,
    server_id: tomoriState.server_id,
    reminder_purpose: parsedArgs.newPurpose,
    reminder_time: finalReminderTime,
    repetition: finalRepetition,
    recurrenceOptions: parsedArgs.recurrenceOptions,
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

  // Self tasks target the bot (no personal timezone), while user tasks show both clocks when personal and server
  // offsets differ so misconverted times stand out.
  let targetPersonalOffset: number | null = null;
  if (!existingReminder.self_reminder) {
    const targetUserRow = await userRepository.loadByDiscordId(existingReminder.user_discord_id);
    targetPersonalOffset = targetUserRow?.timezone_offset ?? null;
  }
  const reminderTimeText =
    targetPersonalOffset != null && targetPersonalOffset !== timezoneOffset
      ? localizer(context.locale, "reminders.dual_time_display", {
          server_time: formatTimeWithOffset(
            finalReminderTime,
            timezoneOffset,
            {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            },
            context.locale,
          ),
          server_offset: formatUTCOffset(timezoneOffset),
          user_time: formatTimeWithOffset(
            finalReminderTime,
            targetPersonalOffset,
            {
              year: "numeric",
              month: "long",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            },
            context.locale,
          ),
          user_offset: formatUTCOffset(targetPersonalOffset),
          user_nickname: existingReminder.user_nickname,
        })
      : formatReminderTime(finalReminderTime, timezoneOffset, context.locale);
  const repeatText = formatReminderRepetition(
    context.locale,
    finalRepetition,
    getReminderRepeatLimit(updateResult.reminder),
    getReminderDailyWindow(updateResult.reminder),
    timezoneOffset,
  );

  await sendTaskEmbedWithExpand(
    context,
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
    { kind: "task", id: parsedArgs.reminderId },
  );

  return {
    success: true,
    message: "Reminder/task updated successfully",
    data: {
      status: "task_updated_successfully",
      reminder_id: parsedArgs.reminderId,
      reminder_purpose: parsedArgs.newPurpose,
      reminder_time: finalReminderTime.toISOString(),
      ...toRepetitionColumns(finalRepetition),
      repeat_remaining_count: updateResult.reminder.repeat_remaining_count ?? null,
      repeat_until_time: updateResult.reminder.repeat_until_time?.toISOString() ?? null,
      daily_window: getReminderDailyWindow(updateResult.reminder),
      self_reminder: existingReminder.self_reminder ?? false,
      target_user: existingReminder.user_nickname,
      target_channel_id: existingReminder.channel_disc_id,
    },
  };
}

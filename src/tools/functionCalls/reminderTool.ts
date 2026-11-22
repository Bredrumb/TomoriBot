import { log } from "../../utils/misc/logger";
import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "../../types/tool/interfaces";
import { validateFutureTime } from "@/utils/text/processors/timeUtils";
import {
  alignReminderToDailyWindow,
  formatReminderRepetition,
  parseReminderDailyWindow,
  parseReminderRepeatLimit,
  parseToolRepetitionArgs,
  toRepetitionColumns,
} from "@/utils/text/processors/reminderRepetition";
import { formatLocalizedDuration, formatTimeRemaining } from "@/utils/text/processors/formatters";
import {
  addMonthsWithOffset,
  parseTimeWithOffset,
  formatUTCOffset,
  formatTimeWithOffset,
  isValidUtcOffset,
} from "../../utils/text/timezoneHelper";
import { UTC_OFFSET_MAX, UTC_OFFSET_MIN } from "@/constants/utcOffset";
import { localizer } from "@/utils/text/localizer";
import { isMatrixRelayMessage } from "@/utils/chat/triggerProcessor";
import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import { resolveChannelTarget, resolveTriggererDiscordId, resolveUserTarget } from "@/utils/discord/targetResolver";
import { MAX_REMINDERS_PER_SERVER, ReminderLimitError } from "@/utils/db/repositories/ServerScheduleRepository";
import { getChannelPrivacyReason } from "@/utils/discord/channelPrivacy";

export class ReminderTool extends BaseTool {
  name = "create_task";
  description =
    "Schedule a user reminder or a task for yourself. Use cross_channel_message for immediate work in another channel. Apply calendar months before adding elapsed minutes. Omit repeat intervals for a one-time task. Set at most one positive interval. With no first trigger specified, minute repeats start after one interval and other tasks start after 1 minute. A closed daily window moves the first trigger to its opening.";
  category = "utility" as const;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      reminder_purpose: {
        type: "string",
        description:
          "In 2-4 sentences, record what to do, why, and the conversation details needed later. Leave out IDs and metadata.",
      },
      target_user: {
        type: "string",
        description: "User name as shown in context. Defaults to the invoking user.",
      },
      reminder_time: {
        type: "string",
        description:
          "Absolute first trigger in YYYY-MM-DD_HH:MM. Copy the user's wall-clock time as given. Uses the server timezone unless utc_offset is set. Takes priority over relative time.",
      },
      utc_offset: {
        type: "number",
        description:
          "Offset in hours for reminder_time (e.g. 5.5 for UTC+5:30). Use the user's offset for time given in their local time.",
      },
      minutes_from_now: {
        type: "number",
        description: "Elapsed minutes to the first trigger (60 per hour, 1440 per day).",
      },
      months_from_now: {
        type: "number",
        description:
          "Add calendar months in the server timezone, keeping the time of day. Clamp to the last day if needed.",
      },
      repetition_interval_months: {
        type: "number",
        description:
          "Repeat every X calendar months (1 for monthly, 12 for yearly). Keep the original day and time, using the last day in shorter months.",
      },
      repetition_interval_minutes: {
        type: "number",
        description: "Repeat every X minutes (60 for hourly, 1440 for daily).",
      },
      repeat_count: {
        type: "number",
        description:
          "Remaining deliveries, including the next trigger. Requires recurrence. Choose a count or a cutoff.",
      },
      repeat_until_time: {
        type: "string",
        description: "Last delivery allowed, in YYYY-MM-DD_HH:MM in the server timezone. Requires recurrence.",
      },
      daily_window_start_time: {
        type: "string",
        description:
          "Start of a daily window for minute repeats. Use the server timezone (e.g. 05:00 or 5AM) and supply the end too.",
      },
      daily_window_end_time: {
        type: "string",
        description: "End of the daily window in the server timezone, on the same day as the start.",
      },
      self_reminder: {
        type: "boolean",
        description: "Set true for a task you will execute yourself. Suppresses user mentions.",
      },
      target_channel: {
        type: "string",
        description:
          "Channel or active thread in this server. Copy the exact label in context, including any ID, or pass the channel ID. Defaults to this channel.",
      },
    },
    required: ["reminder_purpose"],
  };

  isAvailableFor(_provider: string): boolean {
    return true;
  }

  // Non-task reminder turns disable this tool so the AI cannot schedule reminders mid-execution, while self-reminder
  // turns stay exempt to spawn follow-ups.
  isAvailableForContext(_provider: string, context?: ToolContext): boolean {
    if (context?.streamContext?.disableReminderTool) return false;
    return true;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const validation = this.validateParameters(args);
    if (!validation.isValid) {
      return {
        success: false,
        error: `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
        data: {
          status: "reminder_creation_failed_invalid_args",
          reason: `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
        },
      };
    }

    const reminderPurposeArg = args.reminder_purpose as string;
    const targetUserArg = args.target_user as string | undefined;
    const legacyTargetUserNicknameArg = args.target_user_nickname as string | undefined;
    const legacyTargetUserDiscordIdArg = args.target_user_discord_id as string | undefined;
    const reminderTimeArg = args.reminder_time as string | undefined;
    const utcOffsetArg = args.utc_offset as number | undefined;
    const minutesFromNowArg = args.minutes_from_now as number | undefined;
    const monthsFromNowArg = args.months_from_now as number | undefined;
    const selfReminderArg = args.self_reminder as boolean | undefined;
    const targetChannelArg = args.target_channel as string | undefined;
    const legacyChannelIdArg = args.channel_id as string | undefined;

    const { userRepository, serverScheduleRepository } = await import("@/utils/db/repositories");
    const { sendTaskEmbedWithExpand } = await import("../../utils/discord/expandableEmbedNotice");
    const { ColorCode } = await import("../../utils/misc/logger");

    const tomoriState = context.tomoriState;
    const resolvedUserId = resolveTriggererDiscordId(context);

    // Matrix relay webhooks have no users table row, so detect them here to allow a null requestingUserRow and store
    // created_by_user_id = null.
    if (context.message) await verifyMessageWebhook(context.message);
    const isMatrixRelayRequester = !!context.message && isMatrixRelayMessage(context.message);

    const requestingUserRow = resolvedUserId ? await userRepository.loadByDiscordId(resolvedUserId) : null;
    const channelId = context.channel.id;
    const requestedTargetUser =
      targetUserArg?.trim() || legacyTargetUserNicknameArg?.trim() || legacyTargetUserDiscordIdArg?.trim();
    const requestedTargetChannel = targetChannelArg?.trim() || legacyChannelIdArg?.trim();

    if (
      !tomoriState ||
      (!requestingUserRow && !isMatrixRelayRequester) ||
      (requestingUserRow && !requestingUserRow.user_id) ||
      !tomoriState.server_id ||
      !resolvedUserId
    ) {
      const missing = [
        !tomoriState && "tomoriState",
        !requestingUserRow && !isMatrixRelayRequester && "requestingUserRow",
        requestingUserRow && !requestingUserRow.user_id && "requestingUserRow.user_id",
        tomoriState && !tomoriState.server_id && "tomoriState.server_id",
        !resolvedUserId && "resolvedUserId",
      ].filter(Boolean);
      log.error(`Critical state missing before handling create_task: [${missing.join(", ")}]`);
      return {
        success: false,
        error: "Internal bot error: Critical state information is missing",
        data: {
          status: "reminder_creation_failed_internal_error",
          reason: "Internal bot error: Critical state information is missing",
        },
      };
    }

    const personaNickname =
      context.personaUsername || tomoriState.persona_nickname || context.client.user?.username || "TomoriBot";

    if (typeof reminderPurposeArg !== "string" || !reminderPurposeArg.trim()) {
      return {
        success: false,
        error: "The 'reminder_purpose' argument was missing, empty, or not a string",
        data: {
          status: "reminder_creation_failed_invalid_args",
          reason: "The 'reminder_purpose' argument was missing, empty, or not a string",
        },
      };
    }

    const botUserId = context.client.user?.id;
    const isSelfReminder =
      selfReminderArg === true ||
      requestedTargetUser?.toLowerCase() === "self" ||
      (typeof legacyTargetUserDiscordIdArg === "string" &&
        !!botUserId &&
        legacyTargetUserDiscordIdArg.trim() === botUserId);

    const shouldDefaultTargetToInvoker = !isSelfReminder && !requestedTargetUser;
    if (shouldDefaultTargetToInvoker && !requestingUserRow?.user_id) {
      return {
        success: false,
        error: "The invoking user could not be resolved as the default reminder target.",
        data: {
          status: "reminder_creation_failed_user_not_found",
          reason: "The invoking user could not be resolved as the default reminder target.",
        },
      };
    }

    if (isSelfReminder && !botUserId) {
      return {
        success: false,
        error: "Tomori bot user ID is not available to create a self reminder",
        data: {
          status: "reminder_creation_failed_internal_error",
          reason: "Tomori bot user ID is missing.",
        },
      };
    }

    const repetitionArgs = parseToolRepetitionArgs(args);
    if (!repetitionArgs.ok) {
      return {
        success: false,
        error: repetitionArgs.reason,
        data: {
          status: "reminder_creation_failed_invalid_repeat_interval",
          reason: repetitionArgs.reason,
        },
      };
    }
    const repetition = repetitionArgs.provided ? repetitionArgs.repetition : null;

    let resolvedChannelId = channelId;
    let resolvedChannelLabel = "Current channel";
    if (requestedTargetChannel) {
      if (!context.guildId) {
        return {
          success: false,
          error: "Channel overrides are not supported in DMs.",
          data: {
            status: "reminder_creation_failed_invalid_channel",
            reason: "Channel overrides are not supported in DMs.",
          },
        };
      }

      const channelResolution = await resolveChannelTarget(requestedTargetChannel, context);
      if (channelResolution.status === "ambiguous") {
        const shownCount = channelResolution.candidates.length;
        const overflowCount = channelResolution.totalCount - shownCount;
        const overflowNote = overflowCount > 0 ? ` (and ${overflowCount} more; use a raw channel ID for others)` : "";
        const candidateLabels = channelResolution.candidates.map((c) => c.label).join(", ");
        return {
          success: false,
          error: `Multiple channels or threads match "${requestedTargetChannel}". Please clarify using the exact inline-code label or raw ID:\n${candidateLabels}${overflowNote}`,
          data: {
            status: "reminder_creation_failed_ambiguous_channel",
            reason: "Multiple channels or threads matched the requested target.",
            candidates: channelResolution.candidates.map((c) => c.label),
            total_matches: channelResolution.totalCount,
          },
        };
      }

      if (channelResolution.status === "not_found") {
        return {
          success: false,
          error: `Could not find a text channel or thread matching "${requestedTargetChannel}" in this server.`,
          data: {
            status: "reminder_creation_failed_invalid_channel",
            reason: "The requested channel or thread was not found in this server.",
          },
        };
      }

      if (
        channelResolution.channel.id !== channelId &&
        getChannelPrivacyReason(channelResolution.channel, tomoriState.config.private_channel_ids ?? [])
      ) {
        return {
          success: false,
          error: localizer(context.locale, "tools.execution.private_channel_target"),
          data: { status: "reminder_creation_failed_private_target" },
        };
      }
      resolvedChannelId = channelResolution.channel.id;
      resolvedChannelLabel = channelResolution.displayLabel;
    } else if ("name" in context.channel) {
      resolvedChannelLabel = `#${context.channel.name}`;
    }

    let finalReminderTime: Date | null = null;
    let timeCalculationMethod = "";

    const timezoneOffset = tomoriState.config.timezone_offset ?? 0;
    const limitResult = parseReminderRepeatLimit(args.repeat_count, args.repeat_until_time, undefined, timezoneOffset);
    const windowResult = parseReminderDailyWindow(
      args.daily_window_start_time,
      args.daily_window_end_time,
      undefined,
      timezoneOffset,
    );
    if (!limitResult.ok) {
      return {
        success: false,
        error: limitResult.reason,
        data: { status: "reminder_creation_failed_invalid_args", reason: limitResult.reason },
      };
    }
    if (!windowResult.ok) {
      return {
        success: false,
        error: windowResult.reason,
        data: { status: "reminder_creation_failed_invalid_args", reason: windowResult.reason },
      };
    }
    const { value: limit } = limitResult;
    const { value: window } = windowResult;
    if ((!repetition && (limit || window)) || (repetition?.unit === "months" && window)) {
      const reason = "Repeat limits require recurrence. Daily windows require a minute interval.";
      return { success: false, error: reason, data: { status: "reminder_creation_failed_invalid_args", reason } };
    }

    if (reminderTimeArg && typeof reminderTimeArg === "string" && reminderTimeArg.trim()) {
      // The model passes wall-clock time and labels its timezone frame via utc_offset instead of converting it, so
      // deterministic code applies the offset here.
      timeCalculationMethod = "absolute";

      if (utcOffsetArg !== undefined && !isValidUtcOffset(utcOffsetArg)) {
        return {
          success: false,
          error: `Invalid 'utc_offset' value '${utcOffsetArg}'. It must be a number of hours between ${UTC_OFFSET_MIN} and ${UTC_OFFSET_MAX} (e.g., 8 for UTC+8, -5 for UTC-5).`,
          data: {
            status: "reminder_creation_failed_invalid_utc_offset",
            reason: `Invalid 'utc_offset' value: '${utcOffsetArg}'. Expected a number between ${UTC_OFFSET_MIN} and ${UTC_OFFSET_MAX}.`,
          },
        };
      }

      const effectiveParseOffset = typeof utcOffsetArg === "number" ? utcOffsetArg : timezoneOffset;
      finalReminderTime = parseTimeWithOffset(reminderTimeArg.trim(), effectiveParseOffset);
      if (!finalReminderTime) {
        return {
          success: false,
          error: `Invalid reminder time format. Please use YYYY-MM-DD_HH:MM format (e.g., '2025-09-05_15:30'). Without 'utc_offset', times are interpreted in the server's configured timezone (${formatUTCOffset(timezoneOffset)}). The provided format '${reminderTimeArg}' is invalid.`,
          data: {
            status: "reminder_creation_failed_invalid_time_format",
            reason: `Invalid reminder time format: '${reminderTimeArg}'. Expected YYYY-MM-DD_HH:MM format in ${formatUTCOffset(effectiveParseOffset)}.`,
            provided_time: reminderTimeArg,
            server_timezone: formatUTCOffset(timezoneOffset),
          },
        };
      }
    } else {
      if (args.hours_from_now != null || args.days_from_now != null) {
        const reason = "Use minutes_from_now for fixed start delays.";
        return {
          success: false,
          error: reason,
          data: { status: "reminder_creation_failed_invalid_args", reason },
        };
      }
      const hasRelativeParams =
        (typeof minutesFromNowArg === "number" && minutesFromNowArg > 0) ||
        (typeof monthsFromNowArg === "number" && monthsFromNowArg > 0);

      timeCalculationMethod = "relative";
      const now = new Date();
      const currentTime = hasRelativeParams ? now : alignReminderToDailyWindow(now, window);
      const defaultDelayMinutes = repetition?.unit === "minutes" ? repetition.interval : 1;
      const effectiveMinutesFromNow = hasRelativeParams
        ? minutesFromNowArg
        : currentTime > now
          ? 0
          : defaultDelayMinutes;
      const monthShiftedTime =
        typeof monthsFromNowArg === "number" && monthsFromNowArg > 0
          ? addMonthsWithOffset(currentTime, monthsFromNowArg, timezoneOffset)
          : currentTime;
      const totalMilliseconds =
        typeof effectiveMinutesFromNow === "number" && effectiveMinutesFromNow > 0
          ? effectiveMinutesFromNow * 60_000
          : 0;

      finalReminderTime = new Date(monthShiftedTime.getTime() + totalMilliseconds);
    }

    if (finalReminderTime && validateFutureTime(finalReminderTime)) {
      finalReminderTime = alignReminderToDailyWindow(finalReminderTime, window);
    }
    const reminderPurpose = reminderPurposeArg.trim();
    if (limit && "until" in limit && finalReminderTime && finalReminderTime > limit.until) {
      const reason = "The repeat cutoff must allow the first scheduled delivery.";
      return { success: false, error: reason, data: { status: "reminder_creation_failed_invalid_args", reason } };
    }

    if (!finalReminderTime || !validateFutureTime(finalReminderTime)) {
      const timeDisplay =
        timeCalculationMethod === "absolute"
          ? reminderTimeArg
          : `calculated from relative parameters (${[
              minutesFromNowArg && `${minutesFromNowArg} minutes`,
              monthsFromNowArg && `${monthsFromNowArg} months`,
            ]
              .filter(Boolean)
              .join(", ")})`;

      return {
        success: false,
        error: `The reminder time must be in the future. The ${timeCalculationMethod} time ${timeDisplay} results in a past time or is too close to the current time.`,
        data: {
          status: "reminder_creation_failed_past_time",
          reason: `The ${timeCalculationMethod} time calculation resulted in a past time.`,
          calculated_time: finalReminderTime?.toISOString() || "invalid",
          current_utc_time: new Date().toISOString(),
          time_method: timeCalculationMethod,
        },
      };
    }

    try {
      let actualNicknameInDB = requestedTargetUser || "Tomori";
      let resolvedTargetUserId = "";
      let resolvedTargetUserLabel = actualNicknameInDB;
      // Target's personal timezone offset (/personal config): used only for the
      // dual-clock confirmation display, never for time interpretation
      let targetPersonalOffset: number | null = null;

      if (isSelfReminder) {
        resolvedTargetUserId = botUserId as string;
        actualNicknameInDB = tomoriState.persona_nickname || context.client.user?.username || "Tomori";
        resolvedTargetUserLabel = actualNicknameInDB;
      } else if (shouldDefaultTargetToInvoker) {
        resolvedTargetUserId = resolvedUserId;
        actualNicknameInDB = requestingUserRow?.user_nickname ?? context.message?.author?.displayName ?? "Unknown";
        resolvedTargetUserLabel = actualNicknameInDB;
        targetPersonalOffset = requestingUserRow?.timezone_offset ?? null;
        log.info(`Reminder tool: Defaulted missing target_user to invoking user ${resolvedTargetUserId}`);
      } else {
        const userResolution = await resolveUserTarget(requestedTargetUser as string, context);
        if (userResolution.status === "ambiguous") {
          return {
            success: false,
            error: `Multiple users match "${requestedTargetUser}". Please clarify which one you mean: ${userResolution.candidates.map((candidate) => candidate.label).join(", ")}.`,
            data: {
              status: "reminder_creation_failed_ambiguous_user",
              reason: "Multiple users matched the requested target.",
              candidates: userResolution.candidates.map((candidate) => candidate.label),
            },
          };
        }

        if (userResolution.status === "not_found") {
          return {
            success: false,
            error: `Could not find a user matching "${requestedTargetUser}" in this conversation or server.`,
            data: {
              status: "reminder_creation_failed_user_not_found",
              reason: "The requested user was not found in this conversation or server.",
            },
          };
        }

        resolvedTargetUserId = userResolution.targetId;
        resolvedTargetUserLabel = userResolution.displayLabel;

        if (userResolution.isBridgeUser) {
          actualNicknameInDB = userResolution.displayLabel.replace(/\s+\(Matrix\)$/u, "");
          log.info(
            `Reminder: Target is a bridge user (${resolvedTargetUserId}), storing display label "${actualNicknameInDB}" without a DB lookup`,
          );
        } else {
          const targetUserRow = await userRepository.loadByDiscordId(resolvedTargetUserId);

          if (!targetUserRow?.user_id) {
            log.warn(`Reminder: Resolved target user ${resolvedTargetUserId} is unknown to TomoriBot`);
            return {
              success: false,
              error: `I don't know ${resolvedTargetUserLabel} yet, so I cannot create a reminder for them.`,
              data: {
                status: "reminder_creation_failed_user_not_found",
                reason: "I can only create reminders for users I already know.",
              },
            };
          }

          actualNicknameInDB = resolvedTargetUserLabel ?? targetUserRow.user_nickname ?? targetUserRow.user_disc_id;
          targetPersonalOffset = targetUserRow.timezone_offset ?? null;
        }
      }

      const dbResult = await serverScheduleRepository.addReminder({
        server_id: tomoriState.server_id,
        channel_disc_id: resolvedChannelId,
        user_discord_id: resolvedTargetUserId,
        user_nickname: actualNicknameInDB,
        reminder_purpose: reminderPurpose,
        reminder_time: finalReminderTime,
        repetition,
        recurrenceOptions: limit || window ? { limit, window } : undefined,
        self_reminder: isSelfReminder,
        // The creator's personal key pays for the reminder when it fires, so a bystander anchor never becomes it.
        created_by_user_id: context.borrowsTriggerMessage
          ? (context.internalUserId ?? null)
          : (requestingUserRow?.user_id ?? null),
        persona_id: context.tomoriState.persona_id ?? null,
      });

      if (dbResult) {
        log.success(
          `Reminder created (ID: ${dbResult.reminder_id}): "${reminderPurpose}" for ${actualNicknameInDB} (${resolvedTargetUserId}) at ${finalReminderTime.toISOString()}`,
        );

        const timeRemainingMs = finalReminderTime.getTime() - Date.now();
        // The tool result feeds model context, which stays English; only the embed follows the locale.
        const timeRemainingStr = formatTimeRemaining(timeRemainingMs);
        const localizedTimeRemaining = formatLocalizedDuration(timeRemainingMs, context.locale);

        const timeFormatOptions: Intl.DateTimeFormatOptions = {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        };
        const formattedReminderTime = formatTimeWithOffset(
          finalReminderTime,
          timezoneOffset,
          timeFormatOptions,
          context.locale,
        );

        const useRecurringTaskEmbed = isSelfReminder && repetition !== null;
        const useOneTimeTaskEmbed = isSelfReminder && repetition === null;
        const repeatText = formatReminderRepetition(context.locale, repetition, limit, window, timezoneOffset);
        const reminderPurposeText =
          reminderPurpose.length > 200 ? `${reminderPurpose.substring(0, 197)}...` : reminderPurpose;
        // Show both clocks when the target's personal timezone differs from the server's so the user spots misconverted
        // times.
        const reminderTimeText =
          targetPersonalOffset != null && targetPersonalOffset !== timezoneOffset
            ? localizer(context.locale, "reminders.dual_time_display", {
                server_time: formattedReminderTime,
                server_offset: formatUTCOffset(timezoneOffset),
                user_time: formatTimeWithOffset(
                  finalReminderTime,
                  targetPersonalOffset,
                  timeFormatOptions,
                  context.locale,
                ),
                user_offset: formatUTCOffset(targetPersonalOffset),
                user_nickname: actualNicknameInDB,
              })
            : `${formattedReminderTime} (${formatUTCOffset(timezoneOffset)})`;
        // Long purposes receive an expansion button so the full text remains
        // available ephemerally without adding channel clutter.
        await sendTaskEmbedWithExpand(
          context,
          {
            color: useRecurringTaskEmbed ? ColorCode.INFO : ColorCode.SUCCESS,
            titleKey: useRecurringTaskEmbed
              ? "reminders.recurring_task_set_title"
              : useOneTimeTaskEmbed
                ? "reminders.task_set_title"
                : "reminders.reminder_set_title",
            titleVars: {
              persona_nickname: personaNickname,
            },
            descriptionKey: useRecurringTaskEmbed
              ? "reminders.recurring_task_set_details"
              : useOneTimeTaskEmbed
                ? "reminders.task_set_description"
                : "reminders.reminder_set_description",
            descriptionVars: {
              user_nickname: actualNicknameInDB,
              reminder_purpose: reminderPurposeText,
              reminder_time: reminderTimeText,
              repeat_text: repeatText,
            },
            footerKey: useRecurringTaskEmbed
              ? "reminders.recurring_task_set_footer"
              : repetition
                ? "reminders.recurring_reminder_set_footer"
                : useOneTimeTaskEmbed
                  ? "reminders.task_set_footer"
                  : "reminders.reminder_set_footer",
            footerVars: { time_remaining: localizedTimeRemaining, repeat_text: repeatText },
          },
          reminderPurpose,
          dbResult.reminder_id === undefined ? undefined : { kind: "task", id: dbResult.reminder_id },
        );

        return {
          success: true,
          message: `Reminder successfully set for ${actualNicknameInDB}`,
          data: {
            status: "reminder_created_successfully",
            reminder_id: dbResult.reminder_id,
            target_user: resolvedTargetUserLabel,
            reminder_purpose: reminderPurpose,
            reminder_time: finalReminderTime.toISOString(),
            ...toRepetitionColumns(repetition),
            repeat_remaining_count: limit && "remaining" in limit ? limit.remaining : null,
            repeat_until_time: limit && "until" in limit ? limit.until.toISOString() : null,
            daily_window: window ?? null,
            target_channel: resolvedChannelLabel,
            self_reminder: isSelfReminder,
            time_remaining_ms: timeRemainingMs,
            time_remaining_text: timeRemainingStr,
          },
        };
      }

      log.error("Failed to create reminder (DB error)");
      return {
        success: false,
        error: "Database operation failed to create reminder",
        data: {
          status: "reminder_creation_failed_db_error",
          reason: "Database operation failed to create reminder",
        },
      };
    } catch (error) {
      if (error instanceof ReminderLimitError) {
        return {
          success: false,
          error: `This server already has ${MAX_REMINDERS_PER_SERVER} pending reminders and tasks. Ask the user to remove some with /scheduled-task remove before adding another.`,
          data: {
            status: "reminder_creation_failed_limit",
            reason: `The server reached its limit of ${MAX_REMINDERS_PER_SERVER} pending reminders.`,
          },
        };
      }
      log.error("Error during reminder creation", error as Error);
      return {
        success: false,
        error: "Error occurred while creating reminder",
        data: {
          status: "reminder_creation_failed_error",
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }
}

/**
 * Reminder Tool
 * Allows the AI to set reminders for users, causing TomoriBot to mention them at the specified time
 */

import { log } from "../../utils/misc/logger";
import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "../../types/tool/interfaces";
import { validateFutureTime } from "@/utils/text/processors/timeUtils";
import { formatTimeRemaining } from "@/utils/text/processors/formatters";
import {
  parseTimeWithOffset,
  formatUTCOffset,
  formatTimeWithOffset,
  isValidUtcOffset,
  UTC_OFFSET_MIN,
  UTC_OFFSET_MAX,
} from "../../utils/text/timezoneHelper";
import { localizer } from "@/utils/text/localizer";
import { isMatrixBridgeWebhookUsername } from "../../utils/bridges";
import { resolveChannelTarget, resolveUserTarget } from "@/utils/discord/targetResolver";

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
    if (amPmMatch[3] === "am") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
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

function getLocalDayStartUtcMs(date: Date, timezoneOffset: number): number {
  const localDate = new Date(date.getTime() + timezoneOffset * 60 * 60 * 1000);
  return (
    Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate()) -
    timezoneOffset * 60 * 60 * 1000
  );
}

function getLocalMinuteOfDay(date: Date, timezoneOffset: number): number {
  const localDate = new Date(date.getTime() + timezoneOffset * 60 * 60 * 1000);
  return localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
}

function alignToDailyWindow(
  candidate: Date,
  windowStartMinutes: number,
  windowEndMinutes: number,
  timezoneOffset: number,
): Date {
  const localMinute = getLocalMinuteOfDay(candidate, timezoneOffset);
  const localDayStartUtcMs = getLocalDayStartUtcMs(candidate, timezoneOffset);

  if (localMinute < windowStartMinutes) {
    return new Date(localDayStartUtcMs + windowStartMinutes * 60 * 1000);
  }
  if (localMinute > windowEndMinutes) {
    return new Date(localDayStartUtcMs + 24 * 60 * 60 * 1000 + windowStartMinutes * 60 * 1000);
  }
  return candidate;
}

function formatRepetitionIntervalText(
  locale: string,
  repetitionIntervalMinutes: number,
  repeatRemainingCount: number | null,
): string {
  const intervalText =
    repetitionIntervalMinutes % 60 === 0
      ? localizer(locale, "reminders.repeat_interval_hours", {
          repetition_interval_hours: repetitionIntervalMinutes / 60,
        })
      : localizer(locale, "reminders.repeat_interval_minutes", {
          repetition_interval_minutes: repetitionIntervalMinutes,
        });

  if (repeatRemainingCount === null) {
    return intervalText;
  }

  return localizer(locale, "reminders.repeat_interval_with_count", {
    repetition_interval_text: intervalText,
    repeat_remaining_count: repeatRemainingCount,
  });
}

/**
 * Tool for creating scheduled tasks that trigger messages at specific times
 */
export class ReminderTool extends BaseTool {
  name = "create_task";
  description =
    "Create a scheduled task in a Discord channel. Use this for both user reminders and self tasks: a reminder is just a task that notifies a target user. IMPORTANT: Always set either 'repetition_interval_minutes' or 'repetition_interval_hours' - use 0 for one-time tasks, or 1+ for recurring tasks. Prefer minutes for sub-hour schedules (e.g., 2 for every 2 minutes, 30 for every 30 minutes), and hours for whole-hour schedules (e.g., 24 for daily tasks). For finite recurring requests like 'every 15 minutes 4 times', set 'repeat_count'; for requests like 'every 15 minutes until 18:00', set 'repeat_until_time'. For daily active windows like 'every hour from 5AM to 10PM', set repetition_interval_hours=1, daily_window_start_time='05:00', and daily_window_end_time='22:00'. Use 'self_reminder' for tasks you should execute yourself on a schedule (for example daily summaries or periodic reports). For instant, one-time messages in other channels, use cross_channel_message instead as it sends immediately without scheduling. You can specify time in two ways: (1) Use relative time parameters like 'minutes_from_now', 'hours_from_now', 'days_from_now', 'months_from_now' for natural requests like 'in 2 hours' or 'tomorrow'. Multiple relative parameters add up. (2) Use absolute 'reminder_time' in YYYY-MM-DD_HH:MM format for specific dates/times. Pass the wall-clock time exactly as the user expressed it - NEVER convert between timezones yourself. By default absolute times are interpreted in the server's configured timezone (set via /server timezone); if the user expressed the time in their own personal timezone (shown in the conversation context), set 'utc_offset' to that timezone's UTC offset and the conversion is handled for you. If both absolute and relative times are provided, absolute time takes priority. If you omit all time parameters for a recurring task, the first trigger defaults to the repeat interval from now unless a daily window is provided and the current time is outside it; otherwise it defaults to 1 minute from now.";
  category = "utility" as const;

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      reminder_purpose: {
        type: "string",
        description:
          "What the task is for. IMPORTANT: Be very descriptive and detailed (2-4 sentences) because you might not remember the context after a long time. Include WHAT the task is about, WHY it was set, and any relevant details from the conversation. The more context you provide now, the more helpful the task will be later, but do NOT include user/channel IDs or any meta information in this content.",
      },
      target_user: {
        type: "string",
        description:
          "OPTIONAL: Name of the user this task should notify, as shown in the current conversation or current server. Use natural names, not IDs. If omitted, the task notifies the current turn's invoking user. If this is a task for yourself instead, set self_reminder to true.",
      },
      reminder_time: {
        type: "string",
        description:
          "OPTIONAL: Absolute time to trigger the task in YYYY-MM-DD_HH:MM format (e.g., '2025-09-05_15:30'). Pass the wall-clock time exactly as the user expressed it. Do NOT convert between timezones yourself. Without 'utc_offset', this is interpreted in the server's configured timezone (set via /server timezone). Use this for specific dates/times. If provided, this takes priority over 'from now' parameters.",
      },
      utc_offset: {
        type: "number",
        description:
          "OPTIONAL: The UTC offset in hours that 'reminder_time' is expressed in (e.g., 8 for UTC+8, -5 for UTC-5, 5.5 for UTC+5:30). Set this to the target user's personal timezone offset (shown in the conversation context) when they expressed the time in their own local time. If omitted, the server's configured timezone is used. Only meaningful together with 'reminder_time'.",
      },
      minutes_from_now: {
        type: "number",
        description:
          "OPTIONAL: Minutes from the current time to schedule the task. Can be combined with other 'from now' parameters.",
      },
      hours_from_now: {
        type: "number",
        description:
          "OPTIONAL: Hours from the current time to schedule the task. Can be combined with other 'from now' parameters.",
      },
      days_from_now: {
        type: "number",
        description:
          "OPTIONAL: Days from the current time to schedule the task. Can be combined with other 'from now' parameters.",
      },
      months_from_now: {
        type: "number",
        description:
          "OPTIONAL: Months from the current time to schedule the task. Can be combined with other 'from now' parameters. Uses calendar months (30.44 days average).",
      },
      repetition_interval_hours: {
        type: "number",
        description:
          "OPTIONAL: Set to 0 for one-time tasks. Set to 1 or higher to make the task recurring every X hours after the first trigger. Example: 24 for daily tasks, 168 for weekly tasks. Use repetition_interval_minutes instead for sub-hour schedules.",
      },
      repetition_interval_minutes: {
        type: "number",
        description:
          "OPTIONAL: Set to 0 for one-time tasks. Set to 1 or higher to make the task recurring every X minutes after the first trigger. Example: 2 for every 2 minutes, 30 for every 30 minutes, 90 for every 1 hour 30 minutes.",
      },
      repeat_until_time: {
        type: "string",
        description:
          "OPTIONAL: Absolute cutoff time for finite recurring tasks in YYYY-MM-DD_HH:MM format using the server's configured timezone. Example: for 'every 15 minutes until 18:00', set the recurring interval and set this to today's date at 18:00. The task will include triggers at or before this time, then auto-delete.",
      },
      repeat_count: {
        type: "number",
        description:
          "OPTIONAL: Total number of times a recurring task should trigger before auto-deleting. Use this for requests like 'remind me 4 times' or when you have already calculated the number of repeats.",
      },
      daily_window_start_time: {
        type: "string",
        description:
          "OPTIONAL: Local daily start time for recurring tasks, such as '05:00' or '5AM'. Use with daily_window_end_time for requests like 'every day once every hour from 5AM to 10PM'.",
      },
      daily_window_end_time: {
        type: "string",
        description:
          "OPTIONAL: Local daily end time for recurring tasks, such as '22:00' or '10PM'. The task repeats only at times from daily_window_start_time through this time, inclusive, then resumes the next day.",
      },
      self_reminder: {
        type: "boolean",
        description:
          "OPTIONAL: Set to true when this is a task for you to execute yourself. This disables user mentions and focuses the prompt on the task.",
      },
      target_channel: {
        type: "string",
        description:
          "OPTIONAL: Channel or active thread label where this task should trigger. Useful for cross-channel tasks. The channel must exist in the current server. If the prompt shows a copyable inline-code label like `#general (ID: ...)`, prefer copying that exact label to avoid ambiguity. A raw Discord channel/thread ID is also accepted. If omitted, the current channel is used.",
      },
    },
    required: ["reminder_purpose"],
  };

  /**
   * Check if reminder tool is available for the given provider
   * @param _provider - LLM provider name (unused)
   * @returns True if provider supports reminder functionality
   */
  isAvailableFor(_provider: string): boolean {
    return true;
  }

  /**
   * Context-aware availability check — disabled during non-task reminder-triggered turns
   * to prevent the AI from scheduling new reminders while executing an existing one.
   * Self-reminder (task) turns are exempt so tasks can spawn follow-up tasks.
   * @param _provider - LLM provider name (unused)
   * @param context - Optional tool context containing streaming flags
   */
  isAvailableForContext(_provider: string, context?: ToolContext): boolean {
    if (context?.streamContext?.disableReminderTool) return false;
    return true;
  }

  /**
   * Execute reminder creation
   * @param args - Arguments containing reminder details
   * @param context - Tool execution context
   * @returns Promise resolving to tool result
   */
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    // Validate parameters
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

    // Extract arguments
    const reminderPurposeArg = args.reminder_purpose as string;
    const targetUserArg = args.target_user as string | undefined;
    const legacyTargetUserNicknameArg = args.target_user_nickname as string | undefined;
    const legacyTargetUserDiscordIdArg = args.target_user_discord_id as string | undefined;
    let reminderTimeArg = args.reminder_time as string | undefined;
    const utcOffsetArg = args.utc_offset as number | undefined;
    const minutesFromNowArg = args.minutes_from_now as number | undefined;
    const hoursFromNowArg = args.hours_from_now as number | undefined;
    const daysFromNowArg = args.days_from_now as number | undefined;
    const monthsFromNowArg = args.months_from_now as number | undefined;
    let repetitionIntervalHoursArg = args.repetition_interval_hours as number | undefined;
    let repetitionIntervalMinutesArg = args.repetition_interval_minutes as number | undefined;
    let repeatUntilTimeArg = args.repeat_until_time as string | undefined;
    const repeatCountArg = args.repeat_count as number | undefined;
    const dailyWindowStartTimeArg = args.daily_window_start_time as string | undefined;
    const dailyWindowEndTimeArg = args.daily_window_end_time as string | undefined;
    const selfReminderArg = args.self_reminder as boolean | undefined;
    const targetChannelArg = args.target_channel as string | undefined;
    const legacyChannelIdArg = args.channel_id as string | undefined;

    // NovelAI GLM recovery: normalize absolute time format.
    // GLM may output "2025-09-05 15:30" (space), "2025-09-05T15:30" (ISO), or
    // "2025/09/05_15:30" (slashes) instead of the expected "YYYY-MM-DD_HH:MM" format.
    // Normalize common variants before parseTimeWithOffset rejects them.
    if (reminderTimeArg && typeof reminderTimeArg === "string") {
      let normalized = reminderTimeArg.trim();
      // 1. Replace slash date separators with dashes (2025/09/05 -> 2025-09-05)
      normalized = normalized.replace(/^(\d{4})\/(\d{2})\/(\d{2})/, "$1-$2-$3");
      // 2. Replace space or T between date and time with underscore
      normalized = normalized.replace(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/, "$1_$2");
      if (normalized !== reminderTimeArg) {
        log.info(`Reminder tool: Normalized time format "${reminderTimeArg}" -> "${normalized}"`);
        reminderTimeArg = normalized;
      }
    }

    if (repeatUntilTimeArg && typeof repeatUntilTimeArg === "string") {
      let normalized = repeatUntilTimeArg.trim();
      normalized = normalized.replace(/^(\d{4})\/(\d{2})\/(\d{2})/, "$1-$2-$3");
      normalized = normalized.replace(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/, "$1_$2");
      if (normalized !== repeatUntilTimeArg) {
        log.info(`Reminder tool: Normalized repeat-until time format "${repeatUntilTimeArg}" -> "${normalized}"`);
        repeatUntilTimeArg = normalized;
      }
    }

    // NovelAI GLM recovery: default repetition_interval_hours to 0 (one-time) when missing.
    // GLM frequently omits this required parameter for simple "remind me in X" requests.
    // Only for NovelAI — other providers have retries and should be required to explicitly
    // set this so the model is "conscious" of whether the reminder is one-time or recurring.
    if (
      context.provider === "novelai" &&
      typeof repetitionIntervalHoursArg !== "number" &&
      typeof repetitionIntervalMinutesArg !== "number"
    ) {
      log.info("Reminder tool: Auto-filling missing repetition_interval_hours with 0 (one-time reminder)");
      repetitionIntervalHoursArg = 0;
    }

    // Import database functions and utilities
    const { userRepository, serverScheduleRepository } = await import("@/utils/db/repositories");
    const { sendTaskEmbedWithExpand } = await import("../../utils/discord/expandableEmbedNotice");
    const { ColorCode } = await import("../../utils/misc/logger");

    // Get server and user context
    const tomoriState = context.tomoriState;
    const resolvedUserId = context.message?.author?.id || context.userId;

    // Matrix relay messages arrive via Discord webhook (author = webhook bot).
    // The webhook bot has no users table record, so loadUserRow returns null.
    // Detect this case so we can relax the requestingUserRow guard below and
    // store created_by_user_id = null (the column is nullable for this reason).
    const isMatrixRelayRequester =
      !!context.message?.webhookId && isMatrixBridgeWebhookUsername(context.message?.author?.username ?? "");

    const requestingUserRow = resolvedUserId ? await userRepository.loadByDiscordId(resolvedUserId) : null;
    const channelId = context.channel.id;
    const requestedTargetUser =
      targetUserArg?.trim() || legacyTargetUserNicknameArg?.trim() || legacyTargetUserDiscordIdArg?.trim();
    const requestedTargetChannel = targetChannelArg?.trim() || legacyChannelIdArg?.trim();

    if (
      !tomoriState ||
      // Allow null requestingUserRow for Matrix relay webhooks — they have no
      // users table entry, so created_by_user_id will be stored as null
      (!requestingUserRow && !isMatrixRelayRequester) ||
      (requestingUserRow && !requestingUserRow.user_id) ||
      !tomoriState.server_id ||
      !resolvedUserId
    ) {
      // Log which specific value is missing for diagnostics
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

    // Validate reminder purpose
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

    // Validate target user nickname
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

    // Validate repetition interval (0 = one-time, 1+ = recurring)
    let repetitionIntervalHours: number | null = null;
    let repetitionIntervalMinutes: number | null = null;
    const providedHoursInterval = typeof repetitionIntervalHoursArg === "number" ? repetitionIntervalHoursArg : null;
    const providedMinutesInterval =
      typeof repetitionIntervalMinutesArg === "number" ? repetitionIntervalMinutesArg : null;
    const hasHoursInterval = providedHoursInterval !== null;
    const hasMinutesInterval = providedMinutesInterval !== null;

    if (!hasHoursInterval && !hasMinutesInterval) {
      return {
        success: false,
        error: "Set either 'repetition_interval_minutes' or 'repetition_interval_hours' to 0 for one-time tasks or 1+ for recurring tasks.",
        data: {
          status: "reminder_creation_failed_invalid_repeat_interval",
          reason: "No repetition interval was provided.",
        },
      };
    }

    if (hasHoursInterval || hasMinutesInterval) {
      const invalidHours =
        hasHoursInterval &&
        (!Number.isFinite(providedHoursInterval) ||
          !Number.isInteger(providedHoursInterval) ||
          providedHoursInterval < 0);
      const invalidMinutes =
        hasMinutesInterval &&
        (!Number.isFinite(providedMinutesInterval) ||
          !Number.isInteger(providedMinutesInterval) ||
          providedMinutesInterval < 0);

      if (invalidHours || invalidMinutes) {
        return {
          success: false,
          error:
            "The repetition interval must be 0 (for one-time) or an integer >= 1 in either minutes or hours (for recurring)",
          data: {
            status: "reminder_creation_failed_invalid_repeat_interval",
            reason: "The repetition interval must be 0 or an integer >= 1.",
          },
        };
      }

      if (
        hasHoursInterval &&
        hasMinutesInterval &&
        (providedHoursInterval as number) > 0 &&
        (providedMinutesInterval as number) > 0
      ) {
        return {
          success: false,
          error: "Use either 'repetition_interval_minutes' or 'repetition_interval_hours', not both.",
          data: {
            status: "reminder_creation_failed_invalid_repeat_interval",
            reason: "Both minute and hour repetition intervals were provided.",
          },
        };
      }

      const intervalMinutes =
        hasMinutesInterval && (providedMinutesInterval as number) > 0
          ? (providedMinutesInterval as number)
          : hasHoursInterval
            ? (providedHoursInterval as number) * 60
            : 0;
      repetitionIntervalMinutes = intervalMinutes > 0 ? intervalMinutes : null;
      repetitionIntervalHours =
        repetitionIntervalMinutes !== null && repetitionIntervalMinutes % 60 === 0
          ? repetitionIntervalMinutes / 60
          : null;
    }

    // Resolve and validate target channel (optional override)
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

      resolvedChannelId = channelResolution.channel.id;
      resolvedChannelLabel = channelResolution.displayLabel;
    } else if ("name" in context.channel) {
      resolvedChannelLabel = `#${context.channel.name}`;
    }

    // Determine which time method to use and calculate the final reminder time
    let finalReminderTime: Date | null = null;
    let timeCalculationMethod = "";

    // Get the server's configured timezone offset (default to 0/UTC if not set)
    const timezoneOffset = tomoriState.config.timezone_offset ?? 0;
    let dailyWindowStartMinutes: number | null = null;
    let dailyWindowEndMinutes: number | null = null;
    let dailyWindowTimezoneOffset: number | null = null;
    const hasDailyWindowStart = typeof dailyWindowStartTimeArg === "string" && dailyWindowStartTimeArg.trim().length > 0;
    const hasDailyWindowEnd = typeof dailyWindowEndTimeArg === "string" && dailyWindowEndTimeArg.trim().length > 0;

    if (hasDailyWindowStart || hasDailyWindowEnd) {
      if (!hasDailyWindowStart || !hasDailyWindowEnd || repetitionIntervalMinutes === null) {
        return {
          success: false,
          error:
            "'daily_window_start_time' and 'daily_window_end_time' must both be provided and can only be used with a recurring interval.",
          data: {
            status: "reminder_creation_failed_invalid_daily_window",
            reason: "Daily window settings require both start/end times and a recurring interval.",
          },
        };
      }

      dailyWindowStartMinutes = parseDailyWindowTime(dailyWindowStartTimeArg as string);
      dailyWindowEndMinutes = parseDailyWindowTime(dailyWindowEndTimeArg as string);
      if (
        dailyWindowStartMinutes === null ||
        dailyWindowEndMinutes === null ||
        dailyWindowEndMinutes <= dailyWindowStartMinutes
      ) {
        return {
          success: false,
          error: "Daily window times must be valid same-day times, and the end time must be after the start time.",
          data: {
            status: "reminder_creation_failed_invalid_daily_window",
            reason: "Invalid daily window start/end times.",
          },
        };
      }
      dailyWindowTimezoneOffset = timezoneOffset;
    }

    if (reminderTimeArg && typeof reminderTimeArg === "string" && reminderTimeArg.trim()) {
      // Method 1: Absolute time provided - parse in the offset the model labeled
      // the time with (utc_offset), falling back to the server's configured timezone.
      // The model passes wall-clock time as spoken and labels the frame instead of
      // converting it — deterministic code does the offset arithmetic here.
      timeCalculationMethod = "absolute";

      // Validate utc_offset only when it will actually be used (absolute path)
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
      // Method 2: Relative time parameters - calculate from current time
      const hasRelativeParams =
        (typeof minutesFromNowArg === "number" && minutesFromNowArg > 0) ||
        (typeof hoursFromNowArg === "number" && hoursFromNowArg > 0) ||
        (typeof daysFromNowArg === "number" && daysFromNowArg > 0) ||
        (typeof monthsFromNowArg === "number" && monthsFromNowArg > 0);

      // Default to 1 minute if no time parameters provided (immediate message use case)
      let effectiveMinutesFromNow = minutesFromNowArg;
      if (!hasRelativeParams) {
        const currentLocalMinute = getLocalMinuteOfDay(new Date(), timezoneOffset);
        const isOutsideDailyWindow =
          dailyWindowStartMinutes !== null &&
          dailyWindowEndMinutes !== null &&
          (currentLocalMinute < dailyWindowStartMinutes || currentLocalMinute > dailyWindowEndMinutes);
        effectiveMinutesFromNow = isOutsideDailyWindow ? 0 : (repetitionIntervalMinutes ?? 1);
        log.info(`No time parameters provided for reminder - defaulting to ${effectiveMinutesFromNow} minute(s) from now`);
      }

      // Calculate relative time by adding all "from now" parameters
      timeCalculationMethod = "relative";
      const currentTime = new Date();
      let totalMilliseconds = 0;

      // Add each time component (convert to milliseconds)
      if (typeof effectiveMinutesFromNow === "number" && effectiveMinutesFromNow > 0) {
        totalMilliseconds += effectiveMinutesFromNow * 60 * 1000;
      }
      if (typeof hoursFromNowArg === "number" && hoursFromNowArg > 0) {
        totalMilliseconds += hoursFromNowArg * 60 * 60 * 1000;
      }
      if (typeof daysFromNowArg === "number" && daysFromNowArg > 0) {
        totalMilliseconds += daysFromNowArg * 24 * 60 * 60 * 1000;
      }
      if (typeof monthsFromNowArg === "number" && monthsFromNowArg > 0) {
        // Use average month length (30.44 days) for consistency
        totalMilliseconds += monthsFromNowArg * 30.44 * 24 * 60 * 60 * 1000;
      }

      finalReminderTime = new Date(currentTime.getTime() + totalMilliseconds);
    }

    if (finalReminderTime && dailyWindowStartMinutes !== null && dailyWindowEndMinutes !== null) {
      finalReminderTime = alignToDailyWindow(finalReminderTime, dailyWindowStartMinutes, dailyWindowEndMinutes, timezoneOffset);
    }

    const reminderPurpose = reminderPurposeArg.trim();

    // Validate that the calculated time is in the future (both absolute and relative times)
    if (!finalReminderTime || !validateFutureTime(finalReminderTime)) {
      const timeDisplay =
        timeCalculationMethod === "absolute"
          ? reminderTimeArg
          : `calculated from relative parameters (${[
              minutesFromNowArg && `${minutesFromNowArg} minutes`,
              hoursFromNowArg && `${hoursFromNowArg} hours`,
              daysFromNowArg && `${daysFromNowArg} days`,
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

    let repeatRemainingCount: number | null = null;
    let repeatUntilTime: Date | null = null;
    if (typeof repeatCountArg === "number") {
      if (
        repetitionIntervalMinutes === null ||
        !Number.isFinite(repeatCountArg) ||
        !Number.isInteger(repeatCountArg) ||
        repeatCountArg < 1
      ) {
        return {
          success: false,
          error: "'repeat_count' must be an integer >= 1 and can only be used with a recurring interval.",
          data: {
            status: "reminder_creation_failed_invalid_repeat_count",
            reason: "Invalid repeat count for recurring reminder.",
          },
        };
      }

      repeatRemainingCount = repeatCountArg;
    }

    if (repeatUntilTimeArg && typeof repeatUntilTimeArg === "string" && repeatUntilTimeArg.trim()) {
      if (repetitionIntervalMinutes === null) {
        return {
          success: false,
          error: "'repeat_until_time' can only be used with a recurring repetition interval.",
          data: {
            status: "reminder_creation_failed_invalid_repeat_until",
            reason: "A repeat-until cutoff was provided without a recurring interval.",
          },
        };
      }

      repeatUntilTime = parseTimeWithOffset(repeatUntilTimeArg.trim(), timezoneOffset);
      if (!repeatUntilTime) {
        return {
          success: false,
          error: `Invalid repeat-until time format. Please use YYYY-MM-DD_HH:MM format (e.g., '2025-09-05_18:00') in the server's configured timezone (${formatUTCOffset(timezoneOffset)}).`,
          data: {
            status: "reminder_creation_failed_invalid_repeat_until",
            reason: `Invalid repeat-until time format: '${repeatUntilTimeArg}'.`,
            provided_time: repeatUntilTimeArg,
            server_timezone: formatUTCOffset(timezoneOffset),
          },
        };
      }

      if (repeatUntilTime.getTime() < finalReminderTime.getTime()) {
        return {
          success: false,
          error: "'repeat_until_time' must be at or after the first reminder time.",
          data: {
            status: "reminder_creation_failed_invalid_repeat_until",
            reason: "The repeat-until cutoff is before the first trigger time.",
            first_trigger_time: finalReminderTime.toISOString(),
            repeat_until_time: repeatUntilTime.toISOString(),
          },
        };
      }

      const intervalMs = repetitionIntervalMinutes * 60 * 1000;
      const calculatedRepeatCount =
        Math.floor((repeatUntilTime.getTime() - finalReminderTime.getTime()) / intervalMs) + 1;
      repeatRemainingCount =
        repeatRemainingCount !== null ? Math.min(repeatRemainingCount, calculatedRepeatCount) : calculatedRepeatCount;
    }

    try {
      let actualNicknameInDB = requestedTargetUser || "Tomori";
      let resolvedTargetUserId = "";
      let resolvedTargetUserLabel = actualNicknameInDB;
      // Target's personal timezone offset (/personal timezone) — used only for the
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
          // Load target user to verify they exist
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

          actualNicknameInDB = targetUserRow.user_nickname;
          targetPersonalOffset = targetUserRow.timezone_offset ?? null;
        }
      }

      // Create the reminder in the database
      const dbResult = await serverScheduleRepository.addReminder({
        server_id: tomoriState.server_id,
        channel_disc_id: resolvedChannelId,
        user_discord_id: resolvedTargetUserId,
        user_nickname: actualNicknameInDB, // Use the verified nickname from DB
        reminder_purpose: reminderPurpose,
        reminder_time: finalReminderTime,
        repetition_interval_hours: repetitionIntervalHours,
        repetition_interval_minutes: repetitionIntervalMinutes,
        repeat_remaining_count: repeatRemainingCount,
        repeat_until_time: repeatUntilTime,
        daily_window_start_minutes: dailyWindowStartMinutes,
        daily_window_end_minutes: dailyWindowEndMinutes,
        daily_window_timezone_offset: dailyWindowTimezoneOffset,
        self_reminder: isSelfReminder,
        created_by_user_id: requestingUserRow?.user_id ?? null,
        persona_id: context.tomoriState.persona_id ?? null,
      });

      if (dbResult) {
        log.success(
          `Reminder created (ID: ${dbResult.reminder_id}): "${reminderPurpose}" for ${actualNicknameInDB} (${resolvedTargetUserId}) at ${finalReminderTime.toISOString()}`,
        );

        // Calculate time remaining for user-friendly display
        const timeRemainingMs = finalReminderTime.getTime() - Date.now();
        const timeRemainingStr = formatTimeRemaining(timeRemainingMs);

        // Send confirmation notice to the channel
        // Format the reminder time in the server's configured timezone
        const timeFormatOptions: Intl.DateTimeFormatOptions = {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        };
        const formattedReminderTime = formatTimeWithOffset(finalReminderTime, timezoneOffset, timeFormatOptions);

        const useRecurringTaskEmbed = isSelfReminder && repetitionIntervalMinutes !== null;
        const useOneTimeTaskEmbed = isSelfReminder && repetitionIntervalMinutes === null;
        const reminderPurposeText =
          reminderPurpose.length > 200 ? `${reminderPurpose.substring(0, 197)}...` : reminderPurpose;
        // Show both clocks when the target has a personal timezone differing from
        // the server's — lets the user immediately spot a mislabeled/misconverted time
        const reminderTimeText =
          targetPersonalOffset != null && targetPersonalOffset !== timezoneOffset
            ? localizer(context.locale, "reminders.dual_time_display", {
                server_time: formattedReminderTime,
                server_offset: formatUTCOffset(timezoneOffset),
                user_time: formatTimeWithOffset(finalReminderTime, targetPersonalOffset, timeFormatOptions),
                user_offset: formatUTCOffset(targetPersonalOffset),
                user_nickname: actualNicknameInDB,
              })
            : `${formattedReminderTime} (${formatUTCOffset(timezoneOffset)})`;
        const baseDescriptionVars = {
          user_nickname: actualNicknameInDB,
          reminder_purpose: reminderPurposeText,
          reminder_time: reminderTimeText,
        };
        const repetitionIntervalDisplayText =
          repetitionIntervalMinutes === null
            ? localizer(context.locale, "reminders.repeat_interval_minutes", { repetition_interval_minutes: 0 })
            : formatRepetitionIntervalText(context.locale, repetitionIntervalMinutes, repeatRemainingCount);
        const descriptionVars = useRecurringTaskEmbed
          ? {
              ...baseDescriptionVars,
              repetition_interval_text: repetitionIntervalDisplayText,
            }
          : baseDescriptionVars;

        // Send the confirmation notice. The expand helper attaches a "Show Full Task"
        // button when the full purpose exceeds the 200-char truncation threshold,
        // letting users read the entire purpose ephemerally without channel clutter.
        await sendTaskEmbedWithExpand(
          context.channel,
          context.locale,
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
              ? "reminders.recurring_task_set_description"
              : useOneTimeTaskEmbed
                ? "reminders.task_set_description"
                : "reminders.reminder_set_description",
            descriptionVars,
            footerKey: useRecurringTaskEmbed
              ? "reminders.recurring_task_set_footer"
              : repetitionIntervalMinutes
                ? "reminders.reminder_set_footer_recurring"
                : useOneTimeTaskEmbed
                  ? "reminders.task_set_footer"
                  : "reminders.reminder_set_footer",
            footerVars: repetitionIntervalMinutes
              ? {
                  time_remaining: timeRemainingStr,
                  repetition_interval_text: repetitionIntervalDisplayText,
                }
              : {
                  time_remaining: timeRemainingStr,
                },
          },
          reminderPurpose,
          {
            webhook: context.webhook,
            personaUsername: context.personaUsername,
            personaAvatarUrl: context.personaAvatarUrl,
          },
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
            repetition_interval_hours: repetitionIntervalHours,
            repetition_interval_minutes: repetitionIntervalMinutes,
            repeat_until_time: repeatUntilTime?.toISOString() ?? null,
            repeat_remaining_count: repeatRemainingCount,
            daily_window_start_minutes: dailyWindowStartMinutes,
            daily_window_end_minutes: dailyWindowEndMinutes,
            daily_window_timezone_offset: dailyWindowTimezoneOffset,
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

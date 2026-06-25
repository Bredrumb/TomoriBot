import type { Client, Message, TextBasedChannel, TextChannel } from "discord.js";
import { ChannelType } from "discord.js";
import { log, ColorCode } from "../utils/misc/logger";
import { serverScheduleRepository } from "@/utils/db/repositories";

import type { ReminderRow } from "../types/db/schema";
import { calculateLateness } from "@/utils/text/processors/timeUtils";
import { tomoriChat, suppressNextSelfReply } from "../events/messageCreate/tomoriChat";
import { createStandardEmbed } from "../utils/discord/embedHelper";
import { getCachedAllPersonas } from "../utils/cache/tomoriStateCache";
import {
  getOrCreateWebhook,
  resolvePersonaWebhookIdentity,
  sendWebhookMessageWithIdentity,
} from "../utils/discord/webhookManager";
import { ensureDiscordUserMention } from "../utils/discord/mentionHelper";
import { isBridgeUserId } from "../utils/bridges";
import { sendMatrixReminderMention } from "../utils/bridges/matrix";

function getNextRecurringReminderTime(
  reminderTime: Date,
  repetitionIntervalMinutes: number,
  referenceTimeMs = Date.now(),
): Date {
  const intervalMs = repetitionIntervalMinutes * 60 * 1000;
  const scheduledTimeMs = reminderTime.getTime();
  const intervalsElapsed = Math.max(1, Math.floor((referenceTimeMs - scheduledTimeMs) / intervalMs) + 1);
  return new Date(scheduledTimeMs + intervalsElapsed * intervalMs);
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

function isInDailyWindow(
  date: Date,
  windowStartMinutes: number,
  windowEndMinutes: number,
  timezoneOffset: number,
): boolean {
  const localMinute = getLocalMinuteOfDay(date, timezoneOffset);
  return localMinute >= windowStartMinutes && localMinute <= windowEndMinutes;
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

function getNextWindowedRecurringReminderTime(
  reminderTime: Date,
  repetitionIntervalMinutes: number,
  windowStartMinutes: number,
  windowEndMinutes: number,
  timezoneOffset: number,
  referenceTimeMs = Date.now(),
): Date {
  const intervalCandidate = getNextRecurringReminderTime(reminderTime, repetitionIntervalMinutes, referenceTimeMs);
  return alignToDailyWindow(intervalCandidate, windowStartMinutes, windowEndMinutes, timezoneOffset);
}

export class ReminderProcessor {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  public async processDueReminders(): Promise<void> {
    try {
      const dueReminders = await serverScheduleRepository.getDueReminders();

      if (!dueReminders || dueReminders.length === 0) {
        return;
      }

      log.info(`Processing ${dueReminders.length} due reminder(s)`);

      for (const reminder of dueReminders) {
        await this.executeReminder(reminder);
      }
    } catch (error) {
      log.error("Error checking for due reminders:", error);
    }
  }

  private async executeReminder(reminder: ReminderRow): Promise<void> {
    try {
      log.info(
        `Executing reminder ${reminder.reminder_id} for user ${reminder.user_nickname} (${reminder.user_discord_id})`,
      );

      const currentTime = new Date();
      const repetitionIntervalMinutes =
        typeof reminder.repetition_interval_minutes === "number"
          ? reminder.repetition_interval_minutes
          : typeof reminder.repetition_interval_hours === "number"
            ? reminder.repetition_interval_hours * 60
            : null;
      const isRecurring = repetitionIntervalMinutes !== null && repetitionIntervalMinutes >= 1;
      const hasDailyWindow =
        typeof reminder.daily_window_start_minutes === "number" &&
        typeof reminder.daily_window_end_minutes === "number" &&
        typeof reminder.daily_window_timezone_offset === "number";
      const repeatUntilTime = reminder.repeat_until_time instanceof Date ? reminder.repeat_until_time : null;
      const currentRepeatRemainingCount =
        typeof reminder.repeat_remaining_count === "number" ? reminder.repeat_remaining_count : null;

      if (isRecurring && reminder.reminder_id) {
        if (currentRepeatRemainingCount !== null && currentRepeatRemainingCount <= 0) {
          await serverScheduleRepository.deleteReminderById(reminder.reminder_id);
          log.success(`Finite recurring reminder ${reminder.reminder_id} had no remaining runs and was deleted`);
          return;
        }

        if (repeatUntilTime && reminder.reminder_time.getTime() > repeatUntilTime.getTime()) {
          await serverScheduleRepository.deleteReminderById(reminder.reminder_id);
          log.success(`Recurring reminder ${reminder.reminder_id} was past its repeat-until time and was deleted`);
          return;
        }
      }

      if (isRecurring && hasDailyWindow && reminder.reminder_id) {
        const windowStartMinutes = reminder.daily_window_start_minutes as number;
        const windowEndMinutes = reminder.daily_window_end_minutes as number;
        const windowTimezoneOffset = reminder.daily_window_timezone_offset as number;

        if (!isInDailyWindow(currentTime, windowStartMinutes, windowEndMinutes, windowTimezoneOffset)) {
          const nextTriggerTime = alignToDailyWindow(
            currentTime,
            windowStartMinutes,
            windowEndMinutes,
            windowTimezoneOffset,
          );

          if (repeatUntilTime && nextTriggerTime.getTime() > repeatUntilTime.getTime()) {
            await serverScheduleRepository.deleteReminderById(reminder.reminder_id);
            log.success(`Daily-window reminder ${reminder.reminder_id} passed its repeat-until time and was deleted`);
            return;
          }

          const rescheduled = await serverScheduleRepository.rescheduleReminder(
            reminder.reminder_id,
            nextTriggerTime,
            currentRepeatRemainingCount,
            repeatUntilTime,
          );

          if (rescheduled) {
            log.info(
              `Daily-window reminder ${reminder.reminder_id} was due outside its active window and rescheduled for ${nextTriggerTime.toISOString()}`,
            );
          } else {
            log.error(`Failed to reschedule daily-window reminder ${reminder.reminder_id}; deleting to prevent loops`);
            await serverScheduleRepository.deleteReminderById(reminder.reminder_id);
          }
          return;
        }
      }

      const channel = await this.client.channels.fetch(reminder.channel_disc_id);

      if (!channel) {
        log.error(`Channel ${reminder.channel_disc_id} not found for reminder ${reminder.reminder_id}`);
        await this.handleReminderExecutionFailure(reminder, `Channel not found: ${reminder.channel_disc_id}`);
        return;
      }

      if (!channel.isTextBased()) {
        log.error(`Channel ${reminder.channel_disc_id} is not text-based for reminder ${reminder.reminder_id}`);
        await this.handleReminderExecutionFailure(reminder, "Channel is not text-based");
        return;
      }

      let lastMessage: Message | undefined;
      try {
        const messages = await channel.messages.fetch({ limit: 1 });
        lastMessage = messages.first();
      } catch (fetchError) {
        log.error(
          `Failed to fetch last message from channel ${reminder.channel_disc_id} for reminder ${reminder.reminder_id}:`,
          fetchError,
        );
      }

      if (!lastMessage && "send" in channel) {
        try {
          lastMessage = await channel.send({
            content: "\u2800",
          });
          log.info(
            `Seeded placeholder message in channel ${reminder.channel_disc_id} for reminder ${reminder.reminder_id}`,
          );
        } catch (sendError) {
          log.warn(
            `Failed to seed placeholder message in channel ${reminder.channel_disc_id} for reminder ${reminder.reminder_id}:`,
            sendError,
          );
        }
      }

      if (!lastMessage) {
        log.warn(
          `No messages found in channel ${reminder.channel_disc_id} for reminder ${reminder.reminder_id}, sending error embed instead`,
        );
        await this.handleReminderExecutionFailure(reminder, "No messages found in channel for context");
        return;
      }

      const lateness = calculateLateness(reminder.reminder_time, currentTime);

      log.info(`About to call tomoriChat for reminder ${reminder.reminder_id}:`);
      log.info(`- Last message author: ${lastMessage.author.username} (bot: ${lastMessage.author.bot})`);
      log.info(`- Last message ID: ${lastMessage.id}`);
      log.info(`- Reminder recipient ID: ${reminder.user_discord_id}`);
      log.info(`- Reminder purpose: "${reminder.reminder_purpose}"`);
      log.info(`- Lateness: ${lateness || "none"}`);

      const reminderStartTime = Date.now();
      const isSelfReminder = reminder.self_reminder === true;

      suppressNextSelfReply(channel.id);

      const disposition = await tomoriChat({
        client: this.client,
        message: lastMessage,
        isFromQueue: false,
        isManuallyTriggered: true,
        forceReason: false,
        isStopResponse: false,
        reminderRecipientID: reminder.user_discord_id,
        reminderData: {
          reminder_purpose: reminder.reminder_purpose,
          reminder_lateness: lateness,
          self_reminder: isSelfReminder,
        },
        selectedPersonaId: reminder.persona_id ?? undefined,
        isPersonaJob: false,
        isUserImpersonation: false,
        textQuotaSource: "system",
        shouldSurfaceUserErrors: true,
        // Tasks (self_reminder) may spawn follow-up tasks; user reminders block create_task to prevent loops
        manualStreamingContextOverrides: isSelfReminder ? undefined : { disableReminderTool: true },
      });

      log.info(`tomoriChat call completed for reminder ${reminder.reminder_id} (disposition: ${disposition})`);

      // 1. If the chat call was rejected before it could run (ignored/blocked/error), do not delete
      //    the DB row — let the next reconcile cycle retry. Without this guard, a reminder that fires
      //    while the channel is in a transient blocked/ignored state would be lost forever.
      if (disposition !== "run" && disposition !== "queued") {
        log.warn(
          `Reminder ${reminder.reminder_id} not executed (disposition: ${disposition}); leaving DB row intact for next reconcile cycle.`,
        );
        return;
      }

      // 2. "queued" means the reminder is waiting behind a busy channel. The queued replay carries
      //    the reminder context (reminderRecipientID/reminderData on QueuedMessage) and will execute
      //    later, so we still delete/reschedule the DB row to prevent the reconcile loop from
      //    double-firing. But we skip the post-reminder mention fallback below — firing it now would
      //    mention the user before the queued reply actually lands.
      const isQueued = disposition === "queued";

      if (!isQueued && !isSelfReminder && isBridgeUserId(reminder.user_discord_id)) {
        await sendMatrixReminderMention(
          channel,
          reminder,
          lastMessage.id,
          reminderStartTime,
          this.client.user?.id ?? "",
        );
      } else if (!isQueued && !isSelfReminder) {
        await this.ensureReminderRecipientMention(channel, reminder, lastMessage.id, reminderStartTime);
      }

      if (isRecurring && reminder.reminder_id) {
        const nextRepeatRemainingCount =
          currentRepeatRemainingCount !== null ? Math.max(0, currentRepeatRemainingCount - 1) : null;

        if (nextRepeatRemainingCount !== null && nextRepeatRemainingCount <= 0) {
          await serverScheduleRepository.deleteReminderById(reminder.reminder_id);
          log.success(`Finite recurring reminder ${reminder.reminder_id} executed its final run and was deleted`);
          return;
        }

        const nextTriggerTime = hasDailyWindow
          ? getNextWindowedRecurringReminderTime(
              reminder.reminder_time,
              repetitionIntervalMinutes,
              reminder.daily_window_start_minutes as number,
              reminder.daily_window_end_minutes as number,
              reminder.daily_window_timezone_offset as number,
            )
          : getNextRecurringReminderTime(reminder.reminder_time, repetitionIntervalMinutes);
        if (repeatUntilTime && nextTriggerTime.getTime() > repeatUntilTime.getTime()) {
          await serverScheduleRepository.deleteReminderById(reminder.reminder_id);
          log.success(`Recurring reminder ${reminder.reminder_id} reached its repeat-until time and was deleted`);
          return;
        }

        const rescheduled = await serverScheduleRepository.rescheduleReminder(
          reminder.reminder_id,
          nextTriggerTime,
          nextRepeatRemainingCount,
          repeatUntilTime,
        );

        if (rescheduled) {
          log.success(`Reminder ${reminder.reminder_id} executed and rescheduled for ${nextTriggerTime.toISOString()}`);
        } else {
          log.error(`Failed to reschedule recurring reminder ${reminder.reminder_id}; deleting to prevent duplicates`);
          await serverScheduleRepository.deleteReminderById(reminder.reminder_id);
        }
      } else if (reminder.reminder_id) {
        await serverScheduleRepository.deleteReminderById(reminder.reminder_id);
        log.success(`Reminder ${reminder.reminder_id} executed and deleted successfully`);
      } else {
        log.error("Cannot delete reminder: reminder_id is undefined");
      }
    } catch (error) {
      log.error(`Error executing reminder ${reminder.reminder_id}:`, error);
      await this.handleReminderExecutionFailure(reminder, error instanceof Error ? error.message : "Unknown error");
    }
  }

  private async ensureReminderRecipientMention(
    channel: TextBasedChannel,
    reminder: ReminderRow,
    afterMessageId: string,
    reminderStartTime: number,
  ): Promise<void> {
    if (isBridgeUserId(reminder.user_discord_id)) return;

    await ensureDiscordUserMention({
      client: this.client,
      channel,
      targetUserId: reminder.user_discord_id,
      afterMessageId,
      triggerStartTime: reminderStartTime,
      contextLabel: `reminder ${reminder.reminder_id}`,
      fallbackSender: (content) => this.trySendPersonaFallbackMention(channel, reminder, content),
    });
  }

  private async trySendPersonaFallbackMention(
    channel: TextBasedChannel,
    reminder: ReminderRow,
    content: string,
  ): Promise<boolean> {
    if (!reminder.persona_id) return false;
    if (!("guild" in channel) || !channel.guild) return false;

    const supportsWebhooks =
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.PublicThread ||
      channel.type === ChannelType.PrivateThread ||
      channel.type === ChannelType.AnnouncementThread;
    if (!supportsWebhooks) return false;

    try {
      const personas = await getCachedAllPersonas(channel.guild.id);
      const persona = personas.find((p) => p.persona_id === reminder.persona_id);
      if (!persona?.is_alter) return false;

      const isThread = "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
      if (isThread && !channel.parent) {
        return false;
      }
      const webhookChannel = isThread && channel.parent ? channel.parent : channel;

      const webhookResult = await getOrCreateWebhook(webhookChannel as TextChannel);
      const webhook = webhookResult.webhook;
      if (!webhook) return false;

      const identity = await resolvePersonaWebhookIdentity(persona, channel.guild);
      await sendWebhookMessageWithIdentity(
        webhook,
        {
          content,
          allowedMentions: {
            users: [reminder.user_discord_id],
            roles: [],
            parse: [],
          },
          ...(isThread ? { threadId: channel.id } : {}),
        },
        identity,
      );
      return true;
    } catch (error) {
      log.warn(`Failed to send persona fallback mention for reminder ${reminder.reminder_id}:`, error);
      return false;
    }
  }

  private async handleReminderExecutionFailure(reminder: ReminderRow, errorReason: string): Promise<void> {
    try {
      if (reminder.reminder_id) {
        await serverScheduleRepository.deleteReminderById(reminder.reminder_id);
      }

      try {
        const channel = await this.client.channels.fetch(reminder.channel_disc_id);
        if (channel?.isTextBased() && "send" in channel) {
          const isSelfReminder = reminder.self_reminder === true;

          const embed = createStandardEmbed("en-US", {
            color: ColorCode.INFO,
            titleKey: isSelfReminder ? "reminders.task_triggered_title" : "reminders.reminder_triggered_title",
            descriptionKey: "reminders.triggered_description",
            descriptionVars: { reminder_purpose: reminder.reminder_purpose },
            footerKey: "reminders.triggered_footer",
          });

          const mentionContent =
            !isSelfReminder && !isBridgeUserId(reminder.user_discord_id) ? `<@${reminder.user_discord_id}>` : undefined;

          await (channel as TextChannel).send({
            ...(mentionContent ? { content: mentionContent } : {}),
            embeds: [embed],
            ...(mentionContent
              ? {
                  allowedMentions: {
                    users: [reminder.user_discord_id],
                    roles: [],
                    parse: [],
                  },
                }
              : {}),
          });
        }
      } catch (fallbackError) {
        log.error(`Failed to send fallback reminder info embed for reminder ${reminder.reminder_id}:`, fallbackError);
      }

      log.warn(`Reminder ${reminder.reminder_id} deleted due to execution failure: ${errorReason}`);
    } catch (error) {
      log.error(`Error handling reminder execution failure for reminder ${reminder.reminder_id}:`, error);
    }
  }
}

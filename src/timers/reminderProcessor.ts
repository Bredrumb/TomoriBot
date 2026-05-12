import type { Client, Message, TextBasedChannel, TextChannel } from "discord.js";
import { ChannelType } from "discord.js";
import { log, ColorCode } from "../utils/misc/logger";
import { deleteReminderById, getDueReminders } from "../utils/db/repositories";
import { rescheduleReminder } from "../utils/db/repositories";
import type { ReminderRow } from "../types/db/schema";
import { calculateLateness } from "../utils/text/stringHelper";
import tomoriChat, { suppressNextSelfReply } from "../events/messageCreate/tomoriChat";
import { createStandardEmbed } from "../utils/discord/embedHelper";
import { getCachedAllPersonas } from "../utils/cache/tomoriStateCache";
import {
  getOrCreateWebhook,
  resolvePersonaWebhookIdentity,
  sendWebhookMessageWithIdentity,
} from "../utils/discord/webhookManager";
import { ensureDiscordUserMention } from "../utils/discord/mentionHelper";
import { isBridgeUserId } from "../utils/bridge";
import { sendMatrixReminderMention } from "../utils/matrix";

function getNextRecurringReminderTime(
  reminderTime: Date,
  repetitionIntervalHours: number,
  referenceTimeMs = Date.now(),
): Date {
  const intervalMs = repetitionIntervalHours * 60 * 60 * 1000;
  const scheduledTimeMs = reminderTime.getTime();
  const intervalsElapsed = Math.max(1, Math.floor((referenceTimeMs - scheduledTimeMs) / intervalMs) + 1);
  return new Date(scheduledTimeMs + intervalsElapsed * intervalMs);
}

export class ReminderProcessor {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  public async processDueReminders(): Promise<void> {
    try {
      const dueReminders = await getDueReminders();

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

      const currentTime = new Date();
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

      await tomoriChat(
        this.client,
        lastMessage,
        false,
        true,
        false,
        undefined,
        undefined,
        false,
        0,
        false,
        reminder.user_discord_id,
        {
          reminder_purpose: reminder.reminder_purpose,
          reminder_lateness: lateness,
          self_reminder: isSelfReminder,
        },
        reminder.persona_id ?? undefined,
        false,
        false,
        undefined,
        "system",
        undefined, // textQuotaTriggerKey
        undefined, // textQuotaUserDiscId
        undefined, // manualSystemPrompt
        undefined, // manualPrefill
        undefined, // naiContinuationPrefill
        undefined, // emptyResponseFinishReason
        undefined, // injectedContextItems
        undefined, // forcedMentions
        undefined, // manualTriggerInvoker
        // Tasks (self_reminder) may spawn follow-up tasks; user reminders block create_task to prevent loops
        isSelfReminder ? undefined : { disableReminderTool: true },
      );

      log.info(`tomoriChat call completed for reminder ${reminder.reminder_id}`);

      if (!isSelfReminder && isBridgeUserId(reminder.user_discord_id)) {
        await sendMatrixReminderMention(
          channel,
          reminder,
          lastMessage.id,
          reminderStartTime,
          this.client.user?.id ?? "",
        );
      } else if (!isSelfReminder) {
        await this.ensureReminderRecipientMention(channel, reminder, lastMessage.id, reminderStartTime);
      }

      const repetitionIntervalHours =
        typeof reminder.repetition_interval_hours === "number" ? reminder.repetition_interval_hours : null;
      const isRecurring = repetitionIntervalHours !== null && repetitionIntervalHours >= 1;

      if (isRecurring && reminder.reminder_id) {
        const nextTriggerTime = getNextRecurringReminderTime(reminder.reminder_time, repetitionIntervalHours);
        const rescheduled = await rescheduleReminder(reminder.reminder_id, nextTriggerTime);

        if (rescheduled) {
          log.success(`Reminder ${reminder.reminder_id} executed and rescheduled for ${nextTriggerTime.toISOString()}`);
        } else {
          log.error(`Failed to reschedule recurring reminder ${reminder.reminder_id}; deleting to prevent duplicates`);
          await deleteReminderById(reminder.reminder_id);
        }
      } else if (reminder.reminder_id) {
        await deleteReminderById(reminder.reminder_id);
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
      const persona = personas.find((p) => p.tomori_id === reminder.persona_id);
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
        await deleteReminderById(reminder.reminder_id);
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

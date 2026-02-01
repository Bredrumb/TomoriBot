/**
 * Reminder Timer System
 * Polling-based system for executing reminders with 1-minute precision
 * Note: pg_cron is only used for hourly cleanup of expired reminders, not execution
 */

import type {
	Client,
	Message,
	TextBasedChannel,
	TextChannel,
} from "discord.js";
import { ChannelType } from "discord.js";
import { log, ColorCode } from "../utils/misc/logger";
import { getDueReminders, deleteReminderById } from "../utils/db/dbRead";
import { rescheduleReminder } from "../utils/db/dbWrite";
import type { ReminderRow } from "../types/db/schema";
import { calculateLateness } from "../utils/text/stringHelper";
import tomoriChat, {
	suppressNextSelfReply,
} from "../events/messageCreate/tomoriChat";
import { sendStandardEmbed } from "../utils/discord/embedHelper";
import { getCachedAllPersonas } from "../utils/cache/tomoriStateCache";
import {
	getOrCreatePersonaWebhook,
	getOrCreateWebhook,
	resolvePersonaAvatarURL,
} from "../utils/discord/webhookManager";

/**
 * Class to manage the fallback reminder timer system
 */
export class ReminderTimer {
	private client: Client;
	private intervalId: NodeJS.Timeout | null = null;
	private isRunning = false;
	private readonly POLL_INTERVAL_MS = 60000; // Check every minute

	constructor(client: Client) {
		this.client = client;
	}

	/**
	 * Starts the reminder polling timer
	 */
	public start(): void {
		if (this.isRunning) {
			log.warn("Reminder timer is already running");
			return;
		}

		log.info("Starting reminder timer (polling every 60s)");
		this.isRunning = true;

		// Run immediately on start
		this.checkReminders().catch((error) => {
			log.error("Error during initial reminder check on timer start:", error);
		});

		// Set up interval for regular checks
		this.intervalId = setInterval(() => {
			this.checkReminders().catch((error) => {
				log.error("Error during scheduled reminder check:", error);
			});
		}, this.POLL_INTERVAL_MS);

		log.success("Reminder timer started successfully");
	}

	/**
	 * Stops the reminder polling timer
	 */
	public stop(): void {
		if (!this.isRunning) {
			log.warn("Reminder timer is not running");
			return;
		}

		log.info("Stopping reminder timer");
		this.isRunning = false;

		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		log.success("Reminder timer stopped successfully");
	}

	/**
	 * Checks for due reminders and executes them
	 */
	public async checkReminders(): Promise<void> {
		try {
			const dueReminders = await getDueReminders();

			if (!dueReminders || dueReminders.length === 0) {
				// No due reminders - this is normal, don't log
				return;
			}

			log.info(`Processing ${dueReminders.length} due reminder(s)`);

			// Process each due reminder
			for (const reminder of dueReminders) {
				await this.executeReminder(reminder);
			}
		} catch (error) {
			log.error("Error checking for due reminders:", error);
		}
	}

	/**
	 * Executes a single reminder
	 */
	private async executeReminder(reminder: ReminderRow): Promise<void> {
		try {
			log.info(
				`Executing reminder ${reminder.reminder_id} for user ${reminder.user_nickname} (${reminder.user_discord_id})`,
			);

			// Get the channel where the reminder was set
			const channel = await this.client.channels.fetch(
				reminder.channel_disc_id,
			);

			if (!channel) {
				log.error(
					`Channel ${reminder.channel_disc_id} not found for reminder ${reminder.reminder_id}`,
				);
				await this.handleReminderExecutionFailure(
					reminder,
					`Channel not found: ${reminder.channel_disc_id}`,
				);
				return;
			}

			if (!channel.isTextBased()) {
				log.error(
					`Channel ${reminder.channel_disc_id} is not text-based for reminder ${reminder.reminder_id}`,
				);
				await this.handleReminderExecutionFailure(
					reminder,
					"Channel is not text-based",
				);
				return;
			}

			// Fetch the last message from the channel to use as context for tomoriChat
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

			// If no message found, try to seed a placeholder message so we can proceed
			if (!lastMessage) {
				if ("send" in channel) {
					try {
						lastMessage = await channel.send({
							content: "\u2800", // Braille blank: invisible but counts as content
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
			}

			// If still no message found, we can't trigger tomoriChat directly
			if (!lastMessage) {
				log.warn(
					`No messages found in channel ${reminder.channel_disc_id} for reminder ${reminder.reminder_id}, sending error embed instead`,
				);
				await this.handleReminderExecutionFailure(
					reminder,
					"No messages found in channel for context",
				);
				return;
			}

			// Calculate if the reminder is late
			const currentTime = new Date();
			const lateness = calculateLateness(reminder.reminder_time, currentTime);

			log.info(
				`About to call tomoriChat for reminder ${reminder.reminder_id}:`,
			);
			log.info(
				`- Last message author: ${lastMessage.author.username} (bot: ${lastMessage.author.bot})`,
			);
			log.info(`- Last message ID: ${lastMessage.id}`);
			log.info(`- Reminder recipient ID: ${reminder.user_discord_id}`);
			log.info(`- Reminder purpose: "${reminder.reminder_purpose}"`);
			log.info(`- Lateness: ${lateness || "none"}`);

			const reminderStartTime = Date.now();

			const isSelfReminder = reminder.self_reminder === true;

			suppressNextSelfReply(channel.id);

			// Call tomoriChat with manual trigger and reminder recipient ID
			await tomoriChat(
				this.client,
				lastMessage,
				false, // isFromQueue
				true, // isManuallyTriggered
				false, // forceReason
				undefined, // reasoningQuery
				undefined, // llmOverrideCodename
				false, // isStopResponse
				0, // retryCount
				false, // skipLock
				reminder.user_discord_id, // reminderRecipientID
				{
					reminder_purpose: reminder.reminder_purpose,
					reminder_lateness: lateness,
					self_reminder: isSelfReminder,
				},
				reminder.persona_id ?? undefined, // selectedPersonaId (fallback to main)
			);

			log.info(
				`tomoriChat call completed for reminder ${reminder.reminder_id}`,
			);

			if (!isSelfReminder) {
				await this.ensureReminderRecipientMention(
					channel,
					reminder,
					lastMessage.id,
					reminderStartTime,
				);
			}

			const repetitionIntervalHours =
				typeof reminder.repetition_interval_hours === "number"
					? reminder.repetition_interval_hours
					: null;
			const isRecurring =
				repetitionIntervalHours !== null && repetitionIntervalHours >= 1;

			if (isRecurring && reminder.reminder_id) {
				const nextTriggerTime = new Date(
					Date.now() + repetitionIntervalHours * 60 * 60 * 1000,
				);
				const rescheduled = await rescheduleReminder(
					reminder.reminder_id,
					nextTriggerTime,
				);

				if (rescheduled) {
					log.success(
						`Reminder ${reminder.reminder_id} executed and rescheduled for ${nextTriggerTime.toISOString()}`,
					);
				} else {
					log.error(
						`Failed to reschedule recurring reminder ${reminder.reminder_id}; deleting to prevent duplicates`,
					);
					await deleteReminderById(reminder.reminder_id);
				}
			} else if (reminder.reminder_id) {
				// Successfully executed one-time reminder, delete it
				await deleteReminderById(reminder.reminder_id);
				log.success(
					`Reminder ${reminder.reminder_id} executed and deleted successfully`,
				);
			} else {
				log.error("Cannot delete reminder: reminder_id is undefined");
			}
		} catch (error) {
			log.error(`Error executing reminder ${reminder.reminder_id}:`, error);
			await this.handleReminderExecutionFailure(
				reminder,
				error instanceof Error ? error.message : "Unknown error",
			);
		}
	}

	/**
	 * Ensures reminder responses include a mention for the target user.
	 * If the LLM response doesn't mention the user, send a final mention message.
	 */
	private async ensureReminderRecipientMention(
		channel: TextBasedChannel,
		reminder: ReminderRow,
		afterMessageId: string,
		reminderStartTime: number,
	): Promise<void> {
		type SendableChannel = TextBasedChannel & {
			send: (options: {
				content: string;
				allowedMentions: { users: string[]; roles: string[]; parse: string[] };
			}) => Promise<unknown>;
		};

		const botUserId = this.client.user?.id;
		if (!botUserId) {
			log.warn(
				`Cannot verify reminder mention for reminder ${reminder.reminder_id}: bot user not available`,
			);
			return;
		}

		if (!("messages" in channel)) {
			log.warn(
				`Cannot verify reminder mention for reminder ${reminder.reminder_id}: channel does not support message fetching`,
			);
			return;
		}

		try {
			const recentMessages = await channel.messages.fetch({
				after: afterMessageId,
				limit: 100,
			});

			const relevantMessages = recentMessages.filter(
				(message) =>
					(message.author.id === botUserId || message.webhookId) &&
					message.createdTimestamp >= reminderStartTime - 1000,
			);

			if (relevantMessages.size === 0) {
				log.warn(
					`No bot or webhook messages found after reminder ${reminder.reminder_id} to verify mention`,
				);
				return;
			}

			const mentionToken = `<@${reminder.user_discord_id}>`;
			const mentionTokenAlt = `<@!${reminder.user_discord_id}>`;

			const hasMention = relevantMessages.some(
				(message) =>
					message.mentions.users.has(reminder.user_discord_id) ||
					message.content.includes(mentionToken) ||
					message.content.includes(mentionTokenAlt),
			);

			if (!hasMention) {
				if (!("send" in channel)) {
					log.warn(
						`Cannot send fallback mention for reminder ${reminder.reminder_id}: channel does not support sending`,
					);
					return;
				}

				const sentViaPersona = await this.trySendPersonaFallbackMention(
					channel,
					reminder,
					mentionToken,
				);

				if (!sentViaPersona) {
					await (channel as SendableChannel).send({
						content: mentionToken,
						allowedMentions: {
							users: [reminder.user_discord_id],
							roles: [],
							parse: [],
						},
					});
				}
				log.info(
					`Added fallback mention for reminder ${reminder.reminder_id} to ensure recipient is pinged`,
				);
			}
		} catch (error) {
			log.warn(
				`Failed to verify reminder mention for reminder ${reminder.reminder_id}:`,
				error,
			);
		}
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
			const persona = personas.find(
				(p) => p.tomori_id === reminder.persona_id,
			);
			if (!persona || !persona.is_alter) return false;

			const isThread =
				"isThread" in channel &&
				typeof channel.isThread === "function" &&
				channel.isThread();
			if (isThread && !channel.parent) {
				return false;
			}
			const webhookChannel =
				isThread && channel.parent ? channel.parent : channel;

			const usePersonaWebhooks = process.env.RUN_ENV !== "production";
			const webhookResult = usePersonaWebhooks
				? await getOrCreatePersonaWebhook(
						webhookChannel as TextChannel,
						persona,
					)
				: await getOrCreateWebhook(webhookChannel as TextChannel);
			const webhook = webhookResult.webhook;
			if (!webhook) return false;

			const avatarURL = !usePersonaWebhooks
				? resolvePersonaAvatarURL(persona, channel.guild)
				: undefined;

			await webhook.send({
				content,
				username: persona.tomori_nickname,
				avatarURL,
				allowedMentions: {
					users: [reminder.user_discord_id],
					roles: [],
					parse: [],
				},
				...(isThread ? { threadId: channel.id } : {}),
			});
			return true;
		} catch (error) {
			log.warn(
				`Failed to send persona fallback mention for reminder ${reminder.reminder_id}:`,
				error,
			);
			return false;
		}
	}

	/**
	 * Handles cases where reminder execution fails
	 */
	private async handleReminderExecutionFailure(
		reminder: ReminderRow,
		errorReason: string,
	): Promise<void> {
		try {
			// Delete the reminder even if execution failed to prevent retry loops
			if (reminder.reminder_id) {
				await deleteReminderById(reminder.reminder_id);
			}

			// Try to send an error embed to the channel mentioning the user
			try {
				const channel = await this.client.channels.fetch(
					reminder.channel_disc_id,
				);
				if (channel?.isTextBased() && "send" in channel) {
					const currentTime = new Date();
					const lateness = calculateLateness(
						reminder.reminder_time,
						currentTime,
					);

					await sendStandardEmbed(
						channel as import("discord.js").TextChannel,
						"en-US",
						{
							color: ColorCode.ERROR,
							titleKey: "reminders.reminder_error_title",
							descriptionKey: "reminders.reminder_error_description",
							descriptionVars: {
								user_mention: `<@${reminder.user_discord_id}>`,
								reminder_purpose: reminder.reminder_purpose,
								error_reason: errorReason,
								lateness: lateness || "on time",
							},
							footerKey: "reminders.reminder_error_footer",
						},
					);
				}
			} catch (fallbackError) {
				log.error(
					`Failed to send fallback reminder error embed for reminder ${reminder.reminder_id}:`,
					fallbackError,
				);
			}

			log.warn(
				`Reminder ${reminder.reminder_id} deleted due to execution failure: ${errorReason}`,
			);
		} catch (error) {
			log.error(
				`Error handling reminder execution failure for reminder ${reminder.reminder_id}:`,
				error,
			);
		}
	}

	// Removed: sendDirectReminderEmbed method - successful reminders should only use natural AI conversation

	/**
	 * Gets the current status of the reminder timer
	 */
	public getStatus(): { isRunning: boolean; intervalMs: number } {
		return {
			isRunning: this.isRunning,
			intervalMs: this.POLL_INTERVAL_MS,
		};
	}
}

/**
 * Global reminder timer instance
 */
let reminderTimerInstance: ReminderTimer | null = null;

/**
 * Initializes the reminder timer system
 */
export function initializeReminderTimer(client: Client): void {
	if (reminderTimerInstance) {
		log.warn("Reminder timer already initialized");
		return;
	}

	reminderTimerInstance = new ReminderTimer(client);
	reminderTimerInstance.start();
	log.success("Reminder timer system initialized");
}

/**
 * Stops the reminder timer system
 */
export function stopReminderTimer(): void {
	if (reminderTimerInstance) {
		reminderTimerInstance.stop();
		reminderTimerInstance = null;
		log.success("Reminder timer system stopped");
	}
}

/**
 * Gets the status of the reminder timer system
 */
export function getReminderTimerStatus(): {
	isRunning: boolean;
	intervalMs: number;
} | null {
	return reminderTimerInstance ? reminderTimerInstance.getStatus() : null;
}

/**
 * Manually trigger a check for due reminders (useful for testing)
 */
export async function checkRemindersManually(): Promise<void> {
	if (!reminderTimerInstance) {
		throw new Error("Reminder timer not initialized");
	}

	// Call the public checkReminders method
	await reminderTimerInstance.checkReminders();
}

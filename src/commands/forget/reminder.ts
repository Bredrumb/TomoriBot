import type {
	ChatInputCommandInteraction,
	ButtonInteraction,
	ModalSubmitInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { sql } from "@/utils/db/client";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithPaginatedModal,
	safeSelectOptionText,
} from "../../utils/discord/interactionHelper";
import { getCachedTomoriState } from "../../utils/cache/tomoriStateCache";
import type { UserRow, ErrorContext, TomoriState } from "../../types/db/schema";
import type { SelectOption } from "../../types/discord/modal";
import { deleteReminderById } from "../../utils/db/dbRead";
import { formatTimeWithOffset, formatUTCOffset } from "../../utils/text/timezoneHelper";

// Rule 20: Constants for static values at the top
const MODAL_CUSTOM_ID = "forget_reminder_modal";
const REMINDER_SELECT_ID = "reminder_select";

/**
 * Helper function to perform reminder removal from database
 * @param reminderToRemove - Reminder data to remove
 * @param replyInteraction - Interaction to reply to (can be modal or pagination)
 * @param locale - User locale
 */
async function performReminderRemoval(
	reminderToRemove: { reminder_id: number; reminder_purpose: string },
	replyInteraction:
		| ChatInputCommandInteraction
		| ButtonInteraction
		| ModalSubmitInteraction,
	locale: string,
): Promise<void> {
	const deleted = await deleteReminderById(reminderToRemove.reminder_id);

	if (!deleted) {
		await replyInfoEmbed(replyInteraction, locale, {
			titleKey: "general.errors.operation_failed_title",
			descriptionKey: "general.errors.operation_failed_description",
			color: ColorCode.ERROR,
		});
		return;
	}

	log.success(
		`Deleted reminder ${reminderToRemove.reminder_id} (${reminderToRemove.reminder_purpose.slice(0, 60)}...)`,
	);

	await replyInfoEmbed(replyInteraction, locale, {
		titleKey: "commands.forget.reminder.success_title",
		descriptionKey: "commands.forget.reminder.success_description",
		descriptionVars: {
			reminder_purpose:
				reminderToRemove.reminder_purpose.length > 80
					? `${reminderToRemove.reminder_purpose.slice(0, 77)}...`
					: reminderToRemove.reminder_purpose,
		},
		color: ColorCode.SUCCESS,
	});
}

// Rule 21: Configure the subcommand
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("reminder")
		.setDescription(localizer("en-US", "commands.forget.reminder.description"));

/**
 * Removes a reminder for the user using a paginated modal.
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	// 1. Ensure command is run in a valid channel context
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	let tomoriState: TomoriState | null = null;

	try {
		tomoriState = await getCachedTomoriState(
			interaction.guild?.id ?? interaction.user.id,
		);
		if (!tomoriState) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const reminders = await sql`
			SELECT reminder_id, reminder_purpose, reminder_time, repetition_interval_hours, channel_disc_id
			FROM reminders
			WHERE user_discord_id = ${userData.user_disc_id}
			AND server_id = ${tomoriState.server_id}
			ORDER BY reminder_time ASC
		`;

		if (!reminders || reminders.length === 0) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.forget.reminder.no_reminders_title",
				descriptionKey: "commands.forget.reminder.no_reminders",
				color: ColorCode.WARN,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const timezoneOffset = tomoriState.config.timezone_offset ?? 0;
		const reminderSelectOptions: SelectOption[] = reminders.map(
			(
				reminder: {
					reminder_purpose: string;
					reminder_time: Date;
					repetition_interval_hours: number | null;
					channel_disc_id: string;
				},
				index: number,
			) => {
				const formattedTime = formatTimeWithOffset(
					new Date(reminder.reminder_time),
					timezoneOffset,
					{
						year: "numeric",
						month: "short",
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
					},
				);

				const channelName =
					interaction.guild?.channels.cache.get(reminder.channel_disc_id)
						?.name ?? reminder.channel_disc_id;
				const repeatText =
					typeof reminder.repetition_interval_hours === "number" &&
					reminder.repetition_interval_hours >= 1
						? ` | repeats every ${reminder.repetition_interval_hours}h`
						: "";
				const description = `At ${formattedTime} (${formatUTCOffset(timezoneOffset)}) in #${channelName}${repeatText}`;

				return {
					label: safeSelectOptionText(reminder.reminder_purpose, 40),
					value: index.toString(),
					description: safeSelectOptionText(description),
				};
			},
		);

		const modalResult = await promptWithPaginatedModal(interaction, locale, {
			modalCustomId: MODAL_CUSTOM_ID,
			modalTitleKey: "commands.forget.reminder.modal_title",
			components: [
				{
					customId: REMINDER_SELECT_ID,
					labelKey: "commands.forget.reminder.select_label",
					descriptionKey: "commands.forget.reminder.select_description",
					placeholder: "commands.forget.reminder.select_placeholder",
					required: true,
					options: reminderSelectOptions,
				},
			],
		});

		if (modalResult.outcome !== "submit") {
			log.info(
				`Reminder deletion modal ${modalResult.outcome} for user ${userData.user_id}`,
			);
			return;
		}

		const modalSubmitInteraction = modalResult.interaction;
		const selectedIndex = modalResult.values?.[REMINDER_SELECT_ID];

		if (!modalSubmitInteraction || !selectedIndex) {
			log.error("Modal result unexpectedly missing interaction or values");
			return;
		}

		const selectedReminder = reminders[Number.parseInt(selectedIndex, 10)];
		if (!selectedReminder) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "general.errors.operation_failed_title",
				descriptionKey: "general.errors.operation_failed_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		await performReminderRemoval(
			selectedReminder,
			modalSubmitInteraction,
			locale,
		);
	} catch (error) {
		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: tomoriState?.server_id,
			tomoriId: tomoriState?.tomori_id,
			errorType: "CommandExecutionError",
			metadata: {
				command: "forget reminder",
				guildId: interaction.guild?.id,
				executorDiscordId: interaction.user.id,
			},
		};
		await log.error(
			`Unexpected error in /forget reminder for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		if (interaction.deferred || interaction.replied) {
			try {
				await interaction.followUp({
					content: localizer(
						locale,
						"general.errors.unknown_error_description",
					),
					flags: MessageFlags.Ephemeral,
				});
			} catch (followUpError) {
				log.error(
					"Failed to send follow-up error message in reminder catch block",
					followUpError,
				);
			}
		} else {
			log.warn(
				"Could not determine valid interaction to send error message in reminder catch block",
			);
		}
	}
}

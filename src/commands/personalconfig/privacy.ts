import {
	MessageFlags,
	type ChatInputCommandInteraction,
	type Client,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import { setPrivacyOptOut } from "../../utils/db/dbWrite";
import { isPrivacyOptedOut } from "../../utils/db/dbRead";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../types/db/schema";

// Configure the subcommand
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("privacy")
		.setDescription(
			localizer("en-US", "commands.personalconfig.privacy.description"),
		)
		.addStringOption((option) =>
			option
				.setName("setting")
				.setDescription(
					localizer(
						"en-US",
						"commands.personalconfig.privacy.setting_description",
					),
				)
				.setRequired(true)
				.addChoices(
					{
						name: localizer("en-US", "commands.choices.opt_out"),
						value: "opt_out",
					},
					{
						name: localizer("en-US", "commands.choices.opt_in"),
						value: "opt_in",
					},
				),
		);

/**
 * Manages user's global privacy opt-out settings for personal memory storage.
 * When opted out, TomoriBot will not save any personal memories about the user.
 * This setting applies across all servers where TomoriBot is present.
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database (the command executor)
 * @param locale - Locale of the interaction
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	try {
		// 1. Get command options
		const setting = interaction.options.getString("setting", true);
		const requestedOptOut = setting === "opt_out";

		// 2. Check current privacy status
		const currentlyOptedOut = await isPrivacyOptedOut(
			interaction.user.id,
		);

		// 3. Prevent setting the same state twice
		if (requestedOptOut && currentlyOptedOut) {
			await replyInfoEmbed(interaction, locale, {
				titleKey:
					"commands.personalconfig.privacy.already_opted_out_title",
				descriptionKey:
					"commands.personalconfig.privacy.already_opted_out_description",
				color: ColorCode.WARN,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!requestedOptOut && !currentlyOptedOut) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.personalconfig.privacy.already_opted_in_title",
				descriptionKey:
					"commands.personalconfig.privacy.already_opted_in_description",
				color: ColorCode.WARN,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 4. Update privacy setting in database
		const updatedUser = await setPrivacyOptOut(
			interaction.user.id,
			requestedOptOut,
		);

		if (!updatedUser) {
			// Failed to update - show error
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 5. Send success confirmation message
		if (requestedOptOut) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.personalconfig.privacy.opted_out_title",
				descriptionKey:
					"commands.personalconfig.privacy.opted_out_description",
				color: ColorCode.SUCCESS,
				flags: MessageFlags.Ephemeral,
			});
			log.info(
				`User ${interaction.user.id} (${userData.user_nickname}) has opted out of personalization`,
			);
		} else {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.personalconfig.privacy.opted_in_title",
				descriptionKey:
					"commands.personalconfig.privacy.opted_in_description",
				color: ColorCode.SUCCESS,
				flags: MessageFlags.Ephemeral,
			});
			log.info(
				`User ${interaction.user.id} (${userData.user_nickname}) has opted into personalization`,
			);
		}
	} catch (error) {
		// 6. Log error with context
		const context: ErrorContext = {
			userId: userData.user_id,
			errorType: "CommandExecutionError",
			metadata: {
				command: "personalconfig privacy",
				guildId: interaction.guild?.id,
				executorDiscordId: interaction.user.id,
				setting: interaction.options.getString("setting", true),
			},
		};
		await log.error(
			`Error executing /personalconfig privacy for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		// 7. Inform user of unknown error
		if (!interaction.replied && !interaction.deferred) {
			await interaction.reply({
				content: localizer(locale, "general.errors.unknown_error_description"),
				flags: MessageFlags.Ephemeral,
			});
		} else {
			await interaction.followUp({
				content: localizer(locale, "general.errors.unknown_error_description"),
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}

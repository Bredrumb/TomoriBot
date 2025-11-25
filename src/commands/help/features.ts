import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import type { ErrorContext } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/interactionHelper";
import { version } from "../../../package.json";

/**
 * Configure the /help features subcommand
 * Shows users what TomoriBot can do based on chatCapabilities.md
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("features")
		.setDescription(localizer("en-US", "commands.help.features.description"));

/**
 * Execute the /help features command
 * Displays TomoriBot's capabilities and features
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
	try {
		// Use replySummaryEmbed to show structured help info
		await replySummaryEmbed(
			interaction,
			locale,
			{
				titleKey: "commands.help.features.title",
				titleVars: { version },
				descriptionKey: "commands.help.features.embed_description",
				color: ColorCode.INFO,
				fields: [
					{
						nameKey: "commands.help.features.vision_title",
						value: localizer(
							locale,
							"commands.help.features.vision_description",
						),
						inline: false,
					},
					{
						nameKey: "commands.help.features.search_title",
						value: localizer(
							locale,
							"commands.help.features.search_description",
						),
						inline: false,
					},
					{
						nameKey: "commands.help.features.personality_title",
						value: localizer(
							locale,
							"commands.help.features.personality_description",
						),
						inline: false,
					},
					{
						nameKey: "commands.help.features.memory_title",
						value: localizer(
							locale,
							"commands.help.features.memory_description",
						),
						inline: false,
					},
					{
						nameKey: "commands.help.features.time_title",
						value: localizer(locale, "commands.help.features.time_description"),
						inline: false,
					},
				],
				footerKey: "commands.help.features.footer",
			},
			MessageFlags.Ephemeral,
		);
	} catch (error) {
		// Log error with context
		const context: ErrorContext = {
			userId: userData.user_id,
			errorType: "CommandExecutionError",
			metadata: {
				commandName: "/help features",
				guildDiscordId: interaction.guild?.id,
			},
		};
		await log.error(
			"Error executing /help features command",
			error as Error,
			context,
		);

		// Inform user of error (ephemeral)
		const errorMessage = localizer(
			locale,
			"general.errors.unknown_error_description",
		);
		try {
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp({
					content: errorMessage,
					flags: MessageFlags.Ephemeral,
				});
			} else {
				await interaction.reply({
					content: errorMessage,
					flags: MessageFlags.Ephemeral,
				});
			}
		} catch (replyError) {
			// Log if even the error reply fails
			log.error(
				"Failed to send error reply for /help features",
				replyError,
				context,
			);
		}
	}
}

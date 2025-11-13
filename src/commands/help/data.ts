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
import { commandRegistry } from "@/utils/discord/commandRegistry";

/**
 * Configure the /help data subcommand
 * Explains data management (export, import, delete) and privacy policy
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("data")
		.setDescription(localizer("en-US", "commands.help.data.description"));

/**
 * Execute the /help data command
 * Displays data management and privacy information
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
		// Get command mentions for cross-references
		const dataExportMention = commandRegistry.getCommandMention(
			"data",
			"export",
		);
		const dataImportMention = commandRegistry.getCommandMention(
			"data",
			"import",
		);
		const dataDeleteMention = commandRegistry.getCommandMention(
			"data",
			"delete",
		);
		const personaExportMention = commandRegistry.getCommandMention(
			"persona",
			"export",
		);
		const personalPrivacyMention = commandRegistry.getCommandMention(
			"personal",
			"privacy",
		);
		const configPermissionsMention = commandRegistry.getCommandMention(
			"config",
			"permissions",
		);

		// Use replySummaryEmbed to show structured data management guide
		await replySummaryEmbed(
			interaction,
			locale,
			{
				titleKey: "commands.help.data.title",
				descriptionKey: "commands.help.data.embed_description",
				color: ColorCode.INFO,
				fields: [
					{
						nameKey: "commands.help.data.export_title",
						value: localizer(locale, "commands.help.data.export_description", {
							dataExport: dataExportMention,
							personaExport: personaExportMention,
						}),
						inline: false,
					},
					{
						nameKey: "commands.help.data.import_title",
						value: localizer(locale, "commands.help.data.import_description", {
							dataImport: dataImportMention,
						}),
						inline: false,
					},
					{
						nameKey: "commands.help.data.delete_title",
						value: localizer(locale, "commands.help.data.delete_description", {
							dataDelete: dataDeleteMention,
						}),
						inline: false,
					},
					{
						nameKey: "commands.help.data.privacy_title",
						value: localizer(locale, "commands.help.data.privacy_description", {
							personalPrivacy: personalPrivacyMention,
							configPermissions: configPermissionsMention,
						}),
						inline: false,
					},
				],
				footerKey: "commands.help.data.footer",
			},
			MessageFlags.SuppressNotifications,
		);
	} catch (error) {
		// Log error with context
		const context: ErrorContext = {
			userId: userData.user_id,
			errorType: "CommandExecutionError",
			metadata: {
				commandName: "/help data",
				guildDiscordId: interaction.guild?.id,
			},
		};
		await log.error(
			"Error executing /help data command",
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
				"Failed to send error reply for /help data",
				replyError,
				context,
			);
		}
	}
}

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
 * Configure the /help setup subcommand
 * Guides new users through first-time server configuration
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("setup")
		.setDescription(localizer("en-US", "commands.help.setup.description"));

/**
 * Execute the /help setup command
 * Displays first-time setup guide for TomoriBot
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
		const helpApikeyMention = commandRegistry.getCommandMention("help", "apikey");
		const configSetupMention = commandRegistry.getCommandMention("config", "setup");
		const serverTriggerMention = commandRegistry.getCommandMention(
			"server",
			"trigger",
		);
		const configPermissionsMention = commandRegistry.getCommandMention(
			"config",
			"permissions",
		);
		const serverAutotriggerMention = commandRegistry.getCommandMention(
			"server",
			"autotrigger",
		);
		const personaMention = commandRegistry.getCommandMention("persona");
		const serverMention = commandRegistry.getCommandMention("server");
		const personalMention = commandRegistry.getCommandMention("personal");
		const configMention = commandRegistry.getCommandMention("config");
		const teachMention = commandRegistry.getCommandMention("teach");
		const helpFeaturesMention = commandRegistry.getCommandMention(
			"help",
			"features",
		);
		const helpMemoryMention = commandRegistry.getCommandMention("help", "memory");
		const helpCustomizationMention = commandRegistry.getCommandMention(
			"help",
			"customization",
		);
		const supportServerMention = commandRegistry.getCommandMention(
			"support",
			"server",
		);

		// Use replySummaryEmbed to show structured setup guide
		await replySummaryEmbed(
			interaction,
			locale,
			{
				titleKey: "commands.help.setup.title",
				descriptionKey: "commands.help.setup.embed_description",
				color: ColorCode.SUCCESS,
				fields: [
					{
						nameKey: "commands.help.setup.step1_title",
						value: localizer(locale, "commands.help.setup.step1_description", {
							helpApikey: helpApikeyMention,
						}),
						inline: false,
					},
					{
						nameKey: "commands.help.setup.step2_title",
						value: localizer(locale, "commands.help.setup.step2_description", {
							configSetup: configSetupMention,
						}),
						inline: false,
					},
					{
						nameKey: "commands.help.setup.step3_title",
						value: localizer(locale, "commands.help.setup.step3_description", {
							serverTrigger: serverTriggerMention,
							configPermissions: configPermissionsMention,
							serverAutotrigger: serverAutotriggerMention,
						}),
						inline: false,
					},
					{
						nameKey: "commands.help.setup.step4_title",
						value: localizer(locale, "commands.help.setup.step4_description", {
							persona: personaMention,
							server: serverMention,
							personal: personalMention,
							config: configMention,
							teach: teachMention,
						}),
						inline: false,
					},
					{
						nameKey: "commands.help.setup.need_help_title",
						value: localizer(locale, "commands.help.setup.need_help_description", {
							helpFeatures: helpFeaturesMention,
							helpMemory: helpMemoryMention,
							helpCustomization: helpCustomizationMention,
							supportServer: supportServerMention,
						}),
						inline: false,
					},
				],
			},
			MessageFlags.SuppressNotifications,
		);
	} catch (error) {
		// Log error with context
		const context: ErrorContext = {
			userId: userData.user_id,
			errorType: "CommandExecutionError",
			metadata: {
				commandName: "/help setup",
				guildDiscordId: interaction.guild?.id,
			},
		};
		await log.error("Error executing /help setup command", error as Error, context);

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
			log.error("Failed to send error reply for /help setup", replyError, context);
		}
	}
}

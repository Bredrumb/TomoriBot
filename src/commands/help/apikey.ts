import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import type { ErrorContext } from "@/types/db/schema";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/interactionHelper";
import { commandRegistry } from "@/utils/discord/commandRegistry";

/**
 * Configure the /help apikey subcommand
 * Provider-specific instructions for getting and setting up API keys
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("apikey")
		.setDescription(localizer("en-US", "commands.help.apikey.description"))
		.addStringOption((option) =>
			option
				.setName("provider")
				.setDescription(
					localizer("en-US", "commands.help.apikey.provider_description"),
				)
				.setRequired(true)
				.addChoices(
					{ name: "Brave Search", value: "brave" },
					{ name: "Google Gemini", value: "google" },
					{ name: "NovelAI", value: "novelai" },
					{ name: "OpenRouter", value: "openrouter" },
				),
		);

/**
 * Execute the /help apikey command
 * Displays provider-specific API key setup instructions
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
		const provider = interaction.options.getString("provider", true);

		// Get command mentions for cross-references
		const configBraveapiSetMention = commandRegistry.getCommandMention(
			"config",
			"braveapi",
			"set",
		);
		const configSetupMention = commandRegistry.getCommandMention(
			"config",
			"setup",
		);
		const configApikeySetMention = commandRegistry.getCommandMention(
			"config",
			"apikey",
			"set",
		);
		const configModelMention = commandRegistry.getCommandMention(
			"config",
			"model",
		);
		const supportServerMention = commandRegistry.getCommandMention(
			"support",
			"discord",
		);

		// Build options based on provider
		let embedOptions: SummaryEmbedOptions;

		switch (provider) {
			case "brave":
				embedOptions = {
					titleKey: "commands.help.apikey.brave_title",
					descriptionKey: "commands.help.apikey.brave_description",
					color: ColorCode.INFO,
					fields: [
						{
							nameKey: "commands.help.apikey.brave_getting_key_title",
							value: localizer(
								locale,
								"commands.help.apikey.brave_getting_key_description",
								{
									configBraveapiSet: configBraveapiSetMention,
								},
							),
							inline: false,
						},
						{
							nameKey: "commands.help.apikey.brave_important_title",
							value: localizer(
								locale,
								"commands.help.apikey.brave_important_description",
							),
							inline: false,
						},
					],
					footerKey: "commands.help.apikey.brave_footer",
				};
				break;

			case "google":
				embedOptions = {
					titleKey: "commands.help.apikey.google_title",
					descriptionKey: "commands.help.apikey.google_description",
					color: ColorCode.INFO,
					fields: [
						{
							nameKey: "commands.help.apikey.google_getting_key_title",
							value: localizer(
								locale,
								"commands.help.apikey.google_getting_key_description",
								{
									configSetup: configSetupMention,
									configApikeySet: configApikeySetMention,
								},
							),
							inline: false,
						},
					],
					footerKey: "commands.help.apikey.google_footer",
					footerVars: {
						configModel: configModelMention,
					},
				};
				break;

			case "novelai":
				embedOptions = {
					titleKey: "commands.help.apikey.novelai_title",
					descriptionKey: "commands.help.apikey.novelai_description",
					color: ColorCode.INFO,
					fields: [
						{
							nameKey: "commands.help.apikey.novelai_getting_key_title",
							value: localizer(
								locale,
								"commands.help.apikey.novelai_getting_key_description",
								{
									configSetup: configSetupMention,
									configApikeySet: configApikeySetMention,
								},
							),
							inline: false,
						},
					],
					footerKey: "commands.help.apikey.novelai_footer",
					footerVars: {
						configModel: configModelMention,
					},
				};
				break;

			case "openrouter":
				embedOptions = {
					titleKey: "commands.help.apikey.openrouter_title",
					descriptionKey: "commands.help.apikey.openrouter_description",
					color: ColorCode.INFO,
					fields: [
						{
							nameKey: "commands.help.apikey.openrouter_getting_key_title",
							value: localizer(
								locale,
								"commands.help.apikey.openrouter_getting_key_description",
								{
									configSetup: configSetupMention,
									configApikeySet: configApikeySetMention,
								},
							),
							inline: false,
						},
						{
							nameKey: "commands.help.apikey.openrouter_model_selection_title",
							value: localizer(
								locale,
								"commands.help.apikey.openrouter_model_selection_description",
								{
									supportServer: supportServerMention,
								},
							),
							inline: false,
						},
						{
							nameKey: "commands.help.apikey.openrouter_pricing_title",
							value: localizer(
								locale,
								"commands.help.apikey.openrouter_pricing_description",
							),
							inline: false,
						},
						{
							nameKey: "commands.help.apikey.openrouter_settings_title",
							value: localizer(
								locale,
								"commands.help.apikey.openrouter_settings_description",
							),
							inline: false,
						},
					],
					footerKey: "commands.help.apikey.openrouter_footer",
					footerVars: {
						configModel: configModelMention,
					},
				};
				break;

			default:
				// Should never happen due to choices validation
				throw new Error(`Unknown provider: ${provider}`);
		}

		// Use replySummaryEmbed to show provider-specific guide
		await replySummaryEmbed(
			interaction,
			locale,
			embedOptions,
			MessageFlags.Ephemeral,
		);
	} catch (error) {
		// Log error with context
		const context: ErrorContext = {
			userId: userData.user_id,
			errorType: "CommandExecutionError",
			metadata: {
				commandName: "/help apikey",
				guildDiscordId: interaction.guild?.id,
			},
		};
		await log.error(
			"Error executing /help apikey command",
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
				"Failed to send error reply for /help apikey",
				replyError,
				context,
			);
		}
	}
}

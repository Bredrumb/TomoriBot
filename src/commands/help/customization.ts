import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { ChannelType, MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import type { ErrorContext } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/interactionHelper";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { commandRegistry } from "@/utils/discord/commandRegistry";

/**
 * Configure the /help customization subcommand
 * Comprehensive guide to customizing TomoriBot's behavior and personality
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("customization")
		.setDescription(
			localizer("en-US", "commands.help.customization.description"),
		);

/**
 * Execute the /help customization command
 * Displays comprehensive customization guide in 5 consecutive embeds
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
		const helpMemoryMention = commandRegistry.getCommandMention(
			"help",
			"memory",
		);
		const personaCreateMention = commandRegistry.getCommandMention(
			"persona",
			"create",
		);
		const personaGenerateMention = commandRegistry.getCommandMention(
			"persona",
			"generate",
		);
		const personaDefaultMention = commandRegistry.getCommandMention(
			"persona",
			"default",
		);
		const personaExportMention = commandRegistry.getCommandMention(
			"persona",
			"export",
		);
		const personaImportMention = commandRegistry.getCommandMention(
			"persona",
			"import",
		);
		const teachMention = commandRegistry.getCommandMention("teach");
		const serverAvatarMention = commandRegistry.getCommandMention(
			"server",
			"avatar",
		);
		const teachAttributeMention = commandRegistry.getCommandMention(
			"teach",
			"attribute",
		);
		const teachSampledialogueMention = commandRegistry.getCommandMention(
			"teach",
			"sampledialogue",
		);
		const configRenameMention = commandRegistry.getCommandMention(
			"config",
			"rename",
		);
		const forgetAttributeMention = commandRegistry.getCommandMention(
			"forget",
			"attribute",
		);
		const forgetSampledialogueMention = commandRegistry.getCommandMention(
			"forget",
			"sampledialogue",
		);
		const serverMemberpermissionsMention = commandRegistry.getCommandMention(
			"server",
			"memberpermissions",
		);
		const serverBlacklistMention = commandRegistry.getCommandMention(
			"server",
			"blacklist",
		);
		const serverAutotriggerChannelsMention = commandRegistry.getCommandMention(
			"server",
			"autotrigger",
			"channels",
		);
		const serverAutotriggerThresholdMention = commandRegistry.getCommandMention(
			"server",
			"autotrigger",
			"threshold",
		);
		const serverTriggerAddMention = commandRegistry.getCommandMention(
			"server",
			"trigger",
			"add",
		);
		const serverTriggerDeleteMention = commandRegistry.getCommandMention(
			"server",
			"trigger",
			"delete",
		);
		const configModelMention = commandRegistry.getCommandMention(
			"config",
			"model",
			"text",
		);
		const configTemperatureMention = commandRegistry.getCommandMention(
			"config",
			"temperature",
		);
		const configHumanizerMention = commandRegistry.getCommandMention(
			"config",
			"humanizer",
		);
		const configApikeySetMention = commandRegistry.getCommandMention(
			"config",
			"apikey",
			"set",
		);
		const configApikeyDeleteMention = commandRegistry.getCommandMention(
			"config",
			"apikey",
			"delete",
		);
		const configBraveapiSetMention = commandRegistry.getCommandMention(
			"config",
			"braveapi",
			"set",
		);
		const configBraveapiDeleteMention = commandRegistry.getCommandMention(
			"config",
			"braveapi",
			"delete",
		);
		const configTimezoneMention = commandRegistry.getCommandMention(
			"config",
			"timezone",
		);
		const configPermissionsMention = commandRegistry.getCommandMention(
			"config",
			"permissions",
		);

		// EMBED 1: Overview + Personality Personas (reply with first embed)
		await replySummaryEmbed(
			interaction,
			locale,
			{
				titleKey: "commands.help.customization.embed1_title",
				descriptionKey: "commands.help.customization.embed1_description",
				descriptionVars: {
					helpMemory: helpMemoryMention,
				},
				color: ColorCode.INFO,
				fields: [
					{
						nameKey: "commands.help.customization.embed1_personas_title",
						value: localizer(
							locale,
							"commands.help.customization.embed1_personas_description",
							{
								personaCreate: personaCreateMention,
								personaGenerate: personaGenerateMention,
								personaDefault: personaDefaultMention,
								personaExport: personaExportMention,
								personaImport: personaImportMention,
								teach: teachMention,
								serverAvatar: serverAvatarMention,
							},
						),
						inline: false,
					},
					{
						nameKey:
							"commands.help.customization.embed1_what_personas_include_title",
						value: localizer(
							locale,
							"commands.help.customization.embed1_what_personas_include_description",
						),
						inline: false,
					},
				],
				footerKey: "commands.help.customization.embed1_footer",
			},
			MessageFlags.SuppressNotifications,
		);

		// Get channel for follow-up embeds
		const channel = interaction.channel;
		if (
			!channel ||
			channel.partial ||
			(channel.type !== ChannelType.GuildText &&
				channel.type !== ChannelType.GuildNews &&
				channel.type !== ChannelType.DM)
		) {
			log.warn("Invalid channel type for /help customization follow-up embeds");
			return;
		}

		// EMBED 2: Teaching System
		await sendStandardEmbed(channel, locale, {
			titleKey: "commands.help.customization.embed2_title",
			descriptionKey: "commands.help.customization.embed2_description",
			descriptionVars: {
				teachAttribute: teachAttributeMention,
				teachSampledialogue: teachSampledialogueMention,
				configRename: configRenameMention,
			},
			color: ColorCode.INFO,
			footerKey: "commands.help.customization.embed2_footer",
		});

		// EMBED 3: Configuration & Management
		await sendStandardEmbed(channel, locale, {
			titleKey: "commands.help.customization.embed3_title",
			descriptionKey: "commands.help.customization.embed3_description",
			descriptionVars: {
				forgetAttribute: forgetAttributeMention,
				forgetSampledialogue: forgetSampledialogueMention,
				serverMemberpermissions: serverMemberpermissionsMention,
				serverBlacklist: serverBlacklistMention,
				serverAutotriggerChannels: serverAutotriggerChannelsMention,
				serverAutotriggerThreshold: serverAutotriggerThresholdMention,
				serverTriggerAdd: serverTriggerAddMention,
				serverTriggerDelete: serverTriggerDeleteMention,
				serverAvatar: serverAvatarMention,
			},
			color: ColorCode.INFO,
			footerKey: "commands.help.customization.embed3_footer",
		});

		// EMBED 4: Advanced Settings
		await sendStandardEmbed(channel, locale, {
			titleKey: "commands.help.customization.embed4_title",
			descriptionKey: "commands.help.customization.embed4_description",
			descriptionVars: {
				configModel: configModelMention,
				configTemperature: configTemperatureMention,
				configHumanizer: configHumanizerMention,
				configApikeySet: configApikeySetMention,
				configApikeyDelete: configApikeyDeleteMention,
				configBraveapiSet: configBraveapiSetMention,
				configBraveapiDelete: configBraveapiDeleteMention,
				configRename: configRenameMention,
				configTimezone: configTimezoneMention,
				configPermissions: configPermissionsMention,
			},
			color: ColorCode.INFO,
			footerKey: "commands.help.customization.embed4_footer",
		});

		// EMBED 5: Pro Tips
		/*
		await sendStandardEmbed(channel, locale, {
			titleKey: "commands.help.customization.embed5_title",
			descriptionKey: "commands.help.customization.embed5_description",
			color: ColorCode.INFO,
		});*/
	} catch (error) {
		// Log error with context
		const context: ErrorContext = {
			userId: userData.user_id,
			errorType: "CommandExecutionError",
			metadata: {
				commandName: "/help customization",
				guildDiscordId: interaction.guild?.id,
			},
		};
		await log.error(
			"Error executing /help customization command",
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
				"Failed to send error reply for /help customization",
				replyError,
				context,
			);
		}
	}
}

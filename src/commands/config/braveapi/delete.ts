import {
	MessageFlags,
	type ChatInputCommandInteraction,
	type Client,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../../utils/cache/tomoriStateCache";
import { localizer } from "../../../utils/text/localizer";
import { log, ColorCode } from "../../../utils/misc/logger";
import { replyInfoEmbed } from "../../../utils/discord/interactionHelper";
import type {
	UserRow,
	ErrorContext,
	TomoriState,
} from "../../../types/db/schema";
import { deleteOptApiKey, hasOptApiKey } from "../../../utils/security/crypto";

/**
 * Configure the subcommand for deleting Brave Search API key
 * @param subcommand - Discord slash command subcommand builder
 * @returns Configured subcommand builder
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("delete")
		.setDescription(
			localizer("en-US", "commands.config.braveapi.delete.description"),
		);

/**
 * Removes the Brave Search API key from the server's MCP configuration
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
	let tomoriState: TomoriState | null = null; // For error context

	// 1. Ensure command is run in a guild
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, userData.language_pref, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 1.5. Defer the interaction before async work to prevent timeout
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	try {
		// 3. Load the Tomori state for this server
		tomoriState = await getCachedTomoriState(
			interaction.guild?.id ?? interaction.user.id,
		);
		if (!tomoriState) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 4. Check if there's a Brave Search API key to remove
		const hasKey = await hasOptApiKey(tomoriState.server_id, "brave-search");
		if (!hasKey) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.braveapi.delete.no_key_title",
				descriptionKey: "commands.config.braveapi.delete.no_key_description",
				color: ColorCode.WARN,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 5. Delete the API key from the optional API keys table
		const isDeleted = await deleteOptApiKey(
			tomoriState.server_id,
			"brave-search",
		);

		if (!isDeleted) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				userId: userData.user_id,
				errorType: "DatabaseUpdateError",
				metadata: {
					command: "config braveapidelete",
					guildId: interaction.guild?.id ?? interaction.user.id,
					serviceName: "brave-search",
				},
			};
			await log.error(
				"Failed to delete Brave Search API key from optional API keys table",
				new Error("deleteOptApiKey returned false"),
				context,
			);

			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.update_failed_title",
				descriptionKey: "general.errors.update_failed_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 6. Invalidate cache so next message gets fresh config
		invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

		// 7. Success message
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.braveapi.delete.success_title",
			descriptionKey: "commands.config.braveapi.delete.success_description",
			color: ColorCode.SUCCESS,
			flags: MessageFlags.Ephemeral,
		});
	} catch (error) {
		// 7. Log error with context
		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: tomoriState?.server_id ?? null,
			tomoriId: tomoriState?.tomori_id ?? null,
			errorType: "CommandExecutionError",
			metadata: {
				command: "config braveapidelete",
				guildId: interaction.guild?.id,
				executorDiscordId: interaction.user.id,
				serviceName: "brave-search",
			},
		};
		await log.error(
			`Error executing /config braveapidelete for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		// 8. Inform user of unknown error
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
	}
}

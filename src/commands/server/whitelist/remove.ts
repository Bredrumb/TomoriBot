import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { getAllWhitelistChannels, removeChannelWhitelist } from "@/utils/db/channelWhitelist";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed, promptWithPaginatedModal } from "@/utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { CooldownType } from "@/types/db/schema";

/**
 * Modal custom ID for channel whitelist removal
 */
const MODAL_CUSTOM_ID = "server_whitelist_remove_modal";
const CHANNEL_SELECT_ID = "channel_select";

/**
 * Configure the /server whitelist remove subcommand
 * Allows server managers to remove channels from the whitelist
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("remove")
		.setDescription(
			localizer("en-US", "commands.server.whitelist.remove.description"),
		);

/**
 * Execute the /server whitelist remove command
 * Shows a modal with all whitelisted channels and removes the selected one
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	user: UserRow,
	locale: string,
): Promise<void> {
	const errorContext: ErrorContext = {
		userId: user.user_id,
		serverId: null,
		tomoriId: null,
	};

	try {
		// 1. Validate guild context
		if (!interaction.guild || !interaction.guildId) {
			await replyInfoEmbed(interaction, locale, {
				color: ColorCode.ERROR,
				titleKey: "general.errors.guild_only_title",
				descriptionKey: "general.errors.guild_only_description",
			});
			return;
		}

		// 2. Get Tomori state for server
		const tomoriState = await getCachedTomoriState(interaction.guildId);
		if (!tomoriState) {
			await replyInfoEmbed(interaction, locale, {
				color: ColorCode.ERROR,
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
			});
			return;
		}

		errorContext.serverId = tomoriState.server_id;
		errorContext.tomoriId = tomoriState.tomori_id;

		// 3. Get all whitelisted channels for this server
		const whitelistChannels = await getAllWhitelistChannels(tomoriState.server_id);

		// 4. Check if there are any whitelisted channels
		if (whitelistChannels.length === 0) {
			await replyInfoEmbed(interaction, locale, {
				color: ColorCode.WARN,
				titleKey: "commands.server.whitelist.remove.no_channels_title",
				descriptionKey: "commands.server.whitelist.remove.no_channels_description",
			});
			return;
		}

		// 5. Create select options from whitelisted channels
		const channelSelectOptions: SelectOption[] = [];

		for (const entry of whitelistChannels) {
			try {
				// Fetch channel from Discord to get channel name
				const channel = await interaction.guild.channels.fetch(entry.channel_disc_id);

				// Build description with cooldown info
				const cooldownTypeName = getCooldownTypeName(
					entry.cooldown_type as CooldownType,
					locale,
				);
				const description = `${cooldownTypeName}, ${entry.cooldown_length}s`;

				channelSelectOptions.push({
					label: channel?.name ?? entry.channel_disc_id, // Fallback to ID if channel not found
					value: entry.channel_disc_id,
					description: description.substring(0, 100), // Discord limit
				});
			} catch (error) {
				// Channel might have been deleted - use channel ID as fallback
				log.warn("Failed to fetch channel for whitelist remove", error);

				const cooldownTypeName = getCooldownTypeName(
					entry.cooldown_type as CooldownType,
					locale,
				);
				const description = `${cooldownTypeName}, ${entry.cooldown_length}s`;

				channelSelectOptions.push({
					label: `Unknown (${entry.channel_disc_id.substring(0, 10)}...)`,
					value: entry.channel_disc_id,
					description: description.substring(0, 100),
				});
			}
		}

		// 6. Show the paginated modal with channel selection
		const modalResult = await promptWithPaginatedModal(
			interaction,
			locale,
			{
				modalCustomId: MODAL_CUSTOM_ID,
				modalTitleKey: "commands.server.whitelist.remove.modal_title",
				components: [
					{
						customId: CHANNEL_SELECT_ID,
						labelKey: "commands.server.whitelist.remove.select_label",
						descriptionKey: "commands.server.whitelist.remove.select_description",
						placeholder: "commands.server.whitelist.remove.select_placeholder",
						required: true,
						options: channelSelectOptions,
					},
				],
			},
		);

		// 7. Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(
				`Whitelist channel removal modal ${modalResult.outcome} for user ${user.user_id}`,
			);
			return;
		}

		// 8. Extract values from the modal
		const modalSubmitInteraction = modalResult.interaction;
		const selectedChannelDiscId = modalResult.values?.[CHANNEL_SELECT_ID];

		// Safety checks
		if (!modalSubmitInteraction || !selectedChannelDiscId) {
			log.error("Modal result unexpectedly missing interaction or values");
			return;
		}

		// 9. Remove the channel from the whitelist
		const deleted = await removeChannelWhitelist(
			tomoriState.server_id,
			selectedChannelDiscId,
		);

		if (!deleted) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				color: ColorCode.ERROR,
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
			});
			return;
		}

		// 10. Invalidate whitelist cache for this server
		invalidateWhitelistCache(interaction.guildId);

		// 11. Get channel name for success message
		let channelName = selectedChannelDiscId;
		try {
			const channel = await interaction.guild.channels.fetch(selectedChannelDiscId);
			channelName = channel?.name ?? selectedChannelDiscId;
		} catch {
			// Channel might be deleted, use ID
		}

		// 12. Send success message
		await replyInfoEmbed(
			modalSubmitInteraction,
			locale,
			{
				color: ColorCode.SUCCESS,
				titleKey: "commands.server.whitelist.remove.success_title",
				descriptionKey: "commands.server.whitelist.remove.success_description",
				descriptionVars: {
					channel_name: channelName,
				},
			},
			undefined,
		);

		log.info(
			`Channel ${channelName} (${selectedChannelDiscId}) removed from whitelist in server ${interaction.guildId}`,
		);
	} catch (error) {
		log.error("Error executing /server whitelist remove command", error, errorContext);

		// If interaction hasn't been replied to yet, send error
		if (!interaction.replied && !interaction.deferred) {
			await replyInfoEmbed(interaction, locale, {
				color: ColorCode.ERROR,
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
			});
		}
	}
}

/**
 * Get localized name for a cooldown type
 * @param cooldownType - The cooldown type
 * @param locale - The locale to use for localization
 * @returns Localized cooldown type name
 */
function getCooldownTypeName(cooldownType: CooldownType, locale: string): string {
	const key = getCooldownTypeKey(cooldownType);
	return localizer(locale, `commands.config.cooldown.type.choice_${key}`);
}

/**
 * Get the locale key suffix for a cooldown type
 * @param cooldownType - The cooldown type
 * @returns The locale key suffix (e.g., "off", "per_user", "per_channel")
 */
function getCooldownTypeKey(cooldownType: CooldownType): string {
	switch (cooldownType) {
		case CooldownType.OFF:
			return "off";
		case CooldownType.PER_USER:
			return "per_user";
		case CooldownType.PER_CHANNEL:
			return "per_channel";
		case CooldownType.SERVER_WIDE:
			return "server_wide";
		case CooldownType.STRICT_SERVER_WIDE:
			return "strict_server_wide";
		default:
			return "off";
	}
}

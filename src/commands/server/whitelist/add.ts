import {
	ChannelType,
	MessageFlags,
	type ChatInputCommandInteraction,
	type Client,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import { sql } from "@/utils/db/client";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { CooldownType } from "@/types/db/schema";
import { upsertChannelWhitelist } from "@/utils/db/channelWhitelist";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "@/types/db/schema";

/**
 * Configure the /server whitelist add subcommand
 * Allows server managers to whitelist specific channels with custom cooldown settings
 * When ANY channel is whitelisted, ONLY whitelisted channels can trigger the bot
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("add")
		.setDescription(
			localizer("en-US", "commands.server.whitelist.add.description"),
		)
		.addChannelOption((option) =>
			option
				.setName("channel")
				.setDescription(
					localizer("en-US", "commands.server.whitelist.add.channel_description"),
				)
				.addChannelTypes(ChannelType.GuildText)
				.setRequired(true),
		)
		.addIntegerOption((option) =>
			option
				.setName("cooldown_type")
				.setDescription(
					localizer("en-US", "commands.server.whitelist.add.type_description"),
				)
				.setRequired(true)
				.addChoices(
					{
						name: localizer("en-US", "commands.config.cooldown.type.choice_off"),
						value: CooldownType.OFF,
					},
					{
						name: localizer("en-US", "commands.config.cooldown.type.choice_per_user"),
						value: CooldownType.PER_USER,
					},
					{
						name: localizer("en-US", "commands.config.cooldown.type.choice_per_channel"),
						value: CooldownType.PER_CHANNEL,
					},
					{
						name: localizer("en-US", "commands.config.cooldown.type.choice_server_wide"),
						value: CooldownType.SERVER_WIDE,
					},
					{
						name: localizer("en-US", "commands.config.cooldown.type.choice_strict_server_wide"),
						value: CooldownType.STRICT_SERVER_WIDE,
					},
				),
		)
		.addIntegerOption((option) =>
			option
				.setName("cooldown_length")
				.setDescription(
					localizer("en-US", "commands.server.whitelist.add.length_description"),
				)
				.setMinValue(0)
				.setMaxValue(86400)
				.setRequired(true),
		);

/**
 * Execute the /server whitelist add command
 * Adds a channel to the whitelist with custom cooldown settings
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

		// 1.5. Defer the interaction before async work to prevent timeout
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

		// 3. Get command parameters
		const channel = interaction.options.getChannel("channel", true);
		const cooldownType = interaction.options.getInteger("cooldown_type", true);
		const cooldownLength = interaction.options.getInteger("cooldown_length", true);

		// 4. Validate channel type
		if (channel.type !== ChannelType.GuildText) {
			await replyInfoEmbed(interaction, locale, {
				color: ColorCode.ERROR,
				titleKey: "commands.server.whitelist.add.invalid_channel_title",
				descriptionKey: "commands.server.whitelist.add.invalid_channel_description",
			});
			return;
		}

		// 5. Validate cooldown type (0-4)
		if (cooldownType < 0 || cooldownType > 4) {
			await replyInfoEmbed(interaction, locale, {
				color: ColorCode.ERROR,
				titleKey: "commands.server.whitelist.add.invalid_type_title",
				descriptionKey: "commands.server.whitelist.add.invalid_type_description",
			});
			return;
		}

		// 6. Validate cooldown length (0-86400)
		if (cooldownLength < 0 || cooldownLength > 86400) {
			await replyInfoEmbed(interaction, locale, {
				color: ColorCode.ERROR,
				titleKey: "commands.server.whitelist.add.invalid_length_title",
				descriptionKey: "commands.server.whitelist.add.invalid_length_description",
				descriptionVars: {
					min: "0",
					max: "86400",
				},
			});
			return;
		}

		// 7. Check if channel already has these exact settings
		const [existingEntry] = await sql`
			SELECT cooldown_type, cooldown_length
			FROM channel_whitelist
			WHERE server_id = ${tomoriState.server_id}
			AND channel_disc_id = ${channel.id}
		`;

		if (
			existingEntry &&
			existingEntry.cooldown_type === cooldownType &&
			existingEntry.cooldown_length === cooldownLength
		) {
			await replyInfoEmbed(interaction, locale, {
				color: ColorCode.WARN,
				titleKey: "commands.server.whitelist.add.already_set_title",
				descriptionKey: "commands.server.whitelist.add.already_set_description",
				descriptionVars: {
					channel_name: channel.name ?? "UNDEFINED_CH",
				},
			});
			return;
		}

		// 8. Upsert channel whitelist
		await upsertChannelWhitelist(
			tomoriState.server_id,
			channel.id,
			cooldownType as CooldownType,
			cooldownLength,
		);

		// 9. Invalidate whitelist cache for this server
		invalidateWhitelistCache(interaction.guildId);

		// 10. Send success message
		const cooldownTypeName = localizer(
			locale,
			`commands.config.cooldown.type.choice_${getCooldownTypeKey(cooldownType as CooldownType)}`,
		);

		// Use different message for instant cooldown (length = 0)
		if (cooldownLength === 0) {
			await replyInfoEmbed(
				interaction,
				locale,
				{
					color: ColorCode.SUCCESS,
					titleKey: "commands.server.whitelist.add.success_instant_title",
					descriptionKey: "commands.server.whitelist.add.success_instant_description",
					descriptionVars: {
						channel_name: channel.name ?? "UNDEFINED_CH",
						cooldown_type: cooldownTypeName,
					},
				},
				undefined,
			);
		} else {
			await replyInfoEmbed(
				interaction,
				locale,
				{
					color: ColorCode.SUCCESS,
					titleKey: "commands.server.whitelist.add.success_title",
					descriptionKey: "commands.server.whitelist.add.success_description",
					descriptionVars: {
						channel_name: channel.name ?? "UNDEFINED_CH",
						cooldown_type: cooldownTypeName,
						cooldown_length: cooldownLength.toString(),
					},
				},
				undefined,
			);
		}

		log.info(
			`Channel ${channel.name} (${channel.id}) whitelisted in server ${interaction.guildId} with cooldown type ${cooldownType} and length ${cooldownLength}s`,
		);
	} catch (error) {
		log.error("Error executing /server whitelist add command", error, errorContext);

		await replyInfoEmbed(interaction, locale, {
			color: ColorCode.ERROR,
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
		});
	}
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

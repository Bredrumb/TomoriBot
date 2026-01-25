import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { sql } from "@/utils/db/client";
import {
	getCachedTomoriState,
	invalidateTomoriStateCache,
} from "@/utils/cache/tomoriStateCache";
import {
	type ErrorContext,
	type UserRow,
	CooldownType,
	tomoriConfigSchema,
} from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";

// Cooldown length limits (seconds)
const MIN_LENGTH = 1;
const MAX_LENGTH = 86400;
const DEFAULT_LENGTH = 5;

// Cooldown type limits
const COOLDOWN_TYPE_MIN = 0;
const COOLDOWN_TYPE_MAX = 4;
const COOLDOWN_TYPE_DEFAULT = CooldownType.OFF;

/**
 * Configure the subcommand for /config cooldown.
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("cooldown")
		.setDescription(localizer("en-US", "commands.config.cooldown.description"))
		.addIntegerOption((option) =>
			option
				.setName("cooldown_type")
				.setDescription(
					localizer(
						"en-US",
						"commands.config.cooldown.cooldown_type_description",
					),
				)
				.setRequired(true)
				.addChoices(
					{
						name: localizer(
							"en-US",
							"commands.config.cooldown.type.choice_off",
						),
						value: CooldownType.OFF,
					},
					{
						name: localizer(
							"en-US",
							"commands.config.cooldown.type.choice_per_user",
						),
						value: CooldownType.PER_USER,
					},
					{
						name: localizer(
							"en-US",
							"commands.config.cooldown.type.choice_per_channel",
						),
						value: CooldownType.PER_CHANNEL,
					},
					{
						name: localizer(
							"en-US",
							"commands.config.cooldown.type.choice_server_wide",
						),
						value: CooldownType.SERVER_WIDE,
					},
					{
						name: localizer(
							"en-US",
							"commands.config.cooldown.type.choice_strict_server_wide",
						),
						value: CooldownType.STRICT_SERVER_WIDE,
					},
				),
		)
		.addIntegerOption((option) =>
			option
				.setName("cooldown_length")
				.setDescription(
					localizer(
						"en-US",
						"commands.config.cooldown.cooldown_length_description",
					),
				)
				.setMinValue(MIN_LENGTH)
				.setMaxValue(MAX_LENGTH)
				.setRequired(true),
		);

/**
 * Configure cooldown type and length for message triggers in a single command.
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
	// 1. Ensure command is run in a guild
	if (!interaction.guild || !interaction.channel) {
		await replyInfoEmbed(interaction, userData.language_pref, {
			titleKey: "general.errors.guild_only_title",
			descriptionKey: "general.errors.guild_only_description",
			color: ColorCode.ERROR,
		});
		return;
	}

	// 1.5. Defer the interaction before async work to prevent timeout
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	try {
		// 2. Get values from options
		const cooldownTypeValue = interaction.options.getInteger(
			"cooldown_type",
			true,
		);
		const cooldownLength = interaction.options.getInteger(
			"cooldown_length",
			true,
		);

		// 3. Validate cooldown type
		if (
			cooldownTypeValue < COOLDOWN_TYPE_MIN ||
			cooldownTypeValue > COOLDOWN_TYPE_MAX
		) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.cooldown.invalid_type_title",
				descriptionKey: "commands.config.cooldown.invalid_type_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 4. Validate cooldown length
		if (cooldownLength < MIN_LENGTH || cooldownLength > MAX_LENGTH) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.cooldown.invalid_length_title",
				descriptionKey: "commands.config.cooldown.invalid_length_description",
				descriptionVars: {
					min: MIN_LENGTH.toString(),
					max: MAX_LENGTH.toString(),
				},
				color: ColorCode.ERROR,
			});
			return;
		}

		// 5. Load the Tomori state for this server
		const tomoriState = await getCachedTomoriState(interaction.guild.id);
		if (!tomoriState) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 6. Check if values are unchanged
		const currentCooldownType =
			tomoriState.config.cooldown_type ?? COOLDOWN_TYPE_DEFAULT;
		const currentCooldownLength =
			tomoriState.config.cooldown_length ?? DEFAULT_LENGTH;
		if (
			cooldownTypeValue === currentCooldownType &&
			cooldownLength === currentCooldownLength
		) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.cooldown.already_set_title",
				descriptionKey: "commands.config.cooldown.already_set_description",
				descriptionVars: {
					type: getCooldownTypeLabel(locale, cooldownTypeValue),
					length: cooldownLength.toString(),
				},
				color: ColorCode.WARN,
			});
			return;
		}

		// 7. Update both cooldown values in the database
		const [updatedRow] = await sql`
			UPDATE tomori_configs
			SET cooldown_type = ${cooldownTypeValue},
				cooldown_length = ${cooldownLength}
			WHERE server_id = ${tomoriState.server_id}
			RETURNING *
		`;

		if (!updatedRow) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				userId: userData.user_id,
				errorType: "DatabaseUpdateError",
				metadata: {
					command: "config cooldown",
					cooldownTypeValue,
					cooldownLength,
					targetTable: "tomori_configs",
				},
			};
			await log.error(
				"Failed to update cooldown config",
				new Error("Database update returned no rows"),
				context,
			);

			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.update_failed_title",
				descriptionKey: "general.errors.update_failed_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 8. Validate the returned data
		const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);
		if (!validatedConfig.success) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				errorType: "SchemaValidationError",
				metadata: {
					command: "config cooldown",
					validationErrors: validatedConfig.error.flatten(),
				},
			};
			await log.error(
				"Failed to validate updated config",
				validatedConfig.error,
				context,
			);

			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.update_failed_title",
				descriptionKey: "general.errors.update_failed_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 9. Invalidate cache so next message gets fresh config
		invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

		// 10. Success message
		const isEnabled = cooldownTypeValue !== CooldownType.OFF;
		await replyInfoEmbed(interaction, locale, {
			titleKey: isEnabled
				? "commands.config.cooldown.success_title"
				: "commands.config.cooldown.success_disabled_title",
			descriptionKey: isEnabled
				? "commands.config.cooldown.success_description"
				: "commands.config.cooldown.success_disabled_description",
			descriptionVars: {
				type: getCooldownTypeLabel(locale, cooldownTypeValue),
				length: cooldownLength.toString(),
				previous_type: getCooldownTypeLabel(locale, currentCooldownType),
				previous_length: currentCooldownLength.toString(),
			},
			color: isEnabled ? ColorCode.SUCCESS : ColorCode.WARN,
		});
	} catch (error) {
		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: (await getCachedTomoriState(interaction.guild.id))?.server_id,
			errorType: "CommandExecutionError",
			metadata: {
				command: "config cooldown",
				options: interaction.options?.data,
			},
		};
		await log.error(
			"Error in /config cooldown command",
			error as Error,
			context,
		);

		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
		});
	}
}

/**
 * Helper function to get a user-friendly label for cooldown type values.
 * @param locale - The user's locale
 * @param value - Cooldown type value
 * @returns Localized cooldown type label
 */
function getCooldownTypeLabel(locale: string, value: number): string {
	switch (value) {
		case CooldownType.OFF:
			return localizer(locale, "commands.config.cooldown.type.choice_off");
		case CooldownType.PER_USER:
			return localizer(locale, "commands.config.cooldown.type.choice_per_user");
		case CooldownType.PER_CHANNEL:
			return localizer(
				locale,
				"commands.config.cooldown.type.choice_per_channel",
			);
		case CooldownType.SERVER_WIDE:
			return localizer(
				locale,
				"commands.config.cooldown.type.choice_server_wide",
			);
		case CooldownType.STRICT_SERVER_WIDE:
			return localizer(
				locale,
				"commands.config.cooldown.type.choice_strict_server_wide",
			);
		default:
			log.warn(
				`Unexpected cooldown type value encountered in getCooldownTypeLabel: ${value}`,
			);
			return localizer(locale, "commands.config.cooldown.type.choice_off");
	}
}

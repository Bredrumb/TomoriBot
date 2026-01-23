import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { sql } from "@/utils/db/client";
import {
	getCachedTomoriState,
	invalidateTomoriStateCache,
} from "../../../utils/cache/tomoriStateCache";
import { tomoriConfigSchema, CooldownType } from "../../../types/db/schema";
import { localizer } from "../../../utils/text/localizer";
import { log, ColorCode } from "../../../utils/misc/logger";
import { replyInfoEmbed } from "../../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../../types/db/schema";

// Constants for cooldown length limits
const MIN_LENGTH = 1; // Minimum 1 second
const MAX_LENGTH = 86400; // Maximum 24 hours (86400 seconds)
const DEFAULT_LENGTH = 5; // Default 5 seconds

/**
 * Configure the subcommand for /config cooldown length.
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("length")
		.setDescription(
			localizer("en-US", "commands.config.cooldown.length.description"),
		)
		.addIntegerOption((option) =>
			option
				.setName("seconds")
				.setDescription(
					localizer(
						"en-US",
						"commands.config.cooldown.length.seconds_description",
					),
				)
				.setMinValue(MIN_LENGTH)
				.setMaxValue(MAX_LENGTH)
				.setRequired(true),
		);

/**
 * Configures the cooldown duration setting for message triggers.
 * Sets the time in seconds that users must wait before triggering Tomori again.
 * Valid range: 1 to 86400 seconds (24 hours).
 * If cooldowns are disabled (type=0), shows a warning but still saves the value.
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

	try {
		// 2. Get the length value from options
		const lengthSeconds = interaction.options.getInteger("seconds", true);

		// 3. Validate the length against the allowed range (redundant but safe)
		if (lengthSeconds < MIN_LENGTH || lengthSeconds > MAX_LENGTH) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.cooldown.length.invalid_range_title",
				descriptionKey:
					"commands.config.cooldown.length.invalid_range_description",
				descriptionVars: {
					min: MIN_LENGTH.toString(),
					max: MAX_LENGTH.toString(),
				},
				color: ColorCode.ERROR,
			});
			return;
		}

		// 4. Load the Tomori state for this server
		const tomoriState = await getCachedTomoriState(interaction.guild.id);
		if (!tomoriState) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 5. Check if this is the same as the current cooldown length
		const currentLength = tomoriState.config.cooldown_length ?? DEFAULT_LENGTH;
		if (lengthSeconds === currentLength) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.cooldown.length.already_set_title",
				descriptionKey:
					"commands.config.cooldown.length.already_set_description",
				descriptionVars: {
					length: lengthSeconds.toString(),
				},
				color: ColorCode.WARN,
			});
			return;
		}

		// 6. Update the length in the database with direct SQL
		const [updatedRow] = await sql`
			UPDATE tomori_configs
			SET cooldown_length = ${lengthSeconds}
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
					command: "config cooldown length",
					lengthSeconds,
					targetTable: "tomori_configs",
				},
			};
			await log.error(
				"Failed to update cooldown_length config",
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

		// 7. Validate the returned data
		const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);
		if (!validatedConfig.success) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				errorType: "SchemaValidationError",
				metadata: {
					command: "config cooldown length",
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

		// 8. Invalidate cache so next message gets fresh config
		invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

		// 9. Success message - check if cooldowns are enabled to show appropriate message
		const cooldownType = tomoriState.config.cooldown_type ?? CooldownType.OFF;
		const isCooldownEnabled = cooldownType !== CooldownType.OFF;

		await replyInfoEmbed(interaction, locale, {
			titleKey: isCooldownEnabled
				? "commands.config.cooldown.length.success_title"
				: "commands.config.cooldown.length.success_disabled_title",
			descriptionKey: isCooldownEnabled
				? "commands.config.cooldown.length.success_description"
				: "commands.config.cooldown.length.success_disabled_description",
			descriptionVars: {
				length: lengthSeconds.toString(),
			},
			color: isCooldownEnabled ? ColorCode.SUCCESS : ColorCode.WARN,
		});
	} catch (error) {
		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: (await getCachedTomoriState(interaction.guild.id))?.server_id,
			errorType: "CommandExecutionError",
			metadata: {
				command: "config cooldown length",
				options: interaction.options?.data,
			},
		};
		await log.error(
			"Error in /config cooldown length command",
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

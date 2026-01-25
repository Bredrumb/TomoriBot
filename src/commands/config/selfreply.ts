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
} from "../../utils/cache/tomoriStateCache";
import { tomoriConfigSchema } from "../../types/db/schema";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../types/db/schema";

const MIN_LIMIT = 0;
const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 3;

// Configure the subcommand (Rule #21)
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("selfreply")
		.setDescription(
			localizer("en-US", "commands.config.selfreply.limit.description"),
		)
		.addIntegerOption((option) =>
			option
				.setName("limit")
				.setDescription(
					localizer(
						"en-US",
						"commands.config.selfreply.limit.limit_description",
					),
				)
				.setMinValue(MIN_LIMIT)
				.setMaxValue(MAX_LIMIT)
				.setRequired(true),
		);

/**
 * Configures the self-reply chain limit for persona-to-persona triggering.
 * 0 disables self replies, 1-10 allow a chain up to the specified depth.
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
		// 2. Get the limit value from options
		const limit = interaction.options.getInteger("limit", true);

		// 3. Validate range (redundant but safe)
		if (limit < MIN_LIMIT || limit > MAX_LIMIT) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.selfreply.limit.invalid_range_title",
				descriptionKey:
					"commands.config.selfreply.limit.invalid_range_description",
				descriptionVars: {
					min: MIN_LIMIT.toString(),
					max: MAX_LIMIT.toString(),
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

		// 5. Check if this is the same as the current limit
		const currentLimit = tomoriState.config.self_reply_limit ?? DEFAULT_LIMIT;
		if (limit === currentLimit) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.selfreply.limit.already_set_title",
				descriptionKey:
					"commands.config.selfreply.limit.already_set_description",
				descriptionVars: {
					limit: limit.toString(),
				},
				color: ColorCode.WARN,
			});
			return;
		}

		// 6. Update the limit in the database with direct SQL
		const [updatedRow] = await sql`
			UPDATE tomori_configs
			SET self_reply_limit = ${limit}
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
					command: "config selfreply limit",
					limit,
					targetTable: "tomori_configs",
				},
			};
			await log.error(
				"Failed to update self_reply_limit config",
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
					command: "config selfreply limit",
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
		invalidateTomoriStateCache(interaction.guild.id);

		// 9. Success message - indicate disabled state if limit is 0
		const isEnabled = limit > 0;
		await replyInfoEmbed(interaction, locale, {
			titleKey: isEnabled
				? "commands.config.selfreply.limit.success_title"
				: "commands.config.selfreply.limit.success_disabled_title",
			descriptionKey: isEnabled
				? "commands.config.selfreply.limit.success_description"
				: "commands.config.selfreply.limit.success_disabled_description",
			descriptionVars: {
				limit: limit.toString(),
			},
			color: isEnabled ? ColorCode.SUCCESS : ColorCode.WARN,
		});
	} catch (error) {
		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: (await getCachedTomoriState(interaction.guild.id))?.server_id,
			errorType: "CommandExecutionError",
			metadata: {
				command: "config selfreply limit",
				options: interaction.options?.data,
			},
		};
		await log.error(
			"Error in /config selfreply limit command",
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

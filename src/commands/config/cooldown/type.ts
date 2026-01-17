import {
	MessageFlags,
	type ChatInputCommandInteraction,
	type Client,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import {
	getCachedTomoriState,
	invalidateTomoriStateCache,
} from "../../../utils/cache/tomoriStateCache";
import { localizer } from "../../../utils/text/localizer";
import { log, ColorCode } from "../../../utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithRawModal,
} from "../../../utils/discord/interactionHelper";
import {
	type UserRow,
	type ErrorContext,
	tomoriConfigSchema,
	CooldownType,
} from "../../../types/db/schema";
import type { SelectOption } from "../../../types/discord/modal";
import { sql } from "@/utils/db/client";

// Define constants for cooldown type values
const COOLDOWN_TYPE_MIN = 0;
const COOLDOWN_TYPE_MAX = 4;
const COOLDOWN_TYPE_DEFAULT = CooldownType.OFF;

// Modal configuration constants
const MODAL_CUSTOM_ID = "config_cooldown_type_modal";
const COOLDOWN_TYPE_SELECT_ID = "cooldown_type_select";

/**
 * Creates cooldown type options with localized descriptions.
 * @param locale - The locale to use for localization
 * @returns Array of SelectOption with localized descriptions
 */
function createCooldownTypeOptions(locale: string): SelectOption[] {
	return [
		{
			label: localizer(locale, "commands.config.cooldown.type.choice_off"),
			value: "0",
			description: localizer(
				locale,
				"commands.config.cooldown.type.desc_off",
			),
		},
		{
			label: localizer(
				locale,
				"commands.config.cooldown.type.choice_per_user",
			),
			value: "1",
			description: localizer(
				locale,
				"commands.config.cooldown.type.desc_per_user",
			),
		},
		{
			label: localizer(
				locale,
				"commands.config.cooldown.type.choice_per_channel",
			),
			value: "2",
			description: localizer(
				locale,
				"commands.config.cooldown.type.desc_per_channel",
			),
		},
		{
			label: localizer(
				locale,
				"commands.config.cooldown.type.choice_server_wide",
			),
			value: "3",
			description: localizer(
				locale,
				"commands.config.cooldown.type.desc_server_wide",
			),
		},
		{
			label: localizer(
				locale,
				"commands.config.cooldown.type.choice_strict_server_wide",
			),
			value: "4",
			description: localizer(
				locale,
				"commands.config.cooldown.type.desc_strict_server_wide",
			),
		},
	];
}

/**
 * Configure the subcommand for /config cooldown type.
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("type")
		.setDescription(
			localizer("en-US", "commands.config.cooldown.type.description"),
		);

/**
 * Configures the cooldown type setting for message triggers.
 * Available types:
 * 0 = Off (no cooldown)
 * 1 = Per-User (each user has their own cooldown per server, managers exempt)
 * 2 = Per-Channel (each channel has its own cooldown, managers exempt)
 * 3 = Server-Wide (everyone waits, managers exempt)
 * 4 = Strict Server-Wide (everyone waits, no exceptions)
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
		// 2. Load the Tomori state for this server
		const tomoriState = await getCachedTomoriState(interaction.guild.id);
		if (!tomoriState) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 3. Show the modal with cooldown type selection
		const modalResult = await promptWithRawModal(interaction, locale, {
			modalCustomId: MODAL_CUSTOM_ID,
			modalTitleKey: "commands.config.cooldown.type.modal_title",
			components: [
				{
					customId: COOLDOWN_TYPE_SELECT_ID,
					labelKey: "commands.config.cooldown.type.select_label",
					descriptionKey:
						"commands.config.cooldown.type.select_description",
					placeholder: "commands.config.cooldown.type.select_placeholder",
					required: true,
					options: createCooldownTypeOptions(locale),
				},
			],
		});

		// 4. Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(
				`Cooldown type selection modal ${modalResult.outcome} for user ${userData.user_id}`,
			);
			return;
		}

		// Extract values from the modal
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
		const modalSubmitInteraction = modalResult.interaction!;
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
		const selectedValue = modalResult.values![COOLDOWN_TYPE_SELECT_ID];
		const cooldownTypeValue = Number.parseInt(selectedValue, 10);

		// 5. Validate the parsed value (additional safety check)
		if (
			Number.isNaN(cooldownTypeValue) ||
			cooldownTypeValue < COOLDOWN_TYPE_MIN ||
			cooldownTypeValue > COOLDOWN_TYPE_MAX
		) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "general.errors.operation_failed_title",
				descriptionKey:
					"commands.config.cooldown.type.invalid_value_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 6. Check if this is the same as the current cooldown type value
		const currentCooldownType =
			tomoriState.config.cooldown_type ?? COOLDOWN_TYPE_DEFAULT;
		if (cooldownTypeValue === currentCooldownType) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.config.cooldown.type.already_set_title",
				descriptionKey:
					"commands.config.cooldown.type.already_set_description",
				descriptionVars: {
					value: getCooldownTypeLabel(locale, cooldownTypeValue),
				},
				color: ColorCode.WARN,
			});
			return;
		}

		// 7. Update the config in the database using direct SQL
		const [updatedRow] = await sql`
			UPDATE tomori_configs
			SET cooldown_type = ${cooldownTypeValue}
			WHERE tomori_id = ${tomoriState.tomori_id}
			RETURNING *
		`;

		// 8. Validate the returned data
		const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);

		if (!validatedConfig.success || !updatedRow) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				userId: userData.user_id,
				errorType: "DatabaseUpdateError",
				metadata: {
					command: "config cooldown type",
					guildId: interaction.guild?.id ?? interaction.user.id,
					cooldownTypeValue,
					validationErrors: validatedConfig.success
						? null
						: validatedConfig.error.flatten(),
				},
			};
			await log.error(
				"Failed to update or validate cooldown_type config",
				validatedConfig.success
					? new Error("Database update returned no rows or unexpected data")
					: new Error("Updated config data failed validation"),
				context,
			);

			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "general.errors.update_failed_title",
				descriptionKey: "general.errors.update_failed_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 9. Invalidate cache so next message gets fresh config
		invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

		// 10. Success message with explanation of the cooldown type effect
		const isEnabled = cooldownTypeValue !== CooldownType.OFF;
		await replyInfoEmbed(modalSubmitInteraction, locale, {
			titleKey: isEnabled
				? "commands.config.cooldown.type.success_title"
				: "commands.config.cooldown.type.success_disabled_title",
			descriptionKey: isEnabled
				? "commands.config.cooldown.type.success_description"
				: "commands.config.cooldown.type.success_disabled_description",
			descriptionVars: {
				value: getCooldownTypeLabel(locale, cooldownTypeValue),
				previous_value: getCooldownTypeLabel(locale, currentCooldownType),
			},
			color: isEnabled ? ColorCode.SUCCESS : ColorCode.WARN,
		});
	} catch (error) {
		// 10. Log error with context
		let serverIdForError: number | null = null;
		let tomoriIdForError: number | null = null;
		if (interaction.guild?.id) {
			const state = await getCachedTomoriState(interaction.guild.id);
			serverIdForError = state?.server_id ?? null;
			tomoriIdForError = state?.tomori_id ?? null;
		}

		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: serverIdForError,
			tomoriId: tomoriIdForError,
			errorType: "CommandExecutionError",
			metadata: {
				command: "config cooldown type",
				guildId: interaction.guild?.id ?? interaction.user.id,
				executorDiscordId: interaction.user.id,
			},
		};
		await log.error(
			`Error executing /config cooldown type for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		// 11. Inform user of unknown error
		if (!interaction.replied && !interaction.deferred) {
			await interaction.reply({
				content: localizer(locale, "general.errors.unknown_error_description"),
				flags: MessageFlags.Ephemeral,
			});
		} else {
			await interaction.followUp({
				content: localizer(locale, "general.errors.unknown_error_description"),
				flags: MessageFlags.Ephemeral,
			});
		}
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

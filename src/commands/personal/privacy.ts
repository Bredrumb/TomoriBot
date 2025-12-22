import {
	MessageFlags,
	type ChatInputCommandInteraction,
	type Client,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import { setPrivacyLevel } from "../../utils/db/dbWrite";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithRawModal,
} from "../../utils/discord/interactionHelper";
import {
	type UserRow,
	type ErrorContext,
	PrivacyLevel,
} from "../../types/db/schema";
import type { SelectOption } from "../../types/discord/modal";

// Modal configuration constants
const MODAL_CUSTOM_ID = "personal_privacy_modal";
const PRIVACY_SELECT_ID = "privacy_select";

/**
 * Creates privacy level options with localized descriptions
 * @param locale - The locale to use for localization
 * @returns Array of SelectOption with localized descriptions
 */
function createPrivacyOptions(locale: string): SelectOption[] {
	return [
		{
			label: localizer(locale, "commands.personal.privacy.choice_minimal"),
			value: "0",
			description: localizer(locale, "commands.personal.privacy.desc_minimal"),
		},
		{
			label: localizer(locale, "commands.personal.privacy.choice_partial"),
			value: "1",
			description: localizer(locale, "commands.personal.privacy.desc_partial"),
		},
		{
			label: localizer(locale, "commands.personal.privacy.choice_full"),
			value: "2",
			description: localizer(locale, "commands.personal.privacy.desc_full"),
		},
	];
}

/**
 * Helper function to get a user-friendly label for privacy levels
 * @param locale - The user's locale
 * @param level - Privacy level value
 * @returns Localized privacy label
 */
function getPrivacyLevelLabel(locale: string, level: PrivacyLevel): string {
	switch (level) {
		case PrivacyLevel.MINIMAL:
			return localizer(locale, "commands.personal.privacy.choice_minimal");
		case PrivacyLevel.PARTIAL:
			return localizer(locale, "commands.personal.privacy.choice_partial");
		case PrivacyLevel.FULL:
			return localizer(locale, "commands.personal.privacy.choice_full");
		default:
			log.warn(
				`Unexpected privacy level encountered in getPrivacyLevelLabel: ${level}`,
			);
			return localizer(locale, "commands.personal.privacy.choice_minimal");
	}
}

// Configure the subcommand
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("privacy")
		.setDescription(localizer("en-US", "commands.personal.privacy.description"));

/**
 * Manages user's global privacy settings for personalization.
 *
 * Privacy levels:
 * - Level 0 (MINIMAL): Full personalization, all features enabled
 * - Level 1 (PARTIAL): Messages visible but no personal memory access by LLM
 * - Level 2 (FULL): Completely invisible, cannot trigger bot
 *
 * This setting applies across all servers where TomoriBot is present.
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database (the command executor)
 * @param locale - Locale of the interaction
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	// Declare modalSubmitInteraction outside try-catch for catch block access
	let modalSubmitInteraction: import("discord.js").ModalSubmitInteraction | undefined;

	try {
		// 1. Get current privacy level
		const currentLevel = userData.privacy_level ?? PrivacyLevel.MINIMAL;

		// 2. Show the modal with privacy level selection
		const modalResult = await promptWithRawModal(interaction, locale, {
			modalCustomId: MODAL_CUSTOM_ID,
			modalTitleKey: "commands.personal.privacy.modal_title",
			components: [
				{
					customId: PRIVACY_SELECT_ID,
					labelKey: "commands.personal.privacy.select_label",
					descriptionKey: "commands.personal.privacy.select_description",
					placeholder: "commands.personal.privacy.select_placeholder",
					required: true,
					options: createPrivacyOptions(locale),
				},
			],
		});

		// 3. Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(
				`Privacy level selection modal ${modalResult.outcome} for user ${userData.user_id}`,
			);
			return;
		}

		// Extract values from the modal
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
		modalSubmitInteraction = modalResult.interaction!;
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
		const selectedValue = modalResult.values![PRIVACY_SELECT_ID];
		const requestedLevel = Number.parseInt(selectedValue, 10) as PrivacyLevel;

		// 4. Validate the parsed value
		if (
			Number.isNaN(requestedLevel) ||
			![PrivacyLevel.MINIMAL, PrivacyLevel.PARTIAL, PrivacyLevel.FULL].includes(
				requestedLevel,
			)
		) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "general.errors.operation_failed_title",
				descriptionKey:
					"commands.personal.privacy.invalid_value_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 5. Check if this is the same as the current level
		if (requestedLevel === currentLevel) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.personal.privacy.already_set_title",
				descriptionKey: "commands.personal.privacy.already_set_description",
				descriptionVars: {
					value: getPrivacyLevelLabel(locale, requestedLevel),
				},
				color: ColorCode.WARN,
			});
			return;
		}

		// 6. Update privacy level in database
		const updatedUser = await setPrivacyLevel(
			interaction.user.id,
			requestedLevel,
		);

		if (!updatedUser) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 7. Send success confirmation message
		await replyInfoEmbed(modalSubmitInteraction, locale, {
			titleKey: "commands.personal.privacy.success_title",
			descriptionKey: "commands.personal.privacy.success_description",
			descriptionVars: {
				value: getPrivacyLevelLabel(locale, requestedLevel),
				previous_value: getPrivacyLevelLabel(locale, currentLevel),
			},
			color: ColorCode.SUCCESS,
		});

		log.info(
			`User ${interaction.user.id} (${userData.user_nickname}) changed privacy level from ${currentLevel} to ${requestedLevel}`,
		);
	} catch (error) {
		// 8. Log error with context
		const context: ErrorContext = {
			userId: userData.user_id,
			errorType: "CommandExecutionError",
			metadata: {
				command: "personal privacy",
				guildId: interaction.guild?.id,
				executorDiscordId: interaction.user.id,
			},
		};
		await log.error(
			`Error executing /personal privacy for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		// 9. Inform user of unknown error
		const replyTarget = modalSubmitInteraction ?? interaction;
		await replyInfoEmbed(replyTarget, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
	}
}

import {
	MessageFlags,
	type ChatInputCommandInteraction,
	type Client,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import { loadTomoriState, loadPresetRowsByLocale } from "../../utils/db/dbRead";
import {
	localizer,
	getBaseTriggerWords,
	getDefaultBotName,
} from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithRawModal,
	safeSelectOptionText,
} from "../../utils/discord/interactionHelper";
import {
	type UserRow,
	type ErrorContext,
	tomoriSchema,
	type TomoriPresetRow,
} from "../../types/db/schema";
import type { SelectOption } from "../../types/discord/modal";
import { sql } from "bun";
import { getCachedPresetAvatar } from "../../utils/image/avatarHelper";

// Modal configuration constants
const MODAL_CUSTOM_ID = "preset_default_modal";
const PRESET_SELECT_ID = "preset_select";

// Configure the subcommand
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("default")
		.setDescription(localizer("en-US", "commands.persona.default.description"));

/**
 * Applies a preset personality configuration to Tomori.
 * Overwrites the current Attribute List, Sample Dialogues, Trigger Words, and Nickname with preset and default values.
 * Resets trigger words to default locale-specific values and nickname to default bot name.
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
	// 1. Ensure command is run in a channel
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	try {
		// 2. Load the Tomori state for this server
		const tomoriState = await loadTomoriState(
			interaction.guild?.id ?? interaction.user.id,
		);
		if (!tomoriState) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 5. Fetch available presets for the user's locale using shared helper
		const presets = await loadPresetRowsByLocale(locale);

		// 6. Check if there are any presets available
		if (!presets || presets.length === 0) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.persona.default.no_presets_title",
				descriptionKey: "commands.persona.default.no_presets_description",
				color: ColorCode.WARN,
			});
			return;
		}

		// 7. Create preset options for the select menu using full descriptions
		const presetSelectOptions: SelectOption[] = presets.map(
			(preset: TomoriPresetRow) => ({
				label: safeSelectOptionText(preset.tomori_preset_name),
				value: safeSelectOptionText(preset.tomori_preset_name),
				description: safeSelectOptionText(preset.tomori_preset_desc),
			}),
		);

		// 8. Show the modal with preset selection
		const modalResult = await promptWithRawModal(
			interaction,
			locale,
			{
				modalCustomId: MODAL_CUSTOM_ID,
				modalTitleKey: "commands.persona.default.modal_title",
				components: [
					{
						customId: PRESET_SELECT_ID,
						labelKey: "commands.persona.default.select_label",
						descriptionKey: "commands.persona.default.select_description",
						placeholder: "commands.persona.default.select_placeholder",
						required: true,
						options: presetSelectOptions,
					},
				],
			},
			MessageFlags.Ephemeral, // Auto-defer with ephemeral flag
		);

		// 9. Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(
				`Preset selection modal ${modalResult.outcome} for user ${userData.user_id}`,
			);
			return;
		}

		// Extract values from the modal
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
		const modalSubmitInteraction = modalResult.interaction!;
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
		const selectedPresetName = modalResult.values![PRESET_SELECT_ID];

		// 10. Find the selected preset - let helper functions manage interaction state
		const selectedPreset = presets.find(
			(preset: TomoriPresetRow) =>
				preset.tomori_preset_name === selectedPresetName,
		);

		if (!selectedPreset) {
			await modalSubmitInteraction.editReply({
				content: localizer(locale, "commands.persona.default.preset_not_found"),
			});
			return;
		}

		// 11. Create attribute list with description as first element (Rule 23)
		const attributesWithDescription = [
			`{bot}'s Description: ${selectedPreset.tomori_preset_desc}`,
			...selectedPreset.preset_attribute_list,
		];

		// 12. Format arrays for PostgreSQL update (Rule 23)
		const attributeArrayLiteral = `{${attributesWithDescription
			.map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
			.join(",")}}`;

		const inArrayLiteral = `{${selectedPreset.preset_sample_dialogues_in
			.map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
			.join(",")}}`;

		const outArrayLiteral = `{${selectedPreset.preset_sample_dialogues_out
			.map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
			.join(",")}}`;

		// 13. Get default trigger words and bot name for the locale
		const defaultTriggerWords = getBaseTriggerWords(locale);
		const defaultBotName = getDefaultBotName(locale);

		// 14. Format trigger words for PostgreSQL update
		const triggerWordsArrayLiteral = `{${defaultTriggerWords
			.map((word: string) => `"${word.replace(/(["\\])/g, "\\$1")}"`)
			.join(",")}}`;

		// 15. Update Tomori and TomoriConfig in the database
		// First, update the Tomori table (nickname and attribute/dialogue data)
		const [updatedTomoriResult] = await sql`
			UPDATE tomoris
			SET
				tomori_nickname = ${defaultBotName},
				attribute_list = ${attributeArrayLiteral}::text[],
				sample_dialogues_in = ${inArrayLiteral}::text[],
				sample_dialogues_out = ${outArrayLiteral}::text[]
			WHERE tomori_id = ${tomoriState.tomori_id}
			RETURNING *
		`;

		// 16. Update the TomoriConfig table (trigger words)
		await sql`
			UPDATE tomori_configs
			SET trigger_words = ${triggerWordsArrayLiteral}::text[]
			WHERE tomori_id = ${tomoriState.tomori_id}
		`;

		// 17. Validate the result
		const validationResult = tomoriSchema.safeParse(updatedTomoriResult);

		if (!validationResult.success || !updatedTomoriResult) {
			const context: ErrorContext = {
				userId: userData.user_id,
				serverId: tomoriState.server_id,
				tomoriId: tomoriState.tomori_id,
				errorType: "DatabaseValidationError",
				metadata: {
					command: "preset default",
					preset: selectedPreset.tomori_preset_name,
					presetId: selectedPreset.tomori_preset_id,
					validationErrors: validationResult.success
						? null
						: validationResult.error.flatten(),
				},
			};
			await log.error(
				"Failed to validate updated tomori data after applying preset",
				validationResult.success
					? new Error("Database update returned no rows or unexpected data")
					: new Error("Updated tomori data failed validation"),
				context,
			);

			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "general.errors.update_failed_title",
				descriptionKey: "general.errors.update_failed_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		// 18. Detect DM context and set guild avatar/nickname (guild-only operations)
		const isDM = !interaction.guild;
		let avatarUpdateFailed = false;

		// Only attempt avatar/nickname updates in guilds (not available in DMs)
		if (!isDM) {
			try {
				// Reset server nickname if in a guild
				if (interaction.guild?.members.me) {
					await interaction.guild.members.me.setNickname(null);
					log.info(
						`Reset server nickname for guild ${interaction.guild.id} after applying preset`,
					);
				}

				// Set guild-specific avatar from preset cache or reset to none using Discord API
				if (interaction.guild) {
					// 1. Try to get cached preset avatar
					const cachedAvatar = getCachedPresetAvatar(
						selectedPreset.tomori_preset_id,
					);

					// 2. Prepare avatar value (base64 data URI or null)
					const avatarValue = cachedAvatar || null;

					// 3. Update guild avatar via Discord API
					const endpoint = `https://discord.com/api/v10/guilds/${interaction.guild.id}/members/@me`;
					const response = await fetch(endpoint, {
						method: "PATCH",
						headers: {
							Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ avatar: avatarValue }),
					});

					if (response.ok) {
						const actionDescription = cachedAvatar
							? `Set preset avatar for "${selectedPreset.tomori_preset_name}"`
							: "Reset guild avatar to bot default";
						log.info(
							`${actionDescription} for guild ${interaction.guild.id} after applying preset`,
						);
					} else {
						avatarUpdateFailed = true;
						log.warn(
							`Failed to update guild avatar: ${response.status} ${response.statusText}`,
						);
					}
				}
			} catch (avatarError) {
				// Log avatar/nickname errors but don't fail the command
				avatarUpdateFailed = true;
				log.warn(
					`Failed to update avatar or nickname after applying preset: ${avatarError}`,
				);
			}
		}

		// 19. Log success and show success message
		log.success(
			`Applied preset "${selectedPreset.tomori_preset_name}" to server ${tomoriState.server_id} by user ${userData.user_disc_id}`,
		);

		await replyInfoEmbed(modalSubmitInteraction, locale, {
			titleKey: "commands.persona.default.success_title",
			descriptionKey: "commands.persona.default.success_description",
			descriptionVars: {
				preset_name: selectedPreset.tomori_preset_name,
			},
			color: avatarUpdateFailed || isDM ? ColorCode.WARN : ColorCode.SUCCESS,
			footerKey: isDM
				? "commands.persona.default.avatar_update_skipped_dm"
				: avatarUpdateFailed
					? "commands.persona.default.avatar_update_failed"
					: undefined,
		});
	} catch (error) {
		// 20. Log error with context
		let serverIdForError: number | null = null;
		let tomoriIdForError: number | null = null;
		if (interaction.guild?.id) {
			const state = await loadTomoriState(interaction.guild.id);
			serverIdForError = state?.server_id ?? null;
			tomoriIdForError = state?.tomori_id ?? null;
		}

		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: serverIdForError,
			tomoriId: tomoriIdForError,
			errorType: "CommandExecutionError",
			metadata: {
				command: "preset default",
				guildId: interaction.guild?.id ?? interaction.user.id,
				executorDiscordId: interaction.user.id,
			},
		};
		await log.error(
			`Error executing /preset default for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		// 21. Inform user of unknown error
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

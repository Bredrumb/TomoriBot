/**
 * Persona Remove Command
 * Removes an alter persona from the server
 */

import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithPaginatedModal,
	safeSelectOptionText,
} from "../../utils/discord/interactionHelper";
import { invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import type { UserRow } from "../../types/db/schema";
import type { SelectOption } from "../../types/discord/modal";
import { loadAllPersonasForServer } from "../../utils/db/dbRead";
import { sql } from "../../utils/db/client";
import { deletePersonaWebhooks } from "../../utils/discord/webhookManager";
import { deletePersonaAvatarFromS3 } from "../../utils/storage/avatarStorage";

// Constants for modal configuration
const MODAL_CUSTOM_ID = "persona_remove_modal";
const PERSONA_SELECT_ID = "persona_select";

/**
 * Configure the 'remove' subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("remove")
		.setDescription(localizer("en-US", "commands.persona.remove.description"));

/**
 * Executes the 'remove' command
 * Removes an alter persona from the server
 * @param _client - The Discord client instance
 * @param interaction - The chat input command interaction
 * @param _userData - The user data for the invoking user
 * @param locale - The user's preferred locale
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	try {
		// 1. Check if command is run in a guild (not DMs)
		if (!interaction.guild) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.guild_only_title",
				descriptionKey: "general.errors.guild_only_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 2. Check permissions (ManageGuild required)
		const hasPermission =
			interaction.memberPermissions?.has("ManageGuild") ?? false;

		if (!hasPermission) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.persona.remove.no_permission_title",
				descriptionKey: "commands.persona.remove.no_permission_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 3. Load all personas for this server
		const allPersonas = await loadAllPersonasForServer(interaction.guild.id);

		// 4. Filter to alters only
		const alterPersonas = allPersonas.filter((p) => p.is_alter);

		// 5. Error if no alters exist
		if (alterPersonas.length === 0) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.persona.remove.no_alters_error_title",
				descriptionKey: "commands.persona.remove.no_alters_error_description",
				color: ColorCode.WARN,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 6. Build select options for modal
		const alterSelectOptions: SelectOption[] = alterPersonas.map(
			(persona, index) => ({
				label: safeSelectOptionText(persona.tomori_nickname),
				value: index.toString(), // Use index to avoid truncation issues
			}),
		);

		// 7. Show modal with alter selection
		const modalResult = await promptWithPaginatedModal(interaction, locale, {
			modalCustomId: MODAL_CUSTOM_ID,
			modalTitleKey: "commands.persona.remove.modal_title",
			components: [
				{
					customId: PERSONA_SELECT_ID,
					labelKey: "commands.persona.remove.select_label",
					placeholder: "commands.persona.remove.select_placeholder",
					required: true,
					options: alterSelectOptions,
				},
			],
		});

		// Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(
				`Persona removal modal ${modalResult.outcome} for user ${interaction.user.id}`,
			);
			return;
		}

		// Extract selected persona from modal
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
		const modalSubmitInteraction = modalResult.interaction!;
		if (!modalSubmitInteraction.deferred && !modalSubmitInteraction.replied) {
			await modalSubmitInteraction.deferReply({ ephemeral: true });
		}
		const selectedIndex = Number.parseInt(
			// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
			modalResult.values![PERSONA_SELECT_ID],
			10,
		);
		const personaToRemove = alterPersonas[selectedIndex];
		if (!personaToRemove || !personaToRemove.tomori_id) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			log.warn(
				"Persona removal failed due to missing tomori_id for selected alter.",
			);
			return;
		}
		const personaId = personaToRemove.tomori_id;

		// 8. Delete selected alter from database
		await sql`
			DELETE FROM tomoris
			WHERE tomori_id = ${personaId}
			AND is_alter = true
		`;

		// 8.5. Delete persona webhooks (non-production uses per-persona webhooks)
		try {
			const deletedCount = await deletePersonaWebhooks(
				interaction.guild,
				personaId,
			);
			if (deletedCount > 0) {
				log.info(
					`Deleted ${deletedCount} persona webhook(s) for ${personaToRemove.tomori_nickname}`,
				);
			}
		} catch (error) {
			log.warn(
				`Failed to delete persona webhooks for ${personaToRemove.tomori_nickname}`,
				error,
			);
		}

		if (personaToRemove.webhook_avatar_url) {
			await deletePersonaAvatarFromS3(personaToRemove.webhook_avatar_url);
		}

		// 9. Invalidate cache
		invalidateTomoriStateCache(interaction.guild.id);

		// 10. Show success embed with deleted persona's nickname
		await replyInfoEmbed(modalSubmitInteraction, locale, {
			titleKey: "commands.persona.remove.success_title",
			descriptionKey: "commands.persona.remove.success_description",
			descriptionVars: {
				nickname: personaToRemove.tomori_nickname,
			},
			color: ColorCode.SUCCESS,
		});

		log.success(
			`Removed alter persona "${personaToRemove.tomori_nickname}" (ID: ${personaId}) from guild ${interaction.guild.id}`,
		);
	} catch (error) {
		log.error("Error executing persona remove command:", error, {
			errorType: "CommandExecutionError",
			metadata: { commandName: "persona remove" },
		});

		// If we haven't replied yet, reply with error
		if (!interaction.replied && !interaction.deferred) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
		} else {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(localizer(locale, "general.errors.unknown_error_title"))
						.setDescription(
							localizer(locale, "general.errors.unknown_error_description"),
						)
						.setColor(ColorCode.ERROR),
				],
			});
		}
	}
}

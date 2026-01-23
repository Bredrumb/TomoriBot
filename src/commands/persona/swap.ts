/**
 * Persona Swap Command
 * Swaps the main persona with an alter persona
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

// Constants for modal configuration
const MODAL_CUSTOM_ID = "persona_swap_modal";
const PERSONA_SELECT_ID = "persona_select";

/**
 * Configure the 'swap' subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("swap")
		.setDescription(localizer("en-US", "commands.persona.swap.description"));

/**
 * Executes the 'swap' command
 * Swaps the main persona with an alter persona
 * @param client - The Discord client instance
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
				titleKey: "commands.persona.swap.no_permission_title",
				descriptionKey: "commands.persona.swap.no_permission_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 3. Load all personas for this server
		const allPersonas = await loadAllPersonasForServer(interaction.guild.id);

		// 4. Get main and alter personas
		const mainPersona = allPersonas.find((p) => !p.is_alter);
		const alterPersonas = allPersonas.filter((p) => p.is_alter);

		// 5. Error if no alters exist
		if (alterPersonas.length === 0) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.persona.swap.no_alters_error_title",
				descriptionKey: "commands.persona.swap.no_alters_error_description",
				color: ColorCode.WARN,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Error if main persona doesn't exist (should never happen, but safety check)
		if (!mainPersona) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 6. Build select options for modal
		const alterSelectOptions: SelectOption[] = alterPersonas.map(
			(persona, index) => ({
				label: safeSelectOptionText(persona.tomori_nickname),
				value: index.toString(), // Use index to avoid truncation issues
				description: safeSelectOptionText(
					localizer(locale, "commands.persona.swap.select_description", {
						trigger_count: persona.alter_triggers?.length ?? 0,
					}),
				),
			}),
		);

		// 7. Show modal with alter selection
		const modalResult = await promptWithPaginatedModal(interaction, locale, {
			modalCustomId: MODAL_CUSTOM_ID,
			modalTitleKey: "commands.persona.swap.modal_title",
			components: [
				{
					customId: PERSONA_SELECT_ID,
					labelKey: "commands.persona.swap.select_label",
					placeholder: "commands.persona.swap.select_placeholder",
					required: true,
					options: alterSelectOptions,
				},
			],
		});

		// Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(
				`Persona swap modal ${modalResult.outcome} for user ${interaction.user.id}`,
			);
			return;
		}

		// Defer reply before long operations
		// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees interaction exists
		const modalSubmitInteraction = modalResult.interaction!;
		await modalSubmitInteraction.deferReply({ flags: MessageFlags.Ephemeral });

		// Extract selected persona from modal
		const selectedIndex = Number.parseInt(
			// biome-ignore lint/style/noNonNullAssertion: Modal submission outcome "submit" guarantees these values exist
			modalResult.values![PERSONA_SELECT_ID],
			10,
		);
		const selectedAlter = alterPersonas[selectedIndex];

		// 8. Get main persona's trigger words and alter's triggers
		const mainTriggers = mainPersona.config.trigger_words ?? [];
		const alterTriggers = selectedAlter.alter_triggers ?? [];

		// 9. Capture current bot avatar BEFORE swapping (represents former main persona)
		const formerMainAvatarUrl =
			interaction.guild.members.me?.avatarURL({ extension: "png" }) ??
			_client.user?.displayAvatarURL({ extension: "png" });

		// 10. Swap is_alter flags and trigger locations in database
		// Demote current main to alter (move triggers from config to tomoris.alter_triggers)
		await sql`
			UPDATE tomoris
			SET is_alter = true,
				alter_triggers = ${mainTriggers}
			WHERE tomori_id = ${mainPersona.tomori_id}
		`;

		// Clear main persona's triggers from config
		await sql`
			UPDATE tomori_configs
			SET trigger_words = ARRAY[]::TEXT[]
			WHERE tomori_id = ${mainPersona.tomori_id}
		`;

		// Promote selected alter to main (move triggers from tomoris.alter_triggers to config)
		await sql`
			UPDATE tomoris
			SET is_alter = false,
				alter_triggers = ARRAY[]::TEXT[]
			WHERE tomori_id = ${selectedAlter.tomori_id}
		`;

		await sql`
			UPDATE tomori_configs
			SET trigger_words = ${alterTriggers}
			WHERE tomori_id = ${selectedAlter.tomori_id}
		`;

		// 11. Try to download selected alter's avatar and set as guild avatar/nickname (non-fatal if fails)
		let avatarSwapSuccess = false;
		if (selectedAlter.webhook_avatar_url) {
			try {
				// Download the alter's avatar
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

				const avatarResponse = await fetch(selectedAlter.webhook_avatar_url, {
					signal: controller.signal,
				});
				clearTimeout(timeoutId);

				if (avatarResponse.ok) {
					const avatarArrayBuffer = await avatarResponse.arrayBuffer();
					const avatarBuffer = Buffer.from(avatarArrayBuffer);

					// Set as guild avatar using Discord API (same as /server avatar)
					const endpoint = `https://discord.com/api/v10/guilds/${interaction.guild.id}/members/@me`;
					const response = await fetch(endpoint, {
						method: "PATCH",
						headers: {
							Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							avatar: `data:image/png;base64,${avatarBuffer.toString("base64")}`,
							nick: selectedAlter.tomori_nickname,
						}),
					});

					if (response.ok) {
						avatarSwapSuccess = true;
						log.success(
							`Successfully swapped guild avatar and nickname to "${selectedAlter.tomori_nickname}" for guild ${interaction.guild.id}`,
						);
					} else {
						log.warn(
							`Failed to update guild avatar/nickname (non-fatal): ${response.status} ${response.statusText}`,
						);
					}
				} else {
					log.warn(
						`Failed to download alter avatar for swap (non-fatal): ${avatarResponse.status} ${avatarResponse.statusText}`,
					);
				}
			} catch (avatarError) {
				// Non-fatal error - persona swap was successful, avatar swap failed
				log.warn(
					`Failed to swap guild avatar/nickname during persona swap (non-fatal): ${avatarError instanceof Error ? avatarError.message : "Unknown error"}`,
				);
			}
		}

		// 12. Invalidate cache
		invalidateTomoriStateCache(interaction.guild.id);

		// 13. Show success embed with former main's avatar as thumbnail
		const successEmbed = new EmbedBuilder()
			.setTitle(localizer(locale, "commands.persona.swap.success_title"))
			.setDescription(
				localizer(locale, "commands.persona.swap.success_description", {
					new_main: selectedAlter.tomori_nickname,
					old_main: mainPersona.tomori_nickname,
				}),
			)
			.setColor(ColorCode.SUCCESS);

		// Add former main's avatar as thumbnail (if available)
		if (formerMainAvatarUrl) {
			successEmbed.setThumbnail(formerMainAvatarUrl);
		}

		// Add footer with avatar swap status
		if (avatarSwapSuccess) {
			successEmbed.setFooter({
				text: localizer(locale, "commands.persona.swap.avatar_stored_notice"),
			});
		}

		const reply = await modalSubmitInteraction.editReply({
			embeds: [successEmbed],
		});

		// 14. Extract former main's avatar URL from success embed and store it
		if (formerMainAvatarUrl) {
			try {
				const sentEmbed = reply.embeds[0];
				const storedAvatarUrl = sentEmbed?.thumbnail?.url ?? null;

				if (storedAvatarUrl) {
					// Store in former main's webhook_avatar_url
					await sql`
						UPDATE tomoris
						SET webhook_avatar_url = ${storedAvatarUrl}
						WHERE tomori_id = ${mainPersona.tomori_id}
					`;

					log.success(
						`Stored former main persona "${mainPersona.tomori_nickname}" avatar URL for future use`,
					);
				} else {
					log.warn(
						`Failed to extract thumbnail URL from success embed for former main persona ${mainPersona.tomori_id}`,
					);
				}
			} catch (storageError) {
				// Non-fatal error - persona swap was successful, avatar storage failed
				log.warn(
					`Failed to store former main persona avatar (non-fatal): ${storageError instanceof Error ? storageError.message : "Unknown error"}`,
				);
			}
		}

		log.success(
			`Successfully swapped personas: "${selectedAlter.tomori_nickname}" is now main, "${mainPersona.tomori_nickname}" is now alter for guild ${interaction.guild.id}`,
		);
	} catch (error) {
		log.error("Error executing persona swap command:", error, {
			errorType: "CommandExecutionError",
			metadata: { commandName: "persona swap" },
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

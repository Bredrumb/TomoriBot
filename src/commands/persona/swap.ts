/**
 * Persona Swap Command
 * Swaps the main persona with an alter persona
 */

import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags, EmbedBuilder, AttachmentBuilder } from "discord.js";
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
import { downloadImage } from "../../utils/image/avatarHelper";
import { sql } from "../../utils/db/client";

type DiscordApiErrorPayload = {
	message?: string;
	code?: number | string;
	errors?: {
		avatar?: { _errors?: Array<{ code?: string; message?: string }> };
		nick?: { _errors?: Array<{ code?: string; message?: string }> };
	};
};

function isAvatarUpdateRateLimited(
	status: number,
	errorText: string,
): boolean {
	if (status === 429) {
		return true;
	}

	if (!errorText) {
		return false;
	}

	try {
		const parsed = JSON.parse(errorText) as DiscordApiErrorPayload;
		const avatarErrors = parsed.errors?.avatar?._errors ?? [];
		const nickErrors = parsed.errors?.nick?._errors ?? [];
		const hasRateLimitCode = [...avatarErrors, ...nickErrors].some((error) =>
			(error.code ?? "").toString().toUpperCase().includes("RATE_LIMIT"),
		);

		if (hasRateLimitCode) {
			return true;
		}

		if (parsed.message?.toLowerCase().includes("rate limit")) {
			return true;
		}
	} catch {
		// Fall through to text matching below
	}

	return (
		/AVATAR_RATE_LIMIT/i.test(errorText) ||
		/RATE_LIMIT/i.test(errorText) ||
		/too fast/i.test(errorText)
	);
}

// Constants for modal configuration
const MODAL_CUSTOM_ID = "persona_swap_modal";
const PERSONA_SELECT_ID = "persona_select";

const formatTextArrayLiteral = (items: string[]): string =>
	`{${items.map((item) => `"${item.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;

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
			}, MessageFlags.SuppressNotifications);
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
			}, MessageFlags.SuppressNotifications);
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
			}, MessageFlags.SuppressNotifications);
			return;
		}

		// Error if main persona doesn't exist (should never happen, but safety check)
		if (!mainPersona) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
			}, MessageFlags.SuppressNotifications);
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
		await modalSubmitInteraction.deferReply();

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
		const mainTriggersArrayLiteral = formatTextArrayLiteral(mainTriggers);
		const alterTriggersArrayLiteral = formatTextArrayLiteral(alterTriggers);

		// 9. Capture current bot avatar BEFORE swapping (represents former main persona)
		const formerMainAvatarUrl =
			interaction.guild.members.me?.displayAvatarURL({
				size: 1024,
				extension: "png",
				forceStatic: true,
			}) ??
			_client.user?.displayAvatarURL({
				size: 1024,
				extension: "png",
				forceStatic: true,
			});

		// 10. Swap is_alter flags, preserve main config settings, and move trigger locations in database
		await sql.transaction(async (tx) => {
			// Ensure main config exists before copying
			const mainConfigRows = await tx`
				SELECT tomori_config_id
				FROM tomori_configs
				WHERE tomori_id = ${mainPersona.tomori_id}
				LIMIT 1
			`;

			if (mainConfigRows.length === 0) {
				throw new Error(
					`Main persona config missing for tomori_id ${mainPersona.tomori_id}`,
				);
			}

			// Copy the main config settings to the selected alter's config (upsert)
			// This keeps server-level settings intact when the main persona changes.
			await tx`
				INSERT INTO tomori_configs (
					tomori_id,
					llm_id,
					diffusion_model_id,
					llm_temperature,
					api_key,
					key_version,
					trigger_words,
					autoch_disc_ids,
					autoch_threshold,
					server_memteaching_enabled,
					attribute_memteaching_enabled,
					sampledialogue_memteaching_enabled,
					self_teaching_enabled,
					web_search_enabled,
					personal_memories_enabled,
					humanizer_degree,
					emoji_usage_enabled,
					sticker_usage_enabled,
					pin_message_enabled,
					imagegen_enabled,
					videogen_enabled,
					timezone_offset,
					system_prompt,
					cooldown_type,
					cooldown_length,
					custom_endpoint_url
				)
				SELECT
					${selectedAlter.tomori_id},
					llm_id,
					diffusion_model_id,
					llm_temperature,
					api_key,
					key_version,
					trigger_words,
					autoch_disc_ids,
					autoch_threshold,
					server_memteaching_enabled,
					attribute_memteaching_enabled,
					sampledialogue_memteaching_enabled,
					self_teaching_enabled,
					web_search_enabled,
					personal_memories_enabled,
					humanizer_degree,
					emoji_usage_enabled,
					sticker_usage_enabled,
					pin_message_enabled,
					imagegen_enabled,
					videogen_enabled,
					timezone_offset,
					system_prompt,
					cooldown_type,
					cooldown_length,
					custom_endpoint_url
				FROM tomori_configs
				WHERE tomori_id = ${mainPersona.tomori_id}
				ON CONFLICT (tomori_id) DO UPDATE SET
					llm_id = EXCLUDED.llm_id,
					diffusion_model_id = EXCLUDED.diffusion_model_id,
					llm_temperature = EXCLUDED.llm_temperature,
					api_key = EXCLUDED.api_key,
					key_version = EXCLUDED.key_version,
					trigger_words = EXCLUDED.trigger_words,
					autoch_disc_ids = EXCLUDED.autoch_disc_ids,
					autoch_threshold = EXCLUDED.autoch_threshold,
					server_memteaching_enabled = EXCLUDED.server_memteaching_enabled,
					attribute_memteaching_enabled = EXCLUDED.attribute_memteaching_enabled,
					sampledialogue_memteaching_enabled =
						EXCLUDED.sampledialogue_memteaching_enabled,
					self_teaching_enabled = EXCLUDED.self_teaching_enabled,
					web_search_enabled = EXCLUDED.web_search_enabled,
					personal_memories_enabled = EXCLUDED.personal_memories_enabled,
					humanizer_degree = EXCLUDED.humanizer_degree,
					emoji_usage_enabled = EXCLUDED.emoji_usage_enabled,
					sticker_usage_enabled = EXCLUDED.sticker_usage_enabled,
					pin_message_enabled = EXCLUDED.pin_message_enabled,
					imagegen_enabled = EXCLUDED.imagegen_enabled,
					videogen_enabled = EXCLUDED.videogen_enabled,
					timezone_offset = EXCLUDED.timezone_offset,
					system_prompt = EXCLUDED.system_prompt,
					cooldown_type = EXCLUDED.cooldown_type,
					cooldown_length = EXCLUDED.cooldown_length,
					custom_endpoint_url = EXCLUDED.custom_endpoint_url
			`;

			// Demote current main to alter (move triggers from config to tomoris.alter_triggers)
			await tx`
				UPDATE tomoris
				SET is_alter = true,
					alter_triggers = ${mainTriggersArrayLiteral}::text[]
				WHERE tomori_id = ${mainPersona.tomori_id}
			`;

			// Clear main persona's triggers from config
			await tx`
				UPDATE tomori_configs
				SET trigger_words = ARRAY[]::TEXT[]
				WHERE tomori_id = ${mainPersona.tomori_id}
			`;

			// Promote selected alter to main (move triggers from tomoris.alter_triggers to config)
			await tx`
				UPDATE tomoris
				SET is_alter = false,
					alter_triggers = ARRAY[]::TEXT[]
				WHERE tomori_id = ${selectedAlter.tomori_id}
			`;

			await tx`
				UPDATE tomori_configs
				SET trigger_words = ${alterTriggersArrayLiteral}::text[]
				WHERE tomori_id = ${selectedAlter.tomori_id}
			`;
		});

		// 11. Try to update nickname and avatar separately (non-fatal if fails)
		let avatarSwapSuccess = false;
		let avatarSwapRateLimited = false;
		let avatarSwapFailed = false;
		let nicknameSwapSuccess = false;
		let nicknameSwapRateLimited = false;
		let nicknameSwapFailed = false;
		const avatarUrl = selectedAlter.webhook_avatar_url;
		const avatarSwapAttempted = Boolean(avatarUrl);
		const endpoint = `https://discord.com/api/v10/guilds/${interaction.guild.id}/members/@me`;

		try {
			const nicknameResponse = await fetch(endpoint, {
				method: "PATCH",
				headers: {
					Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					nick: selectedAlter.tomori_nickname,
				}),
			});

			if (nicknameResponse.ok) {
				nicknameSwapSuccess = true;
			} else {
				const errorText = await nicknameResponse.text();
				if (isAvatarUpdateRateLimited(nicknameResponse.status, errorText)) {
					nicknameSwapRateLimited = true;
				}
				nicknameSwapFailed = true;
				log.warn(
					`Failed to update guild nickname during swap (non-fatal): ${nicknameResponse.status} ${nicknameResponse.statusText} - ${errorText}`,
				);
			}
		} catch (nicknameError) {
			nicknameSwapFailed = true;
			log.warn(
				`Failed to update guild nickname during swap (non-fatal): ${nicknameError instanceof Error ? nicknameError.message : "Unknown error"}`,
			);
		}

		if (avatarUrl) {
			try {
				// Download the alter's avatar
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

				const avatarResponse = await fetch(avatarUrl, {
					signal: controller.signal,
				});
				clearTimeout(timeoutId);

				if (avatarResponse.ok) {
					const avatarArrayBuffer = await avatarResponse.arrayBuffer();
					const avatarBuffer = Buffer.from(avatarArrayBuffer);

					// Set as guild avatar using Discord API (same as /server avatar)
					const response = await fetch(endpoint, {
						method: "PATCH",
						headers: {
							Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							avatar: `data:image/png;base64,${avatarBuffer.toString("base64")}`,
						}),
					});

					if (response.ok) {
						avatarSwapSuccess = true;
						log.success(
							`Successfully swapped guild avatar to "${selectedAlter.tomori_nickname}" for guild ${interaction.guild.id}`,
						);
					} else {
						const errorText = await response.text();
						if (isAvatarUpdateRateLimited(response.status, errorText)) {
							avatarSwapRateLimited = true;
						}
						avatarSwapFailed = true;
						log.warn(
							`Failed to update guild avatar (non-fatal): ${response.status} ${response.statusText} - ${errorText}`,
						);
					}
				} else {
					avatarSwapFailed = true;
					log.warn(
						`Failed to download alter avatar for swap (non-fatal): ${avatarResponse.status} ${avatarResponse.statusText}`,
					);
				}
			} catch (avatarError) {
				// Non-fatal error - persona swap was successful, avatar swap failed
				avatarSwapFailed = true;
				log.warn(
					`Failed to swap guild avatar during persona swap (non-fatal): ${avatarError instanceof Error ? avatarError.message : "Unknown error"}`,
				);
			}
		}

		// 12. Invalidate cache
		invalidateTomoriStateCache(interaction.guild.id);

		// 13. Show success embed with former main's avatar as image
		const descriptionLines = [
			localizer(locale, "commands.persona.swap.success_description", {
				new_main: selectedAlter.tomori_nickname,
				old_main: mainPersona.tomori_nickname,
			}),
		];

		if (nicknameSwapRateLimited || nicknameSwapFailed) {
			descriptionLines.push(
				localizer(locale, "commands.persona.swap.nickname_update_failed"),
			);
		} else if (nicknameSwapSuccess) {
			descriptionLines.push(
				localizer(locale, "commands.persona.swap.nickname_update_success"),
			);
		}

		if (avatarSwapRateLimited) {
			descriptionLines.push(
				localizer(locale, "commands.persona.swap.avatar_update_rate_limited"),
			);
		} else if (avatarSwapSuccess) {
			descriptionLines.push(
				localizer(locale, "commands.persona.swap.avatar_update_success"),
			);
		} else if (avatarSwapAttempted && avatarSwapFailed) {
			descriptionLines.push(
				localizer(locale, "commands.persona.swap.avatar_update_failed"),
			);
		}

		const successEmbed = new EmbedBuilder()
			.setTitle(localizer(locale, "commands.persona.swap.success_title"))
			.setDescription(descriptionLines.join("\n\n"))
			.setColor(
				avatarSwapRateLimited ||
					(avatarSwapAttempted && avatarSwapFailed) ||
					nicknameSwapRateLimited ||
					nicknameSwapFailed
					? ColorCode.WARN
					: ColorCode.SUCCESS,
			);

		let formerMainAvatarAttachment: AttachmentBuilder | null = null;
		if (formerMainAvatarUrl) {
			try {
				const avatarBuffer = await downloadImage(formerMainAvatarUrl);
				const sanitizedNickname = mainPersona.tomori_nickname
					.replace(/[^a-zA-Z0-9-_]/g, "_")
					.slice(0, 50);
				const timestamp = Date.now();
				const avatarFilename = `persona-swap-${sanitizedNickname}-${timestamp}.png`;
				formerMainAvatarAttachment = new AttachmentBuilder(avatarBuffer, {
					name: avatarFilename,
				});
				successEmbed.setImage(`attachment://${avatarFilename}`);
			} catch (downloadError) {
				log.warn(
					`Failed to download former main avatar for embed (non-fatal): ${downloadError instanceof Error ? downloadError.message : "Unknown error"}`,
				);
				successEmbed.setImage(formerMainAvatarUrl);
			}
		}

		// Add footer warning to keep embed (used for avatar URL storage)
		const embedWarning = localizer(
			locale,
			"commands.persona.swap.avatar_embed_warning",
		);
		const storedNotice = avatarSwapSuccess
			? localizer(locale, "commands.persona.swap.avatar_stored_notice")
			: "";
		const footerText = storedNotice
			? `${embedWarning} ${storedNotice}`
			: embedWarning;

		successEmbed.setFooter({ text: footerText });

		const reply = await modalSubmitInteraction.followUp({
			embeds: [successEmbed],
			files: formerMainAvatarAttachment ? [formerMainAvatarAttachment] : undefined,
			flags: MessageFlags.SuppressNotifications,
		});

		// 14. Extract former main's avatar URL from success embed and store it
		if (formerMainAvatarUrl) {
			try {
				const sentEmbed = reply.embeds[0];
				const storedAvatarUrl = sentEmbed?.image?.url ?? null;

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
						`Failed to extract image URL from success embed for former main persona ${mainPersona.tomori_id}`,
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
			}, MessageFlags.SuppressNotifications);
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

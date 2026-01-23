/**
 * Preset Import Command
 * Imports TomoriBot's personality from a PNG file with embedded metadata
 */

import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow } from "../../types/db/schema";
import {
	memoryGuard,
	IMPORT_LIMITS,
	reserveImportQuota,
} from "../../utils/security/rateLimiter";
import { invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import {
	validatePresetFile,
	importPresetData,
} from "../../utils/db/presetImport";
import type { PresetExportData } from "../../types/preset/presetExport";
import { extractMetadataFromPNG } from "../../utils/image/pngMetadata";
import { validatePNGBuffer } from "../../utils/image/avatarHelper";
import { loadAllPersonasForServer } from "../../utils/db/dbRead";
import { sql } from "../../utils/db/client";

/**
 * Maximum file size for imports (uses centralized constant)
 */
const MAX_FILE_SIZE = IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB * 1024 * 1024;

/**
 * Helper function to localize error messages from utility functions
 * Handles both simple locale keys and keys with pipe-separated variables
 * @param locale - User's locale
 * @param errorString - Error string (locale key or key|var1|var2...)
 * @returns Localized error message
 */
function localizeError(locale: string, errorString: string): string {
	const parts = errorString.split("|");
	const key = parts[0];

	if (parts.length === 1) {
		// Simple locale key without variables
		return localizer(locale, key);
	}

	// Handle keys with variables
	if (key === "commands.persona.import.error_invalid_attribute") {
		return localizer(locale, key, { details: parts[1] });
	}
	if (key === "commands.persona.import.error_invalid_dialogue_in") {
		return localizer(locale, key, { details: parts[1] });
	}
	if (key === "commands.persona.import.error_invalid_dialogue_out") {
		return localizer(locale, key, { details: parts[1] });
	}
	if (key === "commands.persona.import.error_invalid_trigger_word") {
		return localizer(locale, key, { details: parts[1] });
	}
	if (key === "commands.persona.import.error_incompatible_version") {
		return localizer(locale, key, { expected: parts[1], actual: parts[2] });
	}
	if (key === "commands.persona.import.error_invalid_type") {
		return localizer(locale, key, { type: parts[1] });
	}

	// Fallback: just localize the key
	return localizer(locale, key);
}

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

/**
 * Configure the 'import' subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("import")
		.setDescription(localizer("en-US", "commands.persona.import.description"))
		.addAttachmentOption((option) =>
			option
				.setName("file")
				.setDescription(
					localizer("en-US", "commands.persona.import.file_description"),
				)
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("type")
				.setDescription(
					localizer("en-US", "commands.persona.import.type_description"),
				)
				.setRequired(true)
				.addChoices(
					{
						name: localizer("en-US", "commands.persona.import.type_choice_main"),
						value: "main",
					},
					{
						name: localizer(
							"en-US",
							"commands.persona.import.type_choice_alter",
						),
						value: "alter",
					},
				),
		);

/**
 * Executes the 'import' command
 * Imports TomoriBot's personality from an uploaded PNG file
 * @param client - The Discord client instance
 * @param interaction - The chat input command interaction
 * @param userData - The user data for the invoking user
 * @param locale - The user's preferred locale
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	try {
		// 1. Get import type (main or alter)
		const importType = interaction.options.getString("type", true);

		// Alter personas can only be imported in guilds (not DMs)
		if (importType === "alter" && !interaction.guild) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.persona.import.alter_dm_not_allowed_title",
				descriptionKey:
					"commands.persona.import.alter_dm_not_allowed_description",
				color: ColorCode.ERROR,
			}, MessageFlags.SuppressNotifications);
			return;
		}

		// 2. Check permissions (ManageGuild required for import in guilds only)
		if (interaction.guild) {
			const hasPermission =
				interaction.memberPermissions?.has("ManageGuild") ?? false;

			if (!hasPermission) {
				await replyInfoEmbed(interaction, locale, {
					titleKey: "commands.persona.import.no_permission_title",
					descriptionKey: "commands.persona.import.no_permission_description",
					color: ColorCode.ERROR,
				}, MessageFlags.SuppressNotifications);
				return;
			}
		}

		// 3. Get uploaded file attachment
		const attachment = interaction.options.getAttachment("file", true);

		// 5. Validate file type and size
		if (!attachment.name.endsWith(".png")) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.persona.import.invalid_file_type_title",
				descriptionKey: "commands.persona.import.invalid_file_type_description",
				color: ColorCode.ERROR,
			}, MessageFlags.SuppressNotifications);
			return;
		}

		if (attachment.size > MAX_FILE_SIZE) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.persona.import.file_too_large_title",
				descriptionKey: "commands.persona.import.file_too_large_description",
				color: ColorCode.ERROR,
			}, MessageFlags.SuppressNotifications);
			return;
		}

		// 6. Defer reply while we process
		await interaction.deferReply();

		// 6.25. Reserve import operation quota (atomic check+increment for DDoS protection)
		const quotaReserve = reserveImportQuota(interaction.user.id);
		if (!quotaReserve.allowed) {
			const resetTime = quotaReserve.resetAt
				? new Date(quotaReserve.resetAt).toLocaleString(locale)
				: "unknown";

			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "rate_limit.error_quota_exceeded_title"),
						)
						.setDescription(
							localizer(locale, "rate_limit.error_quota_exceeded_description", {
								reset_time: resetTime,
							}),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		// 6.5. Memory guard check (defense-in-depth)
		const memCheck = memoryGuard.checkMemory();
		if (memCheck.status === "critical") {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "rate_limit.error_memory_critical_title"),
						)
						.setDescription(
							localizer(locale, "rate_limit.error_memory_critical_description"),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		// 7. Download the PNG file with timeout
		let pngBuffer: Buffer;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout for larger files

		try {
			const response = await fetch(attachment.url, {
				signal: controller.signal,
			});
			clearTimeout(timeoutId);

			if (!response.ok) {
				throw new Error(
					`Failed to download file: ${response.status} ${response.statusText}`,
				);
			}

			const arrayBuffer = await response.arrayBuffer();
			pngBuffer = Buffer.from(arrayBuffer);
		} catch (error) {
			clearTimeout(timeoutId);

			// Handle timeout vs other errors
			if (error instanceof Error && error.name === "AbortError") {
				log.warn("Persona import download timed out");
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(
									locale,
									"commands.persona.import.error_download_timeout",
								),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}

			// Other download errors
			log.error("Failed to download attachment:", error as Error);
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(
								locale,
								"commands.persona.import.download_failed_title",
							),
						)
						.setDescription(
							localizer(
								locale,
								"commands.persona.import.download_failed_description",
							),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		// 8. Validate PNG buffer
		const pngValidation = validatePNGBuffer(pngBuffer, MAX_FILE_SIZE);
		if (!pngValidation.isValid) {
			log.warn(
				`Invalid PNG buffer during preset import: ${pngValidation.error}`,
			);
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "commands.persona.import.invalid_png_title"),
						)
						.setDescription(
							localizer(
								locale,
								"commands.persona.import.invalid_png_description",
							),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		// 9. Extract metadata from PNG
		const metadata = extractMetadataFromPNG(pngBuffer);

		if (!metadata) {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "commands.persona.import.no_metadata_title"),
						)
						.setDescription(
							localizer(
								locale,
								"commands.persona.import.no_metadata_description",
							),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		// 10. Validate preset file structure
		const validation = validatePresetFile(metadata);

		if (!validation.valid || !validation.data) {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "commands.persona.import.invalid_file_title"),
						)
						.setDescription(
							validation.error
								? localizeError(locale, validation.error)
								: localizer(
										locale,
										"commands.persona.import.invalid_file_description",
									),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		// 11. Branch logic based on import type
		const serverDiscId = interaction.guild?.id ?? interaction.user.id;
		const isDM = !interaction.guild;

		if (importType === "main") {
			// Main persona import: replace existing main persona
			const importResult = await importPresetData(
				serverDiscId,
				validation.data as PresetExportData,
			);

			if (!importResult.success) {
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(locale, "commands.persona.import.failed_title"),
							)
							.setDescription(
								importResult.error
									? localizeError(locale, importResult.error)
									: localizer(
											locale,
											"commands.persona.import.failed_description",
										),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}

			// Invalidate cache so next message gets fresh persona/config
			invalidateTomoriStateCache(serverDiscId);

			// 12. Try to set TomoriBot's server-specific avatar and nickname (guild-only, non-fatal if fails)
			let avatarUpdateSucceeded = false;
			let avatarUpdateRateLimited = false;
			let avatarUpdateFailed = false;
			let nicknameUpdateSucceeded = false;
			let nicknameUpdateRateLimited = false;
			let nicknameUpdateFailed = false;
			if (!isDM) {
				const endpoint = `https://discord.com/api/v10/guilds/${interaction.guild.id}/members/@me`;

				// Get the imported nickname for the bot
				const importedNickname = importResult.itemsImported?.nickname;

				// Update nickname separately so avatar rate limits don't block it
				if (importedNickname) {
					try {
						const nicknameResponse = await fetch(endpoint, {
							method: "PATCH",
							headers: {
								Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								nick: importedNickname,
							}),
						});

						if (nicknameResponse.ok) {
							nicknameUpdateSucceeded = true;
						} else {
							const errorText = await nicknameResponse.text();
							if (
								isAvatarUpdateRateLimited(
									nicknameResponse.status,
									errorText,
								)
							) {
								nicknameUpdateRateLimited = true;
							}
							nicknameUpdateFailed = true;
							log.warn(
								`Failed to update bot's server nickname (non-fatal): ${nicknameResponse.status} ${nicknameResponse.statusText} - ${errorText}`,
							);
						}
					} catch (nicknameError) {
						nicknameUpdateFailed = true;
						log.warn(
							`Failed to update bot's server nickname (non-fatal): ${nicknameError instanceof Error ? nicknameError.message : "Unknown error"}`,
						);
					}
				}

				try {
					// Convert PNG buffer to base64 data URI
					const base64 = pngBuffer.toString("base64");
					const avatarDataUri = `data:image/png;base64,${base64}`;

					// Use Discord API to set bot's guild avatar
					const avatarResponse = await fetch(endpoint, {
						method: "PATCH",
						headers: {
							Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							avatar: avatarDataUri,
						}),
					});

					if (avatarResponse.ok) {
						avatarUpdateSucceeded = true;
						log.success(
							`Successfully updated TomoriBot's server avatar for ${serverDiscId} during preset import`,
						);
					} else {
						const errorText = await avatarResponse.text();
						if (isAvatarUpdateRateLimited(avatarResponse.status, errorText)) {
							avatarUpdateRateLimited = true;
						}
						avatarUpdateFailed = true;
						log.warn(
							`Failed to update bot's server avatar (non-fatal): ${avatarResponse.status} ${avatarResponse.statusText} - ${errorText}`,
						);
					}
				} catch (avatarError) {
					// Non-fatal error - personality was imported successfully
					avatarUpdateFailed = true;
					log.warn(
						`Failed to update bot's server avatar during preset import (non-fatal): ${avatarError instanceof Error ? avatarError.message : "Unknown error"}`,
					);
				}
			}

			// 13. Send success message with import summary
			const itemsImported = importResult.itemsImported;

			if (!itemsImported) {
				log.error("Import result missing itemsImported data");
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(locale, "general.errors.unknown_error_title"),
							)
							.setDescription(
								localizer(locale, "general.errors.unknown_error_description"),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}

			// Build success embed with DM-aware messaging
			const descriptionLines = [
				localizer(locale, "commands.persona.import.success_description", {
					nickname: itemsImported.nickname,
					attribute_count: itemsImported.attributeCount,
					dialogue_count: itemsImported.dialogueCount,
					trigger_word_count: itemsImported.triggerWordCount,
				}),
			];

			if (nicknameUpdateRateLimited || nicknameUpdateFailed) {
				descriptionLines.push(
					localizer(
						locale,
						"commands.persona.import.nickname_update_failed",
					),
				);
			} else if (nicknameUpdateSucceeded) {
				descriptionLines.push(
					localizer(
						locale,
						"commands.persona.import.nickname_update_success",
					),
				);
			}

			if (avatarUpdateRateLimited) {
				descriptionLines.push(
					localizer(
						locale,
						"commands.persona.import.avatar_update_rate_limited",
					),
				);
			} else if (avatarUpdateSucceeded) {
				descriptionLines.push(
					localizer(locale, "commands.persona.import.avatar_update_success"),
				);
			} else if (avatarUpdateFailed) {
				descriptionLines.push(
					localizer(locale, "commands.persona.import.avatar_update_failed"),
				);
			}

			const successEmbed = new EmbedBuilder()
				.setTitle(localizer(locale, "commands.persona.import.success_title"))
				.setDescription(descriptionLines.join("\n\n"))
				.setColor(
					isDM ||
						avatarUpdateRateLimited ||
						avatarUpdateFailed ||
						nicknameUpdateRateLimited ||
						nicknameUpdateFailed
						? ColorCode.WARN
						: ColorCode.SUCCESS,
				);

			// Add DM-specific footer if in DM
			if (isDM) {
				successEmbed.setFooter({
					text: localizer(
						locale,
						"commands.persona.import.avatar_update_skipped_dm",
					),
				});
			}

			const sanitizedNickname = itemsImported.nickname
				.replace(/[^a-zA-Z0-9-_]/g, "_")
				.slice(0, 50);
			const timestamp = Date.now();
			const avatarFilename = `persona-import-${sanitizedNickname}-${timestamp}.png`;

			// Attach avatar as image (higher quality than thumbnail)
			const avatarAttachment = new AttachmentBuilder(pngBuffer, {
				name: avatarFilename,
			});
			successEmbed.setImage(`attachment://${avatarFilename}`);

			await interaction.followUp({
				embeds: [successEmbed],
				files: [avatarAttachment],
				flags: MessageFlags.SuppressNotifications,
			});

			// Quota already reserved at step 6.25 - no increment needed
			log.success(
				`Successfully imported main persona for ${isDM ? "DM" : "guild"} ${serverDiscId}: ${itemsImported.nickname}`,
			);
		} else {
			// Alter persona import: add new alter persona
			const presetData = validation.data as PresetExportData;

			// 11a. Load all existing personas and collect their trigger words
			const allPersonas = await loadAllPersonasForServer(serverDiscId);

			// Collect all trigger words (main persona uses config.trigger_words, alters use alter_triggers)
			const allTriggerWords = new Set<string>();
			for (const persona of allPersonas) {
				if (persona.is_alter) {
					// Alter personas store triggers in alter_triggers
					for (const trigger of persona.alter_triggers ?? []) {
						allTriggerWords.add(trigger.toLowerCase());
					}
				} else {
					// Main persona stores triggers in config.trigger_words
					for (const trigger of persona.config.trigger_words ?? []) {
						allTriggerWords.add(trigger.toLowerCase());
					}
				}
			}

			// 11b. Remove overlapping triggers from the import
			const importTriggers = presetData.trigger_words ?? [];
			const uniqueTriggers = importTriggers.filter(
				(trigger) => !allTriggerWords.has(trigger.toLowerCase()),
			);

			// 11c. Error if no unique triggers remain
			if (uniqueTriggers.length === 0) {
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(
									locale,
									"commands.persona.import.alter_no_triggers_error_title",
								),
							)
							.setDescription(
								localizer(
									locale,
									"commands.persona.import.alter_no_triggers_error_description",
									{
										overlap: importTriggers.join(", "),
									},
								),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}

			// 11d. Get the main persona to copy config from
			const mainPersona = allPersonas.find((p) => !p.is_alter);
			if (!mainPersona) {
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(locale, "general.errors.tomori_not_setup_title"),
							)
							.setDescription(
								localizer(
									locale,
									"general.errors.tomori_not_setup_description",
								),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}

			// 11e. Format arrays as PostgreSQL array literals for safe insertion
			const attributeArrayLiteral = `{${presetData.attribute_list
				.map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
				.join(",")}}`;

			const dialoguesInArrayLiteral = `{${presetData.sample_dialogues_in
				.map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
				.join(",")}}`;

			const dialoguesOutArrayLiteral = `{${presetData.sample_dialogues_out
				.map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
				.join(",")}}`;

			const alterTriggersArrayLiteral = `{${uniqueTriggers
				.map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
				.join(",")}}`;

			// 11f. Insert new tomoris row with is_alter=true
			const [newAlterRow] = await sql`
				INSERT INTO tomoris (
					server_id,
					tomori_nickname,
					attribute_list,
					sample_dialogues_in,
					sample_dialogues_out,
					is_alter,
					alter_triggers
				) VALUES (
					${mainPersona.server_id},
					${presetData.tomori_nickname},
					${attributeArrayLiteral}::text[],
					${dialoguesInArrayLiteral}::text[],
					${dialoguesOutArrayLiteral}::text[],
					true,
					${alterTriggersArrayLiteral}::text[]
				)
				RETURNING tomori_id
			`;

			if (!newAlterRow?.tomori_id) {
				log.error("Failed to insert alter persona row");
				await interaction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(locale, "general.errors.unknown_error_title"),
							)
							.setDescription(
								localizer(locale, "general.errors.unknown_error_description"),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}

			const newTomoriId = newAlterRow.tomori_id;

			const sanitizedNickname = presetData.tomori_nickname
				.replace(/[^a-zA-Z0-9-_]/g, "_")
				.slice(0, 50);
			const timestamp = Date.now();
			const avatarFilename = `persona-import-alter-${sanitizedNickname}-${timestamp}.png`;

			// 11g. Send success embed with avatar image
			const alterAvatarAttachment = new AttachmentBuilder(pngBuffer, {
				name: avatarFilename,
			});

			const alterSuccessEmbed = new EmbedBuilder()
				.setTitle(
					localizer(locale, "commands.persona.import.alter_success_title"),
				)
				.setDescription(
					localizer(
						locale,
						"commands.persona.import.alter_success_description",
						{
							nickname: presetData.tomori_nickname,
							trigger_count: uniqueTriggers.length,
							triggers: uniqueTriggers.join(", "),
						},
					),
				)
				.setColor(ColorCode.SUCCESS)
				.setImage(`attachment://${avatarFilename}`)
				.setFooter({
					text: localizer(
						locale,
						"commands.persona.import.alter_avatar_warning",
					),
				});

			const reply = await interaction.followUp({
				embeds: [alterSuccessEmbed],
				files: [alterAvatarAttachment],
				flags: MessageFlags.SuppressNotifications,
			});

			// 11h. Extract avatar URL from the sent message
			// The image URL is accessible from the sent message's embed
			const sentEmbed = reply.embeds[0];
			const avatarUrl = sentEmbed?.image?.url ?? null;

			// 11i. Store avatar URL in webhook_avatar_url column
			if (avatarUrl) {
				await sql`
					UPDATE tomoris
					SET webhook_avatar_url = ${avatarUrl}
					WHERE tomori_id = ${newTomoriId}
				`;
			} else {
				log.warn(
					`Failed to extract avatar URL from embed for alter persona ${newTomoriId}`,
				);
			}

			// 11j. Invalidate cache
			invalidateTomoriStateCache(serverDiscId);

			log.success(
				`Successfully imported alter persona "${presetData.tomori_nickname}" with ${uniqueTriggers.length} triggers for guild ${serverDiscId}`,
			);
		}
	} catch (error) {
		log.error("Error executing preset import command:", error, {
			errorType: "CommandExecutionError",
			metadata: { commandName: "preset import" },
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

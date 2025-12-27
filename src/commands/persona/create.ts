/**
 * Preset Create Command
 * Manual personality creation with simple form fields
 */

import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { AttachmentBuilder, MessageFlags, EmbedBuilder } from "discord.js";
import { TextInputStyle } from "discord.js";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithRawModal,
} from "../../utils/discord/interactionHelper";
import type { UserRow } from "../../types/db/schema";
import {
	memoryGuard,
	PERSONA_LIMITS,
	reservePersonaQuota,
} from "../../utils/security/rateLimiter";
import {
	getMemoryLimits,
	validateAttribute,
	validateSampleDialogue,
} from "../../utils/db/memoryLimits";
import { safeDownload } from "../../utils/security/safeDownload";
import { getServerAvatar } from "../../utils/image/avatarHelper";
import { centerCropToSquare } from "../../utils/image/imageProcessor";
import { embedMetadataInPNG } from "../../utils/image/pngMetadata";
import {
	presetExportDataSchema,
	PRESET_EXPORT_VERSION,
} from "../../types/preset/presetExport";
import type {
	PresetExport,
	PresetExportData,
} from "../../types/preset/presetExport";
import type { ModalComponent } from "../../types/discord/modal";

// Get memory limits from environment variables
const memoryLimits = getMemoryLimits();

// Modal constants
const MODAL_CUSTOM_ID = "preset_create_modal";
const CHARACTER_NAME_ID = "character_name";
const CHARACTER_DESC_ID = "character_desc";
const EXAMPLE_USER_ID = "example_user";
const EXAMPLE_BOT_ID = "example_bot";
const FILE_UPLOAD_ID = "avatar_image";

/**
 * Configure the 'create' subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("create")
		.setDescription(localizer("en-US", "commands.persona.create.description"));

/**
 * Executes the 'create' command
 * Manual personality creation with simple form input
 *
 * @param client - The Discord client instance
 * @param interaction - The chat input command interaction
 * @param _userData - The user data for the invoking user
 * @param locale - The user's preferred locale
 */
export async function execute(
	client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	try {
		// 1. Check if command is run in a guild (server-only command)
		if (!interaction.guild) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.guild_only_title",
				descriptionKey: "general.errors.guild_only_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 2. Show modal with creation fields
		const modalComponents: ModalComponent[] = [
			{
				customId: CHARACTER_NAME_ID,
				labelKey: "commands.persona.create.modal.character_name_label",
				descriptionKey:
					"commands.persona.create.modal.character_name_description",
				placeholder: "commands.persona.create.modal.character_name_placeholder",
				required: true,
				style: TextInputStyle.Short,
				maxLength: 100,
			},
			{
				customId: CHARACTER_DESC_ID,
				labelKey: "commands.persona.create.modal.character_desc_label",
				placeholder: "commands.persona.create.modal.character_desc_placeholder",
				required: true,
				style: TextInputStyle.Paragraph,
				maxLength: memoryLimits.maxAttributeLength, // Use runtime config limit (default: 2000)
			},
			{
				customId: EXAMPLE_USER_ID,
				labelKey: "commands.persona.create.modal.example_user_label",
				descriptionKey:
					"commands.persona.create.modal.example_user_description",
				placeholder: "commands.persona.create.modal.example_user_placeholder",
				required: false,
				style: TextInputStyle.Paragraph,
				maxLength: memoryLimits.maxSampleDialogueLength, // Use runtime config limit (default: 2000)
			},
			{
				customId: EXAMPLE_BOT_ID,
				labelKey: "commands.persona.create.modal.example_bot_label",
				placeholder: "commands.persona.create.modal.example_bot_placeholder",
				required: false,
				style: TextInputStyle.Paragraph,
				maxLength: memoryLimits.maxSampleDialogueLength, // Use runtime config limit (default: 2000)
			},
			{
				customId: FILE_UPLOAD_ID,
				labelKey: "commands.persona.create.modal.file_upload_label",
				descriptionKey: "commands.persona.create.modal.file_upload_description",
				minValues: 0,
				maxValues: 1,
				required: false,
			},
		];

		const modalResult = await promptWithRawModal(
			interaction,
			locale,
			{
				modalCustomId: MODAL_CUSTOM_ID,
				modalTitleKey: "commands.persona.create.modal.title",
				components: modalComponents,
			},
			true, // Auto-defer with public reply
		);

		// 4. Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(`Create modal ${modalResult.outcome}`);
			return;
		}

		const modalSubmitInteraction = modalResult.interaction;
		const characterName = modalResult.values?.[CHARACTER_NAME_ID];
		const characterDesc = modalResult.values?.[CHARACTER_DESC_ID];
		const exampleUser = modalResult.values?.[EXAMPLE_USER_ID];
		const exampleBot = modalResult.values?.[EXAMPLE_BOT_ID];

		// Safety checks (only character name and description are required)
		if (!modalSubmitInteraction || !characterName || !characterDesc) {
			log.error("Modal result unexpectedly missing required values");
			return;
		}

		// 5. Validate content lengths (server-side validation, modal maxLength can be bypassed)
		const descValidation = validateAttribute(characterDesc);
		if (!descValidation.isValid) {
			await modalSubmitInteraction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(
								locale,
								"commands.persona.create.desc_too_long_title",
							),
						)
						.setDescription(
							localizer(
								locale,
								"commands.persona.create.desc_too_long_description",
								{
									current_length: characterDesc.length.toString(),
									max_allowed: (descValidation.maxAllowed || memoryLimits.maxAttributeLength).toString(),
								},
							),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		// Validate optional example user dialogue
		if (exampleUser) {
			const userDialogueValidation = validateSampleDialogue(exampleUser);
			if (!userDialogueValidation.isValid) {
				await modalSubmitInteraction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(
									locale,
									"commands.persona.create.example_user_too_long_title",
								),
							)
							.setDescription(
								localizer(
									locale,
									"commands.persona.create.example_user_too_long_description",
									{
										current_length: exampleUser.length.toString(),
										max_allowed: (userDialogueValidation.maxAllowed || memoryLimits.maxSampleDialogueLength).toString(),
									},
								),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}
		}

		// Validate optional example bot dialogue
		if (exampleBot) {
			const botDialogueValidation = validateSampleDialogue(exampleBot);
			if (!botDialogueValidation.isValid) {
				await modalSubmitInteraction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(
									locale,
									"commands.persona.create.example_bot_too_long_title",
								),
							)
							.setDescription(
								localizer(
									locale,
									"commands.persona.create.example_bot_too_long_description",
									{
										current_length: exampleBot.length.toString(),
										max_allowed: (botDialogueValidation.maxAllowed || memoryLimits.maxSampleDialogueLength).toString(),
									},
								),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}
		}

		// 6. Reserve persona operation quota (atomic check+increment for DDoS protection)
		const quotaReserve = reservePersonaQuota(interaction.user.id);
		if (!quotaReserve.allowed) {
			const resetTime = quotaReserve.resetAt
				? new Date(quotaReserve.resetAt).toLocaleString(locale)
				: "unknown";

			await modalSubmitInteraction.editReply({
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

		// 6. Get optional image attachment from modal
		const imageAttachment = modalResult.attachments?.[FILE_UPLOAD_ID];
		let imageBuffer: Buffer | undefined;

		if (imageAttachment) {
			// Early memory guard check
			const memCheck = memoryGuard.checkMemory();
			if (memCheck.status === "critical") {
				// Preserve modal inputs for user convenience
				const embed = new EmbedBuilder()
					.setTitle(localizer(locale, "rate_limit.error_memory_critical_title"))
					.setDescription(
						localizer(locale, "rate_limit.error_memory_critical_description"),
					)
					.setColor(ColorCode.ERROR);

				// Add modal inputs as fields (excluding image)
				const memoryErrorFields = [
					{
						name: localizer(
							locale,
							"commands.persona.create.field_character_name",
						),
						value: characterName.substring(0, 1024) || "N/A",
						inline: false,
					},
					{
						name: localizer(
							locale,
							"commands.persona.create.field_character_desc",
						),
						value: characterDesc.substring(0, 1024) || "N/A",
						inline: false,
					},
				];

				// Only add sample dialogue fields if they were provided
				if (exampleUser) {
					memoryErrorFields.push({
						name: localizer(
							locale,
							"commands.persona.create.field_example_user",
						),
						value: exampleUser.substring(0, 1024) || "N/A",
						inline: false,
					});
				}
				if (exampleBot) {
					memoryErrorFields.push({
						name: localizer(
							locale,
							"commands.persona.create.field_example_bot",
						),
						value: exampleBot.substring(0, 1024) || "N/A",
						inline: false,
					});
				}

				embed.addFields(memoryErrorFields);

				await modalSubmitInteraction.editReply({
					embeds: [embed],
				});
				return;
			}

			// Validate image type
			if (!imageAttachment.content_type?.startsWith("image/")) {
				await modalSubmitInteraction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(
									locale,
									"commands.persona.create.invalid_image_title",
								),
							)
							.setDescription(
								localizer(
									locale,
									"commands.persona.create.invalid_image_description",
								),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}

			// Download image with safeDownload
			const downloadResult = await safeDownload(imageAttachment.url, {
				maxSizeMB: PERSONA_LIMITS.MAX_AVATAR_SIZE_MB,
				timeoutMs: 10000,
				knownSize: imageAttachment.size,
			});

			if (!downloadResult.success) {
				// Handle different error types with localized messages
				let errorKey: string;
				if (downloadResult.error === "size_exceeded") {
					errorKey = "commands.persona.create.error_file_too_large";
				} else if (downloadResult.error === "timeout") {
					errorKey = "commands.persona.create.error_download_timeout";
				} else {
					errorKey = "commands.persona.create.error_download_failed";
				}

				await modalSubmitInteraction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(localizer(locale, errorKey))
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}

			imageBuffer = downloadResult.buffer;
			log.info("Image attachment downloaded successfully");
		}

		// 6. Create minimal preset data structure
		// Only include sample dialogues if BOTH fields have content
		const hasSampleDialogue = exampleUser?.trim() && exampleBot?.trim();

		const presetData: PresetExportData = {
			tomori_nickname: characterName,
			attribute_list: [characterDesc],
			// biome-ignore lint/style/noNonNullAssertion: Both or neither has to exist
			sample_dialogues_in: hasSampleDialogue ? [exampleUser!] : [],
			// biome-ignore lint/style/noNonNullAssertion: Both or neither has to exist
			sample_dialogues_out: hasSampleDialogue ? [exampleBot!] : [],
			trigger_words: [],
		};

		// 7. Validate preset data against schema
		const validationResult = presetExportDataSchema.safeParse(presetData);
		if (!validationResult.success) {
			// Log detailed validation errors
			log.error("Created preset failed validation:");
			log.error(
				"Validation errors:",
				JSON.stringify(validationResult.error.format(), null, 2),
			);
			log.error("Preset data:", JSON.stringify(presetData, null, 2));

			// Extract specific error messages for user
			const errorDetails = validationResult.error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("\n");

			await modalSubmitInteraction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(
								locale,
								"commands.persona.create.validation_failed_title",
							),
						)
						.setDescription(
							`${localizer(
								locale,
								"commands.persona.create.validation_failed_description",
							)}\n\n**Details:**\n\`\`\`\n${errorDetails.substring(0, 500)}\n\`\`\``,
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		log.success("Created preset passed validation");

		// 8. Get image for export (uploaded image or server avatar)
		let pngBuffer: Buffer;

		if (imageBuffer) {
			// Use uploaded image
			try {
				pngBuffer = await centerCropToSquare(imageBuffer);
				log.info("Uploaded image cropped to 1:1 square");
			} catch (error) {
				log.error("Failed to process uploaded image:", error);
				await modalSubmitInteraction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(
									locale,
									"commands.persona.create.image_processing_failed_title",
								),
							)
							.setDescription(
								localizer(
									locale,
									"commands.persona.create.image_processing_failed_description",
								),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}
		} else {
			// Use server avatar
			try {
				const avatarBuffer = await getServerAvatar(interaction.guild, client);
				pngBuffer = await centerCropToSquare(avatarBuffer);
				log.info("Server avatar cropped to 1:1 square");
			} catch (error) {
				log.error("Failed to get server avatar:", error);
				await modalSubmitInteraction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(
									locale,
									"commands.persona.create.avatar_fetch_failed_title",
								),
							)
							.setDescription(
								localizer(
									locale,
									"commands.persona.create.avatar_fetch_failed_description",
								),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}
		}

		// 9. Create preset export structure with metadata
		const presetExport: PresetExport = {
			version: PRESET_EXPORT_VERSION,
			type: "preset",
			exported_at: new Date().toISOString(),
			data: presetData,
		};

		// 10. Embed metadata in PNG
		let finalPngBuffer: Buffer;
		try {
			finalPngBuffer = await embedMetadataInPNG(pngBuffer, presetExport);
			log.success("Metadata embedded in PNG");
		} catch (error) {
			log.error("Failed to embed metadata in PNG:", error);
			await modalSubmitInteraction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(
								locale,
								"commands.persona.create.metadata_embed_failed_title",
							),
						)
						.setDescription(
							localizer(
								locale,
								"commands.persona.create.metadata_embed_failed_description",
							),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		// 11. Create attachment
		const filename = `${characterName.replace(/[^a-zA-Z0-9]/g, "_")}_preset.png`;
		const attachment = new AttachmentBuilder(finalPngBuffer, {
			name: filename,
		});

		// 12. Detect DM context and create success embed with all created content
		const isDM = !interaction.guild;

		// Truncate description if too long for embed
		const descriptionPreview =
			characterDesc.length > 200
				? `${characterDesc.substring(0, 200)}...`
				: characterDesc;

		// Build embed fields array
		const embedFields = [];

		// Only add dialogue field if sample dialogues were provided
		if (hasSampleDialogue && exampleUser && exampleBot) {
			// Truncate dialogue examples if too long
			const userPreview =
				exampleUser.length > 100
					? `${exampleUser.substring(0, 100)}...`
					: exampleUser;
			const botPreview =
				exampleBot.length > 100
					? `${exampleBot.substring(0, 100)}...`
					: exampleBot;

			embedFields.push({
				name: localizer(
					locale,
					"commands.persona.create.success_dialogue_title",
				),
				value: `**User:** ${userPreview}\n**Bot:** ${botPreview}`,
				inline: false,
			});
		}

		// Add next steps field
		embedFields.push({
			name: localizer(
				locale,
				"commands.persona.create.success_next_steps_title",
			),
			value: localizer(
				locale,
				"commands.persona.create.success_next_steps_description",
			),
			inline: false,
		});

		const successEmbed = new EmbedBuilder()
			.setTitle(
				localizer(locale, "commands.persona.create.success_title", {
					character_name: characterName,
				}),
			)
			.setDescription(
				localizer(locale, "commands.persona.create.success_description", {
					character_name: characterName,
					character_description: descriptionPreview,
				}),
			)
			.setColor(isDM ? ColorCode.WARN : ColorCode.SUCCESS)
			.setImage(`attachment://${filename}`)
			.addFields(embedFields);

		// Add DM-specific footer if in DM
		if (isDM) {
			successEmbed.setFooter({
				text: localizer(
					locale,
					"commands.persona.create.avatar_update_skipped_dm",
				),
			});
		}

		// 13. Send success embed with attachment
		await modalSubmitInteraction.editReply({
			embeds: [successEmbed],
			files: [attachment],
		});

		// Quota already reserved at step 5 - no increment needed
		log.success(`Preset created successfully for: ${characterName}`);
	} catch (error) {
		log.error("Error in preset create command:", error);
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";

		// Try to send error embed if possible
		try {
			const errorEmbed = new EmbedBuilder()
				.setTitle(localizer(locale, "general.errors.unexpected_title"))
				.setDescription(
					localizer(locale, "general.errors.unexpected_description", {
						error: errorMessage,
					}),
				)
				.setColor(ColorCode.ERROR);

			if (interaction.deferred || interaction.replied) {
				await interaction.editReply({ embeds: [errorEmbed] });
			} else {
				await interaction.reply({
					embeds: [errorEmbed],
					flags: MessageFlags.Ephemeral,
				});
			}
		} catch {
			// If we can't send the error embed, just log it
			log.error("Failed to send error embed");
		}
	}
}

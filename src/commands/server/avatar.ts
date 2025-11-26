import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
	Attachment,
} from "discord.js";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../types/db/schema";
import { safeDownload } from "../../utils/security/safeDownload";
import {
	memoryGuard,
	checkAvatarQuota,
	incrementAvatarQuota,
} from "../../utils/security/rateLimiter";

/**
 * Configure the avatar subcommand
 * @param subcommand - SlashCommandSubcommandBuilder instance
 * @returns Configured subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("avatar")
		.setDescription(localizer("en-US", "commands.server.avatar.description"))
		.addAttachmentOption((option) =>
			option
				.setName("image")
				.setDescription(
					localizer("en-US", "commands.server.avatar.image_description"),
				)
				.setRequired(false),
		);

/**
 * Validates if the provided attachment is a valid image
 * @param attachment - Discord attachment to validate
 * @returns Object with isValid boolean and error message if invalid
 */
function validateImage(attachment: Attachment): {
	isValid: boolean;
	error?: string;
} {
	// 1. Check file size (Discord's limit is 8MB for bots)
	const maxSize = 8 * 1024 * 1024; // 8MB in bytes
	if (attachment.size > maxSize) {
		return {
			isValid: false,
			error: "FILE_TOO_LARGE",
		};
	}

	// 2. Check content type
	const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/gif"];
	if (
		!attachment.contentType ||
		!allowedTypes.includes(attachment.contentType)
	) {
		return {
			isValid: false,
			error: "INVALID_FORMAT",
		};
	}

	// 3. Check file extension as backup validation
	const allowedExtensions = [".png", ".jpg", ".jpeg", ".gif"];
	const fileExtension = attachment.name?.toLowerCase().split(".").pop();
	if (!fileExtension || !allowedExtensions.includes(`.${fileExtension}`)) {
		return {
			isValid: false,
			error: "INVALID_EXTENSION",
		};
	}

	return { isValid: true };
}

/**
 * Converts an image attachment to a base64 data URI with timeout protection
 * @param attachment - Discord attachment to convert
 * @returns Promise resolving to SafeDownloadResult-like object with dataUri or error
 */
async function attachmentToBase64DataUri(attachment: Attachment): Promise<{
	success: boolean;
	dataUri?: string;
	error?: "size_exceeded" | "timeout" | "network_error" | "invalid_response";
	details?: string;
}> {
	// 1. Use safeDownload with 15s timeout and 8MB size limit
	const downloadResult = await safeDownload(attachment.url, {
		maxSizeMB: 8,
		timeoutMs: 15000, // 15 seconds
		knownSize: attachment.size,
	});

	// 2. If download failed, return error
	if (!downloadResult.success) {
		return {
			success: false,
			error: downloadResult.error,
			details: downloadResult.details,
		};
	}

	// 3. Convert buffer to base64 data URI
	const base64 = downloadResult.buffer?.toString("base64");
	const mimeType = attachment.contentType || "image/png";
	const dataUri = `data:${mimeType};base64,${base64}`;

	return {
		success: true,
		dataUri,
	};
}

/**
 * Updates the bot's guild avatar using Discord's raw API with timeout protection
 * @param guildId - Guild ID where to update the avatar
 * @param avatarDataUri - Base64 data URI of the avatar image, or null to remove
 * @returns Promise resolving to object with success status and optional error type
 */
async function updateGuildAvatar(
	guildId: string,
	avatarDataUri: string | null,
): Promise<{
	success: boolean;
	error?: "timeout" | "api_error";
	details?: string;
}> {
	// 1. Setup timeout controller (15s)
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 15000);

	try {
		// 2. Prepare the API endpoint
		const endpoint = `https://discord.com/api/v10/guilds/${guildId}/members/@me`;

		// 3. Prepare the payload
		const payload = {
			avatar: avatarDataUri,
		};

		// 4. Make the API call with timeout
		const response = await fetch(endpoint, {
			method: "PATCH",
			headers: {
				Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			const errorText = await response.text();
			log.error(
				`Failed to update guild avatar: ${response.status} ${response.statusText} - ${errorText}`,
			);
			return {
				success: false,
				error: "api_error",
				details: `${response.status} ${response.statusText}`,
			};
		}

		return { success: true };
	} catch (error) {
		clearTimeout(timeoutId);

		// Handle abort (timeout)
		if (error instanceof Error && error.name === "AbortError") {
			log.warn("Discord API call timed out after 15s", {
				metadata: { guildId },
			});
			return {
				success: false,
				error: "timeout",
				details: "Discord API call timed out after 15s",
			};
		}

		// Handle other errors
		log.error("Error updating guild avatar via Discord API", error);
		return {
			success: false,
			error: "api_error",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Sets or removes TomoriBot's custom avatar for the current guild
 * @param client - Discord client instance
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

	// 2. Defer the reply to prevent timeout during image processing
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	try {
		// 3. Memory guard check (defense-in-depth)
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

		// 4. Check quota (per-server, volume-based DDoS protection)
		const quotaCheck = checkAvatarQuota(interaction.guild.id);
		if (!quotaCheck.allowed) {
			const resetTime = quotaCheck.resetAt
				? new Date(quotaCheck.resetAt).toLocaleString(locale)
				: "unknown";

			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "rate_limit.error_quota_exceeded_title"),
						)
						.setDescription(
							localizer(locale, "rate_limit.error_quota_exceeded_description", {
								current: String(quotaCheck.current || 0),
								max: String(quotaCheck.max || 0),
								reset_time: resetTime,
							}),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		// 5. Get the attachment option
		const imageAttachment = interaction.options.getAttachment("image");

		// 6. Handle avatar removal (no attachment provided)
		if (!imageAttachment) {
			const result = await updateGuildAvatar(interaction.guild.id, null);

			if (result.success) {
				// Increment quota after successful removal
				incrementAvatarQuota(interaction.guild.id);

				await replyInfoEmbed(interaction, locale, {
					titleKey: "commands.server.avatar.removed_title",
					descriptionKey: "commands.server.avatar.removed_description",
					color: ColorCode.SUCCESS,
				});
			} else if (result.error === "timeout") {
				await replyInfoEmbed(interaction, locale, {
					titleKey: "commands.server.avatar.error_api_timeout",
					descriptionKey: "commands.server.avatar.error_api_timeout",
					color: ColorCode.ERROR,
				});
			} else {
				await replyInfoEmbed(interaction, locale, {
					titleKey: "commands.server.avatar.api_error_title",
					descriptionKey: "commands.server.avatar.api_error_description",
					color: ColorCode.ERROR,
				});
			}
			return;
		}

		// 5. Validate the image attachment
		const validation = validateImage(imageAttachment);
		if (!validation.isValid) {
			let errorKey = "invalid_image_description";
			switch (validation.error) {
				case "FILE_TOO_LARGE":
					errorKey = "file_too_large_description";
					break;
				case "INVALID_FORMAT":
				case "INVALID_EXTENSION":
					errorKey = "invalid_format_description";
					break;
			}

			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.server.avatar.invalid_image_title",
				descriptionKey: `commands.server.avatar.${errorKey}`,
				color: ColorCode.ERROR,
			});
			return;
		}

		// 7. Convert image to base64 data URI with timeout protection
		const downloadResult = await attachmentToBase64DataUri(imageAttachment);
		if (!downloadResult.success) {
			let errorKey: string;
			if (downloadResult.error === "size_exceeded") {
				errorKey = "commands.server.avatar.file_too_large_description";
			} else if (downloadResult.error === "timeout") {
				errorKey = "commands.server.avatar.error_download_timeout";
			} else {
				errorKey = "commands.server.avatar.conversion_error_description";
			}

			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.server.avatar.invalid_image_title",
				descriptionKey: errorKey,
				color: ColorCode.ERROR,
			});
			return;
		}

		// biome-ignore lint/style/noNonNullAssertion: Download result is checked in success condition
		const avatarDataUri = downloadResult.dataUri!;

		// 8. Update the guild avatar via Discord API with timeout protection
		const updateResult = await updateGuildAvatar(
			interaction.guild.id,
			avatarDataUri,
		);

		if (updateResult.success) {
			// Increment quota after successful avatar update
			incrementAvatarQuota(interaction.guild.id);

			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.server.avatar.success_title",
				descriptionKey: "commands.server.avatar.success_description",
				color: ColorCode.SUCCESS,
			});
		} else if (updateResult.error === "timeout") {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.server.avatar.error_api_timeout",
				descriptionKey: "commands.server.avatar.error_api_timeout",
				color: ColorCode.ERROR,
			});
		} else {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.server.avatar.api_error_title",
				descriptionKey: "commands.server.avatar.api_error_description",
				color: ColorCode.ERROR,
			});
		}
	} catch (error) {
		const context: ErrorContext = {
			errorType: "CommandExecutionError",
			metadata: {
				command: "config avatar",
				guildId: interaction.guild.id,
			},
		};
		await log.error("Error in /config avatar command", error, context);

		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
		});
	}
}

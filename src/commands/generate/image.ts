/**
 * Image Generation Command
 * Allows users to generate AI images using Google Gemini or OpenRouter
 * Supports text-to-image and image-to-image generation with up to 10 reference images
 */

import {
	MessageFlags,
	TextInputStyle,
	EmbedBuilder,
	AttachmentBuilder,
	type ChatInputCommandInteraction,
	type Client,
	type SlashCommandSubcommandBuilder,
	type APIAttachment,
} from "discord.js";
import { GoogleGenAI } from "@google/genai";
import { log, ColorCode } from "../../utils/misc/logger";
import { localizer } from "../../utils/text/localizer";
import { loadTomoriState } from "../../utils/db/dbRead";
import { sql } from "../../utils/db/client";
import { decryptApiKey } from "../../utils/security/crypto";
import {
	replyInfoEmbed,
	promptWithRawModal,
} from "../../utils/discord/interactionHelper";
import type { UserRow } from "../../types/db/schema";

// Modal configuration constants
const MODAL_CUSTOM_ID = "generate_image_modal";
const PROMPT_INPUT_ID = "prompt_input";
const IMAGE_UPLOAD_ID = "image_upload";
const ASPECT_RATIO_SELECT_ID = "aspect_ratio_select";

/**
 * Configure the subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("image")
		.setDescription(localizer("en-US", "commands.generate.image.description"));

/**
 * Get the diffusion model codename from the database
 * @param diffusionModelId - Database ID of the diffusion model
 * @returns The model codename string (e.g., "gemini-2.5-flash-image")
 */
async function getDiffusionModelCodename(
	diffusionModelId: number,
): Promise<string> {
	const result = await sql`
		SELECT codename
		FROM image_diffusion_models
		WHERE diffusion_model_id = ${diffusionModelId}
	`.values();

	if (result.length === 0) {
		throw new Error(`Diffusion model not found: ${diffusionModelId}`);
	}

	return result[0][0] as string;
}

/**
 * Convert a Discord attachment to base64 format for image generation API
 * @param attachment - Discord API attachment object
 * @returns Object with mimeType and base64 data
 */
async function convertAttachmentToBase64(
	attachment: APIAttachment,
): Promise<{ mimeType: string; data: string }> {
	// 1. Validate image MIME type
	if (!attachment.content_type?.startsWith("image/")) {
		throw new Error(`Invalid image type: ${attachment.content_type}`);
	}

	// 2. Fetch image from Discord CDN
	const response = await fetch(attachment.url);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch image: ${response.status} ${response.statusText}`,
		);
	}

	// 3. Convert to base64
	const arrayBuffer = await response.arrayBuffer();
	const base64Data = Buffer.from(arrayBuffer).toString("base64");

	log.info(
		`Converted attachment ${attachment.id} (${attachment.filename}) to base64`,
	);

	return {
		mimeType: attachment.content_type,
		data: base64Data,
	};
}

/**
 * Generate image using OpenRouter API
 * @param apiKey - Decrypted API key
 * @param modelCodename - Model codename (e.g., "google/gemini-2.5-flash-image")
 * @param prompt - Text prompt for image generation
 * @param aspectRatio - Aspect ratio (e.g., "16:9")
 * @param referenceImages - Optional array of reference images for img2img
 * @returns Promise resolving to generated image data and mimeType
 */
async function generateImageWithOpenRouter(
	apiKey: string,
	modelCodename: string,
	prompt: string,
	aspectRatio: string,
	referenceImages?: Array<{ mimeType: string; data: string }>,
): Promise<{ imageData: string | null; mimeType: string | null }> {
	log.info(
		`[OpenRouter] Sending image request to model "${modelCodename}" (aspect ratio: ${aspectRatio}, refs: ${referenceImages?.length ?? 0})`,
	);

	// Build content array with text prompt first (OpenRouter recommendation)
	const contentParts: Array<{
		type: string;
		text?: string;
		image_url?: { url: string };
	}> = [{ type: "text", text: prompt }];

	// Add reference images if provided (for img2img)
	if (referenceImages && referenceImages.length > 0) {
		for (const img of referenceImages) {
			contentParts.push({
				type: "image_url",
				image_url: {
					url: `data:${img.mimeType};base64,${img.data}`,
				},
			});
		}
		log.info(
			`[OpenRouter] Added ${referenceImages.length} reference image(s) to content array`,
		);
	}

	// Prepare request payload
	const requestPayload = {
		model: modelCodename,
		messages: [
			{
				role: "user",
				content: contentParts,
			},
		],
		modalities: ["image", "text"],
		image_config: {
			aspect_ratio: aspectRatio,
		},
	};

	// Call OpenRouter API
	const response = await fetch(
		"https://openrouter.ai/api/v1/chat/completions",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(requestPayload),
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		const bodySnippet = errorText.slice(0, 500);

		// Try to extract human-readable message
		let parsedMessage = "";
		try {
			const parsed = JSON.parse(errorText);
			parsedMessage =
				(parsed?.error?.message as string | undefined) ||
				(parsed?.message as string | undefined) ||
				"";
		} catch {
			// Ignore JSON parse errors
		}

		const friendlyMessage =
			parsedMessage ||
			bodySnippet ||
			`${response.status} ${response.statusText}`.trim();

		throw new Error(
			`OpenRouter API request failed (${response.status} ${response.statusText}): ${friendlyMessage}`,
		);
	}

	const result = await response.json();

	// Extract image from response
	if (result.choices?.[0]?.message?.images) {
		const firstImage = result.choices[0].message.images[0];
		// OpenRouter may return either snake_case (image_url) or camelCase (imageUrl)
		const dataUrl =
			firstImage?.image_url?.url || firstImage?.imageUrl?.url || null;

		if (dataUrl) {
			// OpenRouter returns data URLs like "data:image/png;base64,..."
			const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

			if (matches) {
				return {
					imageData: matches[2], // Base64 data
					mimeType: matches[1], // MIME type
				};
			}
		}
	}

	return { imageData: null, mimeType: null };
}

/**
 * Execute the image generation command
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param _userData - User data from database
 * @param locale - User's locale
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	// 1. Ensure command is run in a channel context
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 2. Load TomoriState for this server/user
	const serverId = interaction.guild?.id ?? interaction.user.id;
	const tomoriState = await loadTomoriState(serverId);

	// 3. Validate TomoriState exists
	if (!tomoriState) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.tomori_not_setup_title",
			descriptionKey: "general.errors.tomori_not_setup_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 4. Validate provider is Google or OpenRouter
	const provider = tomoriState.llm.llm_provider.toLowerCase();
	if (provider !== "google" && provider !== "openrouter") {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.generate.image.wrong_provider_title",
			descriptionKey: "commands.generate.image.wrong_provider_description",
			descriptionVars: {
				current_provider: tomoriState.llm.llm_provider,
			},
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 5. Validate API key exists
	const encryptedApiKey = tomoriState.config.api_key;
	const keyVersion = tomoriState.config.key_version || 1;

	if (!encryptedApiKey) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.generate.image.no_api_key_title",
			descriptionKey: "commands.generate.image.no_api_key_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 6. Decrypt API key
	const apiKey = await decryptApiKey(encryptedApiKey, keyVersion);

	if (!apiKey) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.generate.image.api_key_decrypt_failed_title",
			descriptionKey:
				"commands.generate.image.api_key_decrypt_failed_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 7. Validate diffusion model is configured
	const diffusionModelId = tomoriState.config.diffusion_model_id;

	if (!diffusionModelId) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.generate.image.no_diffusion_model_title",
			descriptionKey:
				"commands.generate.image.no_diffusion_model_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// Track modal submit interaction for error handling in catch block
	let modalSubmitInteraction:
		| import("discord.js").ModalSubmitInteraction
		| undefined;

	try {
		// 8. Build modal components
		const modalComponents = [
			{
				customId: PROMPT_INPUT_ID,
				labelKey: "commands.generate.image.modal.prompt_label",
				descriptionKey: "commands.generate.image.modal.prompt_description",
				placeholder: "commands.generate.image.modal.prompt_placeholder",
				required: true,
				style: TextInputStyle.Paragraph,
				maxLength: 2000,
			},
			{
				customId: IMAGE_UPLOAD_ID,
				labelKey: "commands.generate.image.modal.image_upload_label",
				descriptionKey:
					"commands.generate.image.modal.image_upload_description",
				minValues: 0,
				maxValues: 1, // Current modal implementation supports single file only
				required: false,
			},
			{
				customId: ASPECT_RATIO_SELECT_ID,
				labelKey: "commands.generate.image.modal.aspect_ratio_label",
				descriptionKey:
					"commands.generate.image.modal.aspect_ratio_description",
				placeholder: "commands.generate.image.modal.aspect_ratio_placeholder",
				required: true,
				options: [
					{ label: "1:1 (Square)", value: "1:1" },
					{ label: "2:3 (Portrait)", value: "2:3" },
					{ label: "3:2 (Landscape)", value: "3:2" },
					{ label: "3:4 (Portrait)", value: "3:4" },
					{ label: "4:3 (Landscape)", value: "4:3" },
					{ label: "4:5 (Portrait)", value: "4:5" },
					{ label: "5:4 (Landscape)", value: "5:4" },
					{ label: "9:16 (Mobile Portrait)", value: "9:16" },
					{ label: "16:9 (Widescreen)", value: "16:9" },
					{ label: "21:9 (Ultra-wide)", value: "21:9" },
				],
			},
		];

		// 9. Show modal and wait for submission
		const modalResult = await promptWithRawModal(
			interaction,
			locale,
			{
				modalCustomId: MODAL_CUSTOM_ID,
				modalTitleKey: "commands.generate.image.modal.title",
				components: modalComponents,
			},
			true, // Auto-defer with public reply
		);

		// 10. Handle modal outcome
		if (modalResult.outcome !== "submit") {
			log.info(`Generate image modal ${modalResult.outcome}`);
			return;
		}

		modalSubmitInteraction = modalResult.interaction;
		const prompt = modalResult.values?.[PROMPT_INPUT_ID];
		const aspectRatio = modalResult.values?.[ASPECT_RATIO_SELECT_ID];
		const imageAttachments = modalResult.attachments?.[IMAGE_UPLOAD_ID];

		// 11. Safety check for required values
		if (!modalSubmitInteraction || !prompt || !aspectRatio) {
			log.error("Modal result unexpectedly missing required values");
			return;
		}

		// 12. Process reference image (if provided)
		const referenceImages: Array<{ mimeType: string; data: string }> = [];
		let referenceImageUrl: string | undefined;

		if (imageAttachments) {
			log.info(
				`Processing uploaded reference image: ${imageAttachments.filename}`,
			);

			try {
				const converted = await convertAttachmentToBase64(imageAttachments);
				referenceImages.push(converted);
				referenceImageUrl = imageAttachments.url; // Store URL for thumbnail
				log.info("Successfully processed reference image");
			} catch (error) {
				log.warn(
					`Failed to process attachment ${imageAttachments.id}:`,
					error as Error,
				);

				// Image processing failed - show error and exit
				await modalSubmitInteraction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(
									locale,
									"commands.generate.image.invalid_image_title",
								),
							)
							.setDescription(
								localizer(
									locale,
									"commands.generate.image.invalid_image_description",
								),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}
		}

		// 13. Get model codename from database
		const modelCodename = await getDiffusionModelCodename(diffusionModelId);

		log.info(
			`Generating image with ${provider} via ${modelCodename}: "${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}" (aspect ratio: ${aspectRatio}, references: ${referenceImages.length})`,
		);

		// 14. Start timer for generation time tracking
		const startTime = performance.now();

		// 15. Call provider API to generate image
		let generatedImageData: string | null = null;
		let generatedImageMimeType: string | null = null;

		if (provider === "openrouter") {
			// Use OpenRouter API
			const result = await generateImageWithOpenRouter(
				apiKey,
				modelCodename,
				prompt,
				aspectRatio,
				referenceImages.length > 0 ? referenceImages : undefined,
			);
			generatedImageData = result.imageData;
			generatedImageMimeType = result.mimeType;
		} else if (provider === "google") {
			// Use Google Gemini API
			const ai = new GoogleGenAI({ apiKey });
			const chat = ai.chats.create({
				model: modelCodename,
			});

			const messagePayload: {
				message: string;
				media?: Array<{ mimeType: string; data: string }>;
				config?: {
					responseModalities: string[];
					imageConfig: {
						aspectRatio: string;
					};
				};
			} = {
				message: prompt,
				config: {
					responseModalities: ["IMAGE"],
					imageConfig: {
						aspectRatio: aspectRatio,
					},
				},
			};

			if (referenceImages.length > 0) {
				messagePayload.media = referenceImages;
			}

			const response = await chat.sendMessage(messagePayload);

			// Extract generated image from response
			if (
				response?.candidates &&
				response.candidates.length > 0 &&
				response.candidates[0]?.content?.parts
			) {
				for (const part of response.candidates[0].content.parts) {
					if (part.inlineData) {
						generatedImageData = part.inlineData.data ?? null;
						generatedImageMimeType = part.inlineData.mimeType ?? null;
						break;
					}
				}
			}
		}

		// 16. Calculate generation time
		const endTime = performance.now();
		const generationTimeSeconds = ((endTime - startTime) / 1000).toFixed(1);

		// 17. Validate image was generated
		if (!generatedImageData) {
			await modalSubmitInteraction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(
								locale,
								"commands.generate.image.error_generation_failed_title",
							),
						)
						.setDescription(
							localizer(
								locale,
								"commands.generate.image.error_generation_failed_description",
								{
									error: "No image data received from API",
								},
							),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		// 18. Convert base64 to buffer and create attachment
		const imageBuffer = Buffer.from(generatedImageData, "base64");

		// Determine file extension from MIME type
		const extension =
			generatedImageMimeType === "image/jpeg"
				? "jpg"
				: generatedImageMimeType === "image/webp"
					? "webp"
					: "png"; // Default to PNG

		const filename = `generated_${Date.now()}.${extension}`;
		const attachment = new AttachmentBuilder(imageBuffer, { name: filename });

		// 19. Build success embed
		const successEmbed = new EmbedBuilder()
			.setTitle(localizer(locale, "commands.generate.image.success_title"))
			.setColor(ColorCode.SUCCESS)
			.setImage(`attachment://${filename}`)
			.addFields([
				{
					name: localizer(locale, "commands.generate.image.field_prompt"),
					value: prompt.substring(0, 1024), // Discord limit
					inline: false,
				},
				{
					name: localizer(locale, "commands.generate.image.field_model"),
					value: modelCodename,
					inline: true,
				},
				{
					name: localizer(
						locale,
						"commands.generate.image.field_generation_time",
					),
					value: `${generationTimeSeconds}s`,
					inline: true,
				},
				{
					name: localizer(locale, "commands.generate.image.field_aspect_ratio"),
					value: aspectRatio,
					inline: true,
				},
			]);

		// Set reference image as thumbnail if provided
		if (referenceImageUrl) {
			successEmbed.setThumbnail(referenceImageUrl);
		}

		// 20. Send success embed with generated image
		await modalSubmitInteraction.editReply({
			embeds: [successEmbed],
			files: [attachment],
		});

		log.success(
			`Successfully generated and sent image (${generationTimeSeconds}s)`,
		);
	} catch (error) {
		// Handle errors
		const errorMessage = error instanceof Error ? error.message : String(error);

		log.error("Image generation failed:", error as Error);

		// Use modalSubmitInteraction if available (error after modal), otherwise interaction (error during modal)
		const replyTarget = modalSubmitInteraction ?? interaction;

		// Check for billing/payment errors
		if (
			errorMessage.includes("billing") ||
			errorMessage.includes("payment") ||
			errorMessage.includes("quota") ||
			errorMessage.includes("PERMISSION_DENIED")
		) {
			await replyInfoEmbed(replyTarget, locale, {
				titleKey: "commands.generate.image.error_billing_title",
				descriptionKey: "commands.generate.image.error_billing_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Check for content safety errors
		if (
			errorMessage.includes("safety") ||
			errorMessage.includes("blocked") ||
			errorMessage.includes("RECITATION")
		) {
			await replyInfoEmbed(replyTarget, locale, {
				titleKey: "commands.generate.image.error_safety_title",
				descriptionKey: "commands.generate.image.error_safety_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Generic error fallback
		await replyInfoEmbed(replyTarget, locale, {
			titleKey: "commands.generate.image.error_generation_failed_title",
			descriptionKey:
				"commands.generate.image.error_generation_failed_description",
			descriptionVars: { error: errorMessage },
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
	}
}

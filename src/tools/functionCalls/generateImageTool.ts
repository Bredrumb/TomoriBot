/**
 * Image Generation Tool
 * Allows TomoriBot to generate images using Google's Gemini Imagen API
 * Supports both text-to-image and image-to-image generation
 */

import { AttachmentBuilder } from "discord.js";
import { GoogleGenAI } from "@google/genai";
import { log } from "../../utils/misc/logger";
import { localizer } from "../../utils/text/localizer";
import {
	BaseTool,
	type ToolContext,
	type ToolResult,
	type ToolParameterSchema,
} from "../../types/tool/interfaces";
import { sql } from "../../utils/db/client";
import { decryptApiKey } from "../../utils/security/crypto";

/**
 * Tool for generating images using Gemini Imagen API
 */
export class GenerateImageTool extends BaseTool {
	name = "generate_image";
	description =
		"Generate an AI image using Google's Gemini Imagen. Provide a detailed text prompt describing what image you want to create. If you provide a message_id or user_id reference, focus the prompt on edits or additions only and avoid re-describing the reference image. You can also specify an aspect ratio (default is 1:1). After generating, the image will be sent directly to the Discord channel.";
	category = "utility" as const;
	requiresFeatureFlag = "image_gen";
	private static readonly DISCORD_ID_PATTERN = /^\d{17,19}$/;

	parameters: ToolParameterSchema = {
		type: "object",
		properties: {
			prompt: {
				type: "string",
				description:
					"A detailed text description of the image you want to generate. Be specific about style, composition, colors, mood, and any important details. For image-to-image, describe only the modifications or additions you want and avoid re-describing the reference image.",
			},
			message_id: {
				type: "string",
				description:
					"Optional: The Discord message ID containing images to use as reference for image-to-image generation. The tool will extract all images from this message and use them to guide the generation along with your prompt. If not provided, generates a new image from scratch (text-to-image).",
			},
			user_id: {
				type: "string",
				description:
					"Optional: Discord user ID whose profile picture should be used as a reference image. Useful for avatar-based edits. Can be combined with message_id references.",
			},
			aspect_ratio: {
				type: "string",
				description:
					"Optional: The aspect ratio for the generated image. Default is '1:1' (square).",
				enum: [
					"1:1",
					"2:3",
					"3:2",
					"3:4",
					"4:3",
					"4:5",
					"5:4",
					"9:16",
					"16:9",
					"21:9",
				],
			},
		},
		required: ["prompt"],
	};

	/**
	 * Check if image generation is available for the given provider
	 * Supports Google Gemini (direct API) and OpenRouter (via their API)
	 * @param provider - LLM provider name
	 * @returns True if provider is Google or OpenRouter
	 */
	isAvailableFor(provider: string): boolean {
		return provider === "google" || provider === "openrouter";
	}

	/**
	 * Check if image generation is enabled in Tomori config
	 * @param context - Tool execution context
	 * @returns True if image generation is enabled
	 */
	protected isEnabled(context: ToolContext): boolean {
		return context.tomoriState.config.imagegen_enabled;
	}

	/**
	 * Get the diffusion model codename from the database
	 * @param diffusionModelId - Database ID of the diffusion model
	 * @returns The model codename string (e.g., "gemini-2.5-flash-image")
	 */
	private async getDiffusionModelCodename(
		diffusionModelId: number,
	): Promise<string> {
		const result = await sql`
			SELECT codename
			FROM image_diffusion_models
			WHERE diffusion_model_id = ${diffusionModelId}
		`.values();

		if (result.length === 0) {
			throw new Error(
				`Diffusion model not found in database: ${diffusionModelId}`,
			);
		}

		return result[0][0] as string;
	}

	/**
	 * Extract images from a Discord message and convert to base64 format
	 * Supports both direct attachments and embedded images (from links like Twitter/X)
	 * @param messageId - Discord message ID to fetch images from
	 * @param context - Tool execution context with channel access
	 * @returns Array of inline data objects with mimeType and base64 data
	 */
	private async extractImagesFromMessage(
		messageId: string,
		context: ToolContext,
	): Promise<Array<{ mimeType: string; data: string }>> {
		try {
			// 1. Fetch the Discord message
			const message = await context.channel.messages.fetch(messageId);

			if (!message) {
				throw new Error(`Message ${messageId} not found`);
			}

			// Array to collect all image URLs (from both attachments and embeds)
			const imageUrls: Array<{ url: string; mimeType: string; source: string }> = [];

			// 2. Extract images from direct attachments
			const imageAttachments = message.attachments.filter((attachment) =>
				attachment.contentType?.startsWith("image/"),
			);

			for (const attachment of imageAttachments.values()) {
				imageUrls.push({
					url: attachment.url,
					mimeType: attachment.contentType || "image/jpeg",
					source: `attachment: ${attachment.name}`,
				});
			}

			// 3. Extract images from embeds (Twitter/X posts, direct image links, etc.)
			for (const embed of message.embeds) {
				// Check for main embed image
				if (embed.image?.url) {
					imageUrls.push({
						url: embed.image.url,
						mimeType: "image/jpeg", // Embeds don't provide explicit MIME type
						source: `embed.image: ${embed.url || "unknown"}`,
					});
				}

				// Check for embed thumbnail (some embeds use thumbnail instead of image)
				if (embed.thumbnail?.url) {
					imageUrls.push({
						url: embed.thumbnail.url,
						mimeType: "image/jpeg",
						source: `embed.thumbnail: ${embed.url || "unknown"}`,
					});
				}
			}

			// 4. Validate we found at least one image
			if (imageUrls.length === 0) {
				throw new Error(
					`No images found in message ${messageId} (checked both attachments and embeds)`,
				);
			}

			log.info(
				`Found ${imageUrls.length} image(s) in message ${messageId} (${imageAttachments.size} attachment(s), ${imageUrls.length - imageAttachments.size} embed(s))`,
			);

			// 5. Convert each image URL to base64
			const inlineDataArray: Array<{ mimeType: string; data: string }> = [];

			for (const imageInfo of imageUrls) {
				try {
					// Fetch image data
					const imageResponse = await fetch(imageInfo.url);
					if (!imageResponse.ok) {
						log.warn(
							`Failed to fetch image from ${imageInfo.source}: ${imageResponse.status}`,
						);
						continue;
					}

					// Convert to base64
					const imageArrayBuffer = await imageResponse.arrayBuffer();
					const base64ImageData =
						Buffer.from(imageArrayBuffer).toString("base64");

					inlineDataArray.push({
						mimeType: imageInfo.mimeType,
						data: base64ImageData,
					});

					log.info(
						`Successfully converted image from ${imageInfo.source} to base64`,
					);
				} catch (imgErr) {
					log.warn(
						`Failed to process image from ${imageInfo.source}:`,
						imgErr as Error,
					);
				}
			}

			// 6. Ensure at least one image was successfully processed
			if (inlineDataArray.length === 0) {
				throw new Error(
					`Failed to process any images from message ${messageId}`,
				);
			}

			return inlineDataArray;
		} catch (error) {
			log.error(`Error extracting images from message ${messageId}:`, error);
			throw error;
		}
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
	private async generateImageWithOpenRouter(
		apiKey: string,
		modelCodename: string,
		prompt: string,
		aspectRatio: string,
		referenceImages?: Array<{ mimeType: string; data: string }>,
	): Promise<{ imageData: string | null; mimeType: string | null }> {
		// Helpful debug log for provider/model combo
		log.info(
			`[OpenRouter] Sending image request to model "${modelCodename}" (aspect ratio: ${aspectRatio}, refs: ${referenceImages?.length ?? 0})`,
		);

		// Prepare messages array
		const messages: Array<{
			role: string;
			content: Array<{
				type: string;
				text?: string;
				image_url?: { url: string };
			}>;
		}> = [];

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
				`[OpenRouter] Added ${referenceImages.length} reference image(s) to content array. Total content parts: ${contentParts.length}`,
			);
		}

		messages.push({
			role: "user",
			content: contentParts,
		});

		// Prepare request payload
		const requestPayload = {
			model: modelCodename,
			messages: messages,
			modalities: ["image", "text"],
			image_config: {
				aspect_ratio: aspectRatio,
			},
		};

		// Log request structure (without full base64 data to avoid log clutter)
		log.info(
			`[OpenRouter] Request payload structure: ${JSON.stringify(
				{
					model: requestPayload.model,
					messageCount: requestPayload.messages.length,
					message: {
						role: messages[0]?.role,
						contentParts: contentParts.map((part) => ({
							type: part.type,
							hasImageUrl: part.type === "image_url",
							hasText: part.type === "text",
							// Log first 100 chars of base64 to verify image data exists
							imageDataPreview: part.image_url?.url.substring(0, 100),
							textPreview: part.text?.substring(0, 50),
						})),
					},
					modalities: requestPayload.modalities,
					image_config: requestPayload.image_config,
				},
				null,
				2,
			)}`,
		);

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
			// Log richer context without dumping the whole prompt
			const bodySnippet = errorText.slice(0, 500);
			log.warn(
				`[OpenRouter] Image request failed (${response.status} ${response.statusText}) for model "${modelCodename}". Body: ${bodySnippet}`,
			);

			// Try to pull a human-readable message out of the body if possible
			let parsedMessage = "";
			try {
				const parsed = JSON.parse(errorText);
				parsedMessage =
					(parsed?.error?.message as string | undefined) ||
					(parsed?.message as string | undefined) ||
					"";
			} catch {
				// ignore JSON parse errors; fall back to raw snippet
			}

			const friendlyMessage =
				parsedMessage ||
				bodySnippet ||
				`${response.status} ${response.statusText}`.trim();

			throw new Error(
				`OpenRouter API request failed (${response.status} ${response.statusText}) for model "${modelCodename}": ${friendlyMessage}`,
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
	 * Execute image generation
	 * @param args - Arguments containing prompt, optional message_id, and optional aspect_ratio
	 * @param context - Tool execution context
	 * @returns Promise resolving to tool result with generated image
	 */
	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		// Validate parameters
		const validation = this.validateParameters(args);
		if (!validation.isValid) {
			return {
				success: false,
				error: `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
			};
		}

		// Check if tool is enabled
		if (!this.isEnabled(context)) {
			return {
				success: false,
				error: "Image generation is disabled for this server",
				message: "Image generation is not enabled for this server.",
			};
		}

		// Extract arguments
		const prompt = args.prompt as string;
		const messageId = args.message_id as string | undefined;
		const userId = args.user_id as string | undefined;
		const aspectRatio = (args.aspect_ratio as string) || "1:1";

		try {
			// Get the diffusion model codename from database
			const diffusionModelId = context.tomoriState.config.diffusion_model_id;

			if (!diffusionModelId) {
				return {
					success: false,
					error:
						"No diffusion model configured for this server. Please run the setup command or configure an API key to enable image generation.",
				};
			}

			const modelCodename =
				await this.getDiffusionModelCodename(diffusionModelId);

			log.info(`Using diffusion model: ${modelCodename} for image generation`);

			// Decrypt API key
			const encryptedApiKey = context.tomoriState.config.api_key;
			const keyVersion = context.tomoriState.config.key_version || 1;

			if (!encryptedApiKey) {
				return {
					success: false,
					error: "No API key configured for this server",
				};
			}

			const apiKey = await decryptApiKey(encryptedApiKey, keyVersion);

			if (!apiKey) {
				return {
					success: false,
					error: "Failed to decrypt API key",
				};
			}

			// Collect reference images from message attachments and/or profile picture
			const referenceImages: Array<{ mimeType: string; data: string }> = [];

			if (messageId) {
				log.info(
					`Extracting images from message ${messageId} for image-to-image generation`,
				);
				const messageImages = await this.extractImagesFromMessage(
					messageId,
					context,
				);
				referenceImages.push(...messageImages);
				log.info(
					`Using ${messageImages.length} reference image(s) from message ${messageId} for generation`,
				);
			}

			if (userId) {
				if (!this.isValidDiscordId(userId)) {
					return {
						success: false,
						error: "Invalid Discord user ID format",
						message:
							"The provided user_id is not a valid Discord snowflake. Please supply a 17-19 digit Discord user ID.",
					};
				}

				try {
					const avatarData = await this.fetchUserAvatar(userId, context);
					const avatarBase64 = await this.fetchAndConvertImageToBase64(
						avatarData.avatarUrl,
					);
					referenceImages.push({
						mimeType: "image/png",
						data: avatarBase64,
					});
					log.info(
						`Added profile picture reference for user ${avatarData.username} (${userId})`,
					);
				} catch (avatarErr) {
					log.error(
						`Failed to fetch profile picture for user ${userId}`,
						avatarErr as Error,
					);
					return {
						success: false,
						error: "Failed to fetch profile picture for user_id",
						message:
							"Could not fetch that user's profile picture. Please confirm the user ID is correct and try again.",
					};
				}
			}

			// Call appropriate provider API
			log.info(
				`Generating image with ${context.provider} via ${modelCodename}: "${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}" (aspect ratio: ${aspectRatio})`,
			);

			let generatedImageData: string | null = null;

			if (context.provider === "openrouter") {
				// Use OpenRouter API
				const result = await this.generateImageWithOpenRouter(
					apiKey,
					modelCodename,
					prompt,
					aspectRatio,
					referenceImages.length > 0 ? referenceImages : undefined,
				);
				generatedImageData = result.imageData;
			} else if (context.provider === "google") {
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
							break;
						}
					}
				}
			}

			if (!generatedImageData) {
				return {
					success: false,
					error:
						"No image data received from API. The generation may have been blocked or failed.",
				};
			}

			// Convert base64 to buffer and send to Discord
			const imageBuffer = Buffer.from(generatedImageData, "base64");
			const attachment = new AttachmentBuilder(imageBuffer, {
				name: `generated_${Date.now()}.png`,
			});

			// Send image to Discord channel and capture the sent message for metadata
			const sentMessage = await context.channel.send({
				files: [attachment],
			});

			log.success("Successfully generated and sent image to Discord");

			// Note: We intentionally DO NOT include imageMetadata for generated images
			// because Discord CDN URLs are protected and cannot be fetched by external
			// servers (like OpenRouter). The model doesn't need to see its own generated
			// output - it just needs confirmation that the generation succeeded.
			// The text message includes the Discord message ID for reference.

			return {
				success: true,
				message: `Successfully generated and sent image to Discord (message ID: ${sentMessage.id}). The image has been created based on your prompt${
					referenceImages.length > 0 ? " and the reference image(s)" : ""
				}.`,
				// imageMetadata intentionally omitted to avoid 403 errors when OpenRouter tries to fetch Discord CDN URLs
			};
		} catch (error) {
			// Handle specific Google API errors
			const errorMessage =
				error instanceof Error ? error.message : String(error);

			// Localize errors, but fall back to readable defaults if the localizer
			// isn't initialized or a key is missing (to avoid leaking locale keys)
			const getReadableError = (key: string, fallback: string): string => {
				const localized = localizer(context.locale, key);
				return localized === key ? fallback : localized;
			};

			log.error("Image generation failed:", error as Error);

			// Check for billing/payment errors
			if (
				errorMessage.includes("billing") ||
				errorMessage.includes("payment") ||
				errorMessage.includes("quota") ||
				errorMessage.includes("PERMISSION_DENIED")
			) {
				return {
					success: false,
					error: getReadableError(
						"errors.google.400_billing_default_message",
						"Billing is required for this service",
					),
				};
			}

			// Check for content safety errors
			if (
				errorMessage.includes("safety") ||
				errorMessage.includes("blocked") ||
				errorMessage.includes("RECITATION")
			) {
				return {
					success: false,
					error: getReadableError(
						"genai.google.content_blocked_default_message",
						"Your content was blocked by safety filters",
					),
				};
			}

			// Generic error fallback
			return {
				success: false,
				error: `Failed to generate image: ${errorMessage}`,
			};
		}
	}

	/**
	 * Validate Discord snowflake format
	 */
	private isValidDiscordId(userId: string): boolean {
		return GenerateImageTool.DISCORD_ID_PATTERN.test(userId);
	}

	/**
	 * Fetch Discord user and their avatar URL (prefers guild avatar when available)
	 */
	private async fetchUserAvatar(
		userId: string,
		context: ToolContext,
	): Promise<{ username: string; avatarUrl: string; serverNickname?: string }> {
		const user = await context.client.users.fetch(userId);

		let avatarUrl: string;
		let serverNickname: string | undefined;

		if (context.guildId) {
			const guild = context.client.guilds.cache.get(context.guildId);
			if (guild) {
				const member = await guild.members.fetch(userId).catch(() => null);
				if (member) {
					avatarUrl = member.displayAvatarURL({
						size: 1024,
						extension: "png",
						forceStatic: false,
					});
					serverNickname = member.nickname ?? undefined;
				} else {
					avatarUrl = user.displayAvatarURL({
						size: 1024,
						extension: "png",
						forceStatic: false,
					});
				}
			} else {
				avatarUrl = user.displayAvatarURL({
					size: 1024,
					extension: "png",
					forceStatic: false,
				});
			}
		} else {
			avatarUrl = user.displayAvatarURL({
				size: 1024,
				extension: "png",
				forceStatic: false,
			});
		}

		return {
			username: user.username,
			avatarUrl,
			serverNickname,
		};
	}

	/**
	 * Fetch an image URL and convert to base64 (used for profile pictures)
	 */
	private async fetchAndConvertImageToBase64(imageUrl: string): Promise<string> {
		const response = await fetch(imageUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch image: ${response.status} ${response.statusText}`,
			);
		}

		const imageArrayBuffer = await response.arrayBuffer();
		return Buffer.from(imageArrayBuffer).toString("base64");
	}
}

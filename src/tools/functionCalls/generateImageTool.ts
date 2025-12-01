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
import { sql } from "bun";
import type { FunctionResponseImageMetadata } from "../../types/provider/interfaces";
import { decryptApiKey } from "../../utils/security/crypto";

/**
 * Tool for generating images using Gemini Imagen API
 */
export class GenerateImageTool extends BaseTool {
	name = "generate_image";
	description =
		"Generate an AI image using Google's Gemini Imagen. Provide a detailed text prompt describing what image you want to create. Optionally reference a message_id to use existing images from that message for image-to-image generation (modifying/editing existing images based on your prompt). You can also specify an aspect ratio (default is 1:1). After generating, the image will be sent directly to the Discord channel.";
	category = "utility" as const;

	parameters: ToolParameterSchema = {
		type: "object",
		properties: {
			prompt: {
				type: "string",
				description:
					"A detailed text description of the image you want to generate. Be specific about style, composition, colors, mood, and any important details. For image-to-image, describe the modifications you want to make to the reference image(s).",
			},
			message_id: {
				type: "string",
				description:
					"Optional: The Discord message ID containing images to use as reference for image-to-image generation. The tool will extract all images from this message and use them to guide the generation along with your prompt. If not provided, generates a new image from scratch (text-to-image).",
			},
			aspect_ratio: {
				type: "string",
				description:
					"Optional: The aspect ratio for the generated image. Default is '1:1' (square).",
				enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
			},
		},
		required: ["prompt"],
	};

	/**
	 * Check if image generation is available for the given provider
	 * Currently only Google Gemini supports Imagen API
	 * @param provider - LLM provider name
	 * @returns True if provider is Google
	 */
	isAvailableFor(provider: string): boolean {
		return provider === "google";
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
			FROM diffusion_models
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
	 * @param messageId - Discord message ID to fetch images from
	 * @param context - Tool execution context with channel access
	 * @returns Array of inline data objects with mimeType and base64 data
	 */
	private async extractImagesFromMessage(
		messageId: string,
		context: ToolContext,
	): Promise<Array<{ mimeType: string; data: string }>> {
		try {
			// Fetch the Discord message
			const message = await context.channel.messages.fetch(messageId);

			if (!message) {
				throw new Error(`Message ${messageId} not found`);
			}

			// Filter for image attachments
			const imageAttachments = message.attachments.filter((attachment) =>
				attachment.contentType?.startsWith("image/"),
			);

			if (imageAttachments.size === 0) {
				throw new Error(`No images found in message ${messageId}`);
			}

			log.info(
				`Found ${imageAttachments.size} image attachment(s) in message ${messageId}`,
			);

			// Convert each image to base64
			const inlineDataArray: Array<{ mimeType: string; data: string }> = [];

			for (const attachment of imageAttachments.values()) {
				try {
					// Fetch image data
					const imageResponse = await fetch(attachment.url);
					if (!imageResponse.ok) {
						log.warn(
							`Failed to fetch image ${attachment.name}: ${imageResponse.status}`,
						);
						continue;
					}

					// Convert to base64
					const imageArrayBuffer = await imageResponse.arrayBuffer();
					const base64ImageData = Buffer.from(imageArrayBuffer).toString(
						"base64",
					);

					inlineDataArray.push({
						mimeType: attachment.contentType || "image/jpeg",
						data: base64ImageData,
					});

					log.info(`Successfully converted image ${attachment.name} to base64`);
				} catch (imgErr) {
					log.warn(
						`Failed to process image ${attachment.name}:`,
						imgErr as Error,
					);
				}
			}

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

		// Extract arguments
		const prompt = args.prompt as string;
		const messageId = args.message_id as string | undefined;
		const aspectRatio = (args.aspect_ratio as string) || "1:1";

		try {
			// Get the diffusion model codename from database
			const diffusionModelId =
				context.tomoriState.config.diffusion_model_id;

			if (!diffusionModelId) {
				return {
					success: false,
					error:
						"No diffusion model configured for this server. Please run the setup command or configure an API key to enable image generation.",
				};
			}

			const modelCodename =
				await this.getDiffusionModelCodename(diffusionModelId);

			log.info(
				`Using diffusion model: ${modelCodename} for image generation`,
			);

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

			// Initialize Google AI client
			const ai = new GoogleGenAI({ apiKey });

			// Create chat for image generation
			const chat = ai.chats.create({
				model: modelCodename,
			});

			// Prepare message content
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

			// If message_id provided, extract images for img2img
			if (messageId) {
				log.info(
					`Extracting images from message ${messageId} for image-to-image generation`,
				);
				const referenceImages =
					await this.extractImagesFromMessage(messageId, context);
				messagePayload.media = referenceImages;
				log.info(
					`Using ${referenceImages.length} reference image(s) for generation`,
				);
			}

			// Call Gemini Imagen API
			log.info(
				`Generating image with prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? "..." : ""}" (aspect ratio: ${aspectRatio})`,
			);

			const response = await chat.sendMessage(messagePayload);

			// Extract generated image from response
			let generatedImageData: string | null = null;
			let generatedImageMimeType: string | null = null;

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

			if (!generatedImageData) {
				return {
					success: false,
					error:
						"No image data received from Gemini API. The generation may have been blocked or failed.",
				};
			}

			// Convert base64 to buffer and send to Discord
			const imageBuffer = Buffer.from(generatedImageData, "base64");
			const attachment = new AttachmentBuilder(imageBuffer, {
				name: `generated_${Date.now()}.png`,
			});

			// Send image to Discord channel
			await context.channel.send({
				files: [attachment],
			});

			log.success("Successfully generated and sent image to Discord");

			// Prepare image metadata for LLM visibility
			const imageMetadata: FunctionResponseImageMetadata = {
				imageUrls: [
					{
						url: `generated_image_${Date.now()}.png`, // Placeholder URL for context
						mimeType: generatedImageMimeType || "image/png",
						wasCompressed: false,
					},
				],
				totalSent: 1,
				totalValidated: 1,
			};

			return {
				success: true,
				message: `Successfully generated and sent image to Discord. The image has been created based on your prompt${messageId ? " and the reference image(s)" : ""}.`,
				imageMetadata,
			};
		} catch (error) {
			// Handle specific Google API errors
			const errorMessage =
				error instanceof Error ? error.message : String(error);

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
					error: localizer(
						context.locale,
						"errors.google.400_billing_default_message",
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
					error: localizer(
						context.locale,
						"errors.google.content_blocked_default_message",
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
}

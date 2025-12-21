/**
 * Structured output utility for LLM providers
 * Provides provider-specific adapters for generating structured JSON responses
 * with image vision capabilities for emoji and sticker classification
 */

import { GoogleGenAI } from "@google/genai";
import type { Content, GenerateContentConfig, Part } from "@google/genai";
import { z } from "zod";
import { getAllEmotionKeys } from "@/types/misc/emotions";
import { log } from "@/utils/misc/logger";

/**
 * Zod schema for a single expression (emoji or sticker) classification result
 */
export const ExpressionClassificationSchema = z.object({
	// 1. Name field - must match emoji/sticker name (case-insensitive)
	name: z
		.string()
		.describe("The emoji or sticker name (case-insensitive match)"),

	// 2. Emotion key - one of the 28 predefined emotion categories
	emotion_key: z
		.enum(getAllEmotionKeys() as [string, ...string[]])
		.describe(
			"One of the 28 emotion categories that best matches the visual expression",
		),

	// 3. Description - concise visual description
	description: z
		.string()
		.min(10)
		.max(200)
		.describe(
			"One concise sentence describing the visual appearance (10-200 characters)",
		),
});

/**
 * Zod schema for the complete LLM response containing multiple expression classifications
 */
export const ExpressionBatchResultSchema = z.object({
	expressions: z.array(ExpressionClassificationSchema),
});

/**
 * Type for a single expression classification result
 */
export type ExpressionClassification = z.infer<
	typeof ExpressionClassificationSchema
>;

/**
 * Type for the complete batch result
 */
export type ExpressionBatchResult = z.infer<
	typeof ExpressionBatchResultSchema
>;

/**
 * Request parameters for Google structured output
 */
export interface GoogleStructuredOutputRequest {
	// API key for authentication
	apiKey: string;

	// Model codename (e.g., "gemini-2.5-flash")
	model: string;

	// System instruction prompt
	systemPrompt: string;

	// User prompt describing the task
	userPrompt: string;

	// Array of Discord CDN image URLs with names
	images: Array<{ url: string; name: string }>;

	// Optional temperature (default: 1.0)
	temperature?: number;
}

/**
 * Result type for structured output calls
 */
export type StructuredOutputResult<T> =
	| { success: true; data: T }
	| { success: false; error: string };

/**
 * Call Google Gemini with structured output using native responseSchema
 *
 * @param request - Request parameters including API key, model, prompts, and images
 * @returns Promise with structured result or error
 *
 * @example
 * ```typescript
 * const result = await callGoogleStructuredOutput({
 *   apiKey: 'your-api-key',
 *   model: 'gemini-2.5-flash',
 *   systemPrompt: 'You are an emoji classifier...',
 *   userPrompt: 'Analyze these emojis...',
 *   images: [
 *     { url: 'https://cdn.discordapp.com/emojis/123.png', name: 'happy_cat' }
 *   ],
 * });
 * ```
 */
export async function callGoogleStructuredOutput(
	request: GoogleStructuredOutputRequest,
): Promise<StructuredOutputResult<ExpressionBatchResult>> {
	try {
		// 1. Initialize Google GenAI client
		const genAI = new GoogleGenAI({ apiKey: request.apiKey });

		// 2. Build content parts array with user prompt text
		const parts: Part[] = [{ text: request.userPrompt }];

		// 3. Fetch and convert images to base64 inlineData format
		for (const image of request.images) {
			try {
				// Fetch image from Discord CDN
				const response = await fetch(image.url);

				// Skip if fetch failed
				if (!response.ok) {
					log.warn(
						`Failed to fetch image ${image.name} from ${image.url}: ${response.status} ${response.statusText}`,
					);
					continue;
				}

				// Convert to array buffer and then to base64
				const arrayBuffer = await response.arrayBuffer();
				const base64 = Buffer.from(arrayBuffer).toString("base64");

				// Add to parts array as inlineData
				parts.push({
					inlineData: {
						data: base64,
						mimeType: "image/png",
					},
				});
			} catch (fetchError) {
				// Log error but continue processing other images
				log.error(
					`Error fetching image ${image.name}`,
					fetchError as Error,
					{
						errorType: "ImageFetchError",
						metadata: {
							imageName: image.name,
							imageUrl: image.url,
						},
					},
				);
			}
		}

		// 4. Build JSON schema object for structured output
		// Google's responseSchema expects a plain object (not Zod)
		const responseSchema = {
			type: "object" as const,
			properties: {
				expressions: {
					type: "array" as const,
					items: {
						type: "object" as const,
						properties: {
							name: {
								type: "string" as const,
								description: "The emoji or sticker name (case-insensitive match)",
							},
							emotion_key: {
								type: "string" as const,
								enum: getAllEmotionKeys(),
								description:
									"One of the 28 emotion categories that best matches the visual expression",
							},
							description: {
								type: "string" as const,
								description:
									"One concise sentence describing the visual appearance",
							},
						},
						required: ["name", "emotion_key", "description"],
					},
				},
			},
			required: ["expressions"],
		};

		// 5. Build generation config with structured output
		const generationConfig: GenerateContentConfig = {
			temperature: request.temperature ?? 1.0,
			maxOutputTokens: 8192,
			responseMimeType: "application/json",
			responseSchema,
			systemInstruction: request.systemPrompt,
		};

		// 6. Build content structure for Google API
		const contents: Content = {
			role: "user",
			parts,
		};

		// 7. Call Google Gemini with structured output
		const result = await genAI.models.generateContent({
			model: request.model,
			contents: [contents],
			config: generationConfig,
		});

		// 8. Extract response text
		const responseText = result.text ?? "";

		// 9. Parse JSON response
		const parsed = JSON.parse(responseText);

		// 10. Validate with Zod schema
		const validationResult = ExpressionBatchResultSchema.safeParse(parsed);

		if (!validationResult.success) {
			log.error("Google structured output validation failed", validationResult.error);
			return {
				success: false,
				error: `Invalid response structure: ${validationResult.error.message}`,
			};
		}

		// 11. Return validated data
		return {
			success: true,
			data: validationResult.data,
		};
	} catch (error) {
		// Log error with context
		log.error(
			"Error calling Google structured output",
			error as Error,
			{
				errorType: "GoogleStructuredOutputError",
				metadata: {
					model: request.model,
					imageCount: request.images.length,
				},
			},
		);

		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Placeholder for OpenRouter structured output adapter
 * OpenRouter support varies by model and will be implemented when needed
 *
 * @param request - Similar to GoogleStructuredOutputRequest
 * @returns Promise with structured result or error
 */
export async function callOpenrouterStructuredOutput(
	_request: unknown,
): Promise<StructuredOutputResult<ExpressionBatchResult>> {
	// TODO: Implement when OpenRouter adds structured output support
	// Will use response_format with json_schema parameter
	return {
		success: false,
		error:
			"OpenRouter structured output not yet implemented. Please use a Google Gemini model.",
	};
}

import { GoogleGenAI, type Content, type GenerateContentConfig, type Part } from "@google/genai";
import { log } from "@/utils/misc/logger";
import type { CompactRoleplaySummary } from "@/types/misc/compact";

export interface CompactSummaryRequest {
	apiKey: string;
	model: string;
	systemPrompt?: string;
	userPrompt: string;
	temperature?: number;
	images?: Array<{ url: string; mimeType?: string }>;
}

export interface CompactConversationResult {
	summary?: string;
	error?: string;
}

export interface CompactRoleplayResult {
	summary?: CompactRoleplaySummary;
	error?: string;
}

async function buildUserParts(
	userPrompt: string,
	images?: Array<{ url: string; mimeType?: string }>,
): Promise<Part[]> {
	const parts: Part[] = [{ text: userPrompt }];

	if (!images || images.length === 0) {
		return parts;
	}

	for (const image of images) {
		try {
			const response = await fetch(image.url);
			if (!response.ok) {
				log.warn(
					`Compact summary: failed to fetch image ${image.url} (${response.status} ${response.statusText})`,
				);
				continue;
			}

			const arrayBuffer = await response.arrayBuffer();
			const base64 = Buffer.from(arrayBuffer).toString("base64");
			parts.push({
				inlineData: {
					data: base64,
					mimeType: image.mimeType || "image/png",
				},
			});
		} catch (error) {
			log.warn(
				`Compact summary: failed to process image ${image.url}`,
				error as Error,
			);
		}
	}

	return parts;
}

export async function generateConversationSummaryGoogle(
	request: CompactSummaryRequest,
): Promise<CompactConversationResult> {
	try {
		if (!request.apiKey || request.apiKey.trim().length < 10) {
			return { error: "Invalid Google API key" };
		}

		const genAI = new GoogleGenAI({ apiKey: request.apiKey });
		const prompt = request.systemPrompt
			? `${request.systemPrompt}\n\n${request.userPrompt}`
			: request.userPrompt;

		const parts = await buildUserParts(prompt, request.images);
		const contents: Content = { role: "user", parts };

		const generationConfig: GenerateContentConfig = {
			temperature: request.temperature ?? 0.7,
			maxOutputTokens: 4096,
		};

		const result = await genAI.models.generateContent({
			model: request.model,
			contents: [contents],
			config: generationConfig,
		});

		const responseText = result.text;
		if (!responseText || responseText.trim() === "") {
			return { error: "Empty response from Google" };
		}

		return { summary: responseText.trim() };
	} catch (error) {
		log.error("Compact summary (Google) failed", error as Error);
		return {
			error:
				error instanceof Error ? error.message : "Unknown Google error",
		};
	}
}

function buildRoleplaySchema() {
	return {
		type: "object" as const,
		properties: {
			overall_scene_summary: {
				type: "string" as const,
			},
			characters: {
				type: "array" as const,
				items: {
					type: "object" as const,
					properties: {
						name: { type: "string" as const },
						current_goals: { type: "string" as const },
						emotional_status: { type: "string" as const },
						physical_status: { type: "string" as const },
						appearance_clothing: { type: "string" as const },
						inventory: { type: "string" as const },
					},
					required: [
						"name",
						"current_goals",
						"emotional_status",
						"physical_status",
						"appearance_clothing",
						"inventory",
					],
				},
			},
		},
		required: ["overall_scene_summary", "characters"],
	};
}

export async function generateRoleplaySummaryGoogle(
	request: CompactSummaryRequest,
): Promise<CompactRoleplayResult> {
	try {
		if (!request.apiKey || request.apiKey.trim().length < 10) {
			return { error: "Invalid Google API key" };
		}

		const genAI = new GoogleGenAI({ apiKey: request.apiKey });
		const prompt = request.systemPrompt
			? `${request.systemPrompt}\n\n${request.userPrompt}`
			: request.userPrompt;

		const parts = await buildUserParts(prompt, request.images);
		const contents: Content = { role: "user", parts };

		const generationConfig: GenerateContentConfig = {
			temperature: request.temperature ?? 0.7,
			maxOutputTokens: 4096,
			responseMimeType: "application/json",
			responseJsonSchema: buildRoleplaySchema(),
		};

		const result = await genAI.models.generateContent({
			model: request.model,
			contents: [contents],
			config: generationConfig,
		});

		const responseText = result.text;
		if (!responseText || responseText.trim() === "") {
			return { error: "Empty response from Google" };
		}

		let parsed: CompactRoleplaySummary;
		try {
			parsed = JSON.parse(responseText) as CompactRoleplaySummary;
		} catch (parseError) {
			return {
				error:
					parseError instanceof Error
						? parseError.message
						: "Invalid JSON response from Google",
			};
		}

		if (
			!parsed ||
			typeof parsed.overall_scene_summary !== "string" ||
			!Array.isArray(parsed.characters)
		) {
			return { error: "Invalid roleplay summary format from Google" };
		}

		return { summary: parsed };
	} catch (error) {
		log.error("Roleplay compact summary (Google) failed", error as Error);
		return {
			error:
				error instanceof Error ? error.message : "Unknown Google error",
		};
	}
}

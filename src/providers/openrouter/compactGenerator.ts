import { log } from "@/utils/misc/logger";
import type { CompactRoleplaySummary } from "@/types/misc/compact";

export interface CompactSummaryRequest {
	apiKey: string;
	model: string;
	systemPrompt?: string;
	userPrompt: string;
	temperature?: number;
	images?: Array<{ url: string }>;
}

export interface CompactConversationResult {
	summary?: string;
	error?: string;
}

export interface CompactRoleplayResult {
	summary?: CompactRoleplaySummary;
	error?: string;
}

type OpenrouterContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string } };

type OpenrouterMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string | OpenrouterContentPart[] };

function buildRoleplaySchema() {
	return {
		type: "object" as const,
		properties: {
			overall_scene_summary: { type: "string" as const },
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

function buildUserContent(
	userPrompt: string,
	images?: Array<{ url: string }>,
): string | OpenrouterContentPart[] {
	if (!images || images.length === 0) {
		return userPrompt;
	}

	const parts: OpenrouterContentPart[] = [{ type: "text", text: userPrompt }];
	for (const image of images) {
		parts.push({
			type: "image_url",
			image_url: { url: image.url },
		});
	}

	return parts;
}

export async function generateConversationSummaryOpenrouter(
	request: CompactSummaryRequest,
): Promise<CompactConversationResult> {
	try {
		if (!request.apiKey || request.apiKey.trim().length < 10) {
			return { error: "Invalid OpenRouter API key" };
		}

		const messages: OpenrouterMessage[] = [];
		if (request.systemPrompt) {
			messages.push({ role: "system", content: request.systemPrompt });
		}

		messages.push({
			role: "user",
			content: buildUserContent(request.userPrompt, request.images),
		});

		const body: Record<string, unknown> = {
			...(request.model !== "account-setting" ? { model: request.model } : {}),
			messages,
			temperature: request.temperature ?? 0.7,
			max_tokens: 4096,
			stream: false,
			plugins: [{ id: "response-healing" }],
		};

		const response = await fetch(
			"https://openrouter.ai/api/v1/chat/completions",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${request.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			},
		);

		if (!response.ok) {
			const errorBody = await response.text();
			log.error(
				"OpenRouter compact summary request failed",
				new Error(errorBody),
				{
					errorType: "OpenrouterCompactHttpError",
					metadata: {
						model: request.model,
						status: response.status,
						errorBody,
					},
				},
			);
			return {
				error: `OpenRouter request failed (${response.status}): ${response.statusText}`,
			};
		}

		const result = (await response.json()) as {
			choices?: Array<{
				message?: { content?: unknown };
			}>;
		};

		const message = result.choices?.[0]?.message;
		const content = message?.content;
		const responseText =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content
							.filter(
								(part) =>
									typeof part === "object" &&
									part !== null &&
									"type" in part &&
									(part as { type?: string }).type === "text" &&
									"text" in part,
							)
							.map((part) => (part as { text: string }).text)
							.join("")
					: "";

		if (!responseText || responseText.trim() === "") {
			return { error: "OpenRouter returned an empty response." };
		}

		return { summary: responseText.trim() };
	} catch (error) {
		log.error("OpenRouter compact summary failed", error as Error);
		return {
			error:
				error instanceof Error ? error.message : "Unknown OpenRouter error",
		};
	}
}

export async function generateRoleplaySummaryOpenrouter(
	request: CompactSummaryRequest,
): Promise<CompactRoleplayResult> {
	try {
		if (!request.apiKey || request.apiKey.trim().length < 10) {
			return { error: "Invalid OpenRouter API key" };
		}

		const messages: OpenrouterMessage[] = [];
		if (request.systemPrompt) {
			messages.push({ role: "system", content: request.systemPrompt });
		}

		messages.push({
			role: "user",
			content: buildUserContent(request.userPrompt, request.images),
		});

		const responseFormat = {
			type: "json_schema" as const,
			json_schema: {
				name: "roleplay_summary",
				schema: buildRoleplaySchema(),
			},
		};

		const body: Record<string, unknown> = {
			...(request.model !== "account-setting" ? { model: request.model } : {}),
			messages,
			temperature: request.temperature ?? 0.7,
			max_tokens: 4096,
			response_format: responseFormat,
			stream: false,
			plugins: [{ id: "response-healing" }],
		};

		const response = await fetch(
			"https://openrouter.ai/api/v1/chat/completions",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${request.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			},
		);

		if (!response.ok) {
			const errorBody = await response.text();
			log.error(
				"OpenRouter roleplay summary request failed",
				new Error(errorBody),
				{
					errorType: "OpenrouterRoleplaySummaryHttpError",
					metadata: {
						model: request.model,
						status: response.status,
						errorBody,
					},
				},
			);
			return {
				error: `OpenRouter request failed (${response.status}): ${response.statusText}`,
			};
		}

		const result = (await response.json()) as {
			choices?: Array<{
				message?: { content?: unknown };
			}>;
		};

		const message = result.choices?.[0]?.message;
		const content = message?.content;
		const responseText =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content
							.filter(
								(part) =>
									typeof part === "object" &&
									part !== null &&
									"type" in part &&
									(part as { type?: string }).type === "text" &&
									"text" in part,
							)
							.map((part) => (part as { text: string }).text)
							.join("")
					: "";

		if (!responseText || responseText.trim() === "") {
			return { error: "OpenRouter returned an empty response." };
		}

		let parsed: CompactRoleplaySummary;
		try {
			parsed = JSON.parse(responseText) as CompactRoleplaySummary;
		} catch (parseError) {
			return {
				error:
					parseError instanceof Error
						? parseError.message
						: "Invalid JSON response from OpenRouter",
			};
		}

		if (
			!parsed ||
			typeof parsed.overall_scene_summary !== "string" ||
			!Array.isArray(parsed.characters)
		) {
			return { error: "Invalid roleplay summary format from OpenRouter" };
		}

		return { summary: parsed };
	} catch (error) {
		log.error("OpenRouter roleplay summary failed", error as Error);
		return {
			error:
				error instanceof Error ? error.message : "Unknown OpenRouter error",
		};
	}
}

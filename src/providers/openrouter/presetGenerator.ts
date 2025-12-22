/**
 * AI-Powered Preset Generation for TomoriBot
 * Uses OpenRouter structured output with optional tool-assisted web search.
 */

import { log } from "../../utils/misc/logger";
import {
	sanitizeSampleDialogueText,
	type GeneratePresetParams,
	type PresetGenerationResult,
} from "../google/presetGenerator";
import type { ToolContext, ToolResult } from "../../types/tool/interfaces";
import { executeTool } from "../../tools/toolRegistry";
import { getOpenrouterToolAdapter } from "./openrouterToolAdapter";

interface OpenrouterPresetGenerationOptions {
	model: string;
	temperature?: number;
	tools?: Array<Record<string, unknown>>;
	toolContext?: ToolContext;
	maxToolRounds?: number;
}

type OpenrouterContentPart =
	| { type: "text"; text: string }
	| { type: "image_url"; image_url: { url: string } };

type OpenrouterMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string | OpenrouterContentPart[] }
	| {
			role: "assistant";
			content?: string | null;
			tool_calls?: OpenrouterToolCall[];
	  }
	| { role: "tool"; tool_call_id: string; content: string };

interface OpenrouterToolCall {
	id?: string;
	type?: string;
	function?: {
		name?: string;
		arguments?: string;
	};
}

function buildPresetResponseSchema() {
	return {
		type: "object" as const,
		properties: {
			attribute_list: {
				type: "array" as const,
				description:
					"Array containing exactly 6 items describing different facets of the character, in this exact order: 1) {bot}'s Description (core identity and essence), 2) {bot}'s Appearance (physical traits and style), 3) {bot}'s Personality (personality traits, comma-separated), 4) {bot}'s Likes (interests and preferences), 5) {bot}'s Dislikes (aversions and pet peeves), 6) {bot}'s Behavioral Quirks (unique mannerisms and patterns). Each item maximum 2000 characters, in this specific format per array item: \"{bot}'s Description: \"",
				items: {
					type: "string" as const,
					maxLength: 2000,
				},
				minItems: 6,
				maxItems: 6,
			},
			sample_dialogues_in: {
				type: "array" as const,
				description:
					"Array of exactly 5 example user messages. MUST include these 3 guided scenarios in order: 1) Self-introduction request, 2) Emotional/personal scenario, 3) Practical/functional scenario. Then add 2 free dialogue scenarios that showcase unique character traits. Do NOT prepend with speaker names. Each message maximum 2000 characters.",
				items: {
					type: "string" as const,
					maxLength: 2000,
				},
				minItems: 5,
				maxItems: 5,
			},
			sample_dialogues_out: {
				type: "array" as const,
				description:
					"Array of exactly 5 character responses paired with sample_dialogues_in. Should reflect the character's speaking style, personality, and demonstrate their full range across the 3 guided scenarios and 2 free scenarios. Do NOT prepend with speaker names. Each response maximum 2000 characters.",
				items: {
					type: "string" as const,
					maxLength: 2000,
				},
				minItems: 5,
				maxItems: 5,
			},
		},
		required: [
			"attribute_list",
			"sample_dialogues_in",
			"sample_dialogues_out",
		],
	};
}

function buildPresetPrompt(params: GeneratePresetParams): string {
	let prompt = `You are an expert character creator for a Discord chatbot. Create a detailed character profile based on the following information.

Character Name: ${params.characterName}

Character Description:
${params.characterDescription}

How the Character Speaks:
${params.speechExamples}

Instructions:
- Create a rich, detailed character profile in the structured JSON format
- The character should be interesting and engaging for conversation
- Do NOT prepend the sample dialogues with character names or "User:"/"Character:" prefixes - the chat application will handle that
- Use "{user}" as a placeholder when referring to other people or the conversation partner in dialogues
- Use "{bot}" as a placeholder when referring to the character themselves
- Ensure exactly 5 sample dialogue pairs (sample_dialogues_in paired with sample_dialogues_out)

The attribute_list MUST contain exactly 6 items in this exact order:

1. {bot}'s Description: A comprehensive 2-4 sentence description capturing the character's core identity, essence, and overall vibe. What makes them unique? What's their deal?

2. {bot}'s Appearance: Physical description including hair, eyes, clothing, accessories, and any distinctive features. Be specific and vivid.

3. {bot}'s Personality: A comma-separated list of personality traits that define how they think, act, and interact. Focus on specific, actionable traits (e.g., "selective passion, authentic advisor, music obsessive, practical pessimist").

4. {bot}'s Likes: Things, activities, topics, or concepts the character genuinely enjoys or gravitates toward. Can include brief explanations in parentheses.

5. {bot}'s Dislikes: Things, activities, topics, or concepts the character dislikes, avoids, or finds irritating. Can include brief explanations in parentheses or quotes.

6. {bot}'s Behavioral Quirks: Specific mannerisms, speech patterns, habits, or behaviors that make the character distinctive. How do they express themselves? What are their tells?

The sample_dialogues_in and sample_dialogues_out MUST follow this structure (exactly 5 dialogue pairs):

**3 GUIDED SCENARIOS (Required, in this exact order):**

1. **Self-Introduction Request**: User asks {bot} to introduce themselves (e.g., "Can you introduce yourself, {bot}?" or "Who are you?" or "Tell me about yourself")
   - Response should establish identity, tone, core personality, and set expectations
   - This is the character's "first impression" - make it memorable and authentic

2. **Emotional/Personal Scenario**: User shares feelings, asks for advice, or engages emotionally (e.g., "I'm feeling really down today..." or "I'm having relationship problems..." or "Thanks for helping me, {bot}!")
   - Response should demonstrate empathy, emotional intelligence, and how they handle vulnerability
   - Show their relational depth and caring capacity (or lack thereof, if fitting)

3. **Practical/Functional Scenario**: User asks for help, explanation, or practical advice (e.g., "Can you help me understand taxes?" or "How do I fix this problem?" or "What should I do about...")
   - Response should demonstrate competence, knowledge, and helpfulness
   - Show they can actually be useful beyond just personality

**2 FREE SCENARIOS (Your creative choice):**

4. **Free Dialogue #1**: Choose a scenario that showcases a unique character trait, interest, or quirk
   - Examples: Questions about their specific interests/hobbies, unexpected situations, character-specific topics
   - Make it distinctive and memorable - something that reveals depth

5. **Free Dialogue #2**: Choose another scenario that demonstrates different aspects of the character
   - Avoid repeating patterns from previous dialogues
   - Could be humor, vulnerability, expertise, philosophical musings, or anything that adds dimension`;

	if (params.useWebSearch) {
		prompt += `\n\nWeb Search Instructions:
- Use the available web search tools to gather accurate, up-to-date details when helpful
- If you cannot find reliable information, treat the character as original and rely on the user's description and image
- Do not include citations, URLs, or sources in the JSON output`;
	}

	if (params.additionalInstructions?.trim()) {
		prompt += `\n\nAdditional Instructions: ${params.additionalInstructions.trim()}`;
	}

	prompt += `\n\nIMPORTANT:
- Respond with COMPLETE valid JSON only
- Follow the exact schema provided with strict length limits
- Exactly 6 items in attribute_list in the exact order specified above (each MAX 2000 characters)
- Exactly 5 dialogue pairs following the 3 GUIDED + 2 FREE structure in the exact order specified
- sample_dialogues_in: Keep user messages concise (1-3 sentences, MAX 2000 characters each)
- sample_dialogues_out: Character responses can be longer and more detailed to showcase personality (MAX 2000 characters each)
- No speaker name prefixes in any dialogue (no "User:", "Character:", "{user}:", "{bot}:", etc.)
- Use "{user}" placeholder when character refers to other people in their responses
- Use "{bot}" placeholder when character refers to themselves in their responses
- All string lengths must not exceed 2000 characters per item`;

	return prompt;
}

function extractResponseText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}

	if (Array.isArray(content)) {
		return content
			.filter(
				(part): part is { type: "text"; text: string } =>
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					(part as { type?: string }).type === "text" &&
					"text" in part &&
					typeof (part as { text?: unknown }).text === "string",
			)
			.map((part) => part.text)
			.join("");
	}

	return "";
}

function buildToolErrorResult(message: string): ToolResult {
	return {
		success: false,
		error: message,
		message,
	};
}

/**
 * Generate preset data from user prompts using OpenRouter structured output
 *
 * @param apiKey - Decrypted OpenRouter API key
 * @param params - Generation parameters
 * @param _locale - User's locale for error messages
 * @param options - OpenRouter-specific options (model, tools, temperature)
 * @returns Promise<PresetGenerationResult> - Generated preset or error
 */
export async function generatePresetFromPromptOpenrouter(
	apiKey: string,
	params: GeneratePresetParams,
	_locale: string,
	options: OpenrouterPresetGenerationOptions,
): Promise<PresetGenerationResult> {
	if (!apiKey || apiKey.trim().length < 10) {
		return {
			error: "Invalid OpenRouter API key",
			errorType: "API_KEY",
		};
	}

	const openrouterAdapter = getOpenrouterToolAdapter();
	const tools = options.tools ?? [];
	const toolContext = options.toolContext;
	const toolsEnabled = tools.length > 0 && toolContext;

	const responseFormat = {
		type: "json_schema" as const,
		json_schema: {
			name: "preset_export_data",
			description: "Structured persona preset data",
			schema: buildPresetResponseSchema(),
		},
	};

	const prompt = buildPresetPrompt(params);

	const contentParts: OpenrouterContentPart[] = [
		{ type: "text", text: prompt },
	];

	if (params.imageBase64 && params.imageMimeType) {
		contentParts.push({
			type: "image_url",
			image_url: {
				url: `data:${params.imageMimeType};base64,${params.imageBase64}`,
			},
		});
		log.info("OpenRouter preset generation: image included in prompt");
	}

	const userContent =
		contentParts.length === 1 && contentParts[0].type === "text"
			? contentParts[0].text
			: contentParts;

	const messages: OpenrouterMessage[] = [
		{
			role: "user",
			content: userContent,
		},
	];

	const maxToolRounds = options.maxToolRounds ?? 3;
	let toolRounds = 0;

	while (true) {
		const body: Record<string, unknown> = {
			...(options.model !== "account-setting" ? { model: options.model } : {}),
			messages,
			temperature: options.temperature ?? 1.0,
			max_tokens: 8192,
			response_format: responseFormat,
			plugins: [{ id: "response-healing" }],
			stream: false,
		};

		if (toolsEnabled) {
			body.tools = tools;
			body.tool_choice = "auto";
		}

		const response = await fetch(
			"https://openrouter.ai/api/v1/chat/completions",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			},
		);

		if (!response.ok) {
			const errorBody = await response.text();
			log.error("OpenRouter preset generation request failed", new Error(errorBody), {
				errorType: "OpenrouterPresetHttpError",
				metadata: {
					model: options.model,
					status: response.status,
				},
			});
			return {
				error: `OpenRouter request failed: ${response.status} ${response.statusText}`,
				errorType: "CONNECTION",
			};
		}

		const result = (await response.json()) as {
			choices?: Array<{
				message?: {
					content?: unknown;
					tool_calls?: OpenrouterToolCall[];
				};
			}>;
		};

		const message = result.choices?.[0]?.message;
		if (!message) {
			return {
				error: "OpenRouter returned an empty response.",
				errorType: "EMPTY_RESPONSE",
			};
		}

		const toolCalls = message.tool_calls ?? [];
		if (toolCalls.length > 0) {
			if (!toolsEnabled || !toolContext) {
				return {
					error: "OpenRouter requested tool calls but tools are not available.",
					errorType: "MODEL_ERROR",
				};
			}

			toolRounds += 1;
			if (toolRounds > maxToolRounds) {
				return {
					error: "OpenRouter tool call loop exceeded limit.",
					errorType: "TIMEOUT",
				};
			}

			const normalizedToolCalls = toolCalls.map((toolCall, index) => ({
				...toolCall,
				id: toolCall.id ?? `tool_call_${toolRounds}_${index}`,
			}));

			messages.push({
				role: "assistant",
				content: typeof message.content === "string" ? message.content : null,
				tool_calls: normalizedToolCalls,
			});

			for (const toolCall of normalizedToolCalls) {
				const functionName = toolCall.function?.name;
				const rawArgs = toolCall.function?.arguments ?? "";

				let toolResult: ToolResult | undefined;
				let parsedArgs: Record<string, unknown> = {};

				if (!functionName) {
					toolResult = buildToolErrorResult(
						"Tool call missing function name",
					);
				} else {
					if (rawArgs) {
						try {
							parsedArgs = JSON.parse(rawArgs);
						} catch (parseError) {
							log.warn(
								`OpenRouter tool call args parse failed for ${functionName}: ${rawArgs}`,
								parseError as Error,
							);
							toolResult = buildToolErrorResult(
								`Invalid tool arguments for ${functionName}`,
							);
						}
					}

					if (!toolResult) {
						log.info(
							`Executing OpenRouter tool call: ${functionName} with args: ${JSON.stringify(parsedArgs)}`,
						);
						toolResult = await executeTool(
							functionName,
							parsedArgs,
							toolContext,
						);
					}
				}

				const convertedResult = openrouterAdapter.convertResult(
					toolResult ?? buildToolErrorResult("Tool execution failed"),
				);
				const resultContent =
					typeof convertedResult.content === "string"
						? convertedResult.content
						: JSON.stringify(convertedResult.content);
				const toolCallId = toolCall.id ?? "tool_call_unknown";

				messages.push({
					role: "tool",
					tool_call_id: toolCallId,
					content: resultContent,
				});
			}

			continue;
		}

		const responseText = extractResponseText(message.content);
		if (!responseText || responseText.trim() === "") {
			return {
				error: "OpenRouter returned an empty response.",
				errorType: "EMPTY_RESPONSE",
			};
		}

		let parsedResponse: {
			attribute_list?: string[];
			sample_dialogues_in?: string[];
			sample_dialogues_out?: string[];
		};

		try {
			parsedResponse = JSON.parse(responseText);
		} catch (parseError) {
			log.error("OpenRouter preset generation JSON parse failed", parseError as Error);
			return {
				error: "Invalid JSON response from OpenRouter.",
				errorType: "INVALID_JSON",
			};
		}

		if (
			!parsedResponse.attribute_list ||
			!parsedResponse.sample_dialogues_in ||
			!parsedResponse.sample_dialogues_out
		) {
			return {
				error: "Generated character data is incomplete. Please try again.",
				errorType: "INVALID_JSON",
			};
		}

		if (
			!Array.isArray(parsedResponse.attribute_list) ||
			parsedResponse.attribute_list.length !== 6
		) {
			return {
				error:
					"Generated attribute list must contain exactly 6 items. Please try again.",
				errorType: "VALIDATION_ERROR",
			};
		}

		if (
			!Array.isArray(parsedResponse.sample_dialogues_in) ||
			parsedResponse.sample_dialogues_in.length !== 5
		) {
			return {
				error: "Generated sample dialogues must contain exactly 5 user inputs.",
				errorType: "VALIDATION_ERROR",
			};
		}

		if (
			!Array.isArray(parsedResponse.sample_dialogues_out) ||
			parsedResponse.sample_dialogues_out.length !== 5
		) {
			return {
				error:
					"Generated sample dialogues must contain exactly 5 character responses.",
				errorType: "VALIDATION_ERROR",
			};
		}

		const sanitizedDialoguesIn = parsedResponse.sample_dialogues_in.map(
			sanitizeSampleDialogueText,
		);
		const sanitizedDialoguesOut = parsedResponse.sample_dialogues_out.map(
			sanitizeSampleDialogueText,
		);

		const preset = {
			tomori_nickname: params.characterName,
			trigger_words: [params.characterName],
			attribute_list: parsedResponse.attribute_list,
			sample_dialogues_in: sanitizedDialoguesIn,
			sample_dialogues_out: sanitizedDialoguesOut,
		};

		log.success(`OpenRouter preset generation successful for ${params.characterName}`);
		return { preset };
	}
}

import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import type { ErrorContext } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/interactionHelper";
import { getMemoryLimits } from "@/utils/db/memoryLimits";
import { getAvailableToolsForContext } from "@/tools/toolRegistry";

/**
 * Token estimation constants
 *
 * Important notes:
 * - Tokenization varies a lot by language (English vs Japanese), punctuation/JSON, and provider/model.
 * - These numbers are intentionally "ballpark" and are tuned to roughly match typical chat-style prompts.
 * - Tool/function schemas (JSON) usually tokenize a bit denser than natural language prose.
 */
const CHARS_PER_TOKEN_TEXT = 4;
const CHARS_PER_TOKEN_JSON = 3.5;

/**
 * Rough per-message overhead for chat-format wrappers (role markers, separators, etc.).
 * This is provider/model dependent, but it matters when you have ~80 messages of history.
 */
const TOKENS_PER_CHAT_MESSAGE_OVERHEAD = 4;

/**
 * Conversation history is formatted as "{authorName}: {message}" in contextBuilder.ts.
 * Approximate average speaker prefix length (name + ": ").
 */
const AVG_SPEAKER_PREFIX_CHARS = 12;

/**
 * Approximate fixed-length instruction blocks included in contextBuilder.ts.
 * These are intentionally rounded; exact lengths vary with server/bot/user names.
 */
const DEFAULT_SYSTEM_PROMPT_CHARS_EST = 360;
const MENTION_PING_RULE_CHARS_EST = 300;
const EMOJI_USAGE_RULES_CHARS_EST = 340;
const STICKER_USAGE_RULES_CHARS_EST = 270; // header + footer, excluding per-sticker lines

/**
 * Scenario definitions for cost estimation
 * These represent minimum, average, and maximum usage patterns
 */
interface ScenarioEstimate {
	name: string;
	components: {
		systemPersonality: number; // Attributes + humanizer instruction
		serverInfo: number; // Server name, description
		serverEmojis: number; // Up to 10 emojis
		serverStickers: number; // Sticker list (if enabled)
		serverMemories: number; // Server-wide memories
		userMemories: number; // Personal memories for all users
		userStatus: number; // Presence info for all users
		reminders: number; // Pending reminders
		currentContext: number; // Time, channel info
		toolSchemas: number; // Function/tool schemas (if tool calling is enabled)
		sampleDialogues: number; // Example conversations
		conversationHistory: number; // Recent messages
	};
	outputTokens: number; // Expected response length
}

/**
 * Calculate token count from character count
 * @param chars - Number of characters
 * @returns Estimated token count
 */
function charsToTokensText(chars: number): number {
	return Math.ceil(chars / CHARS_PER_TOKEN_TEXT);
}

/**
 * Calculate token count for JSON-ish strings (tools, schemas).
 * JSON generally tokenizes slightly denser than prose, so we use a smaller chars/token ratio.
 * @param chars - Number of characters
 * @returns Estimated token count
 */
function charsToTokensJson(chars: number): number {
	return Math.ceil(chars / CHARS_PER_TOKEN_JSON);
}

/**
 * Estimate tokens for a chat history made of many short messages.
 * Includes a small fixed per-message overhead for chat wrappers plus speaker prefixes.
 * @param messageCount - Number of messages
 * @param avgMessageChars - Average characters per message (excluding speaker prefix)
 * @returns Estimated token count
 */
function estimateChatHistoryTokens(
	messageCount: number,
	avgMessageChars: number,
): number {
	const totalChars =
		messageCount * (avgMessageChars + AVG_SPEAKER_PREFIX_CHARS);
	return (
		charsToTokensText(totalChars) +
		messageCount * TOKENS_PER_CHAT_MESSAGE_OVERHEAD
	);
}

/**
 * Estimate tool schema token overhead based on currently registered tools.
 * Falls back to a conservative constant if tools are not initialized.
 * @returns Estimated token count for tool schemas
 */
function estimateToolSchemaTokens(): number {
	try {
			const stateForContext = {
				server_id: "0",
				config: {
					// Defaults match DB defaults in schema.sql (true)
					sticker_usage_enabled: true,
					web_search_enabled: true,
					self_teaching_enabled: true,
					pin_message_enabled: true,
					imagegen_enabled: true,
				},
			};

		// /help cost uses Gemini pricing as the example provider → estimate Google tool schemas.
		const tools = getAvailableToolsForContext("google", stateForContext) ?? [];
		if (tools.length === 0) return 1200;

		const simplified = tools.map((t) => ({
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		}));

		const json = JSON.stringify(simplified);
		return charsToTokensJson(json.length);
	} catch {
		// Conservative fallback
		return 1200;
	}
}

/**
 * Build scenario estimates based on memory limits and usage patterns
 * @returns Object containing minimum, average, and maximum scenarios
 */
function buildScenarioEstimates(): {
	minimum: ScenarioEstimate;
	average: ScenarioEstimate;
	maximum: ScenarioEstimate;
} {
	const limits = getMemoryLimits();
	const baseToolSchemaTokens = estimateToolSchemaTokens();
	const avgMemoryChars = Math.round(limits.maxMemoryLength * 0.5); // e.g., 128 when max is 256

	// 1. Minimum Scenario (Light usage)
	// - 1 user with 0 memories
	// - Minimal persona (single short description)
	// - 80 messages in history (short messages)
	// - 10 emojis (constant)
	const minimum: ScenarioEstimate = {
		name: "Minimum",
		components: {
			systemPersonality: charsToTokensText(
				450 + DEFAULT_SYSTEM_PROMPT_CHARS_EST + MENTION_PING_RULE_CHARS_EST,
			), // Short description + default system prompt + mention rule
			serverInfo: charsToTokensText(220), // Basic server info
			serverEmojis: charsToTokensText(
				EMOJI_USAGE_RULES_CHARS_EST + 60 + 10 * 34,
			), // Rules + header + 10 emoji codes
			serverStickers: 0,
			serverMemories: 0,
			userMemories: 0,
			userStatus: charsToTokensText(220), // 1 user status block (heading + presence line)
			reminders: 0,
			currentContext: charsToTokensText(200), // Time + channel
			toolSchemas: baseToolSchemaTokens,
			sampleDialogues: 0,
			conversationHistory: estimateChatHistoryTokens(80, 40),
		},
		outputTokens: 80, // Short response (1-2 short paragraphs)
	};

	// 2. Average Scenario (Moderate usage)
	// - 3 users with 10 memories each (~128 chars avg per memory)
	// - 10 server memories (~128 chars avg each)
	// - Typical persona + a few sample dialogues
	// - 80 messages in history (1-2 sentences per message)
	// - 10 emojis (constant)
	const average: ScenarioEstimate = {
		name: "Average",
		components: {
			// Persona attributes (commonly 6 items) + fixed system prompt blocks.
			systemPersonality: charsToTokensText(
				6 * 700 + DEFAULT_SYSTEM_PROMPT_CHARS_EST + MENTION_PING_RULE_CHARS_EST,
			),
			serverInfo: charsToTokensText(260),
			serverEmojis: charsToTokensText(
				EMOJI_USAGE_RULES_CHARS_EST + 60 + 10 * 34,
			),
			// Approximate: small sticker list exists, but not huge.
			serverStickers: charsToTokensText(STICKER_USAGE_RULES_CHARS_EST + 8 * 70),
			serverMemories: charsToTokensText(10 * avgMemoryChars + 80), // + heading/formatting
			userMemories: charsToTokensText(3 * 10 * avgMemoryChars + 3 * 90), // + per-user headings
			userStatus: charsToTokensText(3 * 220),
			reminders: charsToTokensText(3 * (80 + 1 * 140)), // 1 reminder per user on average
			currentContext: charsToTokensText(200),
			toolSchemas: baseToolSchemaTokens,
			// 5 sample dialogue pairs (10 messages), short-ish.
			sampleDialogues: estimateChatHistoryTokens(10, 160),
			conversationHistory: estimateChatHistoryTokens(80, 140),
		},
		outputTokens: 220, // Typical response (a few paragraphs / short explanation)
	};

	// 3. Maximum Scenario (Heavy usage)
	// - 5 users with 25 memories each (256 chars max per memory)
	// - 25 server memories (256 chars max each)
	// - Maxed persona + maxed sample dialogues
	// - 80 messages in history (multi-paragraph messages)
	// - 10 emojis (constant)
	const maximum: ScenarioEstimate = {
		name: "Maximum",
		components: {
			systemPersonality: charsToTokensText(
				limits.maxAttributes * limits.maxAttributeLength +
					DEFAULT_SYSTEM_PROMPT_CHARS_EST +
					MENTION_PING_RULE_CHARS_EST,
			),
			serverInfo: charsToTokensText(450), // Detailed description
			serverEmojis: charsToTokensText(
				EMOJI_USAGE_RULES_CHARS_EST + 60 + 10 * 34,
			),
			serverStickers: charsToTokensText(STICKER_USAGE_RULES_CHARS_EST + 25 * 90),
			serverMemories: charsToTokensText(
				limits.maxServerMemories * limits.maxMemoryLength,
			),
			userMemories: charsToTokensText(
				5 * limits.maxPersonalMemories * limits.maxMemoryLength,
			),
			userStatus: charsToTokensText(5 * 300), // activities can bloat presence strings
			reminders: charsToTokensText(5 * (100 + 3 * 160)), // 3 reminders per user
			currentContext: charsToTokensText(240),
			// Tool schemas tend to be constant; add a little headroom for MCP / extra schemas.
			toolSchemas: Math.round(baseToolSchemaTokens * 1.25),
			// Max sample dialogues (pairs), using the separate MAX_SAMPLE_DIALOGUE_LENGTH
			sampleDialogues: estimateChatHistoryTokens(
				limits.maxSampleDialogues * 2,
				limits.maxSampleDialogueLength,
			),
			conversationHistory: estimateChatHistoryTokens(80, 350),
		},
		outputTokens: 500, // Detailed response (multi-paragraph explanation)
	};

	return { minimum, average, maximum };
}

/**
 * Calculate total input tokens for a scenario
 * @param scenario - Scenario estimate object
 * @returns Total input token count
 */
function calculateTotalInputTokens(scenario: ScenarioEstimate): number {
	return Object.values(scenario.components).reduce((sum, val) => sum + val, 0);
}

/**
 * Calculate cost for a scenario based on provider pricing
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param inputPricePerMillion - Input token price per million
 * @param outputPricePerMillion - Output token price per million
 * @returns Cost in dollars
 */
function calculateCost(
	inputTokens: number,
	outputTokens: number,
	inputPricePerMillion: number,
	outputPricePerMillion: number,
): number {
	const inputCost = (inputTokens / 1_000_000) * inputPricePerMillion;
	const outputCost = (outputTokens / 1_000_000) * outputPricePerMillion;
	return inputCost + outputCost;
}

/**
 * Configure the /help cost subcommand
 * Shows users estimated API costs for paid providers
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("cost")
		.setDescription(localizer("en-US", "commands.help.cost.description"));

/**
 * Execute the /help cost command
 * Displays estimated API costs for different usage scenarios
 * @param _client - Discord client instance
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
	try {
		// Build scenario estimates
		const scenarios = buildScenarioEstimates();

		// Example provider: Gemini 2.5 Flash
		// Input: $0.3/M tokens, Output: $2.5/M tokens
		const exampleProvider = "Gemini 2.5 Flash";
		const inputPrice = 0.3;
		const outputPrice = 2.5;

		// Calculate costs for each scenario
		const minInputTokens = calculateTotalInputTokens(scenarios.minimum);
		const avgInputTokens = calculateTotalInputTokens(scenarios.average);
		const maxInputTokens = calculateTotalInputTokens(scenarios.maximum);

		const minCost = calculateCost(
			minInputTokens,
			scenarios.minimum.outputTokens,
			inputPrice,
			outputPrice,
		);
		const avgCost = calculateCost(
			avgInputTokens,
			scenarios.average.outputTokens,
			inputPrice,
			outputPrice,
		);
		const maxCost = calculateCost(
			maxInputTokens,
			scenarios.maximum.outputTokens,
			inputPrice,
			outputPrice,
		);

		// Format cost breakdown fields
		const fields = [
			{
				nameKey: "commands.help.cost.minimum_scenario_title",
				value: localizer(locale, "commands.help.cost.minimum_scenario_value", {
					inputTokens: minInputTokens.toLocaleString(),
					outputTokens: scenarios.minimum.outputTokens.toLocaleString(),
					totalTokens: (
						minInputTokens + scenarios.minimum.outputTokens
					).toLocaleString(),
					costPerMessage: `$${minCost.toFixed(5)}`,
					costPer100: `$${(minCost * 100).toFixed(3)}`,
				}),
				inline: false,
			},
			{
				nameKey: "commands.help.cost.average_scenario_title",
				value: localizer(locale, "commands.help.cost.average_scenario_value", {
					inputTokens: avgInputTokens.toLocaleString(),
					outputTokens: scenarios.average.outputTokens.toLocaleString(),
					totalTokens: (
						avgInputTokens + scenarios.average.outputTokens
					).toLocaleString(),
					costPerMessage: `$${avgCost.toFixed(5)}`,
					costPer100: `$${(avgCost * 100).toFixed(3)}`,
				}),
				inline: false,
			},
			{
				nameKey: "commands.help.cost.maximum_scenario_title",
				value: localizer(locale, "commands.help.cost.maximum_scenario_value", {
					inputTokens: maxInputTokens.toLocaleString(),
					outputTokens: scenarios.maximum.outputTokens.toLocaleString(),
					totalTokens: (
						maxInputTokens + scenarios.maximum.outputTokens
					).toLocaleString(),
					costPerMessage: `$${maxCost.toFixed(5)}`,
					costPer100: `$${(maxCost * 100).toFixed(3)}`,
				}),
				inline: false,
			},
			{
				nameKey: "commands.help.cost.breakdown_title",
				value: localizer(locale, "commands.help.cost.breakdown_value"),
				inline: false,
			},
		];

		// Send the embed
		await replySummaryEmbed(
			interaction,
			locale,
			{
				titleKey: "commands.help.cost.title",
				descriptionKey: "commands.help.cost.embed_description",
				descriptionVars: {
					provider: exampleProvider,
					inputPrice: `$${inputPrice}`,
					outputPrice: `$${outputPrice}`,
				},
				color: ColorCode.INFO,
				fields,
				footerKey: "commands.help.cost.footer",
			},
			MessageFlags.Ephemeral,
		);
	} catch (error) {
		// Log error with context
		const context: ErrorContext = {
			userId: userData.user_id,
			errorType: "CommandExecutionError",
			metadata: {
				commandName: "/help cost",
				guildDiscordId: interaction.guild?.id,
			},
		};
		await log.error(
			"Error executing /help cost command",
			error as Error,
			context,
		);

		// Inform user of error (ephemeral)
		const errorMessage = localizer(
			locale,
			"general.errors.unknown_error_description",
		);
		try {
			if (interaction.replied || interaction.deferred) {
				await interaction.followUp({
					content: errorMessage,
					flags: MessageFlags.Ephemeral,
				});
			} else {
				await interaction.reply({
					content: errorMessage,
					flags: MessageFlags.Ephemeral,
				});
			}
		} catch (replyError) {
			// Log if even the error reply fails
			log.error(
				"Failed to send error reply for /help cost",
				replyError,
				context,
			);
		}
	}
}

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

/**
 * Token estimation constants
 * Based on common approximation: 1 token ≈ 4 characters for English text
 */
const CHARS_PER_TOKEN = 4;

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
function charsToTokens(chars: number): number {
	return Math.ceil(chars / CHARS_PER_TOKEN);
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

	// 1. Minimum Scenario (Light usage)
	// - 1 user with 0 memories
	// - 1 paragraph of persona (just description, no attributes/dialogues, ~500 chars)
	// - 80 messages in history (~25 chars each, less than a sentence)
	// - 10 emojis (constant)
	const minimum: ScenarioEstimate = {
		name: "Minimum",
		components: {
			systemPersonality: charsToTokens(500 + 200), // 1 minimal paragraph + humanizer
			serverInfo: charsToTokens(200), // Basic server info
			serverEmojis: charsToTokens(10 * 40), // 10 emojis × ~40 chars each (constant)
			serverStickers: 0, // Negligible, not counted
			serverMemories: 0,
			userMemories: 0,
			userStatus: charsToTokens(100), // 1 user status
			reminders: 0,
			currentContext: charsToTokens(150), // Time + channel
			sampleDialogues: 0, // Already counted in systemPersonality
			conversationHistory: charsToTokens(80 * 25), // 80 messages × 25 chars
		},
		outputTokens: 100, // Very short response (~25 chars, less than a sentence)
	};

	// 2. Average Scenario (Moderate usage)
	// - 3 users with 10 memories each (~128 chars avg per memory)
	// - 10 server memories (~128 chars avg each)
	// - ~16 paragraphs of persona (~600 chars avg each, includes 5 attributes + 5 dialogue pairs)
	// - 80 messages in history (~125 chars avg each, 1-2 sentences per message)
	// - 10 emojis (constant)
	const average: ScenarioEstimate = {
		name: "Average",
		components: {
			systemPersonality: charsToTokens(16 * 600 + 200), // 16 paragraphs (incl. dialogues) + humanizer
			serverInfo: charsToTokens(200),
			serverEmojis: charsToTokens(10 * 40), // 10 emojis × ~40 chars each (constant)
			serverStickers: 0, // Negligible, not counted
			serverMemories: charsToTokens(10 * 128), // 10 memories × 128 chars
			userMemories: charsToTokens(3 * 10 * 128), // 3 users × 10 memories × 128 chars
			userStatus: charsToTokens(3 * 100), // 3 users × 100 chars
			reminders: 0, // Occasional
			currentContext: charsToTokens(150),
			sampleDialogues: 0, // Already counted in systemPersonality
			conversationHistory: charsToTokens(80 * 125), // 80 messages × 125 chars
		},
		outputTokens: 300, // Moderate response (1-2 sentences, ~125 chars)
	};

	// 3. Maximum Scenario (Heavy usage)
	// - 5 users with 25 memories each (256 chars max per memory)
	// - 25 server memories (256 chars max each)
	// - ~31 paragraphs of persona (2000 chars max each, includes 10 attributes + 10 dialogue pairs)
	// - 80 messages in history (~450 chars avg each, 2 paragraphs per message)
	// - 10 emojis (constant)
	const maximum: ScenarioEstimate = {
		name: "Maximum",
		components: {
			systemPersonality: charsToTokens(
				// 1 description + 10 attributes + (10 dialogues × 2 texts) = 31 paragraphs
				31 * limits.maxAttributeLength + 200,
			), // 31 paragraphs × 2000 chars + humanizer
			serverInfo: charsToTokens(300), // Detailed description
			serverEmojis: charsToTokens(10 * 40), // 10 emojis × ~40 chars each (constant)
			serverStickers: 0, // Negligible, not counted
			serverMemories: charsToTokens(
				limits.maxServerMemories * limits.maxMemoryLength,
			), // 25 × 256
			userMemories: charsToTokens(
				5 * limits.maxPersonalMemories * limits.maxMemoryLength,
			), // 5 users × 25 × 256
			userStatus: charsToTokens(5 * 100), // 5 users with presence
			reminders: charsToTokens(5 * 2 * 100), // 2 reminders per user × 100 chars
			currentContext: charsToTokens(200),
			sampleDialogues: 0, // Already counted in systemPersonality
			conversationHistory: charsToTokens(80 * 450), // 80 messages × 450 chars
		},
		outputTokens: 900, // Detailed response (2 paragraphs, ~450 chars)
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
			MessageFlags.SuppressNotifications,
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

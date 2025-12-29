/**
 * Emoji repetition penalty system to prevent excessive custom emoji usage
 * Analyzes bot's recent messages and injects guidance when threshold is exceeded
 * NOTE: Only counts custom server emojis (:name:), NOT Unicode emojis (😊, 👍)
 *
 * Configuration via environment variables:
 * - EMOJI_PENALTY_ENABLED: Enable/disable the feature (default: true)
 * - EMOJI_PENALTY_LOOKBACK: Number of recent messages to check (default: 3)
 * - EMOJI_PENALTY_THRESHOLD: Max custom emojis allowed across lookback window (default: 1)
 */

import type { StructuredContextItem } from "../../types/misc/context";
import { ContextItemTag } from "../../types/misc/context";
import { extractCustomEmojis, filterCustomEmojis } from "./emojiHelper";
import { log } from "../misc/logger";

/**
 * Configuration for emoji penalty thresholds
 */
interface EmojiPenaltyConfig {
	/** Whether the emoji penalty system is enabled */
	readonly enabled: boolean;
	/** Number of recent bot messages to analyze */
	readonly lookbackCount: number;
	/** Maximum total emojis allowed across the lookback window */
	readonly maxEmojis: number;
}

/**
 * Load emoji penalty configuration from environment variables
 * @returns Configuration object with enabled status and thresholds
 */
function loadEmojiPenaltyConfig(): EmojiPenaltyConfig {
	// 1. Check if feature is enabled (default: true)
	const enabled = process.env.EMOJI_PENALTY_ENABLED !== "false";

	// 2. Load lookback count (default: 3 messages)
	const lookbackCount = Number.parseInt(
		process.env.EMOJI_PENALTY_LOOKBACK || "3",
		10,
	);

	// 3. Load max emoji threshold (default: 1, meaning 2+ triggers penalty)
	const maxEmojis = Number.parseInt(
		process.env.EMOJI_PENALTY_THRESHOLD || "1",
		10,
	);

	return {
		enabled,
		lookbackCount: Number.isNaN(lookbackCount) ? 2 : lookbackCount,
		maxEmojis: Number.isNaN(maxEmojis) ? 1 : maxEmojis,
	};
}

/**
 * Extract text content from a StructuredContextItem's parts
 * @param item - The context item to extract text from
 * @returns Concatenated text from all text parts
 */
function extractTextFromContextItem(item: StructuredContextItem): string {
	// 1. Filter for text parts only
	const textParts = item.parts.filter((part) => part.type === "text");

	// 2. Concatenate all text content
	return textParts.map((part) => part.text).join(" ");
}

/**
 * Analyze recent bot messages for excessive emoji usage
 * @param contextItems - Full context history to analyze
 * @param config - Optional threshold configuration (loads from env if not provided)
 * @returns True if emoji usage exceeds threshold, false otherwise
 */
export function shouldApplyEmojiPenalty(
	contextItems: StructuredContextItem[],
	config?: EmojiPenaltyConfig,
): boolean {
	// 1. Load config from environment if not provided
	const penaltyConfig = config ?? loadEmojiPenaltyConfig();

	// 2. Early return if feature is disabled
	if (!penaltyConfig.enabled) {
		return false;
	}
	// 3. Filter for bot messages in dialogue history (role: "model")
	//    We only care about actual dialogue, not system prompts or sample dialogues
	const botMessages = contextItems.filter(
		(item) =>
			item.role === "model" &&
			item.metadataTag === ContextItemTag.DIALOGUE_HISTORY,
	);

	log.info(
		`[Emoji Penalty] Found ${botMessages.length} bot messages in dialogue history`,
	);

	// 4. If no bot messages exist at all, no penalty needed
	if (botMessages.length === 0) {
		log.info("[Emoji Penalty] No bot messages found, skipping penalty");
		return false;
	}

	// 5. Get the last N bot messages (or all available if fewer than lookback)
	const messagesToCheck = Math.min(
		botMessages.length,
		penaltyConfig.lookbackCount,
	);
	const recentBotMessages = botMessages.slice(-messagesToCheck);

	log.info(
		`[Emoji Penalty] Checking last ${messagesToCheck} message(s) (lookback config: ${penaltyConfig.lookbackCount})`,
	);

	// 6. Count total CUSTOM emojis across recent messages (ignore Unicode emojis)
	let totalCustomEmojis = 0;
	const emojiCounts: string[] = [];
	for (const message of recentBotMessages) {
		const text = extractTextFromContextItem(message);
		const customEmojis = extractCustomEmojis(text);
		const count = customEmojis.length;
		totalCustomEmojis += count;
		emojiCounts.push(
			`"${text.substring(0, 50)}..." = ${count} custom emoji(s)${count > 0 ? `: ${customEmojis.join(", ")}` : ""}`,
		);
	}

	log.info(`[Emoji Penalty] Analyzed messages:\n${emojiCounts.join("\n")}`);
	log.info(
		`[Emoji Penalty] Total: ${totalCustomEmojis} custom emojis (threshold: ${penaltyConfig.maxEmojis})`,
	);

	// 7. Check if threshold exceeded
	const shouldTrigger = totalCustomEmojis > penaltyConfig.maxEmojis;
	log.info(
		`[Emoji Penalty] ${shouldTrigger ? "TRIGGERING" : "NOT triggering"} penalty (custom emojis only)`,
	);

	return shouldTrigger;
}

/**
 * Generate an emoji penalty message to inject into context
 * This message appears as natural user guidance to reduce emoji usage
 * @param botName - The bot's current nickname
 * @returns A StructuredContextItem to append to context
 */
export function generateEmojiPenaltyMessage(
	botName: string,
): StructuredContextItem {
	// Create a natural-sounding reminder message
	// It appears as a user message to be close to generation point
	const penaltyText = `[System: ${botName} has been using emojis too frequently in recent messages. Respond to this message without using any emojis to maintain natural conversation flow.]`;

	return {
		role: "user",
		parts: [
			{
				type: "text",
				text: penaltyText,
			},
		],
		metadataTag: ContextItemTag.DIALOGUE_HISTORY, // Tag as dialogue to keep it close to generation
	};
}

/**
 * Main function to check and apply emoji penalty if needed
 * Call this after building context but before sending to LLM
 * @param contextItems - The full context array to potentially modify
 * @param botName - The bot's current nickname
 * @returns Modified context array with penalty message if threshold exceeded, otherwise unchanged
 */
export function applyEmojiPenaltyIfNeeded(
	contextItems: StructuredContextItem[],
	botName: string,
): StructuredContextItem[] {
	// 1. Check if penalty should be applied
	if (!shouldApplyEmojiPenalty(contextItems)) {
		return contextItems;
	}

	// 2. Generate and append penalty message
	const penaltyMessage = generateEmojiPenaltyMessage(botName);

	// 3. Return new array with penalty message appended
	return [...contextItems, penaltyMessage];
}

/**
 * Configuration for unique emoji enforcement
 */
interface UniqueEmojiConfig {
	/** Whether unique emoji enforcement is enabled */
	readonly enabled: boolean;
	/** Number of recent bot messages to track for unique emojis */
	readonly lookbackCount: number;
}

/**
 * Load unique emoji enforcement configuration from environment variables
 * @returns Configuration object with enabled status and lookback count
 */
function loadUniqueEmojiConfig(): UniqueEmojiConfig {
	// 1. Check if feature is enabled (default: true)
	const enabled = process.env.EMOJI_UNIQUE_ENABLED !== "false";

	// 2. Load lookback count (default: 5 messages)
	const lookbackCount = Number.parseInt(
		process.env.EMOJI_UNIQUE_LOOKBACK || "5",
		10,
	);

	return {
		enabled,
		lookbackCount: Number.isNaN(lookbackCount) ? 5 : lookbackCount,
	};
}

/**
 * Get set of custom emojis used in recent bot messages
 * @param contextItems - Full context history
 * @param config - Optional configuration (loads from env if not provided)
 * @returns Set of custom emoji strings used in recent messages (e.g., ":tomori:", ":pepehands:")
 */
export function getRecentlyUsedCustomEmojis(
	contextItems: StructuredContextItem[],
	config?: UniqueEmojiConfig,
): Set<string> {
	// 1. Load config from environment if not provided
	const uniqueConfig = config ?? loadUniqueEmojiConfig();

	// 2. Early return if feature is disabled
	if (!uniqueConfig.enabled) {
		return new Set();
	}

	// 3. Filter for bot messages in dialogue history
	const botMessages = contextItems.filter(
		(item) =>
			item.role === "model" &&
			item.metadataTag === ContextItemTag.DIALOGUE_HISTORY,
	);

	// 4. If no bot messages exist, return empty set
	if (botMessages.length === 0) {
		return new Set();
	}

	// 5. Get the last N bot messages (or all available if fewer)
	const messagesToCheck = Math.min(
		botMessages.length,
		uniqueConfig.lookbackCount,
	);
	const recentBotMessages = botMessages.slice(-messagesToCheck);

	// 6. Extract all custom emojis from recent messages
	const usedEmojis = new Set<string>();
	for (const message of recentBotMessages) {
		const text = extractTextFromContextItem(message);
		const customEmojis = extractCustomEmojis(text);
		for (const emoji of customEmojis) {
			usedEmojis.add(emoji.toLowerCase()); // Store lowercase for case-insensitive matching
		}
	}

	log.info(
		`[Unique Emoji] Found ${usedEmojis.size} unique custom emoji(s) in last ${messagesToCheck} message(s): ${Array.from(usedEmojis).join(", ") || "(none)"}`,
	);

	return usedEmojis;
}

/**
 * Filter duplicate custom emojis from generated text
 * Removes any custom emojis that were already used in recent bot messages
 * @param generatedText - The text generated by the LLM
 * @param contextItems - Full context history to check for recent emoji usage
 * @returns Filtered text with duplicate custom emojis removed
 */
export function filterDuplicateCustomEmojis(
	generatedText: string,
	contextItems: StructuredContextItem[],
): string {
	// 1. Get recently used custom emojis
	const recentlyUsed = getRecentlyUsedCustomEmojis(contextItems);

	// 2. If no emojis to filter, return original text
	if (recentlyUsed.size === 0) {
		return generatedText;
	}

	// 3. Extract custom emojis from generated text
	const emojisInGenerated = extractCustomEmojis(generatedText);

	// 4. Find which emojis need to be filtered (case-insensitive)
	const emojisToRemove = new Set<string>();
	for (const emoji of emojisInGenerated) {
		if (recentlyUsed.has(emoji.toLowerCase())) {
			emojisToRemove.add(emoji);
		}
	}

	// 5. If no duplicates found, return original text
	if (emojisToRemove.size === 0) {
		log.info(
			"[Unique Emoji] No duplicate custom emojis found in generated text",
		);
		return generatedText;
	}

	// 6. Filter duplicates and log
	const filtered = filterCustomEmojis(generatedText, emojisToRemove);
	log.info(
		`[Unique Emoji] Filtered ${emojisToRemove.size} duplicate custom emoji(s): ${Array.from(emojisToRemove).join(", ")}`,
	);
	log.info(`[Unique Emoji] Original: "${generatedText}"`);
	log.info(`[Unique Emoji] Filtered: "${filtered}"`);

	return filtered;
}

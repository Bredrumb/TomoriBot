/**
 * /server initialize expressions command
 *
 * Uses LLM vision with structured output to automatically analyze and classify
 * all custom emojis and stickers in a Discord server, generating emotion keys
 * and descriptions for use in bot responses.
 *
 * Requires model with both sees_images=true and supports_structoutput=true
 */

import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { sql } from "@/utils/db/client";
import { loadTomoriState } from "@/utils/db/dbRead";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import { getAllEmotionKeys } from "@/types/misc/emotions";
import {
	callGoogleStructuredOutput,
	type ExpressionClassification,
	ExpressionBatchResultSchema,
} from "@/providers/utils/structuredOutput";
import { decryptApiKey } from "@/utils/security/crypto";

/**
 * Configure the subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("expressions")
		.setDescription(
			localizer("en-US", "commands.server.initialize.expressions.description"),
		);

/**
 * Database row type for uninitialized emojis
 */
interface UninitializedEmoji {
	emoji_disc_id: string;
	emoji_name: string;
	is_animated: boolean;
}

/**
 * Database row type for uninitialized stickers
 */
interface UninitializedSticker {
	sticker_disc_id: string;
	sticker_name: string;
	sticker_format: number;
}

/**
 * Convert ColorCode hex string to Discord number format
 * @param hexColor - Hex color string (e.g., "#3498DB")
 * @returns Numeric color code for Discord embeds
 */
function hexToNumber(hexColor: string): number {
	return Number.parseInt(hexColor.replace("#", ""), 16);
}

/**
 * Build Discord CDN URL for an emoji
 * Always use .png format (including for animated emojis - gets first frame)
 *
 * @param emojiId - Discord emoji ID (snowflake)
 * @returns Discord CDN URL for the emoji as PNG
 */
function buildEmojiCDNUrl(emojiId: string): string {
	return `https://cdn.discordapp.com/emojis/${emojiId}.png`;
}

/**
 * Build Discord CDN URL for a sticker
 * Always use .png format
 *
 * @param stickerId - Discord sticker ID (snowflake)
 * @returns Discord CDN URL for the sticker as PNG
 */
function buildStickerCDNUrl(stickerId: string): string {
	return `https://cdn.discordapp.com/stickers/${stickerId}.png`;
}

/**
 * Build system prompt for LLM
 * @returns System instruction text
 */
function buildSystemPrompt(): string {
	return `You are an expert visual analyzer specializing in classifying emojis and stickers based on their emotional expression.

Your task is to analyze custom Discord emojis and stickers and classify each one into exactly one of these 28 emotion categories:

${getAllEmotionKeys().join(", ")}

Guidelines:
- Focus on the PRIMARY emotion conveyed by the visual design
- "neutral" is for emotionally ambiguous or abstract designs
- Descriptions should be ONE concise sentence describing what you see
- Match emoji/sticker names case-insensitively`;
}

/**
 * Build user prompt for LLM
 *
 * @param items - Array of items to analyze (with name and type)
 * @returns User prompt text
 */
function buildUserPrompt(
	items: Array<{ name: string; type: "emoji" | "sticker" }>,
): string {
	// 1. Build numbered list of items
	const itemList = items
		.map((item, idx) => `${idx + 1}. ${item.name} (${item.type})`)
		.join("\n");

	// 2. Construct prompt
	return `Analyze the following ${items.length} Discord expressions and classify each one:

${itemList}

For each expression, determine:
1. The primary emotion category (from the 28 emotion list)
2. A concise visual description (one sentence)

Return results in the specified JSON format.`;
}

/**
 * Update expressions in database with LLM-generated metadata
 *
 * @param serverId - Internal server ID
 * @param results - Array of classification results from LLM
 * @returns Object with counts of updated emojis and stickers
 */
async function updateExpressionsInDB(
	serverId: number,
	results: ExpressionClassification[],
): Promise<{ emojiCount: number; stickerCount: number }> {
	let emojiCount = 0;
	let stickerCount = 0;

	// 1. Use transaction for atomicity
	await sql.transaction(async (tx) => {
		// 2. Process each result
		for (const result of results) {
			// 3. Try updating emoji first (case-insensitive name match)
			const emojiRows = await tx`
				UPDATE server_emojis
				SET
					emotion_key = ${result.emotion_key},
					emoji_desc = ${result.description},
					updated_at = CURRENT_TIMESTAMP
				WHERE server_id = ${serverId}
					AND LOWER(emoji_name) = LOWER(${result.name})
				RETURNING emoji_disc_id
			`;

			// 4. If emoji was updated, increment count and continue
			if (emojiRows.length > 0) {
				emojiCount++;
				continue;
			}

			// 5. If no emoji found, try sticker
			const stickerRows = await tx`
				UPDATE server_stickers
				SET
					emotion_key = ${result.emotion_key},
					sticker_desc = ${result.description},
					updated_at = CURRENT_TIMESTAMP
				WHERE server_id = ${serverId}
					AND LOWER(sticker_name) = LOWER(${result.name})
				RETURNING sticker_disc_id
			`;

			// 6. If sticker was updated, increment count
			if (stickerRows.length > 0) {
				stickerCount++;
			}
		}
	});

	return { emojiCount, stickerCount };
}

/**
 * Execute the /server initialize expressions command
 *
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - User's preferred locale
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	// 1. Ensure command is run in a guild (not DM)
	if (!interaction.guild) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.guild_only_title",
			descriptionKey: "general.errors.guild_only_description",
			color: hexToNumber(ColorCode.ERROR),
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 2. Load Tomori state for this server
	const tomoriState = await loadTomoriState(interaction.guild.id);
	if (!tomoriState) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.tomori_not_setup_title",
			descriptionKey: "general.errors.tomori_not_setup_description",
			color: hexToNumber(ColorCode.ERROR),
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 3. Defer reply early (this operation may take time)
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	try {
		// 4. Validate model capabilities
		// Model must support BOTH image vision AND structured output
		const llm = tomoriState.llm;

		if (!llm.sees_images || !llm.supports_structoutput) {
			// Determine which capability is missing
			const missingCapability = !llm.sees_images
				? "IMAGE VISION"
				: "STRUCTURED OUTPUT";

			await interaction.editReply({
				embeds: [
					{
						title: localizer(
							locale,
							"commands.server.initialize.expressions.model_incompatible_title",
						),
						description: localizer(
							locale,
							"commands.server.initialize.expressions.model_incompatible_description",
							{
								model_name: llm.llm_codename,
								missing_capability: missingCapability,
							},
						),
						color: hexToNumber(ColorCode.ERROR),
					},
				],
			});
			return;
		}

		// 5. Update progress: Fetching uninitialized expressions
		await interaction.editReply({
			content: localizer(
				locale,
				"commands.server.initialize.expressions.progress_fetching",
			),
		});

		// 6. Query database for uninitialized emojis
		const uninitializedEmojis = await sql<UninitializedEmoji[]>`
			SELECT emoji_disc_id, emoji_name, is_animated
			FROM server_emojis
			WHERE server_id = ${tomoriState.server_id}
				AND (
					emotion_key IS NULL
					OR emotion_key = 'unset'
					OR emoji_desc IS NULL
					OR emoji_desc = ''
				)
		`;

		// 7. Query database for uninitialized stickers
		const uninitializedStickers = await sql<UninitializedSticker[]>`
			SELECT sticker_disc_id, sticker_name, sticker_format
			FROM server_stickers
			WHERE server_id = ${tomoriState.server_id}
				AND (
					emotion_key IS NULL
					OR emotion_key = 'unset'
					OR sticker_desc IS NULL
					OR sticker_desc = ''
				)
		`;

		// 8. Check if there's anything to initialize
		const totalUninitialized =
			uninitializedEmojis.length + uninitializedStickers.length;

		if (totalUninitialized === 0) {
			await interaction.editReply({
				embeds: [
					{
						title: localizer(
							locale,
							"commands.server.initialize.expressions.already_initialized_title",
						),
						description: localizer(
							locale,
							"commands.server.initialize.expressions.already_initialized_description",
						),
						color: hexToNumber(ColorCode.INFO),
					},
				],
			});
			return;
		}

		// 9. Update progress: Building image list
		await interaction.editReply({
			content: localizer(
				locale,
				"commands.server.initialize.expressions.progress_building",
				{
					emoji_count: uninitializedEmojis.length,
					sticker_count: uninitializedStickers.length,
				},
			),
		});

		// 10. Build images array for LLM
		const images: Array<{ url: string; name: string }> = [];
		const items: Array<{ name: string; type: "emoji" | "sticker" }> = [];

		// Add emojis
		for (const emoji of uninitializedEmojis) {
			images.push({
				url: buildEmojiCDNUrl(emoji.emoji_disc_id),
				name: emoji.emoji_name,
			});
			items.push({ name: emoji.emoji_name, type: "emoji" });
		}

		// Add stickers
		for (const sticker of uninitializedStickers) {
			images.push({
				url: buildStickerCDNUrl(sticker.sticker_disc_id),
				name: sticker.sticker_name,
			});
			items.push({ name: sticker.sticker_name, type: "sticker" });
		}

		// 11. Update progress: Analyzing with AI
		await interaction.editReply({
			content: localizer(
				locale,
				"commands.server.initialize.expressions.progress_analyzing",
				{
					total: totalUninitialized,
				},
			),
		});

		// 12. Decrypt API key
		if (!tomoriState.config.api_key) {
			await interaction.editReply({
				embeds: [
					{
						title: localizer(locale, "commands.config.model.text.no_api_key_title"),
						description: localizer(
							locale,
							"commands.config.model.text.no_api_key_description",
						),
						color: hexToNumber(ColorCode.ERROR),
					},
				],
			});
			return;
		}

		const keyVersion = tomoriState.config.key_version || 1;
		const decryptedApiKey = await decryptApiKey(
			tomoriState.config.api_key,
			keyVersion,
		);

		// 13. Build prompts
		const systemPrompt = buildSystemPrompt();
		const userPrompt = buildUserPrompt(items);
		const temperature = 1.0;

		log.info(
			`LLM structured output request: ${JSON.stringify(
				{
					model: llm.llm_codename,
					temperature,
					systemPrompt,
					userPrompt,
					images,
				},
				null,
				2,
			)}`,
		);

		// 14. Call Google structured output (only Google supported for now)
		const result = await callGoogleStructuredOutput({
			apiKey: decryptedApiKey,
			model: llm.llm_codename,
			systemPrompt,
			userPrompt,
			images,
			temperature,
		});

		log.info(
			`LLM structured output response: ${JSON.stringify(result, null, 2)}`,
		);

		// 15. Check if LLM call was successful
		if (!result.success) {
			log.error("LLM structured output failed", new Error(result.error), {
				errorType: "LLMStructuredOutputError",
				metadata: {
					model: llm.llm_codename,
					imageCount: images.length,
				},
			});

			await interaction.editReply({
				embeds: [
					{
						title: localizer(
							locale,
							"commands.server.initialize.expressions.llm_error_title",
						),
						description: localizer(
							locale,
							"commands.server.initialize.expressions.llm_error_description",
						),
						color: hexToNumber(ColorCode.ERROR),
					},
				],
			});
			return;
		}

		// 16. Validate LLM response with Zod
		const validationResult = ExpressionBatchResultSchema.safeParse(result.data);

		if (!validationResult.success) {
			log.error(
				"LLM returned invalid structured output",
				validationResult.error,
				{
					errorType: "ValidationError",
					metadata: {
						model: llm.llm_codename,
						rawData: result.data,
					},
				},
			);

			await interaction.editReply({
				embeds: [
					{
						title: localizer(
							locale,
							"commands.server.initialize.expressions.validation_error_title",
						),
						description: localizer(
							locale,
							"commands.server.initialize.expressions.validation_error_description",
						),
						color: hexToNumber(ColorCode.ERROR),
					},
				],
			});
			return;
		}

		// 17. Update progress: Saving to database
		await interaction.editReply({
			content: localizer(
				locale,
				"commands.server.initialize.expressions.progress_saving",
			),
		});

		// 18. Update database with results
		const { emojiCount, stickerCount } = await updateExpressionsInDB(
			tomoriState.server_id,
			validationResult.data.expressions,
		);

		const totalProcessed = emojiCount + stickerCount;

		// 19. Show result message
		if (totalProcessed === 0) {
			// No expressions were updated (all failed to match)
			await interaction.editReply({
				embeds: [
					{
						title: localizer(
							locale,
							"commands.server.initialize.expressions.no_matches_title",
						),
						description: localizer(
							locale,
							"commands.server.initialize.expressions.no_matches_description",
						),
						color: hexToNumber(ColorCode.WARN),
					},
				],
			});
		} else if (totalProcessed < totalUninitialized) {
			// Partial success
			const failed = totalUninitialized - totalProcessed;
			await interaction.editReply({
				embeds: [
					{
						title: localizer(
							locale,
							"commands.server.initialize.expressions.partial_success_title",
						),
						description: localizer(
							locale,
							"commands.server.initialize.expressions.partial_success_description",
							{
								successful: totalProcessed,
								total: totalUninitialized,
								failed,
							},
						),
						color: hexToNumber(ColorCode.WARN),
					},
				],
			});
		} else {
			// Full success
			await interaction.editReply({
				embeds: [
					{
						title: localizer(
							locale,
							"commands.server.initialize.expressions.success_title",
						),
						description: localizer(
							locale,
							"commands.server.initialize.expressions.success_description",
							{
								emoji_count: emojiCount,
								sticker_count: stickerCount,
								total: totalProcessed,
							},
						),
						color: hexToNumber(ColorCode.SUCCESS),
					},
				],
			});
		}
	} catch (error) {
		// 20. Log error with context
		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: tomoriState?.server_id ?? null,
			tomoriId: tomoriState?.tomori_id ?? null,
			errorType: "CommandExecutionError",
			metadata: {
				command: "server initialize expressions",
				guildId: interaction.guild.id,
			},
		};

		await log.error(
			"Error executing /server initialize expressions command",
			error as Error,
			context,
		);

		// 21. Show error message to user
		await interaction.editReply({
			embeds: [
				{
					title: localizer(locale, "general.errors.unknown_error_title"),
					description: localizer(
						locale,
						"general.errors.unknown_error_description",
					),
					color: hexToNumber(ColorCode.ERROR),
				},
			],
		});
	}
}

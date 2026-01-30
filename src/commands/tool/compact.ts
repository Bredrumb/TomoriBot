import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
	TextBasedChannel,
	Embed,
	Message,
} from "discord.js";
import {
	EmbedBuilder,
	MessageFlags,
	TextInputStyle,
} from "discord.js";
import { localizer, getSupportedLocales } from "@/utils/text/localizer";
import { ColorCode, log } from "@/utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithRawModal,
} from "@/utils/discord/interactionHelper";
import type { UserRow } from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
import { loadTomoriState, loadAllPersonasForServer } from "@/utils/db/dbRead";
import { decryptApiKey } from "@/utils/security/crypto";
import { getCachedUserRow, getCachedPrivacyLevel, getCachedBlacklistStatus } from "@/utils/cache/userCache";
import type { ModalComponent } from "@/types/discord/modal";
import {
	generateConversationSummaryGoogle,
	generateRoleplaySummaryGoogle,
} from "@/providers/google/compactGenerator";
import {
	generateConversationSummaryOpenrouter,
	generateRoleplaySummaryOpenrouter,
} from "@/providers/openrouter/compactGenerator";
import type {
	CompactRoleplaySummary,
	CompactSummaryMode,
} from "@/types/misc/compact";

const MESSAGE_FETCH_LIMIT = Number.parseInt(
	process.env.MESSAGE_FETCH_LIMIT || "80",
	10,
);

const MODAL_CUSTOM_ID = "tool_compact_modal";
const TYPE_FIELD_ID = "summary_type";
const REFRESH_FIELD_ID = "refresh_context";
const ANALYZE_IMAGES_FIELD_ID = "analyze_images";
const ADDITIONAL_INST_FIELD_ID = "additional_instructions";

/**
 * Configure /tool compact subcommand
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("compact")
		.setDescription(localizer("en-US", "commands.tool.compact.description"));

function truncateEmbedDescription(text: string, maxLength = 4000): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 3)}...`;
}

function buildEmojiCdnUrl(emojiId: string): string {
	return `https://cdn.discordapp.com/emojis/${emojiId}.png`;
}

function buildStickerCdnUrl(stickerId: string): string {
	return `https://cdn.discordapp.com/stickers/${stickerId}.png`;
}

type ImageReference = {
	label: string;
	url: string;
	mimeType?: string;
	source: string;
};

function extractCustomEmojiImages(content: string): Array<{ url: string; name: string }> {
	const results: Array<{ url: string; name: string }> = [];
	if (!content) return results;

	const emojiPattern = /<(a?):([^:]+):(\d{17,20})>/g;
	const seenEmojiIds = new Set<string>();
	let match: RegExpExecArray | null;

	// biome-ignore lint/suspicious/noAssignInExpressions: Iterative regex exec
	while ((match = emojiPattern.exec(content)) !== null) {
		const emojiName = match[2];
		const emojiId = match[3];
		if (seenEmojiIds.has(emojiId)) continue;
		seenEmojiIds.add(emojiId);
		results.push({
			url: buildEmojiCdnUrl(emojiId),
			name: emojiName,
		});
	}

	return results;
}

function classifyEmbedTitle(embedTitle: string | null): {
	isReset: boolean;
	isSystemInjection: boolean;
	isMemoryLearning: boolean;
	isReminderSet: boolean;
} {
	if (!embedTitle) {
		return {
			isReset: false,
			isSystemInjection: false,
			isMemoryLearning: false,
			isReminderSet: false,
		};
	}

	for (const supportedLocale of getSupportedLocales()) {
		const memoryLearningTitles = [
			localizer(
				supportedLocale,
				"genai.self_teach.server_memory_learned_title",
			),
			localizer(
				supportedLocale,
				"genai.self_teach.personal_memory_learned_title",
			),
		];

		const reminderSetTitle = localizer(
			supportedLocale,
			"reminders.reminder_set_title",
		);

		const systemInjectionTitle = localizer(
			supportedLocale,
			"commands.bot.impersonate.system_title",
		);

		const refreshTitle = localizer(
			supportedLocale,
			"commands.tool.refresh.title",
		);

		const compactSummaryTitle = localizer(
			supportedLocale,
			"commands.tool.compact.summary_title",
		);
		const compactSummaryTitleRefreshed = localizer(
			supportedLocale,
			"commands.tool.compact.summary_title_refreshed",
		);
		const compactSceneTitle = localizer(
			supportedLocale,
			"commands.tool.compact.roleplay_scene_title",
		);
		const compactSceneTitleRefreshed = localizer(
			supportedLocale,
			"commands.tool.compact.roleplay_scene_title_refreshed",
		);
		const compactCharacterTitlePrefix = localizer(
			supportedLocale,
			"commands.tool.compact.roleplay_character_title_prefix",
		);

		const isMemoryLearning = memoryLearningTitles.some(
			(title) => embedTitle === title,
		);
		const isReminderSet = embedTitle === reminderSetTitle;
		const isReset =
			embedTitle === refreshTitle ||
			embedTitle === compactSummaryTitleRefreshed ||
			embedTitle === compactSceneTitleRefreshed;

		const isSystemInjection =
			embedTitle === systemInjectionTitle ||
			embedTitle === compactSummaryTitle ||
			embedTitle === compactSummaryTitleRefreshed ||
			embedTitle === compactSceneTitle ||
			embedTitle === compactSceneTitleRefreshed ||
			Boolean(
				compactCharacterTitlePrefix &&
					embedTitle.startsWith(compactCharacterTitlePrefix),
			);

		if (isMemoryLearning || isReminderSet || isReset || isSystemInjection) {
			return {
				isReset,
				isSystemInjection,
				isMemoryLearning,
				isReminderSet,
			};
		}
	}

	return {
		isReset: false,
		isSystemInjection: false,
		isMemoryLearning: false,
		isReminderSet: false,
	};
}

function appendEmbedContent(
	baseContent: string,
	embed: Embed,
): string {
	if (!embed.description || !embed.title) return baseContent;

	const classification = classifyEmbedTitle(embed.title);
	if (!classification.isSystemInjection && !classification.isMemoryLearning && !classification.isReminderSet) {
		return baseContent;
	}

	const description = embed.description.trim();
	if (!description) return baseContent;

	if (classification.isSystemInjection) {
		const systemContent = `[System: ${description}]`;
		return baseContent ? `${baseContent}\n${systemContent}` : systemContent;
	}

	const embedContent = `[The following is a system-produced embed]\n${description}`;
	return baseContent ? `${baseContent}\n${embedContent}` : embedContent;
}

async function buildConversationContext(params: {
	channel: TextBasedChannel;
	includeImages: boolean;
}): Promise<{
	conversationText: string;
	imageReferences: ImageReference[];
	userIds: string[];
}> {
	const fetchedMessages = await params.channel.messages.fetch({
		limit: MESSAGE_FETCH_LIMIT,
	});

	const messagesArray = Array.from(fetchedMessages.values()).reverse();

	let resetIndex = -1;
	for (let i = messagesArray.length - 1; i >= 0; i--) {
		const msg = messagesArray[i];
		const embedContainsReset = msg.embeds.some((embed) => {
			const classification = classifyEmbedTitle(embed.title ?? null);
			return classification.isReset;
		});

		if (embedContainsReset) {
			resetIndex = i;
			break;
		}
	}

	const startIndex = resetIndex === -1 ? 0 : resetIndex + 1;
	const relevantMessages = messagesArray.slice(startIndex);

	const conversationLines: string[] = [];
	const imageReferences: ImageReference[] = [];
	const userIdSet = new Set<string>();
	let imageCounter = 1;

	for (const msg of relevantMessages) {
		const authorId = msg.author.id;
		const authorPrivacyLevel = await getCachedPrivacyLevel(authorId);
		if (authorPrivacyLevel === PrivacyLevel.FULL) {
			continue;
		}

		userIdSet.add(authorId);

		const authorName = msg.member?.displayName || msg.author.username;
		let messageContent = msg.content?.trim() || "";

		if (msg.embeds.length > 0) {
			for (const embed of msg.embeds) {
				messageContent = appendEmbedContent(messageContent, embed);
			}
		}

		const messageImages: ImageReference[] = [];
		if (params.includeImages) {
			for (const attachment of msg.attachments.values()) {
				if (!attachment.contentType?.startsWith("image/")) continue;
				messageImages.push({
					label: `Image ${imageCounter++}`,
					url: attachment.url,
					mimeType: attachment.contentType ?? undefined,
					source: `${authorName} attachment${attachment.name ? ` (${attachment.name})` : ""}`,
				});
			}

			const emojiImages = extractCustomEmojiImages(msg.content || "");
			for (const emoji of emojiImages) {
				messageImages.push({
					label: `Image ${imageCounter++}`,
					url: emoji.url,
					mimeType: "image/png",
					source: `${authorName} emoji (${emoji.name})`,
				});
			}

			if (msg.stickers && msg.stickers.size > 0) {
				for (const sticker of msg.stickers.values()) {
					messageImages.push({
						label: `Image ${imageCounter++}`,
						url: buildStickerCdnUrl(sticker.id),
						mimeType: "image/png",
						source: `${authorName} sticker (${sticker.name})`,
					});
				}
			}
		}

		let line = messageContent || "(no text)";
		if (messageImages.length > 0) {
			const labels = messageImages.map((img) => img.label).join(", ");
			line = `${line} [${labels}]`;
			imageReferences.push(...messageImages);
		}

		conversationLines.push(`${authorName}: ${line}`);
	}

	const conversationText = conversationLines.join("\n");
	return {
		conversationText,
		imageReferences,
		userIds: Array.from(userIdSet),
	};
}

async function buildSupplementaryContext(params: {
	serverDiscId: string;
	userIds: string[];
	includePersonas: boolean;
}): Promise<string> {
	const sections: string[] = [];
	const tomoriState = await loadTomoriState(params.serverDiscId);

	if (tomoriState?.server_memories && tomoriState.server_memories.length > 0) {
		sections.push(
			`Server memories:\n- ${tomoriState.server_memories.join("\n- ")}`,
		);
	}

	if (tomoriState) {
		const personalizationEnabled =
			tomoriState.config.personal_memories_enabled ?? true;

		const userMemoryLines: string[] = [];
		for (const userId of params.userIds) {
			const userPrivacyLevel = await getCachedPrivacyLevel(userId);
			if (userPrivacyLevel !== PrivacyLevel.MINIMAL) continue;

			const userRow = await getCachedUserRow(userId);
			if (!userRow || !userRow.personal_memories || userRow.personal_memories.length === 0) {
				continue;
			}

			const isBlacklisted = await getCachedBlacklistStatus(
				params.serverDiscId,
				userId,
			);
			if (isBlacklisted) continue;
			if (!personalizationEnabled) continue;

			const userDisplayName = userRow.user_nickname || userId;
			userMemoryLines.push(
				`${userDisplayName}: ${userRow.personal_memories.join("; ")}`,
			);
		}

		if (userMemoryLines.length > 0) {
			sections.push(`User memories:\n- ${userMemoryLines.join("\n- ")}`);
		}
	}

	if (params.includePersonas) {
		const personas = await loadAllPersonasForServer(params.serverDiscId);
		if (personas.length > 0) {
			const personaLines = personas.map((persona) => {
				const attributes = persona.attribute_list?.length
					? persona.attribute_list.join(" | ")
					: "(no attributes)";
				return `${persona.tomori_nickname}: ${attributes}`;
			});

			sections.push(`Personas:\n- ${personaLines.join("\n- ")}`);
		}
	}

	return sections.join("\n\n");
}

function buildConversationPrompt(params: {
	conversationText: string;
	imageReferences: ImageReference[];
	supplementaryContext: string;
	additionalInstructions?: string;
}): { systemPrompt: string; userPrompt: string } {
	const systemPrompt =
		"You are an expert conversation summarizer for a Discord chatbot. " +
		"Summarize the conversation into a compact, factual summary suitable to be injected as system context. " +
		"Focus on key facts, relationships, decisions, and ongoing tasks. " +
		"Keep it concise and avoid fluff. Output plain text only.";

	const sections: string[] = [];
	sections.push("MAIN CONTEXT (chronological):");
	sections.push(params.conversationText || "(no recent messages)");

	if (params.imageReferences.length > 0) {
		sections.push("\nIMAGE REFERENCES:");
		sections.push(
			params.imageReferences
				.map((img) => `${img.label}: ${img.source}`)
				.join("\n"),
		);
	}

	if (params.supplementaryContext) {
		sections.push("\nSUPPLEMENTARY CONTEXT:");
		sections.push(params.supplementaryContext);
	}

	if (params.additionalInstructions) {
		sections.push("\nADDITIONAL INSTRUCTIONS:");
		sections.push(params.additionalInstructions);
	}

	sections.push("\nPlease keep the summary under 3500 characters.");

	return {
		systemPrompt,
		userPrompt: sections.join("\n"),
	};
}

function buildRoleplayPrompt(params: {
	conversationText: string;
	imageReferences: ImageReference[];
	supplementaryContext: string;
	additionalInstructions?: string;
}): { systemPrompt: string; userPrompt: string } {
	const systemPrompt =
		"You are an expert roleplay continuity summarizer. " +
		"Produce a structured JSON summary of the scene and each character. " +
		"Use only information supported by the context; if something is unknown, say 'Unknown' or 'Not specified'. " +
		"Keep each field concise (short phrases or 1-2 sentences).";

	const sections: string[] = [];
	sections.push("MAIN CONTEXT (chronological):");
	sections.push(params.conversationText || "(no recent messages)");

	if (params.imageReferences.length > 0) {
		sections.push("\nIMAGE REFERENCES:");
		sections.push(
			params.imageReferences
				.map((img) => `${img.label}: ${img.source}`)
				.join("\n"),
		);
	}

	if (params.supplementaryContext) {
		sections.push("\nSUPPLEMENTARY CONTEXT:");
		sections.push(params.supplementaryContext);
	}

	if (params.additionalInstructions) {
		sections.push("\nADDITIONAL INSTRUCTIONS:");
		sections.push(params.additionalInstructions);
	}

	return {
		systemPrompt,
		userPrompt: sections.join("\n"),
	};
}

function buildRoleplayEmbeds(
	locale: string,
	summary: CompactRoleplaySummary,
	refresh: boolean,
): EmbedBuilder[] {
	const embeds: EmbedBuilder[] = [];

	const sceneTitle = refresh
		? localizer(locale, "commands.tool.compact.roleplay_scene_title_refreshed")
		: localizer(locale, "commands.tool.compact.roleplay_scene_title");

	const synopsisHeader = localizer(
		locale,
		"commands.tool.compact.roleplay_scene_synopsis_header",
	);
	const sceneDescription = `${synopsisHeader}\n${summary.overall_scene_summary}`;

	const sceneEmbed = new EmbedBuilder()
		.setTitle(sceneTitle)
		.setDescription(truncateEmbedDescription(sceneDescription))
		.setColor(ColorCode.SECTION);

	if (refresh) {
		sceneEmbed.setFooter({
			text: localizer(locale, "commands.tool.compact.refresh_footer"),
		});
	}

	embeds.push(sceneEmbed);

	const characterPrefix = localizer(
		locale,
		"commands.tool.compact.roleplay_character_title_prefix",
	);

	for (const character of summary.characters) {
		const lines = [
			`Character: ${character.name || "Unknown"}`,
			`Current Goals: ${character.current_goals || "Unknown"}`,
			`Emotional Status: ${character.emotional_status || "Unknown"}`,
			`Physical Status: ${character.physical_status || "Unknown"}`,
			`Appearance/Clothing: ${character.appearance_clothing || "Unknown"}`,
			`Inventory: ${character.inventory || "Unknown"}`,
		];

		const description = truncateEmbedDescription(lines.join("\n"));
		const embed = new EmbedBuilder()
			.setTitle(`${characterPrefix} ${character.name || "Unknown"}`)
			.setDescription(description)
			.setColor(ColorCode.SECTION);

		embeds.push(embed);
	}

	return embeds;
}

function buildConversationEmbed(
	locale: string,
	summaryText: string,
	refresh: boolean,
): EmbedBuilder {
	const title = refresh
		? localizer(locale, "commands.tool.compact.summary_title_refreshed")
		: localizer(locale, "commands.tool.compact.summary_title");

	const embed = new EmbedBuilder()
		.setTitle(title)
		.setDescription(truncateEmbedDescription(summaryText))
		.setColor(ColorCode.SECTION);

	if (refresh) {
		embed.setFooter({
			text: localizer(locale, "commands.tool.compact.refresh_footer"),
		});
	}

	return embed;
}

type SendableChannel = {
	send: (options: { embeds: EmbedBuilder[] }) => Promise<Message>;
};

async function sendEmbedsInChunks(
	channel: SendableChannel,
	embeds: EmbedBuilder[],
): Promise<void> {
	const chunkSize = 10;
	for (let i = 0; i < embeds.length; i += chunkSize) {
		const chunk = embeds.slice(i, i + chunkSize);
		await channel.send({ embeds: chunk });
	}
}

/**
 * Execute /tool compact command
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	_userData: UserRow,
	locale: string,
): Promise<void> {
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const modalComponents: ModalComponent[] = [
		{
			customId: TYPE_FIELD_ID,
			labelKey: "commands.tool.compact.modal.type_label",
			descriptionKey: "commands.tool.compact.modal.type_description",
			required: true,
			options: [
				{
					label: localizer(
						locale,
						"commands.tool.compact.modal.type_choice_conversation",
					),
					value: "conversation",
				},
				{
					label: localizer(
						locale,
						"commands.tool.compact.modal.type_choice_roleplay",
					),
					value: "roleplay",
				},
			],
		},
		{
			customId: REFRESH_FIELD_ID,
			labelKey: "commands.tool.compact.modal.refresh_label",
			descriptionKey: "commands.tool.compact.modal.refresh_description",
			required: true,
			options: [
				{
					label: localizer(locale, "general.yes"),
					value: "yes",
				},
				{
					label: localizer(locale, "general.no"),
					value: "no",
				},
			],
		},
		{
			customId: ANALYZE_IMAGES_FIELD_ID,
			labelKey: "commands.tool.compact.modal.analyze_images_label",
			descriptionKey: "commands.tool.compact.modal.analyze_images_description",
			required: true,
			options: [
				{
					label: localizer(locale, "general.yes"),
					value: "yes",
				},
				{
					label: localizer(locale, "general.no"),
					value: "no",
				},
			],
		},
		{
			customId: ADDITIONAL_INST_FIELD_ID,
			labelKey: "commands.tool.compact.modal.additional_instructions_label",
			placeholder:
				"commands.tool.compact.modal.additional_instructions_placeholder",
			required: false,
			style: TextInputStyle.Paragraph,
			maxLength: 1000,
		},
	];

	const modalResult = await promptWithRawModal(
		interaction,
		locale,
		{
			modalCustomId: MODAL_CUSTOM_ID,
			modalTitleKey: "commands.tool.compact.modal.title",
			components: modalComponents,
		},
		MessageFlags.Ephemeral,
	);

	if (modalResult.outcome !== "submit") {
		return;
	}

	const submitInteraction = modalResult.interaction;
	if (!submitInteraction || !modalResult.values) {
		log.error("Compact modal submission missing values");
		return;
	}

	const summaryType = (modalResult.values[TYPE_FIELD_ID] || "conversation") as CompactSummaryMode;
	const refresh = (modalResult.values[REFRESH_FIELD_ID] || "no") === "yes";
	const analyzeImages =
		(modalResult.values[ANALYZE_IMAGES_FIELD_ID] || "no") === "yes";
	const additionalInstructions = modalResult.values[
		ADDITIONAL_INST_FIELD_ID
	]?.trim();

	const serverDiscId = interaction.guild?.id ?? interaction.user.id;
	const tomoriState = await loadTomoriState(serverDiscId);
	if (!tomoriState) {
		await submitInteraction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(localizer(locale, "general.errors.tomori_not_setup_title"))
					.setDescription(
						localizer(locale, "general.errors.tomori_not_setup_description"),
					)
					.setColor(ColorCode.ERROR),
			],
		});
		return;
	}

	const providerName = tomoriState.llm.llm_provider.toLowerCase();
	const isGoogle = providerName === "google" || providerName === "gemini";
	const isOpenrouter = providerName === "openrouter";

	if (!isGoogle && !isOpenrouter) {
		await submitInteraction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(
						localizer(locale, "commands.tool.compact.provider_unsupported_title"),
					)
					.setDescription(
						localizer(
							locale,
							"commands.tool.compact.provider_unsupported_description",
							{ provider: tomoriState.llm.llm_provider },
						),
					)
					.setColor(ColorCode.ERROR),
			],
		});
		return;
	}

	if (summaryType === "roleplay" && !tomoriState.llm.supports_structoutput) {
		await submitInteraction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(
						localizer(
							locale,
							"commands.tool.compact.model_incompatible_title",
						),
					)
					.setDescription(
						localizer(
							locale,
							"commands.tool.compact.model_incompatible_description",
							{ model_name: tomoriState.llm.llm_codename },
						),
					)
					.setColor(ColorCode.ERROR),
			],
		});
		return;
	}

	if (analyzeImages && !tomoriState.llm.sees_images) {
		await submitInteraction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(
						localizer(
							locale,
							"commands.tool.compact.image_vision_required_title",
						),
					)
					.setDescription(
						localizer(
							locale,
							"commands.tool.compact.image_vision_required_description",
							{ model_name: tomoriState.llm.llm_codename },
						),
					)
					.setColor(ColorCode.ERROR),
			],
		});
		return;
	}

	if (!tomoriState.config.api_key) {
		await submitInteraction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(localizer(locale, "general.errors.api_key_missing_title"))
					.setDescription(
						localizer(locale, "general.errors.api_key_missing_description"),
					)
					.setColor(ColorCode.ERROR),
			],
		});
		return;
	}

	const keyVersion = tomoriState.config.key_version || 1;
	const apiKey = await decryptApiKey(tomoriState.config.api_key, keyVersion);
	if (!apiKey) {
		await submitInteraction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(localizer(locale, "general.errors.api_key_error_title"))
					.setDescription(
						localizer(locale, "general.errors.api_key_error_description"),
					)
					.setColor(ColorCode.ERROR),
			],
		});
		return;
	}

	await submitInteraction.editReply({
		embeds: [
			new EmbedBuilder()
				.setTitle(localizer(locale, "commands.tool.compact.processing_title"))
				.setDescription(
					localizer(locale, "commands.tool.compact.processing_description"),
				)
				.setColor(ColorCode.INFO),
		],
	});

	const channel = submitInteraction.channel ?? interaction.channel;
	if (
		!channel ||
		!("send" in channel) ||
		typeof channel.send !== "function" ||
		!("messages" in channel)
	) {
		await submitInteraction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(localizer(locale, "general.errors.channel_only_title"))
					.setDescription(
						localizer(locale, "general.errors.channel_only_description"),
					)
					.setColor(ColorCode.ERROR),
			],
		});
		return;
	}

	const textChannel = channel as TextBasedChannel;
	const sendableChannel = channel as SendableChannel;
	const { conversationText, imageReferences, userIds } =
		await buildConversationContext({
			channel: textChannel,
			includeImages: analyzeImages,
		});

	const supplementaryContext = await buildSupplementaryContext({
		serverDiscId,
		userIds,
		includePersonas: true,
	});

	const imagePayload = analyzeImages
		? imageReferences.map((img) => ({ url: img.url, mimeType: img.mimeType }))
		: [];

	try {
		if (summaryType === "conversation") {
		const prompt = buildConversationPrompt({
			conversationText,
			imageReferences,
			supplementaryContext,
			additionalInstructions,
		});

			const result = isGoogle
				? await generateConversationSummaryGoogle({
					apiKey,
					model: tomoriState.llm.llm_codename,
					systemPrompt: prompt.systemPrompt,
					userPrompt: prompt.userPrompt,
					images: analyzeImages
						? imagePayload
						: undefined,
				})
				: await generateConversationSummaryOpenrouter({
					apiKey,
					model: tomoriState.llm.llm_codename,
					systemPrompt: prompt.systemPrompt,
					userPrompt: prompt.userPrompt,
					images: analyzeImages
						? imageReferences.map((img) => ({ url: img.url }))
						: undefined,
				});

			if (result.error || !result.summary) {
				await submitInteraction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(locale, "commands.tool.compact.failed_title"),
							)
							.setDescription(
								localizer(
									locale,
									"commands.tool.compact.failed_description",
									{ error: result.error || "Unknown error" },
								),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}

			const summaryEmbed = buildConversationEmbed(
				locale,
				result.summary,
				refresh,
			);

			await sendEmbedsInChunks(sendableChannel, [summaryEmbed]);
		} else {
			const prompt = buildRoleplayPrompt({
				conversationText,
				imageReferences,
				supplementaryContext,
				additionalInstructions,
			});

			const result = isGoogle
				? await generateRoleplaySummaryGoogle({
					apiKey,
					model: tomoriState.llm.llm_codename,
					systemPrompt: prompt.systemPrompt,
					userPrompt: prompt.userPrompt,
					images: analyzeImages
						? imagePayload
						: undefined,
				})
				: await generateRoleplaySummaryOpenrouter({
					apiKey,
					model: tomoriState.llm.llm_codename,
					systemPrompt: prompt.systemPrompt,
					userPrompt: prompt.userPrompt,
					images: analyzeImages
						? imageReferences.map((img) => ({ url: img.url }))
						: undefined,
				});

			if (result.error || !result.summary) {
				await submitInteraction.editReply({
					embeds: [
						new EmbedBuilder()
							.setTitle(
								localizer(locale, "commands.tool.compact.failed_title"),
							)
							.setDescription(
								localizer(
									locale,
									"commands.tool.compact.failed_description",
									{ error: result.error || "Unknown error" },
								),
							)
							.setColor(ColorCode.ERROR),
					],
				});
				return;
			}

			const embeds = buildRoleplayEmbeds(locale, result.summary, refresh);
			await sendEmbedsInChunks(sendableChannel, embeds);
		}

		await submitInteraction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(localizer(locale, "commands.tool.compact.success_title"))
					.setDescription(
						localizer(locale, "commands.tool.compact.success_description"),
					)
					.setColor(ColorCode.SUCCESS),
			],
		});
	} catch (error) {
		log.error("Compact summary command failed", error as Error);
		await submitInteraction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(localizer(locale, "commands.tool.compact.failed_title"))
					.setDescription(
						localizer(
							locale,
							"commands.tool.compact.failed_description",
							{ error: error instanceof Error ? error.message : "Unknown error" },
						),
					)
					.setColor(ColorCode.ERROR),
			],
		});
	}
}

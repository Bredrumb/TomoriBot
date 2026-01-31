import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
	Attachment,
} from "discord.js";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { sql } from "@/utils/db/client";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed } from "../../utils/discord/interactionHelper";
import {
	getCachedTomoriState,
	invalidateTomoriStateCache,
} from "../../utils/cache/tomoriStateCache";
import { isBlacklisted, loadEmbeddingModelById } from "../../utils/db/dbRead";
import {
	getMemoryLimits,
} from "../../utils/db/memoryLimits";
import { safeDownload } from "../../utils/security/safeDownload";
import {
	memoryGuard,
	reserveDocumentQuota,
} from "../../utils/security/rateLimiter";
import { decryptApiKey } from "../../utils/security/crypto";
import {
	chunkDocumentText,
	insertDocumentWithChunks,
	normalizeDocumentText,
} from "../../utils/documents/documentService";
import { generateEmbeddingsBatched } from "../../utils/embeddings/embeddingProvider";
import type { ErrorContext, TomoriState, UserRow } from "../../types/db/schema";

const MAX_DOCUMENT_NAME_LENGTH = 64;

// Configure the subcommand
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("document")
		.setDescription(localizer("en-US", "commands.teach.document.description"))
		.addStringOption((option) =>
			option
				.setName("name")
				.setDescription(
					localizer("en-US", "commands.teach.document.name_description"),
				)
				.setRequired(true)
				.setMaxLength(MAX_DOCUMENT_NAME_LENGTH),
		)
		.addAttachmentOption((option) =>
			option
				.setName("file")
				.setDescription(
					localizer("en-US", "commands.teach.document.file_description"),
				)
				.setRequired(true),
		);

function validateAttachment(attachment: Attachment): {
	isValid: boolean;
	errorKey?: string;
} {
	const allowedExtensions = [".txt", ".md", ".pdf"];
	const filename = attachment.name?.toLowerCase() ?? "";
	const hasAllowedExtension = allowedExtensions.some((ext) =>
		filename.endsWith(ext),
	);

	const allowedTypes = [
		"text/plain",
		"text/markdown",
		"application/pdf",
	];
	const hasAllowedContentType = attachment.contentType
		? allowedTypes.includes(attachment.contentType)
		: false;

	if (!hasAllowedExtension && !hasAllowedContentType) {
		return { isValid: false, errorKey: "invalid_format" };
	}

	return { isValid: true };
}

async function extractTextFromBuffer(
	buffer: Buffer,
	filename: string,
	contentType?: string | null,
): Promise<string> {
	const lowerName = filename.toLowerCase();
	const isPdf =
		contentType === "application/pdf" || lowerName.endsWith(".pdf");

	if (isPdf) {
		const pdfParse = (await import("pdf-parse")).default;
		const parsed = await pdfParse(buffer);
		return parsed.text ?? "";
	}

	return buffer.toString("utf8");
}

/**
 * Uploads and stores a server document for RAG retrieval.
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	// 1. Ensure command is run in a valid channel context
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const memoryLimits = getMemoryLimits();
	let tomoriState: TomoriState | null = null;

	try {
		// 2. Check memory guard
		const memCheck = memoryGuard.checkMemory();
		if (memCheck.status === "critical") {
			await interaction.reply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "rate_limit.error_memory_critical_title"),
						)
						.setDescription(
							localizer(locale, "rate_limit.error_memory_critical_description"),
						)
						.setColor(ColorCode.ERROR),
				],
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 3. Reserve document quota (per-user)
		const quotaReserve = reserveDocumentQuota(interaction.user.id);
		if (!quotaReserve.allowed) {
			const resetTime = quotaReserve.resetAt
				? new Date(quotaReserve.resetAt).toLocaleString(locale)
				: "unknown";
			await replyInfoEmbed(interaction, locale, {
				titleKey: "rate_limit.error_quota_exceeded_title",
				descriptionKey: "rate_limit.error_quota_exceeded_description",
				descriptionVars: {
					reset_time: resetTime,
				},
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 4. Check blacklist for guild contexts
		const hasManagePermission =
			interaction.memberPermissions?.has("ManageGuild") ?? false;
		if (interaction.guild) {
			const blacklisted =
				(await isBlacklisted(interaction.guild.id, interaction.user.id)) ??
				false;
			if (blacklisted && !hasManagePermission) {
				await replyInfoEmbed(interaction, locale, {
					titleKey: "general.errors.user_blacklisted_title",
					descriptionKey: "general.errors.user_blacklisted_description",
					color: ColorCode.ERROR,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
		}

		// 5. Load server's Tomori state
		tomoriState = await getCachedTomoriState(
			interaction.guild?.id ?? interaction.user.id,
		);
		if (!tomoriState) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.tomori_not_setup_title",
				descriptionKey: "general.errors.tomori_not_setup_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 6. Check teaching permission (reuse server memory setting)
		if (!tomoriState.config.server_memteaching_enabled && !hasManagePermission) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.teach.document.teaching_disabled_title",
				descriptionKey: "commands.teach.document.teaching_disabled_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 7. Validate embedding model configuration
		const embeddingModelId = tomoriState.config.embedding_model_id;
		if (!embeddingModelId) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.teach.document.no_embedding_model_title",
				descriptionKey: "commands.teach.document.no_embedding_model_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!tomoriState.config.api_key) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.teach.document.no_api_key_title",
				descriptionKey: "commands.teach.document.no_api_key_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const embeddingModel = await loadEmbeddingModelById(
			embeddingModelId,
		);
		if (!embeddingModel) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.teach.document.no_embedding_model_title",
				descriptionKey: "commands.teach.document.no_embedding_model_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 8. Validate document name
		const nameInput = interaction.options.getString("name", true).trim();
		if (!nameInput || nameInput.length === 0) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.teach.document.invalid_name_title",
				descriptionKey: "commands.teach.document.invalid_name_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 9. Check duplicate document name
		const existing = await sql`
			SELECT document_id
			FROM documents
			WHERE server_id = ${tomoriState.server_id}
			  AND document_name = ${nameInput}
			LIMIT 1
		`;
		if (existing.length > 0) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.teach.document.duplicate_title",
				descriptionKey: "commands.teach.document.duplicate_description",
				descriptionVars: { name: nameInput },
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// 10. Enforce document count limit
		const [docCountRow] = await sql`
			SELECT COUNT(*) as doc_count
			FROM documents
			WHERE server_id = ${tomoriState.server_id}
		`;
		const docCount = Number(docCountRow?.doc_count || 0);
		if (docCount >= memoryLimits.maxDocumentsPerServer) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.teach.document.limit_exceeded_title",
				descriptionKey: "commands.teach.document.limit_exceeded_description",
				descriptionVars: {
					current_count: docCount.toString(),
					max_allowed: memoryLimits.maxDocumentsPerServer.toString(),
				},
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const attachment = interaction.options.getAttachment("file", true);
		const attachmentValidation = validateAttachment(attachment);
		if (!attachmentValidation.isValid) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.teach.document.invalid_file_title",
				descriptionKey: `commands.teach.document.${attachmentValidation.errorKey}`,
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const maxSizeBytes = memoryLimits.maxDocumentSizeMB * 1024 * 1024;
		if (attachment.size && attachment.size > maxSizeBytes) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.teach.document.file_too_large_title",
				descriptionKey: "commands.teach.document.file_too_large_description",
				descriptionVars: {
					max_size: memoryLimits.maxDocumentSizeMB.toString(),
				},
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const downloadResult = await safeDownload(attachment.url, {
			maxSizeMB: memoryLimits.maxDocumentSizeMB,
			timeoutMs: 20000,
			knownSize: attachment.size,
		});

		if (!downloadResult.success || !downloadResult.buffer) {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "commands.teach.document.download_failed_title"),
						)
						.setDescription(
							localizer(
								locale,
								"commands.teach.document.download_failed_description",
							),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		const rawText = await extractTextFromBuffer(
			downloadResult.buffer,
			attachment.name ?? "document",
			attachment.contentType,
		);
		const normalizedText = normalizeDocumentText(rawText);

		if (!normalizedText) {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "commands.teach.document.empty_title"),
						)
						.setDescription(
							localizer(locale, "commands.teach.document.empty_description"),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		if (normalizedText.length > memoryLimits.maxDocumentTextLength) {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "commands.teach.document.too_long_title"),
						)
						.setDescription(
							localizer(locale, "commands.teach.document.too_long_description", {
								max_length: memoryLimits.maxDocumentTextLength.toString(),
							}),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		const chunks = chunkDocumentText(
			normalizedText,
			memoryLimits.documentChunkSize,
			memoryLimits.documentChunkOverlap,
		);

		if (chunks.length === 0) {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "commands.teach.document.empty_title"),
						)
						.setDescription(
							localizer(locale, "commands.teach.document.empty_description"),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		if (chunks.length > memoryLimits.maxDocumentChunks) {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(locale, "commands.teach.document.too_many_chunks_title"),
						)
						.setDescription(
							localizer(
								locale,
								"commands.teach.document.too_many_chunks_description",
								{
									max_chunks: memoryLimits.maxDocumentChunks.toString(),
								},
							),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		const [chunkCountRow] = await sql`
			SELECT COUNT(*) as chunk_count
			FROM document_chunks
			WHERE server_id = ${tomoriState.server_id}
		`;
		const currentChunkCount = Number(chunkCountRow?.chunk_count || 0);
		if (
			currentChunkCount + chunks.length >
			memoryLimits.maxDocumentChunksPerServer
		) {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setTitle(
							localizer(
								locale,
								"commands.teach.document.server_chunk_limit_title",
							),
						)
						.setDescription(
							localizer(
								locale,
								"commands.teach.document.server_chunk_limit_description",
								{
									max_chunks:
										memoryLimits.maxDocumentChunksPerServer.toString(),
								},
							),
						)
						.setColor(ColorCode.ERROR),
				],
			});
			return;
		}

		const decryptedKey = await decryptApiKey(
			tomoriState.config.api_key,
			tomoriState.config.key_version || 1,
		);

		const embeddings = await generateEmbeddingsBatched({
			provider: embeddingModel.provider as "google" | "openrouter",
			apiKey: decryptedKey,
			model: embeddingModel.codename,
			inputs: chunks,
			taskType:
				embeddingModel.provider === "google"
					? "RETRIEVAL_DOCUMENT"
					: undefined,
			batchSize: 16,
		});

		const documentId = await insertDocumentWithChunks({
			serverId: tomoriState.server_id,
			uploaderUserId: userData.user_id ?? null,
			documentName: nameInput,
			fileName: attachment.name ?? null,
			mimeType: attachment.contentType ?? null,
			fileSizeBytes: attachment.size ?? null,
			textContent: normalizedText,
			chunks,
			embeddings,
			embeddingModelId,
			embeddingFamily: embeddingModel.model_family,
		});

		invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(
						localizer(locale, "commands.teach.document.success_title"),
					)
					.setDescription(
						localizer(locale, "commands.teach.document.success_description", {
							name: nameInput,
							chunk_count: chunks.length.toString(),
							document_id: documentId.toString(),
						}),
					)
					.setColor(ColorCode.SUCCESS),
			],
		});
	} catch (error) {
		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: tomoriState?.server_id,
			tomoriId: tomoriState?.tomori_id,
			errorType: "CommandExecutionError",
			metadata: {
				command: "teach document",
				guildId: interaction.guild?.id,
				executorDiscordId: interaction.user.id,
			},
		};
		await log.error("Error in /teach document command", error, context);

		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
	}
}

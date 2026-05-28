import type {
  ChatInputCommandInteraction,
  Client,
  SlashCommandSubcommandBuilder,
  Attachment,
  ModalSubmitInteraction,
} from "discord.js";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { sql } from "@/utils/db/client";
import { isRagAvailable } from "@/utils/db/ragDetection";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed, promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/interactionHelper";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { isBlacklisted, loadAllPersonasForServer, loadEmbeddingModelById } from "@/utils/db/dbRead";
import { getMemoryLimits } from "@/utils/db/memoryLimits";
import { safeDownload } from "@/utils/security/safeDownload";
import { memoryGuard, reserveDocumentQuota } from "@/utils/security/rateLimiter";
import { chunkDocumentText, insertDocumentWithChunks, normalizeDocumentText } from "@/utils/documents/documentService";
import { extractTextFromBuffer } from "@/utils/documents/textExtractor";
import { generateEmbeddingsBatched, providerSupportsEmbeddingTaskType } from "@/utils/embeddings/embeddingProvider";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import {
  CredentialUnavailableError,
  getResolvedCapabilityModelId,
  PersonalProviderRequiredError,
  type ResolvedCredentials,
  resolveCapabilityCredentials,
} from "@/utils/provider/credentialResolver";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";

const MAX_DOCUMENT_NAME_LENGTH = 64;
type DocumentScope = "persona" | "serverwide";
const DEFAULT_DOCUMENT_SCOPE: DocumentScope = "persona";
const DOCUMENT_PERSONA_MODAL_ID = "teach_document_persona_modal";
const DOCUMENT_PERSONA_SELECT_ID = "persona_select";

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("add")
    .setDescription(localizer("en-US", "commands.memory.document.add.description"))
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription(localizer("en-US", "commands.memory.document.add.name_description"))
        .setRequired(true)
        .setMaxLength(MAX_DOCUMENT_NAME_LENGTH),
    )
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription(localizer("en-US", "commands.memory.document.add.file_description"))
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.memory.document.add.scope_description"))
        .addChoices(
          {
            name: localizer("en-US", "commands.memory.document.add.scope_choice_persona"),
            value: "persona",
          },
          {
            name: localizer("en-US", "commands.memory.document.add.scope_choice_serverwide"),
            value: "serverwide",
          },
        )
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("channels")
        .setDescription(localizer("en-US", "commands.memory.document.add.channels_description"))
        .setRequired(false)
        .setMaxLength(200),
    );

function validateAttachment(attachment: Attachment): {
  isValid: boolean;
  errorKey?: string;
} {
  const allowedExtensions = [".txt", ".md", ".pdf"];
  const filename = attachment.name?.toLowerCase() ?? "";
  const hasAllowedExtension = allowedExtensions.some((ext) => filename.endsWith(ext));

  const allowedTypes = ["text/plain", "text/markdown", "application/pdf"];
  const hasAllowedContentType = attachment.contentType ? allowedTypes.includes(attachment.contentType) : false;

  if (!hasAllowedExtension && !hasAllowedContentType) {
    return { isValid: false, errorKey: "invalid_format" };
  }

  return { isValid: true };
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
  let targetTomoriId: number | null = null;
  let modalSubmitInteraction: ModalSubmitInteraction | null = null;
  let responseInteraction: ChatInputCommandInteraction | ModalSubmitInteraction = interaction;

  try {
    if (!isRagAvailable()) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.document.rag_disabled_title",
        descriptionKey: "commands.teach.document.rag_disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 2. Check memory guard
    const memCheck = memoryGuard.checkMemory();
    if (memCheck.status === "critical") {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "rate_limit.error_memory_critical_title"))
            .setDescription(localizer(locale, "rate_limit.error_memory_critical_description"))
            .setColor(ColorCode.ERROR),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 3. Reserve document quota (per-user)
    const quotaReserve = reserveDocumentQuota(interaction.user.id);
    if (!quotaReserve.allowed) {
      const resetTime = quotaReserve.resetAt ? new Date(quotaReserve.resetAt).toLocaleString(locale) : "unknown";
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
    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    if (interaction.guild) {
      const blacklisted = (await isBlacklisted(interaction.guild.id, interaction.user.id)) ?? false;
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
    tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const overlayResult = await applyPersonalProviderSelectionsToTomoriState(tomoriState, userData.user_id ?? null);
    tomoriState = overlayResult.tomoriState;

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
    let embeddingCreds: ResolvedCredentials;
    try {
      embeddingCreds = await resolveCapabilityCredentials(tomoriState.server_id, "embedding", {
        userId: userData.user_id ?? null,
      });
    } catch (error) {
      if (error instanceof PersonalProviderRequiredError) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.personal_provider_required_title",
          descriptionKey: "general.errors.personal_provider_required_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (error instanceof CredentialUnavailableError && error.source === "personal") {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.api_key_error_title",
          descriptionKey: "general.errors.personal_provider_credentials_error_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      throw error;
    }

    const embeddingModelId =
      getResolvedCapabilityModelId(embeddingCreds, "embedding") ?? tomoriState.config.embedding_model_id;
    if (!embeddingModelId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.document.no_embedding_model_title",
        descriptionKey: "commands.teach.document.no_embedding_model_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embeddingModel = await loadEmbeddingModelById(embeddingModelId);
    if (!embeddingModel) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.document.no_embedding_model_title",
        descriptionKey: "commands.teach.document.no_embedding_model_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 8. Validate document name and parse optional channel tags
    const nameInput = interaction.options.getString("name", true).trim();
    const channelsInput = interaction.options.getString("channels");
    const channelTags: string[] = channelsInput
      ? channelsInput
          .split(",")
          .map((raw) => {
            const s = raw.trim();
            const mention = s.match(/^<#(\d+)>$/);
            if (mention) {
              const resolved = _client.channels.cache.get(mention[1]);
              return "name" in (resolved ?? {}) ? (resolved as { name: string }).name.toLowerCase() : "";
            }
            return s.toLowerCase().replace(/^#+/, "");
          })
          .filter((c) => c.length > 0 && /^[\w-]+$/.test(c))
          .map((c) => `#${c}`)
      : [];

    if (!nameInput || nameInput.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.document.invalid_name_title",
        descriptionKey: "commands.teach.document.invalid_name_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 9. Resolve document scope
    const scopeInput = interaction.options.getString("scope");
    const scope: DocumentScope = scopeInput === "serverwide" ? "serverwide" : DEFAULT_DOCUMENT_SCOPE;
    let scopeLabel = localizer(locale, "commands.teach.document.scope_label_serverwide");

    // Scope `persona` explicitly uses a string-select modal.
    // Scope `serverwide` intentionally skips persona selection and stores tomori_id as NULL.
    if (scope === "persona") {
      const allPersonas = await loadAllPersonasForServer(interaction.guild?.id ?? interaction.user.id);
      const personaSelectOptions: SelectOption[] = allPersonas
        .filter((persona) => persona.tomori_id !== undefined)
        .map((persona) => ({
          label: safeSelectOptionText(persona.tomori_nickname),
          value: persona.tomori_id?.toString() ?? "",
          description: persona.is_alter
            ? localizer(locale, "commands.teach.document.alter_persona_description")
            : localizer(locale, "commands.teach.document.main_persona_description"),
        }))
        .filter((option) => option.value !== "");

      if (personaSelectOptions.length === 0) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const personaModalResult = await promptWithPaginatedModal(interaction, locale, {
        modalCustomId: DOCUMENT_PERSONA_MODAL_ID,
        modalTitleKey: "commands.teach.document.persona_modal_title",
        components: [
          {
            customId: DOCUMENT_PERSONA_SELECT_ID,
            labelKey: "commands.teach.document.persona_select_label",
            descriptionKey: "commands.teach.document.persona_select_description",
            placeholder: "commands.teach.document.persona_select_placeholder",
            required: true,
            options: personaSelectOptions,
          },
        ],
      });

      if (personaModalResult.outcome !== "submit") {
        log.info(`Teach document persona modal ${personaModalResult.outcome} for user ${interaction.user.id}`);
        return;
      }

      modalSubmitInteraction = personaModalResult.interaction ?? null;
      if (!modalSubmitInteraction) {
        return;
      }
      responseInteraction = modalSubmitInteraction;

      const selectedPersonaId = personaModalResult.values?.[DOCUMENT_PERSONA_SELECT_ID];
      const selectedPersona =
        allPersonas.find((persona) => persona.tomori_id?.toString() === selectedPersonaId) ?? null;

      if (!selectedPersona?.tomori_id) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      targetTomoriId = selectedPersona.tomori_id;
      scopeLabel = localizer(locale, "commands.teach.document.scope_label_persona", {
        persona_name: selectedPersona.tomori_nickname,
      });
    }

    // 10. Check duplicate document name in selected scope
    const existing =
      targetTomoriId === null
        ? await sql`
					SELECT document_id
					FROM documents
					WHERE server_id = ${tomoriState.server_id}
					  AND tomori_id IS NULL
					  AND document_name = ${nameInput}
					LIMIT 1
				`
        : await sql`
					SELECT document_id
					FROM documents
					WHERE server_id = ${tomoriState.server_id}
					  AND tomori_id = ${targetTomoriId}
					  AND document_name = ${nameInput}
					LIMIT 1
				`;
    if (existing.length > 0) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.teach.document.duplicate_title",
        descriptionKey: "commands.teach.document.duplicate_description",
        descriptionVars: { name: nameInput },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 11. Enforce document count limit for selected scope
    const [docCountRow] =
      targetTomoriId === null
        ? await sql`
					SELECT COUNT(*) as doc_count
					FROM documents
					WHERE server_id = ${tomoriState.server_id}
					  AND tomori_id IS NULL
				`
        : await sql`
					SELECT COUNT(*) as doc_count
					FROM documents
					WHERE server_id = ${tomoriState.server_id}
					  AND tomori_id = ${targetTomoriId}
				`;
    const docCount = Number(docCountRow?.doc_count || 0);
    if (docCount >= memoryLimits.maxDocumentsPerServer) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.teach.document.limit_exceeded_title",
        descriptionKey: "commands.teach.document.limit_exceeded_description",
        descriptionVars: {
          current_count: docCount.toString(),
          max_allowed: memoryLimits.maxDocumentsPerServer.toString(),
          scope: scopeLabel,
        },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const attachment = interaction.options.getAttachment("file", true);
    const attachmentValidation = validateAttachment(attachment);
    if (!attachmentValidation.isValid) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.teach.document.invalid_file_title",
        descriptionKey: `commands.teach.document.${attachmentValidation.errorKey}`,
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const maxSizeBytes = memoryLimits.maxDocumentSizeMB * 1024 * 1024;
    if (attachment.size && attachment.size > maxSizeBytes) {
      await replyInfoEmbed(responseInteraction, locale, {
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

    await responseInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    const downloadResult = await safeDownload(attachment.url, {
      maxSizeMB: memoryLimits.maxDocumentSizeMB,
      timeoutMs: 20000,
      knownSize: attachment.size,
    });

    if (!downloadResult.success || !downloadResult.buffer) {
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.teach.document.download_failed_title"))
            .setDescription(localizer(locale, "commands.teach.document.download_failed_description"))
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
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.teach.document.empty_title"))
            .setDescription(localizer(locale, "commands.teach.document.empty_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    if (normalizedText.length > memoryLimits.maxDocumentTextLength) {
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.teach.document.too_long_title"))
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

    const chunks = chunkDocumentText(normalizedText, memoryLimits.documentChunkSize, memoryLimits.documentChunkOverlap);

    if (chunks.length === 0) {
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.teach.document.empty_title"))
            .setDescription(localizer(locale, "commands.teach.document.empty_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    if (chunks.length > memoryLimits.maxDocumentChunks) {
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.teach.document.too_many_chunks_title"))
            .setDescription(
              localizer(locale, "commands.teach.document.too_many_chunks_description", {
                max_chunks: memoryLimits.maxDocumentChunks.toString(),
              }),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    const [chunkCountRow] =
      targetTomoriId === null
        ? await sql`
					SELECT COUNT(*) as chunk_count
					FROM document_chunks dc
					JOIN documents d ON d.document_id = dc.document_id
					WHERE d.server_id = ${tomoriState.server_id}
					  AND d.tomori_id IS NULL
				`
        : await sql`
					SELECT COUNT(*) as chunk_count
					FROM document_chunks dc
					JOIN documents d ON d.document_id = dc.document_id
					WHERE d.server_id = ${tomoriState.server_id}
					  AND d.tomori_id = ${targetTomoriId}
				`;
    const currentChunkCount = Number(chunkCountRow?.chunk_count || 0);
    if (currentChunkCount + chunks.length > memoryLimits.maxDocumentChunksPerServer) {
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.teach.document.server_chunk_limit_title"))
            .setDescription(
              localizer(locale, "commands.teach.document.server_chunk_limit_description", {
                max_chunks: memoryLimits.maxDocumentChunksPerServer.toString(),
                scope: scopeLabel,
              }),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    const embeddings = await generateEmbeddingsBatched({
      provider: embeddingModel.provider,
      apiKey: embeddingCreds.apiKey,
      model: embeddingModel.codename,
      inputs: chunks,
      taskType: (await providerSupportsEmbeddingTaskType(embeddingModel.provider)) ? "RETRIEVAL_DOCUMENT" : undefined,
      batchSize: 16,
    });

    const documentId = await insertDocumentWithChunks({
      serverId: tomoriState.server_id,
      tomoriId: targetTomoriId,
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
      channelTags,
    });

    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    await responseInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.teach.document.success_title"))
          .setDescription(
            localizer(locale, "commands.teach.document.success_description", {
              name: nameInput,
              chunk_count: chunks.length.toString(),
              document_id: documentId.toString(),
              scope: scopeLabel,
            }),
          )
          .setColor(ColorCode.SUCCESS),
      ],
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      tomoriId: targetTomoriId ?? tomoriState?.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "teach document",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /teach document command", error, context);

    const errorReplyInteraction =
      modalSubmitInteraction ??
      (responseInteraction.replied || responseInteraction.deferred
        ? responseInteraction
        : interaction.replied || interaction.deferred
          ? interaction
          : null);
    if (errorReplyInteraction) {
      await replyInfoEmbed(errorReplyInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

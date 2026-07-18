import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { EmbedBuilder, MessageFlags, TextInputStyle } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  acknowledgeModalSubmitForRefresh,
  promptWithPaginatedModal,
  promptWithRawModal,
  safeSelectOptionText,
} from "@/utils/discord/ui/modals";
import { promptWithUnacknowledgedConfirmation } from "@/utils/discord/ui/confirmation";
import { replyComponentsV2Status, updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import {
  llmModelRepo,
  personaRepository,
  ragRepository,
  serverMemoryRepository,
  userRepository,
} from "@/utils/db/repositories";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { getMemoryLimits, validateMemoryContent } from "@/utils/misc/memoryLimits";
import { memoryGuard, reserveDocumentQuota } from "@/utils/security/rateLimiter";
import { generateEmbeddingsBatched, providerSupportsEmbeddingTaskType } from "@/utils/embeddings/embeddingProvider";
import {
  CredentialUnavailableError,
  getResolvedCapabilityModelId,
  PersonalProviderRequiredError,
  resolveCapabilityCredentials,
} from "@/utils/provider/credentialResolver";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";

const SELECT_MODAL_CUSTOM_ID = "memory_server_vectorize_select_modal";
const VECTORIZE_MODAL_CUSTOM_ID = "memory_server_vectorize_value_modal";
const MEMORY_SELECT_ID = "memory_select";
const CONTENT_INPUT_ID = "vectorize_content_input";
const DOC_NAME_INPUT_ID = "vectorize_doc_name_input";
const CHANNEL_TAGS_INPUT_ID = "vectorize_channel_tags_input";

const MAX_DOC_NAME_LENGTH = 64;
const MAX_CHANNEL_TAGS_LENGTH = 200;

const memoryLimits = getMemoryLimits();

function parseChannelTagsInput(input: string, client: Client): string[] {
  return input
    .split(",")
    .map((raw) => {
      const s = raw.trim();
      const mention = s.match(/^<#(\d+)>$/);
      if (mention) {
        const resolved = client.channels.cache.get(mention[1]);
        return "name" in (resolved ?? {}) ? (resolved as { name: string }).name.toLowerCase() : "";
      }
      return s.toLowerCase().replace(/^#+/, "");
    })
    .filter((c) => c.length > 0 && /^[\w-]+$/.test(c))
    .map((c) => `#${c}`);
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("vectorize").setDescription(localizer("en-US", "commands.memory.server.vectorize.description"));

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
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

  let tomoriState: TomoriState | null = null;
  let selectedPersona: TomoriState | null = null;
  let personaSelectionInteraction: ButtonInteraction | null = null;
  let deferredInteraction: ModalSubmitInteraction | null = null;

  try {
    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

    if (interaction.guild) {
      const blacklisted = (await userRepository.isBlacklisted(interaction.guild.id, interaction.user.id)) ?? false;
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

    const allPersonas = await personaRepository.loadAllForServer(interaction.guild?.id ?? interaction.user.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const avatarSessionCache: AvatarSessionCache = new Map();

    while (true) {
      // ── Step 1: Persona picker ──────────────────────────────────────────────
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        avatarSessionCache,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success) return;
      if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) return;

      personaSelectionInteraction = personaSelection.interaction;
      selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
      if (!selectedPersona?.persona_id) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "general.errors.invalid_option_title",
          "general.errors.invalid_option_description",
          ColorCode.ERROR,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      if (!tomoriState.config.server_memteaching_enabled && !hasManagePermission) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.teach.memory.server.teaching_disabled_title",
          descriptionKey: "commands.teach.memory.server.teaching_disabled_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const targetPersonaLineageId = selectedPersona.persona_lineage_id ?? 0;
      const memories = await serverMemoryRepository.loadServerMemoriesScoped(
        tomoriState.server_id,
        targetPersonaLineageId,
        hasManagePermission ? undefined : userData.user_id,
      );

      if (memories.length === 0) {
        const descriptionKey = hasManagePermission
          ? "commands.forget.memory.server.no_memories"
          : "commands.forget.memory.server.no_owned_memories";
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "commands.forget.memory.server.no_memories_title",
          descriptionKey,
          ColorCode.WARN,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      // ── Step 2: Memory selection modal ─────────────────────────────────────
      const memorySelectOptions: SelectOption[] = memories.map((memory, index) => ({
        label: safeSelectOptionText(memory.content, 20),
        value: index.toString(),
        description: safeSelectOptionText(memory.content),
      }));

      const selectModalResult = await promptWithPaginatedModal(personaSelectionInteraction, locale, {
        modalCustomId: SELECT_MODAL_CUSTOM_ID,
        modalTitleKey: "commands.memory.server.vectorize.select_modal_title",
        components: [
          {
            customId: MEMORY_SELECT_ID,
            labelKey: "commands.memory.server.vectorize.select_label",
            descriptionKey: "commands.memory.server.vectorize.select_description",
            placeholder: "commands.memory.server.vectorize.select_placeholder",
            required: true,
            options: memorySelectOptions,
          },
        ],
      });

      if (selectModalResult.outcome !== "submit") {
        log.info(`Server memory vectorize selection modal ${selectModalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      const selectModalInteraction = selectModalResult.interaction;
      const selectedIndex = selectModalResult.values?.[MEMORY_SELECT_ID];
      if (!selectModalInteraction || !selectedIndex) {
        log.error("Server memory vectorize selection unexpectedly missing interaction or values");
        return;
      }

      const selectedMemory = memories[Number.parseInt(selectedIndex, 10)];
      if (!selectedMemory) {
        await replyInfoEmbed(selectModalInteraction, locale, {
          titleKey: "general.errors.operation_failed_title",
          descriptionKey: "commands.forget.memory.server.memory_not_found",
          color: ColorCode.ERROR,
        });
        return;
      }

      if (!hasManagePermission && selectedMemory.user_id !== userData.user_id) {
        await replyInfoEmbed(selectModalInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        continue;
      }

      await acknowledgeModalSubmitForRefresh(selectModalInteraction);

      // ── Step 3: Confirmation embed ─────────────────────────────────────────
      const confirmationResult = await promptWithUnacknowledgedConfirmation(interaction, locale, {
        embedTitleKey: "commands.memory.server.vectorize.confirm_title",
        embedDescriptionKey: "commands.memory.server.vectorize.confirm_description",
        embedDescriptionVars: { memory: selectedMemory.content },
        embedColor: ColorCode.INFO,
        useComponentsV2: true,
        continueLabelKey: "general.confirm",
        cancelLabelKey: "general.pagination.cancel",
        continueCustomId: `memory_server_vectorize_confirm_${selectModalInteraction.id}`,
        cancelCustomId: `memory_server_vectorize_cancel_${selectModalInteraction.id}`,
      });

      if (confirmationResult.outcome !== "continue" || !confirmationResult.interaction) {
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      // Pre-fill channel tags from any #channel-format tags on the memory
      const existingChannelTags = (selectedMemory.tags ?? [])
        .map((t) => t.replace(/^["']+|["']+$/g, ""))
        .filter((t) => t.startsWith("#"));
      const channelTagsPrefill = existingChannelTags.join(", ");

      // ── Step 4: Vectorize modal ────────────────────────────────────────────
      const vectorizeModalResult = await promptWithRawModal(confirmationResult.interaction, locale, {
        modalCustomId: VECTORIZE_MODAL_CUSTOM_ID,
        modalTitleKey: "commands.memory.server.vectorize.modal_title",
        components: [
          {
            customId: CONTENT_INPUT_ID,
            labelKey: "commands.memory.server.vectorize.content_label",
            descriptionKey: "commands.memory.server.vectorize.content_description",
            placeholder: "commands.memory.server.vectorize.content_placeholder",
            style: TextInputStyle.Paragraph,
            required: true,
            maxLength: memoryLimits.maxMemoryLength,
            value: selectedMemory.content,
          },
          {
            customId: DOC_NAME_INPUT_ID,
            labelKey: "commands.memory.server.vectorize.doc_name_label",
            descriptionKey: "commands.memory.server.vectorize.doc_name_description",
            placeholder: "commands.memory.server.vectorize.doc_name_placeholder",
            style: TextInputStyle.Short,
            required: true,
            maxLength: MAX_DOC_NAME_LENGTH,
          },
          {
            customId: CHANNEL_TAGS_INPUT_ID,
            labelKey: "commands.memory.server.vectorize.channel_tags_label",
            descriptionKey: "commands.memory.server.vectorize.channel_tags_description",
            placeholder: "commands.memory.server.vectorize.channel_tags_placeholder",
            style: TextInputStyle.Short,
            required: false,
            maxLength: MAX_CHANNEL_TAGS_LENGTH,
            value: channelTagsPrefill,
          },
        ],
      });

      if (vectorizeModalResult.outcome !== "submit") {
        log.info(`Server memory vectorize modal ${vectorizeModalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      const vectorizeInteraction = vectorizeModalResult.interaction;
      if (!vectorizeInteraction) {
        log.error("Server memory vectorize modal unexpectedly missing interaction");
        return;
      }

      const editedContent = vectorizeModalResult.values?.[CONTENT_INPUT_ID]?.trim() ?? "";
      const docName = vectorizeModalResult.values?.[DOC_NAME_INPUT_ID]?.trim() ?? "";
      const rawTagsInput = vectorizeModalResult.values?.[CHANNEL_TAGS_INPUT_ID]?.trim() ?? "";
      const channelTags = rawTagsInput ? parseChannelTagsInput(rawTagsInput, client) : [];

      // ── Step 5: Sync validation (before deferReply) ────────────────────────
      const contentValidation = validateMemoryContent(editedContent);
      if (!contentValidation.isValid) {
        await replyInfoEmbed(vectorizeInteraction, locale, {
          titleKey: "commands.teach.memory.server.content_too_long_title",
          descriptionKey: "commands.teach.memory.server.content_too_long_description",
          descriptionVars: {
            max_length: (contentValidation.maxAllowed || memoryLimits.maxMemoryLength).toString(),
          },
          color: ColorCode.ERROR,
        });
        continue;
      }

      if (!docName) {
        await replyInfoEmbed(vectorizeInteraction, locale, {
          titleKey: "commands.memory.server.vectorize.invalid_doc_name_title",
          descriptionKey: "commands.memory.server.vectorize.invalid_doc_name_description",
          color: ColorCode.ERROR,
        });
        continue;
      }

      if (!isRagAvailable()) {
        await replyInfoEmbed(vectorizeInteraction, locale, {
          titleKey: "commands.memory.server.vectorize.rag_disabled_title",
          descriptionKey: "commands.memory.server.vectorize.rag_disabled_description",
          color: ColorCode.ERROR,
        });
        continue;
      }

      if (memoryGuard.checkMemory().status === "critical") {
        await replyInfoEmbed(vectorizeInteraction, locale, {
          titleKey: "rate_limit.error_memory_critical_title",
          descriptionKey: "rate_limit.error_memory_critical_description",
          color: ColorCode.ERROR,
        });
        continue;
      }

      // Resolve embedding credentials
      const overlayResult = await applyPersonalProviderSelectionsToTomoriState(tomoriState, userData.user_id ?? null);
      const stateWithOverlays = overlayResult.tomoriState;

      let embeddingCreds: Awaited<ReturnType<typeof resolveCapabilityCredentials>>;
      try {
        embeddingCreds = await resolveCapabilityCredentials(stateWithOverlays.server_id, "embedding", {
          userId: userData.user_id ?? null,
        });
      } catch (credError) {
        if (credError instanceof PersonalProviderRequiredError) {
          await replyInfoEmbed(vectorizeInteraction, locale, {
            titleKey: "general.errors.personal_provider_required_title",
            descriptionKey: "general.errors.personal_provider_required_description",
            color: ColorCode.ERROR,
          });
          continue;
        }
        if (credError instanceof CredentialUnavailableError) {
          await replyInfoEmbed(vectorizeInteraction, locale, {
            titleKey: "commands.memory.server.vectorize.embedding_creds_missing_title",
            descriptionKey: "commands.memory.server.vectorize.embedding_creds_missing_description",
            color: ColorCode.ERROR,
          });
          continue;
        }
        throw credError;
      }

      const embeddingModelId =
        getResolvedCapabilityModelId(embeddingCreds, "embedding") ?? stateWithOverlays.config.embedding_model_id;
      if (!embeddingModelId) {
        await replyInfoEmbed(vectorizeInteraction, locale, {
          titleKey: "commands.memory.server.vectorize.no_embedding_model_title",
          descriptionKey: "commands.memory.server.vectorize.no_embedding_model_description",
          color: ColorCode.ERROR,
        });
        continue;
      }

      const embeddingModel = await llmModelRepo.loadEmbeddingModelById(embeddingModelId);
      if (!embeddingModel) {
        await replyInfoEmbed(vectorizeInteraction, locale, {
          titleKey: "commands.memory.server.vectorize.no_embedding_model_title",
          descriptionKey: "commands.memory.server.vectorize.no_embedding_model_description",
          color: ColorCode.ERROR,
        });
        continue;
      }

      const duplicateExists = await serverMemoryRepository.documentExistsByName(
        tomoriState.server_id,
        selectedPersona.persona_id,
        docName,
      );
      if (duplicateExists) {
        await replyInfoEmbed(vectorizeInteraction, locale, {
          titleKey: "commands.memory.server.vectorize.duplicate_title",
          descriptionKey: "commands.memory.server.vectorize.duplicate_description",
          descriptionVars: { name: docName, persona_name: selectedPersona.persona_nickname },
          color: ColorCode.ERROR,
        });
        continue;
      }

      const docCount = await serverMemoryRepository.countDocumentsScoped(
        tomoriState.server_id,
        selectedPersona.persona_id,
      );
      if (docCount >= memoryLimits.maxDocumentsPerServer) {
        await replyInfoEmbed(vectorizeInteraction, locale, {
          titleKey: "commands.memory.server.vectorize.doc_limit_title",
          descriptionKey: "commands.memory.server.vectorize.doc_limit_description",
          descriptionVars: {
            current_count: docCount.toString(),
            max_allowed: memoryLimits.maxDocumentsPerServer.toString(),
            persona_name: selectedPersona.persona_nickname,
          },
          color: ColorCode.ERROR,
        });
        continue;
      }

      // ── Step 6: Async pipeline (defer first) ───────────────────────────────
      await vectorizeInteraction.deferReply({ flags: MessageFlags.Ephemeral });
      deferredInteraction = vectorizeInteraction;

      const normalizedContent = ragRepository.normalizeText(editedContent);
      const chunks = ragRepository.chunkText(
        normalizedContent,
        memoryLimits.documentChunkSize,
        memoryLimits.documentChunkOverlap,
      );

      if (chunks.length === 0) {
        await vectorizeInteraction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.memory.server.vectorize.empty_content_title"))
              .setDescription(localizer(locale, "commands.memory.server.vectorize.empty_content_description"))
              .setColor(ColorCode.ERROR),
          ],
        });
        continue;
      }

      const currentChunkCount = await serverMemoryRepository.countChunksScoped(
        tomoriState.server_id,
        selectedPersona.persona_id,
      );
      if (currentChunkCount + chunks.length > memoryLimits.maxDocumentChunksPerServer) {
        await vectorizeInteraction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.memory.server.vectorize.chunk_limit_title"))
              .setDescription(
                localizer(locale, "commands.memory.server.vectorize.chunk_limit_description", {
                  max_chunks: memoryLimits.maxDocumentChunksPerServer.toString(),
                  persona_name: selectedPersona.persona_nickname,
                }),
              )
              .setColor(ColorCode.ERROR),
          ],
        });
        continue;
      }

      // Reserve document quota now that all validation has passed — earlier placement
      // would burn the user's daily slot on duplicate-name and credential errors that
      // never write a document.
      const quotaReserve = reserveDocumentQuota(interaction.user.id);
      if (!quotaReserve.allowed) {
        await replyInfoEmbed(vectorizeInteraction, locale, {
          titleKey: "rate_limit.error_quota_exceeded_title",
          descriptionKey: "rate_limit.error_quota_exceeded_description",
          descriptionVars: {
            reset_time: quotaReserve.resetAt ? new Date(quotaReserve.resetAt).toLocaleString(locale) : "unknown",
          },
          color: ColorCode.ERROR,
        });
        continue;
      }

      const embeddings = await generateEmbeddingsBatched({
        provider: embeddingModel.provider,
        apiKey: embeddingCreds.apiKey,
        model: embeddingModel.codename,
        modelId: embeddingModel.embedding_model_id,
        inputs: chunks,
        taskType: (await providerSupportsEmbeddingTaskType(embeddingModel.provider)) ? "RETRIEVAL_DOCUMENT" : undefined,
        batchSize: 16,
      });

      await ragRepository.insertWithChunks({
        serverId: tomoriState.server_id,
        personaId: selectedPersona.persona_id,
        uploaderUserId: userData.user_id ?? null,
        documentName: docName,
        fileName: null,
        mimeType: null,
        fileSizeBytes: null,
        textContent: normalizedContent,
        chunks,
        embeddings,
        embeddingModelId,
        embeddingFamily: embeddingModel.model_family,
        sourceType: "memory",
        channelTags,
      });

      if (selectedMemory.server_memory_id) {
        await serverMemoryRepository.remove(selectedMemory.server_memory_id);
      }

      invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

      log.success(
        `Vectorized server memory ${selectedMemory.server_memory_id} → "${docName}" (${chunks.length} chunks) for persona ${selectedPersona.persona_id} in server ${tomoriState.server_id}`,
      );

      const successVars = {
        name: docName,
        chunk_count: chunks.length.toString(),
        persona_name: selectedPersona.persona_nickname,
      };

      await vectorizeInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.memory.server.vectorize.success_title"))
            .setDescription(localizer(locale, "commands.memory.server.vectorize.success_description", successVars))
            .setColor(ColorCode.SUCCESS),
        ],
      });

      deferredInteraction = null;

      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.memory.server.vectorize.success_title",
        "commands.memory.server.vectorize.success_description",
        ColorCode.SUCCESS,
        successVars,
        "general.pagination.reloading_persona_picker",
      );
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: selectedPersona?.persona_id ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "memory server vectorize",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /memory server vectorize for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

    if (deferredInteraction) {
      await deferredInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "general.errors.unknown_error_title"))
            .setDescription(localizer(locale, "general.errors.unknown_error_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    const errorReplyTarget =
      personaSelectionInteraction && !personaSelectionInteraction.deferred && !personaSelectionInteraction.replied
        ? personaSelectionInteraction
        : interaction;
    await replyInfoEmbed(errorReplyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

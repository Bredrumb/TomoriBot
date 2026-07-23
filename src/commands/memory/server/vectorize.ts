import type {
  ActionRowData,
  ButtonComponentData,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ComponentInContainerData,
  ContainerComponentData,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { ButtonStyle, ComponentType, MessageFlags, TextInputStyle } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS as WORKFLOW_COMPONENT_TIMEOUT_MS,
  retryPersonaWorkflow,
  runPersonaPickerWorkflow,
  type PersonaWorkflowComponentsV2Payload,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/personaWorkflow";
import { lineageIdIsEligible } from "@/utils/discord/ui/personaEligibility";
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
const CONFIRMATION_DESCRIPTION_LIMIT = 3800;
const memoryLimits = getMemoryLimits();

function buildConfirmationPayload(locale: string, memory: string, phaseId: string): PersonaWorkflowComponentsV2Payload {
  const description = localizer(locale, "commands.memory.server.vectorize.confirm_description", { memory }).slice(
    0,
    CONFIRMATION_DESCRIPTION_LIMIT,
  );
  const actionRow: ActionRowData<ButtonComponentData> = {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Success,
        customId: `memory_server_vectorize_confirm_${phaseId}`,
        label: localizer(locale, "general.confirm"),
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        customId: `memory_server_vectorize_cancel_${phaseId}`,
        label: localizer(locale, "general.pagination.cancel"),
      },
    ],
  };
  const components: ComponentInContainerData[] = [
    {
      type: ComponentType.TextDisplay,
      content: `### ${localizer(locale, "commands.memory.server.vectorize.confirm_title")}`,
    },
    { type: ComponentType.TextDisplay, content: description },
    actionRow,
  ];
  const container: ContainerComponentData<ComponentInContainerData> = {
    type: ComponentType.Container,
    accentColor: Number.parseInt(ColorCode.INFO.replace("#", ""), 16),
    components,
  };
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

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
  let selectedPersonaId: number | undefined;
  const workflowState: { message: PersonaWorkflowMessageController | null } = { message: null };

  try {
    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    const baseTomoriState = tomoriState;
    if (!baseTomoriState.config.server_memteaching_enabled && !hasManagePermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.memory.server.teaching_disabled_title",
        descriptionKey: "commands.teach.memory.server.teaching_disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Class B, permission-dependent eligibility. A manager sees every lineage
    // with server memories; a non-manager only lineages with memories they own.
    // Vectorizing does not delete a memory, so the set stays static (no refresh).
    const memoryUserScope = hasManagePermission ? undefined : userData.user_id;
    const eligibleServerMemoryLineageIds = await serverMemoryRepository.lineageIdsWithServerMemories(
      baseTomoriState.server_id,
      memoryUserScope,
    );
    const isEligible = lineageIdIsEligible(eligibleServerMemoryLineageIds);
    const emptyMemoriesDescriptionKey = hasManagePermission
      ? "commands.forget.memory.server.no_memories"
      : "commands.forget.memory.server.no_owned_memories";
    const eligiblePersonas = allPersonas.filter(isEligible);
    if (eligiblePersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.forget.memory.server.no_memories_title",
        descriptionKey: emptyMemoriesDescriptionKey,
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const workflowResult = await runPersonaPickerWorkflow(interaction, locale, {
      personas: allPersonas,
      color: ColorCode.INFO,
      eligibility: {
        isEligible,
        emptyTitleKey: "commands.forget.memory.server.no_memories_title",
        emptyDescriptionKey: emptyMemoriesDescriptionKey,
        itemsLabelKey: "general.persona_workflow.items.server_memories",
      },
      async onSelected(selection) {
        workflowState.message = selection.message;
        selectedPersona = selection.persona;
        const personaId = selectedPersona.persona_id;
        selectedPersonaId = personaId;
        if (!personaId) {
          const work = await selection.beginInPlaceWork();
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.invalid_option_title",
              descriptionKey: "general.errors.invalid_option_description",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.ERROR,
            }),
          );
          return retryPersonaWorkflow();
        }

        let memories: Awaited<ReturnType<typeof serverMemoryRepository.loadServerMemoriesScoped>> = [];
        let memoriesLoaded = false;
        const selectModalResult = await selection.openModal(async () => {
          memories = await serverMemoryRepository.loadServerMemoriesScoped(
            baseTomoriState.server_id,
            selectedPersona?.persona_lineage_id ?? 0,
            hasManagePermission ? undefined : userData.user_id,
          );
          memoriesLoaded = true;
          if (memories.length === 0) throw new Error("No scoped server memories are available");

          const memorySelectOptions: SelectOption[] = memories.map((memory, index) => ({
            label: safeSelectOptionText(memory.content, 20),
            value: index.toString(),
            description: safeSelectOptionText(memory.content),
          }));
          return {
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
          };
        });

        if (selectModalResult.outcome !== "submitted") {
          log.info(`Server memory vectorize selection modal ${selectModalResult.outcome} for user ${userData.user_id}`);
          if (memoriesLoaded && memories.length === 0 && selectModalResult.outcome === "error") {
            const descriptionKey = hasManagePermission
              ? "commands.forget.memory.server.no_memories"
              : "commands.forget.memory.server.no_owned_memories";
            await selection.message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "commands.forget.memory.server.no_memories_title",
                descriptionKey,
                footerKey: "general.pagination.reloading_persona_picker",
                color: ColorCode.WARN,
              }),
            );
          }
          return selectModalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
        }

        const selectWork = await selectModalResult.phase.beginInPlaceWork();
        const selectedIndex = Number.parseInt(selectModalResult.phase.values[MEMORY_SELECT_ID] ?? "", 10);
        const selectedMemory = memories[selectedIndex];
        if (!selectedMemory) {
          await selectWork.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.operation_failed_title",
              descriptionKey: "commands.forget.memory.server.memory_not_found",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.ERROR,
            }),
          );
          return retryPersonaWorkflow();
        }
        if (!hasManagePermission && selectedMemory.user_id !== userData.user_id) {
          await selectWork.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.update_failed_title",
              descriptionKey: "general.errors.update_failed_description",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.ERROR,
            }),
          );
          return retryPersonaWorkflow();
        }

        const confirmId = `memory_server_vectorize_confirm_${selection.phaseId}`;
        const cancelId = `memory_server_vectorize_cancel_${selection.phaseId}`;
        await selectWork.message.replace(buildConfirmationPayload(locale, selectedMemory.content, selection.phaseId));

        let confirmationButton: ButtonInteraction;
        try {
          const confirmationMessage = await selectWork.message.fetchMessage();
          confirmationButton = await confirmationMessage.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: (candidate) =>
              candidate.user.id === interaction.user.id &&
              (candidate.customId === confirmId || candidate.customId === cancelId),
            time: WORKFLOW_COMPONENT_TIMEOUT_MS,
          });
        } catch (error) {
          log.info(
            `Server memory vectorize confirmation timed out for user ${userData.user_id}: ${error instanceof Error ? error.message : String(error)}`,
          );
          await selectWork.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.interaction.timeout_title",
              descriptionKey: "general.interaction.timeout_description",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.WARN,
            }),
          );
          return retryPersonaWorkflow();
        }

        const confirmationPhase = selection.useButton(confirmationButton);
        if (confirmationButton.customId === cancelId) {
          await confirmationPhase.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.interaction.cancel_title",
              descriptionKey: "general.interaction.cancel_description",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.WARN,
            }),
          );
          return retryPersonaWorkflow();
        }

        const existingChannelTags = (selectedMemory.tags ?? [])
          .map((tag) => tag.replace(/^["']+|["']+$/g, ""))
          .filter((tag) => tag.startsWith("#"));
        const vectorizeModalResult = await confirmationPhase.openModal({
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
              value: existingChannelTags.join(", "),
            },
          ],
        });

        if (vectorizeModalResult.outcome !== "submitted") {
          log.info(`Server memory vectorize modal ${vectorizeModalResult.outcome} for user ${userData.user_id}`);
          return vectorizeModalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
        }

        const work = await vectorizeModalResult.phase.beginInPlaceWork();
        const editedContent = vectorizeModalResult.phase.values[CONTENT_INPUT_ID]?.trim() ?? "";
        const docName = vectorizeModalResult.phase.values[DOC_NAME_INPUT_ID]?.trim() ?? "";
        const rawTagsInput = vectorizeModalResult.phase.values[CHANNEL_TAGS_INPUT_ID]?.trim() ?? "";
        const channelTags = rawTagsInput ? parseChannelTagsInput(rawTagsInput, client) : [];

        const replaceError = async (
          titleKey: string,
          descriptionKey: string,
          descriptionVars?: Record<string, string>,
        ) => {
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey,
              descriptionKey,
              descriptionVars,
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.ERROR,
            }),
          );
          return retryPersonaWorkflow();
        };

        const contentValidation = validateMemoryContent(editedContent);
        if (!contentValidation.isValid) {
          return replaceError(
            "commands.teach.memory.server.content_too_long_title",
            "commands.teach.memory.server.content_too_long_description",
            { max_length: (contentValidation.maxAllowed || memoryLimits.maxMemoryLength).toString() },
          );
        }
        if (!docName) {
          return replaceError(
            "commands.memory.server.vectorize.invalid_doc_name_title",
            "commands.memory.server.vectorize.invalid_doc_name_description",
          );
        }
        if (!isRagAvailable()) {
          return replaceError(
            "commands.memory.server.vectorize.rag_disabled_title",
            "commands.memory.server.vectorize.rag_disabled_description",
          );
        }
        if (memoryGuard.checkMemory().status === "critical") {
          return replaceError("rate_limit.error_memory_critical_title", "rate_limit.error_memory_critical_description");
        }

        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "general.persona_workflow.loading_title",
            descriptionKey: "general.persona_workflow.loading_description",
            color: ColorCode.INFO,
          }),
        );
        const overlayResult = await applyPersonalProviderSelectionsToTomoriState(
          baseTomoriState,
          userData.user_id ?? null,
        );
        const stateWithOverlays = overlayResult.tomoriState;
        let embeddingCreds: Awaited<ReturnType<typeof resolveCapabilityCredentials>>;
        try {
          embeddingCreds = await resolveCapabilityCredentials(stateWithOverlays.server_id, "embedding", {
            userId: userData.user_id ?? null,
          });
        } catch (credError) {
          if (credError instanceof PersonalProviderRequiredError) {
            return replaceError(
              "general.errors.personal_provider_required_title",
              "general.errors.personal_provider_required_description",
            );
          }
          if (credError instanceof CredentialUnavailableError) {
            return replaceError(
              "commands.memory.server.vectorize.embedding_creds_missing_title",
              "commands.memory.server.vectorize.embedding_creds_missing_description",
            );
          }
          throw credError;
        }

        const embeddingModelId =
          getResolvedCapabilityModelId(embeddingCreds, "embedding") ?? stateWithOverlays.config.embedding_model_id;
        if (!embeddingModelId) {
          return replaceError(
            "commands.memory.server.vectorize.no_embedding_model_title",
            "commands.memory.server.vectorize.no_embedding_model_description",
          );
        }
        const embeddingModel = await llmModelRepo.loadEmbeddingModelById(embeddingModelId);
        if (!embeddingModel) {
          return replaceError(
            "commands.memory.server.vectorize.no_embedding_model_title",
            "commands.memory.server.vectorize.no_embedding_model_description",
          );
        }

        if (await serverMemoryRepository.documentExistsByName(baseTomoriState.server_id, personaId, docName)) {
          return replaceError(
            "commands.memory.server.vectorize.duplicate_title",
            "commands.memory.server.vectorize.duplicate_description",
            { name: docName, persona_name: selectedPersona.persona_nickname },
          );
        }
        const docCount = await serverMemoryRepository.countDocumentsScoped(baseTomoriState.server_id, personaId);
        if (docCount >= memoryLimits.maxDocumentsPerServer) {
          return replaceError(
            "commands.memory.server.vectorize.doc_limit_title",
            "commands.memory.server.vectorize.doc_limit_description",
            {
              current_count: docCount.toString(),
              max_allowed: memoryLimits.maxDocumentsPerServer.toString(),
              persona_name: selectedPersona.persona_nickname,
            },
          );
        }

        const normalizedContent = ragRepository.normalizeText(editedContent);
        const chunks = ragRepository.chunkText(
          normalizedContent,
          memoryLimits.documentChunkSize,
          memoryLimits.documentChunkOverlap,
        );
        if (chunks.length === 0) {
          return replaceError(
            "commands.memory.server.vectorize.empty_content_title",
            "commands.memory.server.vectorize.empty_content_description",
          );
        }
        const currentChunkCount = await serverMemoryRepository.countChunksScoped(baseTomoriState.server_id, personaId);
        if (currentChunkCount + chunks.length > memoryLimits.maxDocumentChunksPerServer) {
          return replaceError(
            "commands.memory.server.vectorize.chunk_limit_title",
            "commands.memory.server.vectorize.chunk_limit_description",
            {
              max_chunks: memoryLimits.maxDocumentChunksPerServer.toString(),
              persona_name: selectedPersona.persona_nickname,
            },
          );
        }

        const quotaReserve = reserveDocumentQuota(interaction.user.id);
        if (!quotaReserve.allowed) {
          return replaceError("rate_limit.error_quota_exceeded_title", "rate_limit.error_quota_exceeded_description", {
            reset_time: quotaReserve.resetAt ? new Date(quotaReserve.resetAt).toLocaleString(locale) : "unknown",
          });
        }

        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "general.persona_workflow.loading_title",
            descriptionKey: "general.persona_workflow.loading_description",
            color: ColorCode.INFO,
          }),
        );
        const embeddings = await generateEmbeddingsBatched({
          provider: embeddingModel.provider,
          apiKey: embeddingCreds.apiKey,
          model: embeddingModel.codename,
          modelId: embeddingModel.embedding_model_id,
          inputs: chunks,
          taskType: (await providerSupportsEmbeddingTaskType(embeddingModel.provider))
            ? "RETRIEVAL_DOCUMENT"
            : undefined,
          batchSize: 16,
        });
        const documentId = await ragRepository.insertWithChunks({
          serverId: baseTomoriState.server_id,
          personaId,
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
        const serverDiscId = interaction.guild?.id ?? interaction.user.id;
        invalidateTomoriStateCache(serverDiscId);

        const originalMemoryId = selectedMemory.server_memory_id;
        const originalMemoryRemoved =
          typeof originalMemoryId === "number" && (await serverMemoryRepository.remove(originalMemoryId));
        if (!originalMemoryRemoved) {
          const context: ErrorContext = {
            userId: userData.user_id,
            serverId: baseTomoriState.server_id,
            personaId,
            errorType: "DatabaseUpdateError",
            metadata: {
              command: "memory server vectorize",
              guildId: serverDiscId,
              originalMemoryId: originalMemoryId ?? null,
              newDocumentId: documentId,
              documentName: docName,
              chunkCount: chunks.length,
            },
          };
          await log.error(
            "Failed to remove the original server memory after vectorizing it",
            new Error(
              typeof originalMemoryId === "number"
                ? "Server memory removal returned false"
                : "Selected server memory has no database ID",
            ),
            context,
          );
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.memory.server.vectorize.partial_failure_title",
              descriptionKey: "commands.memory.server.vectorize.partial_failure_description",
              descriptionVars: {
                name: docName,
                chunk_count: chunks.length.toString(),
                persona_name: selectedPersona.persona_nickname,
              },
              color: ColorCode.WARN,
            }),
          );
          return completePersonaWorkflow();
        }
        invalidateTomoriStateCache(serverDiscId);

        log.success(
          `Vectorized server memory ${selectedMemory.server_memory_id} → "${docName}" (${chunks.length} chunks) for persona ${personaId} in server ${baseTomoriState.server_id}`,
        );
        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "commands.memory.server.vectorize.success_title",
            descriptionKey: "commands.memory.server.vectorize.success_description",
            descriptionVars: {
              name: docName,
              chunk_count: chunks.length.toString(),
              persona_name: selectedPersona.persona_nickname,
            },
            footerKey: "general.pagination.reloading_persona_picker",
            color: ColorCode.SUCCESS,
          }),
        );
        return retryPersonaWorkflow();
      },
    });

    if (workflowResult.outcome === "error" && workflowState.message) {
      await workflowState.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        }),
      );
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: selectedPersonaId ?? tomoriState?.persona_id,
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

    if (workflowState.message) {
      await workflowState.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        }),
      );
    } else {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

import type { ButtonInteraction, Message } from "discord.js";
import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type {
  ModalChannelSelectField,
  ModalInputField,
  ModalResult,
  ModalSelectField,
  SelectOption,
} from "@/types/discord/modal";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { llmModelRepo, personaRepository, ragRepository } from "@/utils/db/repositories";
import { resolveUserLocale } from "@/utils/discord/interactionLocale";
import {
  DISCORD_SELECT_OPTION_DESCRIPTION_MAX,
  DISCORD_SELECT_VALUES_MAX,
} from "@/utils/discord/ui/componentsV2Limits";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { generateEmbeddingsBatched, providerSupportsEmbeddingTaskType } from "@/utils/embeddings/embeddingProvider";
import { ColorCode, log } from "@/utils/misc/logger";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import type { ResolvedCredentials } from "@/utils/provider/credentialResolver";
import { getResolvedCapabilityModelId, resolveCapabilityCredentials } from "@/utils/provider/credentialResolver";
import {
  createProviderUsageRecorder,
  findProviderRequestDeniedError,
  getProviderRequestFailureCopy,
  withProviderUsageContext,
} from "@/utils/provider/providerUsage";
import { localizer } from "@/utils/text/localizer";
import { resolvePersonaSnippet } from "@/utils/text/personaPrompt";
import {
  COMPACT_EDIT_WINDOW_MS,
  COMPACT_ROUTE_NAMESPACE,
  COMPACT_ROUTE_VERSION,
  type SummaryControlAction,
  type SummaryControls,
  isSummaryEditWindowOpen,
  renderSummaryMessage,
} from "./rendering";
import type { SendableChannel } from "./types";

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

/**
 * Message IDs whose document save is in flight. Saved state itself lives on the message (its buttons
 * are withdrawn), so this set only covers the window between a submit and that repaint.
 */
const savingSummaryMessageIds = new Set<string>();

export async function postSummaryWithControls(params: {
  outputChannel: SendableChannel;
  embed: EmbedBuilder;
  locale: string;
  refresh: boolean;
}): Promise<void> {
  const controls: SummaryControls = {
    locale: params.locale,
    refresh: params.refresh,
    editDeadline: Math.ceil((Date.now() + COMPACT_EDIT_WINDOW_MS) / 1000),
  };
  const summaryMessage = await params.outputChannel.send(renderSummaryMessage(params.embed, controls, false));
  // Because a restart drops this timer, the edit route also withdraws the stale button on its next click.
  setTimeout(() => void withdrawExpiredEditButton(summaryMessage, controls), controls.editDeadline * 1000 - Date.now());
}

async function withdrawExpiredEditButton(summaryMessage: Message, controls: SummaryControls): Promise<void> {
  const liveMessage = await summaryMessage.fetch().catch(() => null);
  const liveEmbed = liveMessage?.embeds[0];
  if (!liveMessage || !liveEmbed || !hasSummaryControl(liveMessage, "edit")) return;
  if (savingSummaryMessageIds.has(liveMessage.id) || !hasSummaryControl(liveMessage, "save")) return;
  await liveMessage.edit(renderSummaryMessage(EmbedBuilder.from(liveEmbed), controls, false)).catch(() => {});
}

function hasSummaryControl(message: Pick<Message, "components">, action: SummaryControlAction): boolean {
  const prefix = `${COMPACT_ROUTE_NAMESPACE}:${COMPACT_ROUTE_VERSION}:${action}:`;
  return message.components.some(
    (row) =>
      "components" in row &&
      row.components.some(
        (component) =>
          "customId" in component && typeof component.customId === "string" && component.customId.startsWith(prefix),
      ),
  );
}

async function replyEditLocked(interaction: Parameters<typeof replyInfoEmbed>[0], locale: string): Promise<void> {
  await replyInfoEmbed(interaction, locale, {
    titleKey: "commands.compact.edit_locked_title",
    descriptionKey: "commands.compact.edit_locked_description",
    color: ColorCode.WARN,
  });
}

async function replyAlreadySaved(interaction: Parameters<typeof replyInfoEmbed>[0], locale: string): Promise<void> {
  await replyInfoEmbed(interaction, locale, {
    titleKey: "commands.compact.add_to_docs_already_claimed_title",
    descriptionKey: "commands.compact.add_to_docs_already_claimed_description",
    color: ColorCode.WARN,
  });
}

/**
 * Opens the edit modal. The lock is checked on the click and again on the submit, because a member
 * may save the summary while this modal is open.
 */
export async function handleSummaryEditClick(interaction: ButtonInteraction, controls: SummaryControls): Promise<void> {
  const locale = await resolveUserLocale(interaction);
  const summaryEmbed = interaction.message.embeds[0];
  if (!summaryEmbed) throw new Error("Compact summary message has no embed");

  if (!isSummaryEditWindowOpen(controls)) {
    await interaction.update(renderSummaryMessage(EmbedBuilder.from(summaryEmbed), controls, false));
    return;
  }
  if (savingSummaryMessageIds.has(interaction.message.id)) {
    await replyEditLocked(interaction, locale);
    return;
  }

  const modalCustomId = `compact_edit_modal_${interaction.id}`;
  const textInput = new TextInputBuilder()
    .setCustomId("compact_edit_text")
    .setLabel(localizer(locale, "commands.compact.edit_field_label"))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(4000)
    .setRequired(true)
    .setValue((summaryEmbed.description ?? "").slice(0, 4000));
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(modalCustomId)
      .setTitle(localizer(locale, "commands.compact.edit_modal_title"))
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(textInput)),
  );

  const submitted = await interaction
    .awaitModalSubmit({ time: 600000, filter: (i) => i.customId === modalCustomId })
    .catch(() => null);
  if (!submitted) return;

  const submittedMessage = await (submitted.message ?? interaction.message).fetch().catch(() => null);
  const submittedEmbed = submittedMessage?.embeds[0];
  if (
    !submittedMessage ||
    !submittedEmbed ||
    savingSummaryMessageIds.has(submittedMessage.id) ||
    !hasSummaryControl(submittedMessage, "save")
  ) {
    await replyEditLocked(submitted, locale);
    return;
  }

  await submitted.deferUpdate();
  const newText = submitted.fields.getTextInputValue("compact_edit_text");
  await submittedMessage.edit(
    renderSummaryMessage(EmbedBuilder.from(submittedEmbed).setDescription(newText), controls, false),
  );
}

/**
 * Opens the save modal for any member. Several members can hold it open at once, so the first submit
 * claims the message and later submits are told it was already saved.
 */
export async function handleSummarySaveClick(interaction: ButtonInteraction, controls: SummaryControls): Promise<void> {
  const locale = await resolveUserLocale(interaction);
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  const messageId = interaction.message.id;

  const prompt = await promptSaveAsDocModal(interaction, locale, serverDiscId);
  if (prompt.modalResult.outcome !== "submit" || !prompt.modalResult.interaction) return;
  const submitInteraction = prompt.modalResult.interaction;

  // The check and the claim must stay in one synchronous step; an await between them lets two submits both claim.
  if (savingSummaryMessageIds.has(messageId)) {
    await replyAlreadySaved(submitInteraction, locale);
    return;
  }
  savingSummaryMessageIds.add(messageId);

  try {
    await submitInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    const liveMessage = await interaction.message.fetch().catch(() => null);
    if (liveMessage && !hasSummaryControl(liveMessage, "save")) {
      await replyAlreadySaved(submitInteraction, locale);
      return;
    }
    const liveEmbed = liveMessage?.embeds[0];

    const docName = await saveSummaryToDocs({
      buttonInteraction: interaction,
      submitInteraction,
      prompt,
      summaryText: liveEmbed?.description ?? "",
      locale,
      serverDiscId,
    });
    if (!docName || !liveMessage || !liveEmbed) return;

    await liveMessage.edit(renderSummaryMessage(EmbedBuilder.from(liveEmbed), controls, true)).catch(() => {});
    await replyInfoEmbed(submitInteraction, locale, {
      titleKey: "commands.compact.add_to_docs_success_title",
      descriptionKey: "commands.compact.add_to_docs_success_description",
      descriptionVars: { name: docName },
      color: ColorCode.SUCCESS,
    });
  } finally {
    savingSummaryMessageIds.delete(messageId);
  }
}

const DOC_NAME_FIELD_ID = "compact_doc_name";
const DOC_PERSONA_FIELD_ID = "compact_doc_persona";
const ALL_PERSONAS_VALUE = "all";
const DOC_CHANNELS_FIELD_ID = "compact_doc_channels";

interface SaveAsDocPrompt {
  modalResult: ModalResult;
  allPersonas: TomoriState[];
  autoName: string;
}

async function promptSaveAsDocModal(
  buttonInteraction: ButtonInteraction,
  locale: string,
  serverDiscId: string,
): Promise<SaveAsDocPrompt> {
  const allPersonas = await personaRepository.loadAllForServer(serverDiscId);

  const today = new Date().toISOString().slice(0, 10);
  const autoName = localizer(locale, "commands.compact.add_to_docs_doc_name", { date: today });

  const personaOptions: SelectOption[] = [
    {
      label: localizer(locale, "commands.compact.save_as_doc_persona_all"),
      value: ALL_PERSONAS_VALUE,
      description: localizer(locale, "commands.compact.save_as_doc_persona_all_description"),
      emoji: { name: "🌍" },
      default: true,
    },
    ...allPersonas
      .filter((p) => p.persona_id !== undefined)
      .map((p) => ({
        label: safeSelectOptionText(p.persona_nickname),
        value: p.persona_id?.toString() ?? "",
        description:
          resolvePersonaSnippet(p, DISCORD_SELECT_OPTION_DESCRIPTION_MAX) ??
          localizer(
            locale,
            p.is_alter
              ? "commands.teach.document.alter_persona_description"
              : "commands.teach.document.main_persona_description",
          ),
      }))
      .filter((o) => o.value !== ""),
  ];

  const modalResult = await promptWithPaginatedModal(buttonInteraction, locale, {
    modalCustomId: "compact_save_as_doc_modal",
    modalTitleKey: "commands.compact.save_as_doc_modal_title",
    selectorStyle: "componentsV2",
    pageSelectTitleKey: "general.pagination.select_persona_title",
    pageSelectDescriptionKey: "general.pagination.select_persona_page_description",
    components: [
      {
        customId: DOC_NAME_FIELD_ID,
        labelKey: "commands.compact.save_as_doc_name_label",
        descriptionKey: "commands.compact.save_as_doc_name_description",
        value: autoName,
        maxLength: 64,
        required: true,
      } as ModalInputField,
      {
        customId: DOC_PERSONA_FIELD_ID,
        labelKey: "commands.compact.save_as_doc_persona_label",
        descriptionKey: "commands.compact.save_as_doc_persona_description",
        placeholder: "commands.compact.save_as_doc_persona_all",
        options: personaOptions,
        // Optional so a member paging past the first 25 personas can still keep All Personas by leaving it empty.
        required: false,
      } as ModalSelectField,
      {
        kind: "channelSelect",
        customId: DOC_CHANNELS_FIELD_ID,
        labelKey: "commands.compact.save_as_doc_channels_label",
        descriptionKey: "commands.compact.save_as_doc_channels_description",
        channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
        minValues: 0,
        maxValues: DISCORD_SELECT_VALUES_MAX,
        required: false,
      } as ModalChannelSelectField,
    ],
  });

  return { modalResult, allPersonas, autoName };
}

/**
 * Embeds the summary text into the document store and returns the stored document name. Replies
 * with the failure reason and returns null when the save cannot proceed.
 */
async function saveSummaryToDocs(params: {
  buttonInteraction: ButtonInteraction;
  submitInteraction: NonNullable<ModalResult["interaction"]>;
  prompt: SaveAsDocPrompt;
  summaryText: string;
  locale: string;
  serverDiscId: string;
}): Promise<string | null> {
  const { buttonInteraction, submitInteraction, summaryText, locale, serverDiscId } = params;
  const { modalResult, allPersonas, autoName } = params.prompt;

  const docName = (modalResult.values?.[DOC_NAME_FIELD_ID] ?? autoName).trim().slice(0, 64) || autoName;
  const selectedPersonaIdStr = modalResult.values?.[DOC_PERSONA_FIELD_ID];
  const channelDiscIds = [
    ...new Set(
      (modalResult.multiValues?.[DOC_CHANNELS_FIELD_ID] ?? []).filter((id) => DISCORD_SNOWFLAKE_PATTERN.test(id)),
    ),
  ];

  let targetPersonaId: number | null = null;
  if (selectedPersonaIdStr && selectedPersonaIdStr !== ALL_PERSONAS_VALUE) {
    const selectedPersona = allPersonas.find((p) => p.persona_id?.toString() === selectedPersonaIdStr);
    if (!selectedPersona?.persona_id) {
      await replyInfoEmbed(submitInteraction, locale, {
        titleKey: "commands.compact.add_to_docs_persona_not_found_title",
        descriptionKey: "commands.compact.add_to_docs_persona_not_found_description",
        color: ColorCode.ERROR,
      });
      return null;
    }
    targetPersonaId = selectedPersona.persona_id;
  }

  if (!isRagAvailable()) {
    await replyInfoEmbed(submitInteraction, locale, {
      titleKey: "commands.compact.add_to_docs_rag_unavailable_title",
      descriptionKey: "commands.compact.add_to_docs_rag_unavailable_description",
      color: ColorCode.ERROR,
    });
    return null;
  }

  const tomoriState = await personaRepository.loadState(serverDiscId);
  if (!tomoriState) {
    await replyInfoEmbed(submitInteraction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
    });
    return null;
  }

  const hasManagePermission = buttonInteraction.memberPermissions?.has("ManageGuild") ?? false;
  if (!tomoriState.config.server_memteaching_enabled && !hasManagePermission) {
    await replyInfoEmbed(submitInteraction, locale, {
      titleKey: "commands.compact.add_to_docs_no_permission_title",
      descriptionKey: "commands.compact.add_to_docs_no_permission_description",
      color: ColorCode.ERROR,
    });
    return null;
  }

  let embeddingCreds: ResolvedCredentials | null = null;
  try {
    embeddingCreds = await resolveCapabilityCredentials(tomoriState.server_id, "embedding", { userId: null });
  } catch (error) {
    const denied = findProviderRequestDeniedError(error);
    if (denied) {
      await replyInfoEmbed(submitInteraction, locale, {
        ...getProviderRequestFailureCopy(denied, locale),
        color: ColorCode.ERROR,
      });
      return null;
    }
  }
  if (!embeddingCreds) {
    await replyInfoEmbed(submitInteraction, locale, {
      titleKey: "commands.compact.add_to_docs_no_embedding_title",
      descriptionKey: "commands.compact.add_to_docs_no_embedding_description",
      color: ColorCode.ERROR,
    });
    return null;
  }

  const embeddingModelId =
    getResolvedCapabilityModelId(embeddingCreds, "embedding") ?? tomoriState.config.embedding_model_id;
  const embeddingModel = embeddingModelId ? await llmModelRepo.loadEmbeddingModelById(embeddingModelId) : null;
  if (!embeddingModel?.embedding_model_id) {
    await replyInfoEmbed(submitInteraction, locale, {
      titleKey: "commands.compact.add_to_docs_no_embedding_title",
      descriptionKey: "commands.compact.add_to_docs_no_embedding_description",
      color: ColorCode.ERROR,
    });
    return null;
  }

  if (!summaryText) {
    await replyInfoEmbed(submitInteraction, locale, {
      titleKey: "commands.compact.add_to_docs_error_title",
      descriptionKey: "commands.compact.add_to_docs_error_description",
      color: ColorCode.ERROR,
    });
    return null;
  }

  try {
    const memLimits = getMemoryLimits();
    const normalized = ragRepository.normalizeText(summaryText);
    const chunks = ragRepository.chunkText(normalized, memLimits.documentChunkSize, memLimits.documentChunkOverlap);

    if (chunks.length === 0) {
      await replyInfoEmbed(submitInteraction, locale, {
        titleKey: "commands.compact.add_to_docs_error_title",
        descriptionKey: "commands.compact.add_to_docs_error_description",
        color: ColorCode.ERROR,
      });
      return null;
    }

    const embeddings = await withProviderUsageContext(embeddingCreds.usageContext, async () =>
      generateEmbeddingsBatched({
        provider: embeddingModel.provider,
        apiKey: embeddingCreds.apiKey,
        model: embeddingModel.codename,
        modelId: embeddingModel.embedding_model_id,
        inputs: chunks,
        taskType: (await providerSupportsEmbeddingTaskType(embeddingModel.provider)) ? "RETRIEVAL_DOCUMENT" : undefined,
        batchSize: 16,
        onUsage: createProviderUsageRecorder(embeddingCreds.usageContext, embeddingModel.codename),
      }),
    );

    await ragRepository.insertWithChunks({
      serverId: tomoriState.server_id,
      personaId: targetPersonaId,
      uploaderUserId: null,
      documentName: docName,
      fileName: null,
      mimeType: "text/plain",
      fileSizeBytes: normalized.length,
      textContent: normalized,
      chunks,
      embeddings,
      embeddingModelId: embeddingModel.embedding_model_id,
      embeddingFamily: embeddingModel.model_family,
      sourceType: "history",
      channelDiscIds,
    });

    invalidateTomoriStateCache(serverDiscId);

    return docName;
  } catch (error) {
    const denied = findProviderRequestDeniedError(error, embeddingCreds.usageContext);
    if (denied) {
      await replyInfoEmbed(submitInteraction, locale, {
        ...getProviderRequestFailureCopy(denied, locale),
        color: ColorCode.ERROR,
      });
      return null;
    }
    log.error("Failed to save compact summary to document store", error);
    await replyInfoEmbed(submitInteraction, locale, {
      titleKey: "commands.compact.add_to_docs_error_title",
      descriptionKey: "commands.compact.add_to_docs_error_description",
      color: ColorCode.ERROR,
    });
  }
  return null;
}

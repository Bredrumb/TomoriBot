/**
 * /memory document view — Browse a stored document chunk-by-chunk with edit/delete.
 *
 * Scopes:
 * - persona:    Documents scoped to a specific persona (persona picker shown first)
 * - serverwide: Documents with persona_id IS NULL
 *
 * Flow: scope → [persona picker] → document select modal → ephemeral embed + nav buttons.
 * Edit/Delete buttons appear only for users with Manage Server. Editing channel tags from
 * a per-chunk modal updates the parent document (channel_tags is document-scoped, not chunk-scoped).
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { promptWithModal, promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyComponentsV2Status, updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { llmModelRepo, personaRepository, serverMemoryRepository } from "@/utils/db/repositories";
import { formatVector, rebuildDocumentTextContent } from "@/utils/documents/documentService";
import { generateEmbeddingsBatched, providerSupportsEmbeddingTaskType } from "@/utils/embeddings/embeddingProvider";
import {
  CredentialUnavailableError,
  getResolvedCapabilityModelId,
  PersonalProviderRequiredError,
  resolveCapabilityCredentials,
} from "@/utils/provider/credentialResolver";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import type { SelectOption } from "@/types/discord/modal";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";

const MODAL_CUSTOM_ID = "view_document_modal";
const DOCUMENT_SELECT_ID = "document_view_select";
const EDIT_MODAL_ID = "view_document_edit_modal";
const EDIT_CONTENT_FIELD_ID = "edit_chunk_content";
const EDIT_TAGS_FIELD_ID = "edit_chunk_channel_tags";
const BTN_PREV = "doc_view_prev";
const BTN_NEXT = "doc_view_next";
const BTN_CLOSE = "doc_view_close";
const BTN_EDIT = "doc_view_edit";
const BTN_DELETE = "doc_view_delete";
const BTN_CONFIRM_DELETE = "doc_view_confirm_delete";
const BTN_CANCEL_DELETE = "doc_view_cancel_delete";
const CHUNK_CONTENT_MAX = 4000;
const EDIT_CONTENT_INPUT_MAX = 4000;
const EDIT_TAGS_INPUT_MAX = 200;
const VIEW_TIMEOUT_MS = 5 * 60 * 1000;

type DocumentScope = "persona" | "serverwide";
type NavMode = "normal" | "confirm_delete";

interface ChunkRow {
  document_chunk_id: number;
  chunk_index: number;
  content: string;
}

function buildChunkEmbed(
  chunks: ChunkRow[],
  index: number,
  documentName: string,
  locale: string,
): EmbedBuilder {
  const raw = chunks[index]?.content ?? "";
  const truncated = raw.length > CHUNK_CONTENT_MAX;
  const display = truncated ? `${raw.substring(0, CHUNK_CONTENT_MAX)}…` : raw;

  const embed = new EmbedBuilder()
    .setTitle(documentName.length > 256 ? `${documentName.substring(0, 253)}…` : documentName)
    .setDescription(display || "​")
    .setColor(ColorCode.INFO);

  if (chunks.length > 1) {
    embed.setFooter({
      text: localizer(locale, "commands.memory.document.view.chunk_footer", {
        current: String(index + 1),
        total: String(chunks.length),
      }),
    });
  }

  return embed;
}

function buildNavRow(
  index: number,
  total: number,
  locale: string,
  canEdit: boolean,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  if (total > 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(BTN_PREV)
        .setLabel(localizer(locale, "commands.memory.document.view.btn_prev"))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(index === 0),
      new ButtonBuilder()
        .setCustomId(BTN_NEXT)
        .setLabel(localizer(locale, "commands.memory.document.view.btn_next"))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(index === total - 1),
    );
  }

  if (canEdit) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(BTN_EDIT)
        .setLabel(localizer(locale, "commands.memory.document.view.btn_edit"))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BTN_DELETE)
        .setLabel(localizer(locale, "commands.memory.document.view.btn_delete"))
        .setStyle(ButtonStyle.Danger),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_CLOSE)
      .setLabel(localizer(locale, "commands.memory.document.view.btn_close"))
      .setStyle(ButtonStyle.Secondary),
  );

  return row;
}

function buildDeleteConfirmRow(locale: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_CONFIRM_DELETE)
      .setLabel(localizer(locale, "commands.memory.document.view.btn_confirm_delete"))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(BTN_CANCEL_DELETE)
      .setLabel(localizer(locale, "commands.memory.document.view.btn_cancel"))
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Parses comma-separated channel input into normalized #channel tags, mirroring
 * the logic in /memory document add and /memory history import so tags stay
 * consistent across commands.
 */
function parseChannelTagsInput(input: string, client: Client): string[] {
  if (!input.trim()) return [];
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

function tagArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

/** Outcomes from the embedding regeneration helper, surfaced as locale keys to the caller. */
type RegenError =
  | { ok: false; errorKey: "no_embedding_model" | "embedding_creds_missing" | "embedding_error" };
type RegenSuccess = {
  ok: true;
  embeddingVector: string;
  embeddingModelId: number;
  embeddingFamily: string;
};
type RegenResult = RegenSuccess | RegenError;

/**
 * Resolves credentials + embedding model and generates a single embedding for the
 * edited chunk content. Uses the user's current embedding capability rather than
 * the chunk's original model — switching models mid-document is the user's call.
 */
async function regenChunkEmbedding(params: {
  content: string;
  serverId: number;
  configuredEmbeddingModelId: number | null;
  userId: number | null;
}): Promise<RegenResult> {
  const { content, serverId, configuredEmbeddingModelId, userId } = params;

  let creds: Awaited<ReturnType<typeof resolveCapabilityCredentials>>;
  try {
    creds = await resolveCapabilityCredentials(serverId, "embedding", { userId });
  } catch (error) {
    if (error instanceof PersonalProviderRequiredError || error instanceof CredentialUnavailableError) {
      return { ok: false, errorKey: "embedding_creds_missing" };
    }
    throw error;
  }

  const modelId = getResolvedCapabilityModelId(creds, "embedding") ?? configuredEmbeddingModelId;
  if (!modelId) {
    return { ok: false, errorKey: "no_embedding_model" };
  }

  const model = await llmModelRepo.loadEmbeddingModelById(modelId);
  if (!model?.embedding_model_id) {
    return { ok: false, errorKey: "no_embedding_model" };
  }

  try {
    const embeddings = await generateEmbeddingsBatched({
      provider: model.provider,
      apiKey: creds.apiKey,
      model: model.codename,
      modelId: model.embedding_model_id,
      inputs: [content],
      taskType: (await providerSupportsEmbeddingTaskType(model.provider)) ? "RETRIEVAL_DOCUMENT" : undefined,
      batchSize: 1,
    });
    if (embeddings.length === 0) {
      return { ok: false, errorKey: "embedding_error" };
    }
    return {
      ok: true,
      embeddingVector: formatVector(embeddings[0]),
      embeddingModelId: model.embedding_model_id,
      embeddingFamily: model.model_family,
    };
  } catch (error) {
    log.warn(`Failed to regenerate embedding during chunk edit: ${error}`);
    return { ok: false, errorKey: "embedding_error" };
  }
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("view")
    .setDescription(localizer("en-US", "commands.memory.document.view.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.memory.document.view.scope_description"))
        .setRequired(false)
        .addChoices(
          {
            name: localizer("en-US", "commands.memory.document.view.scope_choice_persona"),
            value: "persona",
          },
          {
            name: localizer("en-US", "commands.memory.document.view.scope_choice_serverwide"),
            value: "serverwide",
          },
        ),
    );

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
  let targetPersonaId: number | null = null;
  let personaSelectionInteraction: ButtonInteraction | null = null;

  try {
    if (!isRagAvailable()) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.memory.history.import.rag_disabled_title",
        descriptionKey: "commands.memory.history.import.rag_disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
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
    const overlayResult = await applyPersonalProviderSelectionsToTomoriState(tomoriState, userData.user_id ?? null);
    tomoriState = overlayResult.tomoriState;

    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    if (!tomoriState.config.server_memteaching_enabled && !hasManagePermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.document.teaching_disabled_title",
        descriptionKey: "commands.teach.document.teaching_disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    // Edit/Delete are gated on Manage Server even when teaching is enabled,
    // because regenerating embeddings costs API tokens.
    const canEdit = hasManagePermission;

    const scopeInput = interaction.options.getString("scope");
    const scope: DocumentScope = scopeInput === "serverwide" ? "serverwide" : "persona";
    const avatarSessionCache: AvatarSessionCache = new Map();

    // Persona picker
    if (scope === "persona") {
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

      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        avatarSessionCache,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success || personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
        return;
      }

      personaSelectionInteraction = personaSelection.interaction;
      const selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;

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
        return;
      }

      targetPersonaId = selectedPersona.persona_id;
    }

    const selectionInteraction = personaSelectionInteraction ?? interaction;
    const dbServerId = tomoriState.server_id;
    const guildCacheKey = interaction.guild?.id ?? interaction.user.id;

    // Load document list
    const documents = await serverMemoryRepository.loadDocuments(dbServerId, targetPersonaId);

    if (!documents || documents.length === 0) {
      if (personaSelectionInteraction) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "commands.memory.document.view.none_title",
          "commands.memory.document.view.none_description",
          ColorCode.WARN,
        );
      } else {
        await replyInfoEmbed(selectionInteraction, locale, {
          titleKey: "commands.memory.document.view.none_title",
          descriptionKey: "commands.memory.document.view.none_description",
          color: ColorCode.WARN,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    // Document select modal
    const documentOptions: SelectOption[] = documents.map((doc) => ({
      label: safeSelectOptionText(doc.document_name),
      value: doc.document_id.toString(),
      description: doc.first_chunk ? safeSelectOptionText(doc.first_chunk) : undefined,
    }));

    const modalResult = await promptWithPaginatedModal(selectionInteraction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.memory.document.view.modal_title",
      components: [
        {
          customId: DOCUMENT_SELECT_ID,
          labelKey: "commands.memory.document.view.select_label",
          descriptionKey: "commands.memory.document.view.select_description",
          placeholder: "commands.memory.document.view.select_placeholder",
          required: true,
          options: documentOptions,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      log.info(`Document view modal ${modalResult.outcome} for user ${userData.user_id}`);
      if (scope === "persona") {
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
      }
      return;
    }

    if (!modalResult.interaction || !modalResult.values) {
      await replyInfoEmbed(selectionInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const selectedIdStr = modalResult.values[DOCUMENT_SELECT_ID];
    if (!selectedIdStr) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "commands.memory.document.view.none_title",
        descriptionKey: "commands.memory.document.view.none_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modalSubmitInteraction = modalResult.interaction;
    const selectedId = Number.parseInt(selectedIdStr, 10);

    // Reject any document_id not in the persona-scoped list we already loaded
    if (!documents.some((doc) => doc.document_id === selectedId)) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Load document meta (for channel_tags pre-fill on edit) and chunks
    const documentMeta = await serverMemoryRepository.loadDocumentMeta(selectedId, dbServerId, targetPersonaId);
    if (!documentMeta) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    let documentName = documentMeta.document_name;
    let currentChannelTags = documentMeta.channel_tags;

    let chunks: ChunkRow[] = await serverMemoryRepository.loadDocumentChunks(selectedId, dbServerId, targetPersonaId);

    if (chunks.length === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.memory.document.view.no_chunks_title",
        descriptionKey: "commands.memory.document.view.no_chunks_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let currentIndex = 0;
    let mode: NavMode = "normal";

    // Reply with first chunk
    await modalSubmitInteraction.reply({
      embeds: [buildChunkEmbed(chunks, currentIndex, documentName, locale)],
      components: [buildNavRow(currentIndex, chunks.length, locale, canEdit)],
      flags: MessageFlags.Ephemeral,
    });

    const viewMessage = await modalSubmitInteraction.fetchReply();

    // Navigation loop — handles paging, edit modal, and delete-confirm flow
    while (true) {
      let btnInteraction: ButtonInteraction;
      try {
        btnInteraction = (await viewMessage.awaitMessageComponent({
          filter: (i) => i.user.id === interaction.user.id,
          time: VIEW_TIMEOUT_MS,
        })) as ButtonInteraction;
      } catch {
        // Timeout — strip buttons so the embed stays readable
        await modalSubmitInteraction.editReply({ components: [] });
        break;
      }

      if (btnInteraction.customId === BTN_CLOSE) {
        await btnInteraction.update({ embeds: [], components: [] });
        break;
      }

      if (btnInteraction.customId === BTN_PREV) {
        currentIndex = Math.max(0, currentIndex - 1);
        mode = "normal";
        await btnInteraction.update({
          embeds: [buildChunkEmbed(chunks, currentIndex, documentName, locale)],
          components: [buildNavRow(currentIndex, chunks.length, locale, canEdit)],
        });
        continue;
      }

      if (btnInteraction.customId === BTN_NEXT) {
        currentIndex = Math.min(chunks.length - 1, currentIndex + 1);
        mode = "normal";
        await btnInteraction.update({
          embeds: [buildChunkEmbed(chunks, currentIndex, documentName, locale)],
          components: [buildNavRow(currentIndex, chunks.length, locale, canEdit)],
        });
        continue;
      }

      // Defensive — should never be rendered for non-managers
      if (!canEdit && (btnInteraction.customId === BTN_EDIT || btnInteraction.customId === BTN_DELETE)) {
        await btnInteraction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.memory.document.view.no_permission_title"))
              .setDescription(localizer(locale, "commands.memory.document.view.no_permission_description"))
              .setColor(ColorCode.ERROR),
          ],
          flags: MessageFlags.Ephemeral,
        });
        continue;
      }

      // ──────────────────────────── EDIT ────────────────────────────
      if (btnInteraction.customId === BTN_EDIT) {
        const currentChunk = chunks[currentIndex];
        if (!currentChunk) {
          await btnInteraction.deferUpdate();
          continue;
        }

        const tagsPrefill = currentChannelTags.join(",");
        const modalEditResult = await promptWithModal(btnInteraction, locale, {
          modalTitleKey: "commands.memory.document.view.edit_modal_title",
          modalCustomId: EDIT_MODAL_ID,
          components: [
            {
              customId: EDIT_CONTENT_FIELD_ID,
              labelKey: "commands.memory.document.view.edit_content_label",
              placeholder: "commands.memory.document.view.edit_content_placeholder",
              style: TextInputStyle.Paragraph,
              required: true,
              maxLength: EDIT_CONTENT_INPUT_MAX,
              value: currentChunk.content.substring(0, EDIT_CONTENT_INPUT_MAX),
            },
            {
              customId: EDIT_TAGS_FIELD_ID,
              labelKey: "commands.memory.document.view.edit_channel_tags_label",
              placeholder: "commands.memory.document.view.edit_channel_tags_placeholder",
              style: TextInputStyle.Short,
              required: false,
              maxLength: EDIT_TAGS_INPUT_MAX,
              value: tagsPrefill,
            },
          ],
        });

        if (modalEditResult.outcome !== "submit" || !modalEditResult.interaction || !modalEditResult.values) {
          continue;
        }
        const editSubmit = modalEditResult.interaction as ModalSubmitInteraction;
        const newContent = (modalEditResult.values[EDIT_CONTENT_FIELD_ID] ?? "").trim();
        const newTags = parseChannelTagsInput(modalEditResult.values[EDIT_TAGS_FIELD_ID] ?? "", client);

        if (!newContent) {
          await editSubmit.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(localizer(locale, "commands.memory.document.view.edit_empty_content_title"))
                .setDescription(localizer(locale, "commands.memory.document.view.edit_empty_content_description"))
                .setColor(ColorCode.ERROR),
            ],
            flags: MessageFlags.Ephemeral,
          });
          continue;
        }

        const contentChanged = newContent !== currentChunk.content;
        const tagsChanged = !tagArraysEqual(newTags, currentChannelTags);

        if (!contentChanged && !tagsChanged) {
          await editSubmit.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(localizer(locale, "commands.memory.document.view.edit_no_changes_title"))
                .setDescription(localizer(locale, "commands.memory.document.view.edit_no_changes_description"))
                .setColor(ColorCode.INFO),
            ],
            flags: MessageFlags.Ephemeral,
          });
          continue;
        }

        // Defer the modal submit so we can do network work without hitting 3s deadline
        await editSubmit.deferUpdate();

        // Re-embed only if content actually changed
        if (contentChanged) {
          const regen = await regenChunkEmbedding({
            content: newContent,
            serverId: dbServerId,
            configuredEmbeddingModelId: tomoriState?.config.embedding_model_id ?? null,
            userId: userData.user_id ?? null,
          });
          if (!regen.ok) {
            await editSubmit.followUp({
              embeds: [
                new EmbedBuilder()
                  .setTitle(localizer(locale, `commands.memory.document.view.${regen.errorKey}_title`))
                  .setDescription(localizer(locale, `commands.memory.document.view.${regen.errorKey}_description`))
                  .setColor(ColorCode.ERROR),
              ],
              flags: MessageFlags.Ephemeral,
            });
            continue;
          }
          const updated = await serverMemoryRepository.updateChunk({
            chunkId: currentChunk.document_chunk_id,
            serverId: dbServerId,
            personaId: targetPersonaId,
            content: newContent,
            embeddingVector: regen.embeddingVector,
            embeddingModelId: regen.embeddingModelId,
            embeddingFamily: regen.embeddingFamily,
          });
          if (!updated) {
            await editSubmit.followUp({
              embeds: [
                new EmbedBuilder()
                  .setTitle(localizer(locale, "commands.memory.document.view.embedding_error_title"))
                  .setDescription(localizer(locale, "commands.memory.document.view.embedding_error_description"))
                  .setColor(ColorCode.ERROR),
              ],
              flags: MessageFlags.Ephemeral,
            });
            continue;
          }
          await rebuildDocumentTextContent(selectedId);
          chunks[currentIndex] = { ...currentChunk, content: newContent };
        }

        if (tagsChanged) {
          await serverMemoryRepository.updateDocumentChannelTags(selectedId, dbServerId, newTags, targetPersonaId);
          currentChannelTags = newTags;
        }

        invalidateTomoriStateCache(guildCacheKey);

        const successKey =
          contentChanged && tagsChanged
            ? "edit_success_both"
            : contentChanged
              ? "edit_success_content_only"
              : "edit_success_tags_only";

        await editSubmit.editReply({
          embeds: [buildChunkEmbed(chunks, currentIndex, documentName, locale)],
          components: [buildNavRow(currentIndex, chunks.length, locale, canEdit)],
        });
        await editSubmit.followUp({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.memory.document.view.edit_success_title"))
              .setDescription(localizer(locale, `commands.memory.document.view.${successKey}`))
              .setColor(ColorCode.SUCCESS),
          ],
          flags: MessageFlags.Ephemeral,
        });
        continue;
      }

      // ─────────────────────── DELETE (request confirm) ───────────────────────
      if (btnInteraction.customId === BTN_DELETE) {
        mode = "confirm_delete";
        const isLast = chunks.length === 1;
        const confirmTitleKey = isLast
          ? "commands.memory.document.view.delete_last_confirm_title"
          : "commands.memory.document.view.delete_confirm_title";
        const confirmDescKey = isLast
          ? "commands.memory.document.view.delete_last_confirm_description"
          : "commands.memory.document.view.delete_confirm_description";
        const confirmEmbed = new EmbedBuilder()
          .setTitle(localizer(locale, confirmTitleKey))
          .setDescription(
            localizer(locale, confirmDescKey, {
              current: String(currentIndex + 1),
              total: String(chunks.length),
              document_name: documentName,
            }),
          )
          .setColor(ColorCode.WARN);

        await btnInteraction.update({
          embeds: [confirmEmbed],
          components: [buildDeleteConfirmRow(locale)],
        });
        continue;
      }

      // ─────────────────────── DELETE CONFIRM ───────────────────────
      if (btnInteraction.customId === BTN_CONFIRM_DELETE && mode === "confirm_delete") {
        const currentChunk = chunks[currentIndex];
        if (!currentChunk) {
          mode = "normal";
          await btnInteraction.update({
            embeds: [buildChunkEmbed(chunks, currentIndex, documentName, locale)],
            components: [buildNavRow(currentIndex, chunks.length, locale, canEdit)],
          });
          continue;
        }

        const wasLast = chunks.length === 1;
        const deleted = await serverMemoryRepository.deleteChunk(currentChunk.document_chunk_id, dbServerId, targetPersonaId);
        if (!deleted) {
          mode = "normal";
          await btnInteraction.update({
            embeds: [
              new EmbedBuilder()
                .setTitle(localizer(locale, "commands.memory.document.view.delete_failed_title"))
                .setDescription(localizer(locale, "commands.memory.document.view.delete_failed_description"))
                .setColor(ColorCode.ERROR),
            ],
            components: [buildNavRow(currentIndex, chunks.length, locale, canEdit)],
          });
          continue;
        }

        if (wasLast) {
          await serverMemoryRepository.removeDocument(selectedId, dbServerId, targetPersonaId);
          invalidateTomoriStateCache(guildCacheKey);
          await btnInteraction.update({
            embeds: [
              new EmbedBuilder()
                .setTitle(localizer(locale, "commands.memory.document.view.delete_document_title"))
                .setDescription(
                  localizer(locale, "commands.memory.document.view.delete_document_description", {
                    document_name: documentName,
                  }),
                )
                .setColor(ColorCode.SUCCESS),
            ],
            components: [],
          });
          break;
        }

        await rebuildDocumentTextContent(selectedId);
        invalidateTomoriStateCache(guildCacheKey);

        chunks = chunks.filter((c) => c.document_chunk_id !== currentChunk.document_chunk_id);
        currentIndex = Math.min(currentIndex, chunks.length - 1);
        mode = "normal";

        await btnInteraction.update({
          embeds: [buildChunkEmbed(chunks, currentIndex, documentName, locale)],
          components: [buildNavRow(currentIndex, chunks.length, locale, canEdit)],
        });
        await btnInteraction.followUp({
          embeds: [
            new EmbedBuilder()
              .setTitle(localizer(locale, "commands.memory.document.view.delete_success_title"))
              .setDescription(
                localizer(locale, "commands.memory.document.view.delete_success_description", {
                  total: String(chunks.length),
                }),
              )
              .setColor(ColorCode.SUCCESS),
          ],
          flags: MessageFlags.Ephemeral,
        });
        continue;
      }

      // ─────────────────────── DELETE CANCEL ───────────────────────
      if (btnInteraction.customId === BTN_CANCEL_DELETE) {
        mode = "normal";
        await btnInteraction.update({
          embeds: [buildChunkEmbed(chunks, currentIndex, documentName, locale)],
          components: [buildNavRow(currentIndex, chunks.length, locale, canEdit)],
        });
        continue;
      }

      // Unknown button — defer to avoid hanging
      await btnInteraction.deferUpdate();
    }

  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: targetPersonaId ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "memory document view",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Unexpected error in /memory document view for user ${userData.user_disc_id}`, error, context);

    const errorTarget =
      personaSelectionInteraction && (personaSelectionInteraction.deferred || personaSelectionInteraction.replied)
        ? personaSelectionInteraction
        : interaction.deferred || interaction.replied
          ? interaction
          : null;

    if (errorTarget) {
      await replyInfoEmbed(errorTarget, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

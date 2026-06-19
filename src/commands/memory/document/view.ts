/**
 * /memory document view — Browse a stored document chunk-by-chunk in an ephemeral embed.
 *
 * Scopes:
 * - persona:    Documents scoped to a specific persona (persona picker shown first)
 * - serverwide: Documents with persona_id IS NULL
 *
 * Flow: scope → [persona picker] → document select modal → ephemeral embed + nav buttons
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyComponentsV2Status, updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { personaRepository, serverMemoryRepository } from "@/utils/db/repositories";
import type { SelectOption } from "@/types/discord/modal";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";

const MODAL_CUSTOM_ID = "view_document_modal";
const DOCUMENT_SELECT_ID = "document_view_select";
const BTN_PREV = "doc_view_prev";
const BTN_NEXT = "doc_view_next";
const BTN_CLOSE = "doc_view_close";
const CHUNK_CONTENT_MAX = 4000;
const VIEW_TIMEOUT_MS = 5 * 60 * 1000;

type DocumentScope = "persona" | "serverwide";

function buildChunkEmbed(
  chunks: Array<{ chunk_index: number; content: string }>,
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

function buildNavRow(index: number, total: number, locale: string): ActionRowBuilder<ButtonBuilder> {
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

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_CLOSE)
      .setLabel(localizer(locale, "commands.memory.document.view.btn_close"))
      .setStyle(ButtonStyle.Secondary),
  );

  return row;
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
  _client: Client,
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

    // Load document list
    const documents = await serverMemoryRepository.loadDocuments(tomoriState.server_id, targetPersonaId);

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
    const selectedDocument = documents.find((doc) => doc.document_id === selectedId);
    if (!selectedDocument) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Load all chunks for the selected document
    const chunks = await serverMemoryRepository.loadDocumentChunks(selectedId, tomoriState.server_id);

    if (chunks.length === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.memory.document.view.no_chunks_title",
        descriptionKey: "commands.memory.document.view.no_chunks_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Reply with first chunk
    await modalSubmitInteraction.reply({
      embeds: [buildChunkEmbed(chunks, 0, selectedDocument.document_name, locale)],
      components: [buildNavRow(0, chunks.length, locale)],
      flags: MessageFlags.Ephemeral,
    });

    const viewMessage = await modalSubmitInteraction.fetchReply();
    let currentIndex = 0;

    // Navigation loop
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
      } else if (btnInteraction.customId === BTN_NEXT) {
        currentIndex = Math.min(chunks.length - 1, currentIndex + 1);
      }

      await btnInteraction.update({
        embeds: [buildChunkEmbed(chunks, currentIndex, selectedDocument.document_name, locale)],
        components: [buildNavRow(currentIndex, chunks.length, locale)],
      });
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

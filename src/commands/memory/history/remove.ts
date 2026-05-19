/**
 * /memory history remove - Remove a history-extracted document from the server knowledge base.
 * Mirrors /memory document remove but filters to source_type = 'history' documents only.
 *
 * Supports two scopes:
 * - persona: Show documents scoped to a selected persona
 * - serverwide: Show documents with persona_id IS NULL
 */

import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { sql } from "@/utils/db/client";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  acknowledgeModalSubmitForRefresh,
  promptWithPaginatedModal,
  safeSelectOptionText,
} from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyComponentsV2Status, updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository, serverMemoryRepository } from "@/utils/db/repositories";
import type { SelectOption } from "@/types/discord/modal";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";

const MODAL_CUSTOM_ID = "forget_history_modal";
const DOCUMENT_SELECT_ID = "history_document_select";
type HistoryScope = "persona" | "serverwide";

/**
 * Performs the actual document deletion and replies with success/failure.
 *
 * @param tomoriState - The server's Tomori state
 * @param targetPersonaId - Persona ID (null for serverwide)
 * @param documentId - The document to delete
 * @param userData - The executing user's data
 * @param replyInteraction - The interaction to reply on
 * @param locale - The user's locale
 */
async function performHistoryDocumentRemoval(
  tomoriState: TomoriState,
  targetPersonaId: number | null,
  documentId: number,
  _userData: UserRow,
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  // Delete the history document (chunks cascade via FK)
  const documentName = await serverMemoryRepository.removeHistoryDocument(
    documentId,
    tomoriState.server_id,
    targetPersonaId,
  );

  if (!documentName) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  if (replyInteraction.guildId) {
    invalidateTomoriStateCache(replyInteraction.guildId);
  }

  if (!suppressSuccessReply) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.memory.history.remove.success_title",
      descriptionKey: "commands.memory.history.remove.success_description",
      descriptionVars: { name: documentName },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

/**
 * Configures the /memory history remove subcommand options.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("remove")
    .setDescription(localizer("en-US", "commands.memory.history.remove.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.memory.history.remove.scope_description"))
        .addChoices(
          {
            name: localizer("en-US", "commands.memory.history.remove.scope_choice_persona"),
            value: "persona",
          },
          {
            name: localizer("en-US", "commands.memory.history.remove.scope_choice_serverwide"),
            value: "serverwide",
          },
        )
        .setRequired(false),
    );

/**
 * Executes the /memory history remove command.
 * Lists history-extracted documents and lets the user select one to remove.
 */
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
    // 1. Check RAG is enabled
    if (!isRagAvailable()) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.memory.history.remove.rag_disabled_title",
        descriptionKey: "commands.memory.history.remove.rag_disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 2. Load Tomori state
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

    // 3. Check teaching permission
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

    // 4. Resolve scope
    const scopeInput = interaction.options.getString("scope");
    const scope: HistoryScope = scopeInput === "serverwide" ? "serverwide" : "persona";

    // 5. Handle persona scope: show persona selector
    const avatarSessionCache: AvatarSessionCache = new Map();
    while (true) {
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

        if (!personaSelection.success) {
          if (personaSelection.reason === "cancelled" || personaSelection.reason === "fatal") return;
          continue;
        }
        if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
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
          continue;
        }
        targetPersonaId = selectedPersona.persona_id;
      }

      // 6. Query history-extracted documents for the selected scope
      const selectionInteraction = personaSelectionInteraction ?? interaction;
      const documents =
        targetPersonaId === null
          ? await sql<Array<{ document_id: number; document_name: string }>>`
						SELECT document_id, document_name
						FROM documents
						WHERE server_id = ${tomoriState.server_id}
						  AND persona_id IS NULL
						  AND source_type = 'history'
						ORDER BY created_at DESC
					`
          : await sql<Array<{ document_id: number; document_name: string }>>`
						SELECT document_id, document_name
						FROM documents
						WHERE server_id = ${tomoriState.server_id}
						  AND persona_id = ${targetPersonaId}
						  AND source_type = 'history'
						ORDER BY created_at DESC
					`;

      if (!documents || documents.length === 0) {
        if (personaSelectionInteraction) {
          await updateButtonComponentsV2Status(
            personaSelectionInteraction,
            locale,
            "commands.memory.history.remove.none_title",
            "commands.memory.history.remove.none_description",
            ColorCode.WARN,
            undefined,
            "general.pagination.reloading_persona_picker",
          );
        } else {
          await replyInfoEmbed(selectionInteraction, locale, {
            titleKey: "commands.memory.history.remove.none_title",
            descriptionKey: "commands.memory.history.remove.none_description",
            color: ColorCode.WARN,
          });
        }
        continue;
      }

      // 7. Show paginated document selection modal
      const documentOptions: SelectOption[] = documents.map((doc) => ({
        label: safeSelectOptionText(doc.document_name),
        value: doc.document_id.toString(),
      }));

      const modalResult = await promptWithPaginatedModal(selectionInteraction, locale, {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.memory.history.remove.modal_title",
        components: [
          {
            customId: DOCUMENT_SELECT_ID,
            labelKey: "commands.memory.history.remove.select_label",
            descriptionKey: "commands.memory.history.remove.select_description",
            placeholder: "commands.memory.history.remove.select_placeholder",
            required: true,
            options: documentOptions,
          },
        ],
      });

      // Handle modal outcome - keep the persona picker loop alive when the modal closes
      if (modalResult.outcome !== "submit") {
        log.info(`History document removal modal ${modalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
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
          titleKey: "commands.memory.history.remove.none_title",
          descriptionKey: "commands.memory.history.remove.none_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const selectedId = Number.parseInt(selectedIdStr, 10);
      const selectedDocument = documents.find((document) => document.document_id === selectedId);
      if (!selectedDocument) {
        await replyInfoEmbed(modalResult.interaction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 8. Perform deletion
      const removalSucceeded = await performHistoryDocumentRemoval(
        tomoriState,
        targetPersonaId,
        selectedId,
        userData,
        modalResult.interaction,
        locale,
        true,
      );
      if (!removalSucceeded) {
        return;
      }
      await acknowledgeModalSubmitForRefresh(modalResult.interaction);
      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.memory.history.remove.success_title",
        "commands.memory.history.remove.success_description",
        ColorCode.SUCCESS,
        { name: selectedDocument.document_name },
        "general.pagination.reloading_persona_picker",
      );
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: targetPersonaId ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "memory history remove",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /memory history remove for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

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

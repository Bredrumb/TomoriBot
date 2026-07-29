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
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  acknowledgeModalSubmitForRefresh,
  promptWithPaginatedModal,
  safeSelectOptionText,
} from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  retryPersonaWorkflow,
  runPersonaPickerWorkflow,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/personaWorkflow";
import { personaIdIsEligible, refreshEligibilitySet } from "@/utils/discord/ui/personaEligibility";
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
 * @param serverDiscId - The Discord server or DM owner ID used as the Tomori-state cache key
 * @param userData - The executing user's data
 * @param replyInteraction - The interaction to reply on
 * @param locale - The user's locale
 */
async function performHistoryDocumentRemoval(
  tomoriState: TomoriState,
  targetPersonaId: number | null,
  documentId: number,
  serverDiscId: string,
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

  invalidateTomoriStateCache(serverDiscId);

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
  const workflowState: { message: PersonaWorkflowMessageController | null } = { message: null };
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  const scopeInput = interaction.options.getString("scope");
  const scope: HistoryScope = scopeInput === "serverwide" ? "serverwide" : "persona";

  try {
    // Check RAG is enabled
    if (!isRagAvailable()) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.memory.history.remove.rag_disabled_title",
        descriptionKey: "commands.memory.history.remove.rag_disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (scope === "persona") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    // Load Tomori state
    tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const activeTomoriState = tomoriState;

    // Check teaching permission
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

    // Dispatch the already-resolved scope.
    if (scope === "persona") {
      const allPersonas = await personaRepository.loadAllForServer(serverDiscId);
      if (allPersonas.length === 0) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.tomori_not_setup_title",
          descriptionKey: "general.errors.tomori_not_setup_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Class B eligibility keyed on personas owning history-sourced documents.
      // The mutable set is refreshed after each removal so the mid-loop empty
      // state is reachable; the `loadHistoryDocuments` reload stays the backstop.
      const eligibleHistoryPersonaIds = await serverMemoryRepository.personaIdsWithHistoryDocuments(
        activeTomoriState.server_id,
      );
      const isEligible = personaIdIsEligible(eligibleHistoryPersonaIds);
      const eligiblePersonas = allPersonas.filter(isEligible);
      if (eligiblePersonas.length === 0) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.memory.history.remove.none_title",
          descriptionKey: "commands.memory.history.remove.none_description",
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
          emptyTitleKey: "commands.memory.history.remove.none_title",
          emptyDescriptionKey: "commands.memory.history.remove.none_description",
          itemsLabelKey: "general.persona_workflow.items.chat_history",
        },
        async onSelected(selection) {
          workflowState.message = selection.message;
          const selectedPersonaId = selection.persona.persona_id;
          if (!selectedPersonaId) {
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
          targetPersonaId = selectedPersonaId;

          let documents: Awaited<ReturnType<typeof serverMemoryRepository.loadHistoryDocuments>> = [];
          let hasNoDocuments = false;
          const modalResult = await selection.openModal(async () => {
            documents = await serverMemoryRepository.loadHistoryDocuments(
              activeTomoriState.server_id,
              selectedPersonaId,
            );
            if (!documents || documents.length === 0) {
              hasNoDocuments = true;
              throw new Error("The selected persona has no history documents.");
            }
            const documentOptions: SelectOption[] = documents.map((doc) => ({
              label: safeSelectOptionText(doc.document_name),
              value: doc.document_id.toString(),
            }));
            return {
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
            };
          });

          if (hasNoDocuments) {
            await selection.message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "commands.memory.history.remove.none_title",
                descriptionKey: "commands.memory.history.remove.none_description",
                footerKey: "general.pagination.reloading_persona_picker",
                color: ColorCode.WARN,
              }),
            );
            return retryPersonaWorkflow(await personaRepository.loadAllForServer(serverDiscId));
          }
          if (modalResult.outcome !== "submitted") {
            log.info(`History document removal modal ${modalResult.outcome} for user ${userData.user_id}`);
            return modalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
          }

          const work = await modalResult.phase.beginInPlaceWork();
          const selectedIdStr = modalResult.phase.values[DOCUMENT_SELECT_ID];
          const selectedId = Number.parseInt(selectedIdStr ?? "", 10);
          const selectedDocument = documents.find((document) => document.document_id === selectedId);
          if (!selectedIdStr || !selectedDocument) {
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

          const documentName = await serverMemoryRepository.removeHistoryDocument(
            selectedId,
            activeTomoriState.server_id,
            selectedPersonaId,
          );
          if (!documentName) {
            await work.message.replace(
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

          invalidateTomoriStateCache(serverDiscId);
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.memory.history.remove.success_title",
              descriptionKey: "commands.memory.history.remove.success_description",
              descriptionVars: { name: documentName },
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.SUCCESS,
            }),
          );
          // Refresh eligibility in place so a persona whose last history document
          // was removed drops from the picker on retry (reaching mid-loop empty).
          await refreshEligibilitySet(
            eligibleHistoryPersonaIds,
            serverMemoryRepository.personaIdsWithHistoryDocuments(activeTomoriState.server_id),
          );
          return retryPersonaWorkflow(await personaRepository.loadAllForServer(serverDiscId));
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
      return;
    }

    while (true) {
      const selectionInteraction = interaction;
      const documents = await serverMemoryRepository.loadHistoryDocuments(tomoriState.server_id, targetPersonaId);

      if (!documents || documents.length === 0) {
        await replyInfoEmbed(selectionInteraction, locale, {
          titleKey: "commands.memory.history.remove.none_title",
          descriptionKey: "commands.memory.history.remove.none_description",
          color: ColorCode.WARN,
        });
        return;
      }

      // Show paginated document selection modal
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

      // Perform deletion
      const removalSucceeded = await performHistoryDocumentRemoval(
        tomoriState,
        targetPersonaId,
        selectedId,
        serverDiscId,
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
      return;
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

    if (workflowState.message) {
      await workflowState.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        }),
      );
      return;
    }
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

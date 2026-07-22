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
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository, serverMemoryRepository } from "@/utils/db/repositories";
import type { SelectOption } from "@/types/discord/modal";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";

const MODAL_CUSTOM_ID = "forget_document_modal";
const DOCUMENT_SELECT_ID = "document_select";
type DocumentScope = "persona" | "serverwide";

async function performDocumentRemoval(
  tomoriState: TomoriState,
  targetPersonaId: number | null,
  documentId: number,
  serverDiscId: string,
  _userData: UserRow,
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  const documentName = await serverMemoryRepository.removeDocument(documentId, tomoriState.server_id, targetPersonaId);

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
      titleKey: "commands.forget.document.success_title",
      descriptionKey: "commands.forget.document.success_description",
      descriptionVars: {
        name: documentName,
      },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("remove")
    .setDescription(localizer("en-US", "commands.memory.document.remove.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.memory.document.remove.scope_description"))
        .addChoices(
          {
            name: localizer("en-US", "commands.memory.document.remove.scope_choice_persona"),
            value: "persona",
          },
          {
            name: localizer("en-US", "commands.memory.document.remove.scope_choice_serverwide"),
            value: "serverwide",
          },
        )
        .setRequired(false),
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
  const workflowState: { message: PersonaWorkflowMessageController | null } = { message: null };
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  const scopeInput = interaction.options.getString("scope");
  const scope: DocumentScope = scopeInput === "serverwide" ? "serverwide" : "persona";

  try {
    if (!isRagAvailable()) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.forget.document.rag_disabled_title",
        descriptionKey: "commands.forget.document.rag_disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (scope === "persona") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

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

      const workflowResult = await runPersonaPickerWorkflow(interaction, locale, {
        personas: allPersonas,
        color: ColorCode.INFO,
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

          let documents: Awaited<ReturnType<typeof serverMemoryRepository.loadDocuments>> = [];
          let hasNoDocuments = false;
          const modalResult = await selection.openModal(async () => {
            documents = await serverMemoryRepository.loadDocuments(activeTomoriState.server_id, selectedPersonaId);
            if (!documents || documents.length === 0) {
              hasNoDocuments = true;
              throw new Error("The selected persona has no documents.");
            }
            const documentOptions: SelectOption[] = documents.map((doc) => ({
              label: safeSelectOptionText(doc.document_name),
              value: doc.document_id.toString(),
              description: doc.first_chunk ? safeSelectOptionText(doc.first_chunk) : undefined,
            }));
            return {
              modalCustomId: MODAL_CUSTOM_ID,
              modalTitleKey: "commands.forget.document.modal_title",
              components: [
                {
                  customId: DOCUMENT_SELECT_ID,
                  labelKey: "commands.forget.document.select_label",
                  descriptionKey: "commands.forget.document.select_description",
                  placeholder: "commands.forget.document.select_placeholder",
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
                titleKey: "commands.forget.document.none_title",
                descriptionKey: "commands.forget.document.none_description",
                footerKey: "general.pagination.reloading_persona_picker",
                color: ColorCode.WARN,
              }),
            );
            return retryPersonaWorkflow(await personaRepository.loadAllForServer(serverDiscId));
          }
          if (modalResult.outcome !== "submitted") {
            log.info(`Document removal modal ${modalResult.outcome} for user ${userData.user_id}`);
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

          const documentName = await serverMemoryRepository.removeDocument(
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
              titleKey: "commands.forget.document.success_title",
              descriptionKey: "commands.forget.document.success_description",
              descriptionVars: { name: documentName },
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.SUCCESS,
            }),
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
      const documents = await serverMemoryRepository.loadDocuments(tomoriState.server_id, targetPersonaId);

      if (!documents || documents.length === 0) {
        await replyInfoEmbed(selectionInteraction, locale, {
          titleKey: "commands.forget.document.none_title",
          descriptionKey: "commands.forget.document.none_description",
          color: ColorCode.WARN,
        });
        return;
      }

      const documentOptions: SelectOption[] = documents.map((doc) => ({
        label: safeSelectOptionText(doc.document_name),
        value: doc.document_id.toString(),
        description: doc.first_chunk ? safeSelectOptionText(doc.first_chunk) : undefined,
      }));

      const modalResult = await promptWithPaginatedModal(selectionInteraction, locale, {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.forget.document.modal_title",
        components: [
          {
            customId: DOCUMENT_SELECT_ID,
            labelKey: "commands.forget.document.select_label",
            descriptionKey: "commands.forget.document.select_description",
            placeholder: "commands.forget.document.select_placeholder",
            required: true,
            options: documentOptions,
          },
        ],
      });

      // Handle modal outcome - keep the persona picker loop alive when the modal closes
      if (modalResult.outcome !== "submit") {
        log.info(`Document removal modal ${modalResult.outcome} for user ${userData.user_id}`);
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
          titleKey: "commands.forget.document.none_title",
          descriptionKey: "commands.forget.document.none_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const modalSubmitInteraction = modalResult.interaction;
      const selectedId = Number.parseInt(selectedIdStr, 10);
      const selectedDocument = documents.find((document) => document.document_id === selectedId);
      if (!selectedDocument) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const removalSucceeded = await performDocumentRemoval(
        tomoriState,
        targetPersonaId,
        selectedId,
        serverDiscId,
        userData,
        modalSubmitInteraction,
        locale,
        true,
      );
      if (!removalSucceeded) {
        return;
      }
      await acknowledgeModalSubmitForRefresh(modalSubmitInteraction);
      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.forget.document.success_title",
        "commands.forget.document.success_description",
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
        command: "forget document",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(`Unexpected error in /forget document for user ${userData.user_disc_id}`, error as Error, context);

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

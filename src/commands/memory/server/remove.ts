import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow, ErrorContext, TomoriState } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  retryPersonaWorkflow,
  runPersonaPickerWorkflow,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/personaWorkflow";
import { lineageIdIsEligible, refreshEligibilitySet } from "@/utils/discord/ui/personaEligibility";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { SelectOption } from "@/types/discord/modal";
import { personaRepository, serverMemoryRepository } from "@/utils/db/repositories";

// Rule 20: Constants for static values at the top
const MODAL_CUSTOM_ID = "forget_servermemory_modal";
const MEMORY_SELECT_ID = "memory_select";

// Rule 21: Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.memory.server.remove.description"));

/**
 * Rule 1: JSDoc comment for exported function
 * Removes a server memory from the server_memories table using a paginated embed.
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Ensure command is run in a valid channel context (Rule 17)
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Define state and result variables outside try for catch block context
  let tomoriState: TomoriState | null = null;
  let selectedPersona: TomoriState | null = null;
  const workflowState: {
    message: PersonaWorkflowMessageController | null;
    selectedPersona: TomoriState | null;
  } = { message: null, selectedPersona: null };
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 2. Load server's Tomori state (Rule 17) - Needed for server_id and config checks
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

    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

    // Class B, permission-dependent eligibility. Removal deletes memories, so the
    // set is refreshed in place after each success to reach mid-loop empty.
    const memoryUserScope = hasManagePermission ? undefined : userData.user_id;
    const eligibleServerMemoryLineageIds = await serverMemoryRepository.lineageIdsWithServerMemories(
      activeTomoriState.server_id,
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
        workflowState.selectedPersona = selectedPersona;
        if (!selectedPersona.persona_id) {
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

        if (!activeTomoriState.config.server_memteaching_enabled && !hasManagePermission) {
          const work = await selection.beginInPlaceWork();
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.teach.memory.server.teaching_disabled_title",
              descriptionKey: "commands.teach.memory.server.teaching_disabled_description",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.ERROR,
            }),
          );
          return retryPersonaWorkflow();
        }

        let memories: Awaited<ReturnType<typeof serverMemoryRepository.loadServerMemoriesScoped>> = [];
        let hasNoMemories = false;
        const modalResult = await selection.openModal(async () => {
          memories = await serverMemoryRepository.loadServerMemoriesScoped(
            activeTomoriState.server_id,
            selectedPersona?.persona_lineage_id ?? 0,
            hasManagePermission ? undefined : userData.user_id,
          );
          if (memories.length === 0) {
            hasNoMemories = true;
            throw new Error("The selected persona has no removable server memories.");
          }
          const memorySelectOptions: SelectOption[] = memories.map((memory, index) => ({
            label: safeSelectOptionText(memory.content, 20),
            value: index.toString(),
            description: safeSelectOptionText(memory.content),
          }));
          return {
            modalCustomId: MODAL_CUSTOM_ID,
            modalTitleKey: "commands.forget.memory.server.modal_title",
            components: [
              {
                customId: MEMORY_SELECT_ID,
                labelKey: "commands.forget.memory.server.select_label",
                descriptionKey: "commands.forget.memory.server.select_description",
                placeholder: "commands.forget.memory.server.select_placeholder",
                required: true,
                options: memorySelectOptions,
              },
            ],
          };
        });

        if (hasNoMemories) {
          await selection.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.forget.memory.server.no_memories_title",
              descriptionKey: hasManagePermission
                ? "commands.forget.memory.server.no_memories"
                : "commands.forget.memory.server.no_owned_memories",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.WARN,
            }),
          );
          return retryPersonaWorkflow(await personaRepository.loadAllForServer(serverDiscId));
        }
        if (modalResult.outcome !== "submitted") {
          log.info(`Server memory deletion modal ${modalResult.outcome} for user ${userData.user_id}`);
          return modalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
        }

        const work = await modalResult.phase.beginInPlaceWork();
        const selectedIndex = Number.parseInt(modalResult.phase.values[MEMORY_SELECT_ID] ?? "", 10);
        const selectedMemory = memories[selectedIndex];
        if (!selectedMemory?.server_memory_id) {
          await work.message.replace(
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

        const ok = await serverMemoryRepository.remove(selectedMemory.server_memory_id);
        if (!ok) {
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
        log.success(
          `Deleted server memory "${selectedMemory.content.slice(0, 30)}..." (ID: ${selectedMemory.server_memory_id}) for server ${activeTomoriState.server_id} by user ${userData.user_disc_id}`,
        );
        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "commands.forget.memory.server.success_title",
            descriptionKey: "commands.forget.memory.server.success_description",
            descriptionVars: {
              memory:
                selectedMemory.content.length > 50
                  ? `${selectedMemory.content.slice(0, 50)}...`
                  : selectedMemory.content,
            },
            footerKey: "general.pagination.reloading_persona_picker",
            color: ColorCode.SUCCESS,
          }),
        );
        // Refresh eligibility in place so a lineage whose last owned memory was
        // just removed drops from the picker (reaching mid-loop empty on retry).
        await refreshEligibilitySet(
          eligibleServerMemoryLineageIds,
          serverMemoryRepository.lineageIdsWithServerMemories(activeTomoriState.server_id, memoryUserScope),
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
  } catch (error) {
    // 14. Catch unexpected errors
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: workflowState.selectedPersona?.persona_id ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "forget servermemory",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /forget servermemory for user ${userData.user_disc_id}`,
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

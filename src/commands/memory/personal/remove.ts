import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  Client,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow, ErrorContext, TomoriState } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  retryPersonaWorkflow,
  runPersonaPickerWorkflow,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/personaWorkflow";
import { lineageIdIsEligible, refreshEligibilitySet } from "@/utils/discord/ui/personaEligibility";
import { personaRepository, personalMemoryRepository } from "@/utils/db/repositories";
import { invalidateUserCache } from "@/utils/cache/userCache";
import type { SelectOption } from "@/types/discord/modal";
import { createStandardEmbed } from "@/utils/discord/embedHelper";

const MODAL_CUSTOM_ID = "forget_personalmemory_modal";
const MEMORY_SELECT_ID = "memory_select";
const PERSONAL_SCOPE_VALUE = "persona";
const GLOBAL_SCOPE_VALUE = "global";
const GLOBAL_PERSONAL_MEMORY_LINEAGE_ID = 0;

/**
 * Helper function to perform personal memory removal from database
 * @param replyInteraction - Interaction to reply to (can be modal or pagination)
 */
async function performPersonalMemoryRemoval(
  memoryToRemove: { personal_memory_id?: number; content: string },
  userData: UserRow,
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  if (!memoryToRemove.personal_memory_id) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  const ok = await personalMemoryRepository.remove(memoryToRemove.personal_memory_id);
  if (!ok) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  // Invalidate user cache so next message gets fresh data
  invalidateUserCache(userData.user_disc_id);

  log.success(
    `Deleted personal memory "${memoryToRemove.content.slice(0, 30)}..." for user ${userData.user_disc_id} (ID: ${userData.user_id})`,
  );

  if (!suppressSuccessReply) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.forget.memory.personal.success_title",
      descriptionKey: "commands.forget.memory.personal.success_description",
      descriptionVars: {
        memory:
          memoryToRemove.content.length > 50 ? `${memoryToRemove.content.slice(0, 50)}...` : memoryToRemove.content,
      },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("remove")
    .setDescription(localizer("en-US", "commands.memory.personal.remove.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.memory.personal.remove.scope_description"))
        .setRequired(false)
        .addChoices(
          {
            name: localizer("en-US", "commands.memory.personal.remove.scope_choice_persona"),
            value: PERSONAL_SCOPE_VALUE,
          },
          {
            name: localizer("en-US", "commands.memory.personal.remove.scope_choice_global"),
            value: GLOBAL_SCOPE_VALUE,
          },
        ),
    );

/**
 * JSDoc comment for exported function
 * Removes a personal memory from the user's record in the users table using a paginated embed.
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

  // Define state and result variables outside try for catch block context
  let tomoriState: TomoriState | null = null;
  let selectedPersona: TomoriState | null = null;
  const workflowState: { message: PersonaWorkflowMessageController | null } = { message: null };
  let personalizationDisabledWarning = false; // Flag to check if warning needed
  const memoryScope =
    (interaction.options.getString("scope") as typeof PERSONAL_SCOPE_VALUE | typeof GLOBAL_SCOPE_VALUE | null) ??
    PERSONAL_SCOPE_VALUE;

  try {
    if (memoryScope === PERSONAL_SCOPE_VALUE) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    tomoriState = await personaRepository.loadState(interaction.guild?.id ?? interaction.user.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title", // Corrected key
        descriptionKey: "general.errors.tomori_not_setup_description", // Corrected key
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if personalization is disabled *before* showing choices
    // biome-ignore lint/style/noNonNullAssertion: tomoriState checked earlier
    if (!tomoriState!.config.personal_memories_enabled) {
      personalizationDisabledWarning = true;
    }

    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    if (memoryScope === PERSONAL_SCOPE_VALUE) {
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

      // Class B eligibility keyed on lineages for which this user has personal
      // memories. `lineageIdsWithMemories` excludes lineage 0, matching the
      // persona branch's own global-lineage rejection; the global scope below is
      // handled by its own branch and is unaffected. Refreshed after each removal.
      const eligibleLineageIds = userData.user_id
        ? await personalMemoryRepository.lineageIdsWithMemories(userData.user_id)
        : new Set<number>();
      const isEligible = lineageIdIsEligible(eligibleLineageIds);
      const eligiblePersonas = allPersonas.filter(isEligible);
      if (eligiblePersonas.length === 0) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.forget.memory.personal.no_memories_title",
          descriptionKey: "commands.forget.memory.personal.no_memories",
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
          emptyTitleKey: "commands.forget.memory.personal.no_memories_title",
          emptyDescriptionKey: "commands.forget.memory.personal.no_memories",
          itemsLabelKey: "general.persona_workflow.items.personal_memories",
        },
        async onSelected(selection) {
          workflowState.message = selection.message;
          selectedPersona = selection.persona;
          const targetLineageId = selectedPersona.persona_lineage_id ?? GLOBAL_PERSONAL_MEMORY_LINEAGE_ID;
          if (targetLineageId === GLOBAL_PERSONAL_MEMORY_LINEAGE_ID) {
            const work = await selection.beginInPlaceWork();
            await work.message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.operation_failed_title",
                descriptionKey: "general.errors.operation_failed_description",
                footerKey: "general.pagination.reloading_persona_picker",
                color: ColorCode.ERROR,
              }),
            );
            return retryPersonaWorkflow();
          }

          let currentMemories: Awaited<ReturnType<typeof personalMemoryRepository.loadForUserLineage>> = [];
          let hasNoMemories = false;
          const modalResult = await selection.openModal(async () => {
            const fetchedMemories = userData.user_id
              ? await personalMemoryRepository.loadForUserLineage(userData.user_id, targetLineageId, false)
              : [];
            currentMemories = fetchedMemories.filter((memory) => memory.persona_lineage_id === targetLineageId);
            if (currentMemories.length === 0) {
              hasNoMemories = true;
              throw new Error("The selected persona has no personal memories.");
            }
            const memorySelectOptions: SelectOption[] = currentMemories.map((memory, index) => ({
              label: safeSelectOptionText(memory.content, 20),
              value: index.toString(),
              description: safeSelectOptionText(memory.content),
            }));
            return {
              modalCustomId: MODAL_CUSTOM_ID,
              modalTitleKey: "commands.forget.memory.personal.modal_title",
              components: [
                {
                  customId: MEMORY_SELECT_ID,
                  labelKey: "commands.forget.memory.personal.select_label",
                  descriptionKey: "commands.forget.memory.personal.select_description",
                  placeholder: "commands.forget.memory.personal.select_placeholder",
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
                titleKey: "commands.forget.memory.personal.no_memories_title",
                descriptionKey: "commands.forget.memory.personal.no_memories",
                footerKey: "general.pagination.reloading_persona_picker",
                color: ColorCode.WARN,
              }),
            );
            return retryPersonaWorkflow(await personaRepository.loadAllForServer(serverDiscId));
          }
          if (modalResult.outcome !== "submitted") {
            log.info(`Personal memory deletion modal ${modalResult.outcome} for user ${userData.user_id}`);
            return modalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
          }

          const work = await modalResult.phase.beginInPlaceWork();
          const selectedIndex = Number.parseInt(modalResult.phase.values[MEMORY_SELECT_ID] ?? "", 10);
          const selectedMemory = currentMemories[selectedIndex];
          if (!selectedMemory?.personal_memory_id) {
            await work.message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.operation_failed_title",
                descriptionKey: "commands.forget.memory.personal.no_memories",
                footerKey: "general.pagination.reloading_persona_picker",
                color: ColorCode.ERROR,
              }),
            );
            return retryPersonaWorkflow();
          }

          const ok = await personalMemoryRepository.remove(selectedMemory.personal_memory_id);
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

          invalidateUserCache(userData.user_disc_id);
          log.success(
            `Deleted personal memory "${selectedMemory.content.slice(0, 30)}..." for user ${userData.user_disc_id} (ID: ${userData.user_id})`,
          );
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.forget.memory.personal.success_title",
              descriptionKey: "commands.forget.memory.personal.success_description",
              descriptionVars: {
                memory:
                  selectedMemory.content.length > 50
                    ? `${selectedMemory.content.slice(0, 50)}...`
                    : selectedMemory.content,
              },
              footerKey: personalizationDisabledWarning
                ? "commands.forget.memory.personal.warning_disabled_description"
                : "general.pagination.reloading_persona_picker",
              color: ColorCode.SUCCESS,
            }),
          );
          // Refresh eligibility in place so a lineage whose last personal memory
          // was removed drops from the picker on retry (reaching mid-loop empty).
          await refreshEligibilitySet(
            eligibleLineageIds,
            userData.user_id
              ? personalMemoryRepository.lineageIdsWithMemories(userData.user_id)
              : Promise.resolve(new Set<number>()),
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
    } else {
      // GLOBAL scope: load lineage-0 memories directly (no persona picker needed)
      const globalMemories = userData.user_id
        ? await personalMemoryRepository.loadForUserLineage(userData.user_id, GLOBAL_PERSONAL_MEMORY_LINEAGE_ID, false)
        : [];

      if (globalMemories.length === 0) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.forget.memory.personal.no_memories_title",
          descriptionKey: "commands.forget.memory.personal.no_memories",
          color: ColorCode.WARN,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const memorySelectOptions: SelectOption[] = globalMemories.map((memory, index) => ({
        label: safeSelectOptionText(memory.content, 20),
        value: index.toString(),
        description: safeSelectOptionText(memory.content),
      }));

      // Show the paginated modal with memory selection (no back-navigation loop needed)
      const modalResult = await promptWithPaginatedModal(interaction, locale, {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.forget.memory.personal.modal_title",
        components: [
          {
            customId: MEMORY_SELECT_ID,
            labelKey: "commands.forget.memory.personal.select_label",
            descriptionKey: "commands.forget.memory.personal.select_description",
            placeholder: "commands.forget.memory.personal.select_placeholder",
            required: true,
            options: memorySelectOptions,
          },
        ],
      });

      if (modalResult.outcome !== "submit") {
        log.info(`Global personal memory deletion modal ${modalResult.outcome} for user ${userData.user_id}`);
        return;
      }

      const modalSubmitInteraction = modalResult.interaction;
      const selectedIndex = modalResult.values?.[MEMORY_SELECT_ID];

      if (!modalSubmitInteraction || !selectedIndex) {
        log.error("Modal result unexpectedly missing interaction or values");
        return;
      }

      const selectedMemory = globalMemories[Number.parseInt(selectedIndex, 10)];
      if (!selectedMemory) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.operation_failed_title",
          descriptionKey: "commands.forget.memory.personal.no_memories",
          color: ColorCode.ERROR,
        });
        return;
      }

      await performPersonalMemoryRemoval(selectedMemory, userData, modalSubmitInteraction, locale);

      // If personalization is disabled, send a warning follow-up
      if (personalizationDisabledWarning) {
        await modalSubmitInteraction.followUp({
          embeds: [
            createStandardEmbed(locale, {
              titleKey: "commands.forget.memory.personal.warning_disabled_title",
              descriptionKey: "commands.forget.memory.personal.warning_disabled_description",
              color: ColorCode.WARN,
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "forget personalmemory",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /forget personalmemory for user ${userData.user_disc_id}`,
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

import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import type { CheckboxGroupOption, ModalCheckboxGroupField, SelectOption } from "@/types/discord/modal";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { hasTriggerWords } from "@/utils/discord/ui/personaEligibility";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  retryPersonaWorkflow,
  runPersonaPickerWorkflow,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/personaWorkflow";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { normalizeTriggerWord } from "@/utils/text/triggerWords";

const TRIGGER_MODAL_CUSTOM_ID = "persona_triggerremove_trigger_modal";
const TRIGGER_SELECT_ID = "trigger_select";
const TRIGGER_CHECKBOX_ID_PREFIX = "persona_trigger_checkbox_group";
const MAX_OPTIONS_PER_GROUP = 10;
const MAX_GROUPS_PER_MODAL = 5;
const MAX_ENTRIES_PER_MODAL = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;

type PersonaWithId = TomoriState & { persona_id: number };

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.persona.trigger.remove.description"));

/** Removes one or more trigger words from a selected persona. */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const guildId = interaction.guild.id;
  const workflowState: {
    selectedPersona: TomoriState | null;
    message: PersonaWorkflowMessageController | null;
  } = { selectedPersona: null, message: null };

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const allPersonas = await personaRepository.loadAllForServer(guildId);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(
        interaction,
        locale,
        {
          titleKey: "general.errors.tomori_not_setup_title",
          descriptionKey: "general.errors.tomori_not_setup_description",
          color: ColorCode.ERROR,
        },
        MessageFlags.Ephemeral,
      );
      return;
    }

    // Pre-picker eligibility guard shared with the workflow filter and the
    // post-selection backstop below (all via `hasTriggerWords`).
    const eligiblePersonas = allPersonas.filter(hasTriggerWords);
    if (eligiblePersonas.length === 0) {
      await replyInfoEmbed(
        interaction,
        locale,
        {
          titleKey: "commands.persona.trigger.remove.no_triggers_title",
          descriptionKey: "commands.persona.trigger.remove.no_triggers_description",
          color: ColorCode.WARN,
        },
        MessageFlags.Ephemeral,
      );
      return;
    }

    await runPersonaPickerWorkflow(interaction, locale, {
      personas: allPersonas,
      color: ColorCode.INFO,
      eligibility: {
        isEligible: hasTriggerWords,
        emptyTitleKey: "commands.persona.trigger.remove.no_triggers_title",
        emptyDescriptionKey: "commands.persona.trigger.remove.no_triggers_description",
        itemsLabelKey: "general.persona_workflow.items.trigger_words",
      },
      onSelected: async (selection) => {
        workflowState.selectedPersona = selection.persona;
        workflowState.message = selection.message;
        if (!selection.persona.persona_id) {
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

        // Concurrency backstop reusing the shared predicate.
        const selectedPersona = selection.persona as PersonaWithId;
        const currentTriggerWords = selectedPersona.trigger_words ?? [];
        if (!hasTriggerWords(selectedPersona)) {
          const work = await selection.beginInPlaceWork();
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.persona.trigger.remove.no_triggers_title",
              descriptionKey: "commands.persona.trigger.remove.no_triggers_description",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.WARN,
            }),
          );
          return retryPersonaWorkflow();
        }

        const paginatedFallback = currentTriggerWords.length > MAX_ENTRIES_PER_MODAL;
        const modalResult = paginatedFallback
          ? await selection.openModal({
              modalCustomId: TRIGGER_MODAL_CUSTOM_ID,
              modalTitleKey: "commands.persona.trigger.remove.modal_title",
              components: [
                {
                  customId: TRIGGER_SELECT_ID,
                  labelKey: "commands.persona.trigger.remove.select_label",
                  descriptionKey: "commands.persona.trigger.remove.select_description",
                  placeholder: "commands.persona.trigger.remove.select_placeholder",
                  required: true,
                  options: currentTriggerWords.map(
                    (trigger, index): SelectOption => ({
                      label: safeSelectOptionText(formatTriggerWordForDisplay(trigger), 50),
                      value: index.toString(),
                    }),
                  ),
                },
              ],
            })
          : await selection.openModal({
              modalCustomId: TRIGGER_MODAL_CUSTOM_ID,
              modalTitleKey: "commands.persona.trigger.remove.modal_title",
              components: buildTriggerCheckboxGroups(currentTriggerWords),
            });

        if (modalResult.outcome !== "submitted") {
          log.info(`Trigger delete modal ${modalResult.outcome} for user ${userData.user_id}`);
          return modalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
        }

        const work = await modalResult.phase.beginInPlaceWork();
        let removedIndices: number[];
        if (paginatedFallback) {
          const selectedIndex = Number.parseInt(modalResult.phase.values[TRIGGER_SELECT_ID] ?? "", 10);
          removedIndices = Number.isInteger(selectedIndex) ? [selectedIndex] : [];
        } else {
          const checkedIndices = new Set<number>();
          const triggerGroupCount = Math.ceil(currentTriggerWords.length / MAX_OPTIONS_PER_GROUP);
          for (let groupIndex = 0; groupIndex < triggerGroupCount; groupIndex++) {
            const groupValues = modalResult.phase.multiValues[`${TRIGGER_CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
            for (const index of groupValues) checkedIndices.add(Number.parseInt(index, 10));
          }
          removedIndices = currentTriggerWords.flatMap((_, index) => (checkedIndices.has(index) ? [] : [index]));
        }

        const removedIndexSet = new Set(removedIndices);
        const removedTriggerWords = currentTriggerWords.filter((_, index) => removedIndexSet.has(index));
        const remainingTriggerWords = currentTriggerWords.filter((_, index) => !removedIndexSet.has(index));
        if (removedTriggerWords.length === 0) {
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.persona.trigger.remove.no_removals_title",
              descriptionKey: "commands.persona.trigger.remove.no_removals_description",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.INFO,
            }),
          );
          return retryPersonaWorkflow();
        }

        const success = await personaRepository.removeTrigger(selectedPersona.persona_id, remainingTriggerWords);
        if (!success) {
          const context: ErrorContext = {
            personaId: selectedPersona.persona_id,
            serverId: selectedPersona.server_id,
            userId: userData.user_id,
            errorType: "DatabaseUpdateError",
            metadata: {
              command: "persona trigger remove",
              guildId,
              removedIndices,
              removedTriggerWords,
            },
          };
          await log.error(
            "Failed to update trigger_words in persona_configs table via repository",
            new Error("Database update returned false"),
            context,
          );
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.update_failed_title",
              descriptionKey: "general.errors.update_failed_description",
              color: ColorCode.ERROR,
            }),
          );
          return completePersonaWorkflow();
        }

        invalidateTomoriStateCache(guildId);
        log.success(
          `Removed ${removedTriggerWords.length} trigger word(s) for tomori ${selectedPersona.persona_id} by user ${userData.user_disc_id}: ${removedTriggerWords.join(", ")}`,
        );
        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "commands.persona.trigger.remove.success_title",
            descriptionKey: "commands.persona.trigger.remove.success_description",
            descriptionVars: { triggerWords: formatTriggerList(removedTriggerWords) },
            footerKey: "general.pagination.reloading_persona_picker",
            color: ColorCode.SUCCESS,
          }),
        );
        const refreshedPersonas = await personaRepository.loadAllForServer(guildId);
        return retryPersonaWorkflow(refreshedPersonas);
      },
    });
  } catch (error) {
    const selectedPersona = workflowState.selectedPersona;
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: selectedPersona?.server_id,
      personaId: selectedPersona?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona trigger remove",
        guildId,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /persona trigger remove for user ${userData.user_disc_id}`,
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

function buildTriggerCheckboxGroups(currentTriggerWords: string[]): ModalCheckboxGroupField[] {
  const checkboxGroups: ModalCheckboxGroupField[] = [];
  for (let i = 0; i < currentTriggerWords.length; i += MAX_OPTIONS_PER_GROUP) {
    const chunk = currentTriggerWords.slice(i, i + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((triggerWord, offset) => ({
      label: safeSelectOptionText(formatTriggerWordForDisplay(triggerWord), 50),
      value: (i + offset).toString(),
      default: true,
    }));
    checkboxGroups.push({
      kind: "checkboxGroup",
      customId: `${TRIGGER_CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.persona.trigger.remove.checkbox_label"
          : "commands.persona.trigger.remove.checkbox_label_continued",
      descriptionKey: groupIndex === 0 ? "commands.persona.trigger.remove.checkbox_description" : undefined,
      minValues: 0,
      required: false,
      options,
    });
  }
  return checkboxGroups;
}

function formatTriggerList(triggerWords: string[]): string {
  const visibleWords = triggerWords.slice(0, 10);
  const suffix = triggerWords.length > 10 ? ", ..." : "";
  return `${visibleWords.map((triggerWord) => `\`${formatTriggerWordForDisplay(triggerWord)}\``).join(", ")}${suffix}`;
}

function formatTriggerWordForDisplay(triggerWord: string): string {
  return normalizeTriggerWord(triggerWord, { lowercase: false });
}

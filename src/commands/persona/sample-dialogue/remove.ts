import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { hasSampleDialogues } from "@/utils/discord/ui/personaEligibility";
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

const MODAL_CUSTOM_ID = "forget_sampledialogue_modal";
const DIALOGUE_SELECT_ID = "dialogue_select";

async function repairMismatchedDialogues(
  personaId: number,
  inLength: number,
  outLength: number,
  serverDiscId: string,
): Promise<{ repairedIn: string[]; repairedOut: string[] } | null> {
  const safeLength = Math.min(inLength, outLength);
  log.warn(
    `Self-healing: truncating sample dialogues for tomori ${personaId} from (in: ${inLength}, out: ${outLength}) to ${safeLength} pairs`,
  );
  const repaired = await personaRepository.repairSampleDialogues(personaId, safeLength);
  if (!repaired) {
    log.error(`Self-healing failed: no rows returned for tomori ${personaId}`);
    return null;
  }
  invalidateTomoriStateCache(serverDiscId);
  log.success(`Self-healing complete: sample dialogues for tomori ${personaId} repaired to ${safeLength} pairs`);
  return repaired;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("remove")
    .setDescription(localizer("en-US", "commands.persona.sample-dialogue.remove.description"));

/** Removes a sample-dialogue pair from a selected persona. */
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

  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  let tomoriState: TomoriState | null = null;
  const workflowState: {
    selectedPersona: TomoriState | null;
    message: PersonaWorkflowMessageController | null;
  } = { selectedPersona: null, message: null };

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    // Pre-picker eligibility guard shared with the workflow filter and the
    // post-selection backstop below (all via `hasSampleDialogues`).
    const eligiblePersonas = allPersonas.filter(hasSampleDialogues);
    if (eligiblePersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.forget.sampledialogue.no_dialogues_title",
        descriptionKey: "commands.forget.sampledialogue.no_dialogues",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
    await runPersonaPickerWorkflow(interaction, locale, {
      personas: allPersonas,
      color: ColorCode.INFO,
      eligibility: {
        isEligible: hasSampleDialogues,
        emptyTitleKey: "commands.forget.sampledialogue.no_dialogues_title",
        emptyDescriptionKey: "commands.forget.sampledialogue.no_dialogues",
        itemsLabelKey: "general.persona_workflow.items.sample_dialogues",
      },
      onSelected: async (selection) => {
        workflowState.selectedPersona = selection.persona;
        workflowState.message = selection.message;
        const personaId = selection.persona.persona_id;

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

        if (!tomoriState?.config.sampledialogue_memteaching_enabled && !hasManagePermission) {
          const work = await selection.beginInPlaceWork();
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.teach.sampledialogue.teaching_disabled_title",
              descriptionKey: "commands.teach.sampledialogue.teaching_disabled_description",
              color: ColorCode.ERROR,
            }),
          );
          return completePersonaWorkflow();
        }

        // Concurrency backstop reusing the shared predicate (both input and
        // output arrays must be non-empty, identical to the picker filter).
        let currentIn = [...(selection.persona.sample_dialogues_in ?? [])];
        let currentOut = [...(selection.persona.sample_dialogues_out ?? [])];
        if (!hasSampleDialogues(selection.persona)) {
          const work = await selection.beginInPlaceWork();
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.forget.sampledialogue.no_dialogues_title",
              descriptionKey: "commands.forget.sampledialogue.no_dialogues",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.WARN,
            }),
          );
          return retryPersonaWorkflow();
        }

        const modalResult = await selection.openModal(async () => {
          if (currentIn.length !== currentOut.length) {
            const repaired = await repairMismatchedDialogues(
              personaId,
              currentIn.length,
              currentOut.length,
              serverDiscId,
            );
            if (!repaired) throw new Error("Failed to repair mismatched sample dialogues");
            currentIn = repaired.repairedIn;
            currentOut = repaired.repairedOut;
            selection.persona.sample_dialogues_in = repaired.repairedIn;
            selection.persona.sample_dialogues_out = repaired.repairedOut;
          }

          const options: SelectOption[] = currentIn.map((input, index) => ({
            label: safeSelectOptionText(input, 50),
            value: index.toString(),
            description: safeSelectOptionText(currentOut[index] ?? "", 50),
          }));
          return {
            modalCustomId: MODAL_CUSTOM_ID,
            modalTitleKey: "commands.forget.sampledialogue.modal_title",
            components: [
              {
                customId: DIALOGUE_SELECT_ID,
                labelKey: "commands.forget.sampledialogue.select_label",
                descriptionKey: "commands.forget.sampledialogue.select_description",
                placeholder: "commands.forget.sampledialogue.select_placeholder",
                required: true,
                options,
              },
            ],
          };
        });
        if (modalResult.outcome !== "submitted") {
          log.info(`Sample dialogue deletion modal ${modalResult.outcome} for user ${userData.user_id}`);
          return modalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
        }

        const work = await modalResult.phase.beginInPlaceWork();
        const selectedValue = modalResult.phase.values[DIALOGUE_SELECT_ID];
        const selectedIndex = Number.parseInt(selectedValue ?? "", 10);
        const itemToRemoveIn = currentIn[selectedIndex];
        const itemToRemoveOut = currentOut[selectedIndex];
        if (!Number.isInteger(selectedIndex) || itemToRemoveIn === undefined || itemToRemoveOut === undefined) {
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

        const removed = await personaRepository.removeSampleDialoguePairAt(personaId, selectedIndex + 1);
        if (!removed) {
          const context: ErrorContext = {
            personaId,
            serverId: selection.persona.server_id,
            userId: userData.user_id,
            errorType: "DatabaseUpdateError",
            metadata: { command: "forget sampledialogue", selectedIndex },
          };
          await log.error(
            "Failed to update sample_dialogues in personas table",
            new Error("Database update returned no rows"),
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

        invalidateTomoriStateCache(serverDiscId);
        log.success(
          `Removed sample dialogue pair at index ${selectedIndex} for tomori ${personaId} by user ${userData.user_disc_id}`,
        );
        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "commands.forget.sampledialogue.success_title",
            descriptionKey: "commands.forget.sampledialogue.success_description",
            descriptionVars: {
              input: itemToRemoveIn.length > 50 ? `${itemToRemoveIn.slice(0, 50)}...` : itemToRemoveIn,
              output: itemToRemoveOut.length > 50 ? `${itemToRemoveOut.slice(0, 50)}...` : itemToRemoveOut,
            },
            footerKey: "general.pagination.reloading_persona_picker",
            color: ColorCode.SUCCESS,
          }),
        );
        const refreshedPersonas = await personaRepository.loadAllForServer(serverDiscId);
        return retryPersonaWorkflow(refreshedPersonas);
      },
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: workflowState.selectedPersona?.persona_id ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "forget sampledialogue",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /forget sampledialogue for user ${userData.user_disc_id}`,
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

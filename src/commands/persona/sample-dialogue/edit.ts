import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  acknowledgeModalSubmitForRefresh,
  promptWithPaginatedModal,
  promptWithRawModal,
  safeSelectOptionText,
} from "@/utils/discord/ui/modals";
import { promptWithUnacknowledgedConfirmation } from "@/utils/discord/ui/confirmation";
import { replyComponentsV2Status, updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { personaRepository, userRepository } from "@/utils/db/repositories";
import { getMemoryLimits, validateSampleDialogue } from "@/utils/misc/memoryLimits";
import { splitPromptIntoModalParts, combineModalPromptParts } from "@/utils/text/modalPromptParts";
import type { SelectOption } from "@/types/discord/modal";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";

const SELECT_MODAL_CUSTOM_ID = "persona_sampledialogue_edit_select_modal";
const EDIT_MODAL_CUSTOM_ID = "persona_sampledialogue_edit_value_modal";
const DIALOGUE_SELECT_ID = "dialogue_select";
const USER_INPUT_PART1_ID = "user_input_part1";
const USER_INPUT_PART2_ID = "user_input_part2";
const BOT_INPUT_PART1_ID = "bot_input_part1";
const BOT_INPUT_PART2_ID = "bot_input_part2";
const DIALOGUE_PART_MAX_LENGTH = 4000; // Discord text input character limit

const memoryLimits = getMemoryLimits();

function formatDialoguePreview(text: string, maxLength = 96): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function makeDialogueKey(userInput: string, botInput: string): string {
  return `${userInput.trim().toLowerCase()}|||${botInput.trim().toLowerCase()}`;
}

async function repairMismatchedDialogues(
  personaId: number,
  inLength: number,
  outLength: number,
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

  log.success(`Self-healing complete: sample dialogues for tomori ${personaId} repaired to ${safeLength} pairs`);
  return repaired;
}

async function performSampleDialogueEdit(
  selectedPersona: TomoriState,
  selectedIndex: number,
  newUserInput: string,
  newBotInput: string,
  userData: UserRow,
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  if (selectedPersona.persona_id === undefined) {
    await log.error("Cannot edit sample dialogue for persona without persona_id");
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  const pgIndex = selectedIndex + 1;
  const updated = await personaRepository.editSampleDialoguePairAt(
    selectedPersona.persona_id,
    pgIndex,
    newUserInput,
    newBotInput,
  );

  if (!updated) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: selectedPersona.server_id,
      personaId: selectedPersona.persona_id,
      errorType: "DatabaseUpdateError",
      metadata: {
        command: "persona sample-dialogue edit",
        selectedIndex,
      },
    };

    await log.error("Failed to update sample dialogue arrays", new Error("Database update returned no rows"), context);

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

  log.success(
    `Updated sample dialogue ${selectedIndex} for tomori ${selectedPersona.persona_id} by ${userData.user_disc_id}`,
  );

  if (!suppressSuccessReply) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.persona.sample-dialogue.edit.success_title",
      descriptionKey: "commands.persona.sample-dialogue.edit.success_description",
      descriptionVars: {
        input: formatDialoguePreview(newUserInput),
        output: formatDialoguePreview(newBotInput),
      },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("edit").setDescription(localizer("en-US", "commands.persona.sample-dialogue.edit.description"));

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
  let selectedPersona: TomoriState | null = null;
  let personaSelectionInteraction: ButtonInteraction | null = null;

  try {
    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

    if (interaction.guild) {
      const blacklisted = (await userRepository.isBlacklisted(interaction.guild.id, interaction.user.id)) ?? false;
      if (blacklisted && !hasManagePermission) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.user_blacklisted_title",
          descriptionKey: "general.errors.user_blacklisted_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
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

    let allPersonas = await personaRepository.loadAllForServer(interaction.guild?.id ?? interaction.user.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const avatarSessionCache: AvatarSessionCache = new Map();
    while (true) {
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        avatarSessionCache,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success) {
        return;
      }
      if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
        return;
      }

      personaSelectionInteraction = personaSelection.interaction;
      selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
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

      if (!tomoriState.config.sampledialogue_memteaching_enabled && !hasManagePermission) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.teach.sampledialogue.teaching_disabled_title",
          descriptionKey: "commands.teach.sampledialogue.teaching_disabled_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let currentIn = selectedPersona.sample_dialogues_in ?? [];
      let currentOut = selectedPersona.sample_dialogues_out ?? [];

      if (currentIn.length !== currentOut.length && currentIn.length > 0 && currentOut.length > 0) {
        const repaired = await repairMismatchedDialogues(
          selectedPersona.persona_id,
          currentIn.length,
          currentOut.length,
        );
        if (repaired) {
          currentIn = repaired.repairedIn;
          currentOut = repaired.repairedOut;
          selectedPersona.sample_dialogues_in = repaired.repairedIn;
          selectedPersona.sample_dialogues_out = repaired.repairedOut;
          if (interaction.guildId) {
            invalidateTomoriStateCache(interaction.guildId);
          }
        }
      }

      if (currentIn.length === 0 || currentIn.length !== currentOut.length) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "commands.forget.sampledialogue.no_dialogues_title",
          "commands.forget.sampledialogue.no_dialogues",
          ColorCode.WARN,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      const dialogueSelectOptions: SelectOption[] = currentIn.map((input, index) => ({
        label: safeSelectOptionText(input, 50),
        value: index.toString(),
        description: safeSelectOptionText(currentOut[index] ?? "", 50),
      }));

      const selectModalResult = await promptWithPaginatedModal(personaSelectionInteraction, locale, {
        modalCustomId: SELECT_MODAL_CUSTOM_ID,
        modalTitleKey: "commands.persona.sample-dialogue.edit.select_modal_title",
        components: [
          {
            customId: DIALOGUE_SELECT_ID,
            labelKey: "commands.persona.sample-dialogue.edit.select_label",
            descriptionKey: "commands.persona.sample-dialogue.edit.select_description",
            placeholder: "commands.persona.sample-dialogue.edit.select_placeholder",
            required: true,
            options: dialogueSelectOptions,
          },
        ],
      });

      if (selectModalResult.outcome !== "submit") {
        log.info(`Sample dialogue edit selection modal ${selectModalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      const selectModalInteraction = selectModalResult.interaction;
      const selectedIndexRaw = selectModalResult.values?.[DIALOGUE_SELECT_ID];
      if (!selectModalInteraction || !selectedIndexRaw) {
        log.error("Sample dialogue edit selection unexpectedly missing interaction or values");
        return;
      }

      const selectedIndex = Number.parseInt(selectedIndexRaw, 10);
      const selectedUserInput = currentIn[selectedIndex];
      const selectedBotInput = currentOut[selectedIndex];
      if (!selectedUserInput || !selectedBotInput) {
        await replyInfoEmbed(selectModalInteraction, locale, {
          titleKey: "general.errors.operation_failed_title",
          descriptionKey: "general.errors.operation_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      await acknowledgeModalSubmitForRefresh(selectModalInteraction);

      const confirmationResult = await promptWithUnacknowledgedConfirmation(interaction, locale, {
        embedTitleKey: "commands.persona.sample-dialogue.edit.confirm_title",
        embedDescriptionKey: "commands.persona.sample-dialogue.edit.confirm_description",
        embedDescriptionVars: {
          input: formatDialoguePreview(selectedUserInput, 1500)
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n"),
          output: formatDialoguePreview(selectedBotInput, 1500)
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n"),
        },
        embedColor: ColorCode.INFO,
        useComponentsV2: true,
        continueLabelKey: "general.confirm",
        cancelLabelKey: "general.pagination.cancel",
        continueCustomId: `persona_sampledialogue_edit_confirm_${selectModalInteraction.id}`,
        cancelCustomId: `persona_sampledialogue_edit_cancel_${selectModalInteraction.id}`,
      });

      if (confirmationResult.outcome !== "continue" || !confirmationResult.interaction) {
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      const userInputParts = splitPromptIntoModalParts(selectedUserInput, 2, DIALOGUE_PART_MAX_LENGTH);
      const botInputParts = splitPromptIntoModalParts(selectedBotInput, 2, DIALOGUE_PART_MAX_LENGTH);

      const editModalResult = await promptWithRawModal(confirmationResult.interaction, locale, {
        modalCustomId: EDIT_MODAL_CUSTOM_ID,
        modalTitleKey: "commands.persona.sample-dialogue.edit.modal_title",
        components: [
          {
            customId: USER_INPUT_PART1_ID,
            labelKey: "commands.persona.sample-dialogue.edit.user_input_label",
            descriptionKey: "commands.persona.sample-dialogue.edit.user_input_description",
            placeholder: "commands.persona.sample-dialogue.edit.user_input_placeholder",
            style: TextInputStyle.Paragraph,
            required: true,
            maxLength: DIALOGUE_PART_MAX_LENGTH,
            value: userInputParts[0] || undefined,
          },
          {
            customId: USER_INPUT_PART2_ID,
            labelKey: "commands.persona.sample-dialogue.edit.user_input_part2_label",
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: DIALOGUE_PART_MAX_LENGTH,
            value: userInputParts[1] || undefined,
          },
          {
            customId: BOT_INPUT_PART1_ID,
            labelKey: "commands.persona.sample-dialogue.edit.bot_input_label",
            descriptionKey: "commands.persona.sample-dialogue.edit.bot_input_description",
            placeholder: "commands.persona.sample-dialogue.edit.bot_input_placeholder",
            style: TextInputStyle.Paragraph,
            required: true,
            maxLength: DIALOGUE_PART_MAX_LENGTH,
            value: botInputParts[0] || undefined,
          },
          {
            customId: BOT_INPUT_PART2_ID,
            labelKey: "commands.persona.sample-dialogue.edit.bot_input_part2_label",
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: DIALOGUE_PART_MAX_LENGTH,
            value: botInputParts[1] || undefined,
          },
        ],
      });

      if (editModalResult.outcome !== "submit") {
        log.info(`Sample dialogue edit modal ${editModalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      const editModalInteraction = editModalResult.interaction;
      const editedUserInput = combineModalPromptParts(
        [
          editModalResult.values?.[USER_INPUT_PART1_ID]?.trim() ?? "",
          editModalResult.values?.[USER_INPUT_PART2_ID]?.trim() ?? "",
        ],
        DIALOGUE_PART_MAX_LENGTH,
      );
      const editedBotInput = combineModalPromptParts(
        [
          editModalResult.values?.[BOT_INPUT_PART1_ID]?.trim() ?? "",
          editModalResult.values?.[BOT_INPUT_PART2_ID]?.trim() ?? "",
        ],
        DIALOGUE_PART_MAX_LENGTH,
      );
      if (!editModalInteraction) {
        log.error("Sample dialogue edit modal unexpectedly missing interaction");
        return;
      }

      const userInputValidation = validateSampleDialogue(editedUserInput);
      if (!userInputValidation.isValid) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.teach.sampledialogue.user_input_too_long_title",
          descriptionKey: "commands.teach.sampledialogue.user_input_too_long_description",
          descriptionVars: {
            current_length: editedUserInput.length.toString(),
            max_allowed: (userInputValidation.maxAllowed || memoryLimits.maxSampleDialogueLength).toString(),
          },
          color: ColorCode.ERROR,
        });
        continue;
      }

      const botInputValidation = validateSampleDialogue(editedBotInput);
      if (!botInputValidation.isValid) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.teach.sampledialogue.bot_input_too_long_title",
          descriptionKey: "commands.teach.sampledialogue.bot_input_too_long_description",
          descriptionVars: {
            current_length: editedBotInput.length.toString(),
            max_allowed: (botInputValidation.maxAllowed || memoryLimits.maxSampleDialogueLength).toString(),
          },
          color: ColorCode.ERROR,
        });
        continue;
      }

      if (editedUserInput === selectedUserInput.trim() && editedBotInput === selectedBotInput.trim()) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.persona.sample-dialogue.edit.no_changes_title",
          descriptionKey: "commands.persona.sample-dialogue.edit.no_changes_description",
          color: ColorCode.WARN,
        });
        continue;
      }

      const editedKey = makeDialogueKey(editedUserInput, editedBotInput);
      const duplicateExists = currentIn.some(
        (input, index) => index !== selectedIndex && makeDialogueKey(input, currentOut[index] ?? "") === editedKey,
      );
      if (duplicateExists) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.persona.sample-dialogue.edit.duplicate_title",
          descriptionKey: "commands.persona.sample-dialogue.edit.duplicate_description",
          color: ColorCode.WARN,
        });
        continue;
      }

      const editSucceeded = await performSampleDialogueEdit(
        selectedPersona,
        selectedIndex,
        editedUserInput,
        editedBotInput,
        userData,
        editModalInteraction,
        locale,
        true,
      );
      if (!editSucceeded) {
        return;
      }

      await acknowledgeModalSubmitForRefresh(editModalInteraction);
      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.persona.sample-dialogue.edit.success_title",
        "commands.persona.sample-dialogue.edit.success_description",
        ColorCode.SUCCESS,
        {
          input: formatDialoguePreview(editedUserInput),
          output: formatDialoguePreview(editedBotInput),
        },
        "general.pagination.reloading_persona_picker",
      );

      allPersonas = await personaRepository.loadAllForServer(interaction.guild?.id ?? interaction.user.id);
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: selectedPersona?.persona_id ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "persona sample-dialogue edit",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /persona sample-dialogue edit for user ${userData.user_disc_id}`,
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

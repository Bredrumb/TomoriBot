import type {
  ChatInputCommandInteraction,
  Client,
  SlashCommandSubcommandBuilder,
  ModalSubmitInteraction,
} from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import type { UserRow, ErrorContext, TomoriState } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { personaRepository, userRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { SelectOption } from "@/types/discord/modal";
import { getMemoryLimits, validateSampleDialogue } from "@/utils/misc/memoryLimits";

import { dedupeSampleDialoguePairs, parseSampleDialogueBatch, readTxtUpload } from "@/utils/teach/batchUploadUtils";

// Get memory limits from environment variables
const memoryLimits = getMemoryLimits();

// Rule 20: Constants (Modal IDs, Input IDs)
const MODAL_CUSTOM_ID = "teach_sampledialogue_add_modal";
const PERSONA_SELECT_ID = "persona_select";
const USER_INPUT_ID = "user_input";
const BOT_INPUT_ID = "bot_input";
const SAMPLE_DIALOGUE_FILE_UPLOAD_ID = "sampledialogue_file_upload";

// Rule 21: Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("add").setDescription(localizer("en-US", "commands.persona.sample-dialogue.add.description"));

/**
 * Rule 1: JSDoc comment for exported function
 * Adds a sample dialogue pair to Tomori's memory for the server.
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
      flags: MessageFlags.Ephemeral, // User Request
    });
    return;
  }

  let tomoriState: TomoriState | null = null;
  let selectedPersona: TomoriState | null = null;
  let modalSubmitInteraction: ModalSubmitInteraction | null = null;

  try {
    // 2. Check if user has Manage Server permission - used for blacklist and teaching restriction bypass
    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

    // 3. Check blacklisting only for guild contexts
    // Users with Manage Server permission can bypass blacklist (they can unblacklist themselves anyway)
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

    // 4. Load server's Tomori state (Rule 17)
    tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);

    // 5. Check if Tomori is set up and if sample dialogue teaching is enabled
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 6. Resolve target persona options
    const allPersonas = await personaRepository.loadAllForServer(interaction.guild?.id ?? interaction.user.id);
    const personaSelectOptions: SelectOption[] = allPersonas
      .filter((persona) => persona.persona_id !== undefined)
      .map((persona) => ({
        label: safeSelectOptionText(persona.persona_nickname),
        value: persona.persona_id?.toString() ?? "",
        description: persona.is_alter
          ? localizer(locale, "commands.teach.sampledialogue.alter_persona_description")
          : localizer(locale, "commands.teach.sampledialogue.main_persona_description"),
      }))
      .filter((option) => option.value !== "");
    if (personaSelectOptions.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 7. Check if sample dialogue teaching is enabled and if user has bypass permissions
    // Access config directly from tomoriState
    if (!tomoriState.config.sampledialogue_memteaching_enabled && !hasManagePermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.sampledialogue.teaching_disabled_title",
        descriptionKey: "commands.teach.sampledialogue.teaching_disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 8. Prompt user with persona selector + dialogue inputs
    // NOTE: Ensure locale keys resolve to strings <= 45 chars for labels!
    const modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.teach.sampledialogue.modal_title",
      components: [
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.teach.sampledialogue.persona_select_label",
          descriptionKey: "commands.teach.sampledialogue.persona_select_description",
          placeholder: "commands.teach.sampledialogue.persona_select_placeholder",
          required: true,
          options: personaSelectOptions,
        },
        {
          customId: USER_INPUT_ID,
          labelKey: "commands.teach.sampledialogue.user_input_label",
          descriptionKey: "commands.teach.sampledialogue.user_input_description",
          placeholder: "commands.teach.sampledialogue.user_input_placeholder",
          style: TextInputStyle.Paragraph,
          required: false,
          maxLength: memoryLimits.maxSampleDialogueLength,
        },
        {
          customId: BOT_INPUT_ID,
          labelKey: "commands.teach.sampledialogue.bot_input_label",
          descriptionKey: "commands.teach.sampledialogue.bot_input_description",
          placeholder: "commands.teach.sampledialogue.bot_input_placeholder",
          style: TextInputStyle.Paragraph,
          required: false,
          maxLength: memoryLimits.maxSampleDialogueLength,
        },
        {
          customId: SAMPLE_DIALOGUE_FILE_UPLOAD_ID,
          labelKey: "commands.teach.sampledialogue.batch_file_label",
          descriptionKey: "commands.teach.sampledialogue.batch_file_description",
          minValues: 0,
          maxValues: 1,
          required: false,
        },
      ],
    });

    // 10. Handle modal outcome
    if (modalResult.outcome !== "submit") {
      log.info(`Sample dialogue add modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: Modal submit guarantees interaction exists
    modalSubmitInteraction = modalResult.interaction!;

    // Resolve selected persona from modal
    // biome-ignore lint/style/noNonNullAssertion: Modal submit + required=true guarantees value
    const selectedPersonaId = modalResult.values![PERSONA_SELECT_ID];
    selectedPersona = allPersonas.find((persona) => persona.persona_id?.toString() === selectedPersonaId) ?? null;
    if (!selectedPersona?.persona_id) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const typedUserInput = modalResult.values?.[USER_INPUT_ID]?.trim() ?? "";
    const typedBotInput = modalResult.values?.[BOT_INPUT_ID]?.trim() ?? "";
    const uploadedTextFile = modalResult.attachments?.[SAMPLE_DIALOGUE_FILE_UPLOAD_ID];

    const pendingDialogues: Array<{ userInput: string; botInput: string }> = [];

    if (typedUserInput || typedBotInput) {
      if (!typedUserInput || !typedBotInput) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.teach.sampledialogue.no_input_title",
          descriptionKey: "commands.teach.sampledialogue.manual_pair_required_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      pendingDialogues.push({
        userInput: typedUserInput,
        botInput: typedBotInput,
      });
    }

    if (uploadedTextFile) {
      const uploadResult = await readTxtUpload(uploadedTextFile);
      if (!uploadResult.isValid || !uploadResult.text) {
        const errorKey =
          uploadResult.error === "invalid_format"
            ? "commands.teach.sampledialogue.invalid_file_description"
            : uploadResult.error === "file_too_large"
              ? "commands.teach.sampledialogue.file_too_large_description"
              : "commands.teach.sampledialogue.download_failed_description";
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.teach.sampledialogue.invalid_file_title",
          descriptionKey: errorKey,
          descriptionVars: {
            max_size: "1",
          },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const parsedBatch = parseSampleDialogueBatch(uploadResult.text);
      if (!parsedBatch.isValid) {
        const expectedPrefix =
          parsedBatch.error?.code === "invalid_bot_prefix" ? "{bot}: or {{char}}:" : "{user}: or {{user}}:";
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.teach.sampledialogue.invalid_batch_format_title",
          descriptionKey: "commands.teach.sampledialogue.invalid_batch_format_description",
          descriptionVars: {
            line_number: (parsedBatch.error?.lineNumber ?? 1).toString(),
            expected_prefix: expectedPrefix,
          },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      pendingDialogues.push(...parsedBatch.pairs);
    }

    if (pendingDialogues.length === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.teach.sampledialogue.no_input_title",
        descriptionKey: "commands.teach.sampledialogue.no_input_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const dedupedDialogues = dedupeSampleDialoguePairs(pendingDialogues);

    // 11. Validate sample dialogue content lengths (server-side validation, modal maxLength can be bypassed)
    for (const dialogue of dedupedDialogues) {
      const userInputValidation = validateSampleDialogue(dialogue.userInput);
      if (!userInputValidation.isValid) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.teach.sampledialogue.user_input_too_long_title",
          descriptionKey: "commands.teach.sampledialogue.user_input_too_long_description",
          descriptionVars: {
            current_length: dialogue.userInput.length.toString(),
            max_allowed: (userInputValidation.maxAllowed || memoryLimits.maxSampleDialogueLength).toString(),
          },
          color: ColorCode.ERROR,
        });
        return;
      }

      const botInputValidation = validateSampleDialogue(dialogue.botInput);
      if (!botInputValidation.isValid) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.teach.sampledialogue.bot_input_too_long_title",
          descriptionKey: "commands.teach.sampledialogue.bot_input_too_long_description",
          descriptionVars: {
            current_length: dialogue.botInput.length.toString(),
            max_allowed: (botInputValidation.maxAllowed || memoryLimits.maxSampleDialogueLength).toString(),
          },
          color: ColorCode.ERROR,
        });
        return;
      }
    }

    const currentUserDialogues = selectedPersona.sample_dialogues_in || [];
    const currentBotDialogues = selectedPersona.sample_dialogues_out || [];
    const existingDialogues = new Set<string>();
    const existingLength = Math.min(currentUserDialogues.length, currentBotDialogues.length);
    for (let i = 0; i < existingLength; i += 1) {
      existingDialogues.add(
        `${currentUserDialogues[i]?.trim().toLowerCase()}|||${currentBotDialogues[i]?.trim().toLowerCase()}`,
      );
    }

    const dialoguesToAdd = dedupedDialogues.filter((dialogue) => {
      const key = `${dialogue.userInput.toLowerCase()}|||${dialogue.botInput.toLowerCase()}`;
      return !existingDialogues.has(key);
    });

    if (dialoguesToAdd.length === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.teach.sampledialogue.duplicate_title",
        descriptionKey: "commands.teach.sampledialogue.duplicate_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 12. Check sample dialogue limit after persona resolution
    const dialogueLimitCheck = await personaRepository.checkSampleDialogueLimit(selectedPersona.persona_id);
    const currentCount = dialogueLimitCheck.currentCount ?? currentUserDialogues.length;
    const maxAllowed = dialogueLimitCheck.maxAllowed ?? memoryLimits.maxSampleDialogues;
    const availableSlots = Math.max(0, maxAllowed - currentCount);

    if (dialoguesToAdd.length > availableSlots) {
      const removeCount = dialoguesToAdd.length - availableSlots;
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: uploadedTextFile
          ? "commands.teach.sampledialogue.batch_limit_exceeded_title"
          : "commands.teach.sampledialogue.limit_exceeded_title",
        descriptionKey: uploadedTextFile
          ? "commands.teach.sampledialogue.batch_limit_exceeded_description"
          : "commands.teach.sampledialogue.limit_exceeded_description",
        descriptionVars: uploadedTextFile
          ? {
              current_count: currentCount.toString(),
              max_allowed: maxAllowed.toString(),
              import_count: dialoguesToAdd.length.toString(),
              remove_count: removeCount.toString(),
            }
          : {
              current_count: currentCount.toString(),
              max_allowed: maxAllowed.toString(),
            },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 13. Update target persona row in the database using paired atomic array operations
    const added = await personaRepository.addSampleDialoguePair(
      selectedPersona.persona_id,
      dialoguesToAdd.map((dialogue) => dialogue.userInput),
      dialoguesToAdd.map((dialogue) => dialogue.botInput),
    );

    if (!added) {
      // Rule 22: Log error with context (Access IDs directly)
      const context: ErrorContext = {
        userId: userData.user_id,
        serverId: tomoriState.server_id, // Direct access
        personaId: selectedPersona.persona_id,
        errorType: "DatabaseValidationError",
        metadata: {
          command: "teach sampledialogue",
          userDiscordId: interaction.user.id,
        },
      };
      await log.error("Failed to add sample dialogue pair(s)", new Error("Database update returned no rows"), context);

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 14. Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    // 15. Success! Confirm addition (Rule 12, 19)
    const firstDialogue = dialoguesToAdd[0] ?? {
      userInput: "",
      botInput: "",
    };
    const userPreview =
      firstDialogue.userInput.length > 96 ? `${firstDialogue.userInput.slice(0, 96)}...` : firstDialogue.userInput;
    const botPreview =
      firstDialogue.botInput.length > 96 ? `${firstDialogue.botInput.slice(0, 96)}...` : firstDialogue.botInput;

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey:
        dialoguesToAdd.length > 1 || uploadedTextFile
          ? "commands.teach.sampledialogue.batch_success_title"
          : "commands.teach.sampledialogue.success_title",
      descriptionKey:
        dialoguesToAdd.length > 1 || uploadedTextFile
          ? "commands.teach.sampledialogue.batch_success_description"
          : "commands.teach.sampledialogue.success_description",
      descriptionVars:
        dialoguesToAdd.length > 1 || uploadedTextFile
          ? {
              added_count: dialoguesToAdd.length.toString(),
            }
          : {
              user_input: userPreview,
              bot_input: botPreview,
            },
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    // Rule 22: Log error with context
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: selectedPersona?.persona_id ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "teach sampledialogue",
        userDiscordId: interaction.user.id,
        guildId: interaction.guild?.id,
      },
    };
    await log.error("Error in /teach sampledialogue command", error, context);

    const errorReplyInteraction =
      modalSubmitInteraction ?? (interaction.replied || interaction.deferred ? interaction : null);
    if (errorReplyInteraction) {
      await replyInfoEmbed(errorReplyInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      log.warn(
        "Interaction was not replied or deferred in sampledialogue, cannot send error message to user.",
        context,
      );
    }
  }
}

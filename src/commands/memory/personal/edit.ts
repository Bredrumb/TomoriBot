import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import { sql } from "@/utils/db/client";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  acknowledgeModalSubmitForRefresh,
  promptWithPaginatedModal,
  promptWithRawModal,
  promptWithUnacknowledgedConfirmation,
  replyComponentsV2Status,
  replyInfoEmbed,
  type AvatarSessionCache,
  replyPaginatedPersonaChoicesV2,
  safeSelectOptionText,
  updateButtonComponentsV2Status,
} from "@/utils/discord/interactionHelper";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import {
  isBlacklisted,
  loadAllPersonasForServer,
  loadPersonalMemoriesForUserLineage,
  loadTomoriState,
  getPrivacyLevel,
} from "@/utils/db/dbRead";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { getMemoryLimits, validateMemoryContent } from "@/utils/db/memoryLimits";
import type { SelectOption } from "@/types/discord/modal";
import {
  personalMemorySchema,
  PrivacyLevel,
  type ErrorContext,
  type PersonalMemoryRow,
  type TomoriState,
  type UserRow,
} from "@/types/db/schema";

const SELECT_MODAL_CUSTOM_ID = "memory_personal_edit_select_modal";
const EDIT_MODAL_CUSTOM_ID = "memory_personal_edit_value_modal";
const MEMORY_SELECT_ID = "memory_select";
const MEMORY_INPUT_ID = "personal_memory_input";
const MEMORY_TAGS_INPUT_ID = "personal_memory_tags_input";
const PERSONAL_SCOPE_VALUE = "persona";
const GLOBAL_SCOPE_VALUE = "global";
const GLOBAL_PERSONAL_MEMORY_LINEAGE_ID = 0;

const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 32;

const memoryLimits = getMemoryLimits();

function formatMemoryPreview(memory: string, maxLength = 120): string {
  return memory.length > maxLength ? `${memory.slice(0, maxLength)}...` : memory;
}

async function performPersonalMemoryEdit(
  memoryToEdit: PersonalMemoryRow,
  newContent: string,
  newTags: string[],
  userData: UserRow,
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  const [updatedMemory] = await sql`
    UPDATE personal_memories
    SET content = ${newContent}, tags = ${sql.array(newTags)}
    WHERE personal_memory_id = ${memoryToEdit.personal_memory_id}
      AND user_id = ${userData.user_id}
    RETURNING *
  `;

  const validationResult = personalMemorySchema.safeParse(updatedMemory);
  if (!validationResult.success || !updatedMemory) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: null,
      tomoriId: null,
      errorType: "DatabaseUpdateError",
      metadata: {
        command: "memory personal edit",
        table: "personal_memories",
        operation: "UPDATE",
        personalMemoryId: memoryToEdit.personal_memory_id,
        validationErrors: validationResult.success ? null : validationResult.error.flatten(),
      },
    };

    await log.error(
      "Failed to update or validate personal memory",
      validationResult.success
        ? new Error("Database update returned no rows or unexpected data")
        : new Error("Updated personal memory failed validation"),
      context,
    );

    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  invalidateUserCache(userData.user_disc_id);

  log.success(
    `Updated personal memory ${memoryToEdit.personal_memory_id} for user ${userData.user_disc_id}: "${formatMemoryPreview(newContent, 60)}"`,
  );

  if (!suppressSuccessReply) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.memory.personal.edit.success_title",
      descriptionKey: "commands.memory.personal.edit.success_description",
      descriptionVars: {
        memory: formatMemoryPreview(newContent, 96),
      },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("edit")
    .setDescription(localizer("en-US", "commands.memory.personal.edit.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.memory.personal.edit.scope_description"))
        .setRequired(false)
        .addChoices(
          {
            name: localizer("en-US", "commands.memory.personal.edit.scope_choice_persona"),
            value: PERSONAL_SCOPE_VALUE,
          },
          {
            name: localizer("en-US", "commands.memory.personal.edit.scope_choice_global"),
            value: GLOBAL_SCOPE_VALUE,
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
  let selectedPersona: TomoriState | null = null;
  let personaSelectionInteraction: ButtonInteraction | null = null;
  let personalizationDisabledWarning = false;

  try {
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    tomoriState = await loadTomoriState(serverDiscId);
    const memoryScope =
      (interaction.options.getString("scope") as typeof PERSONAL_SCOPE_VALUE | typeof GLOBAL_SCOPE_VALUE | null) ??
      PERSONAL_SCOPE_VALUE;

    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!tomoriState.config.personal_memories_enabled) {
      personalizationDisabledWarning = true;
    }

    const userPrivacyLevel = await getPrivacyLevel(interaction.user.id);
    if (userPrivacyLevel === PrivacyLevel.FULL) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.memory.personal.opted_out_error_title",
        descriptionKey: "commands.teach.memory.personal.opted_out_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (memoryScope === PERSONAL_SCOPE_VALUE) {
      const allPersonas = await loadAllPersonasForServer(serverDiscId);
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
          if (personaSelection.reason === "cancelled" || personaSelection.reason === "fatal") return;
          continue;
        }
        if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
          return;
        }

        personaSelectionInteraction = personaSelection.interaction;
        selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
        if (!selectedPersona) {
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

        const targetLineageId = selectedPersona.persona_lineage_id ?? 0;
        if (targetLineageId === GLOBAL_PERSONAL_MEMORY_LINEAGE_ID) {
          await updateButtonComponentsV2Status(
            personaSelectionInteraction,
            locale,
            "general.errors.operation_failed_title",
            "general.errors.operation_failed_description",
            ColorCode.ERROR,
            undefined,
            "general.pagination.reloading_persona_picker",
          );
          continue;
        }

        const currentMemories = userData.user_id
          ? (await loadPersonalMemoriesForUserLineage(userData.user_id, targetLineageId, false)).filter(
              (memory) => memory.persona_lineage_id === targetLineageId,
            )
          : [];

        if (currentMemories.length === 0) {
          await updateButtonComponentsV2Status(
            personaSelectionInteraction,
            locale,
            "commands.forget.memory.personal.no_memories_title",
            "commands.forget.memory.personal.no_memories",
            ColorCode.WARN,
            undefined,
            "general.pagination.reloading_persona_picker",
          );
          continue;
        }

        const memorySelectOptions: SelectOption[] = currentMemories.map((memory, index) => ({
          label: safeSelectOptionText(memory.content, 20),
          value: index.toString(),
          description: safeSelectOptionText(memory.content),
        }));

        const selectModalResult = await promptWithPaginatedModal(personaSelectionInteraction, locale, {
          modalCustomId: SELECT_MODAL_CUSTOM_ID,
          modalTitleKey: "commands.memory.personal.edit.select_modal_title",
          components: [
            {
              customId: MEMORY_SELECT_ID,
              labelKey: "commands.memory.personal.edit.select_label",
              descriptionKey: "commands.memory.personal.edit.select_description",
              placeholder: "commands.memory.personal.edit.select_placeholder",
              required: true,
              options: memorySelectOptions,
            },
          ],
        });

        if (selectModalResult.outcome !== "submit") {
          log.info(`Personal memory edit selection modal ${selectModalResult.outcome} for user ${userData.user_id}`);
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
        const selectedIndex = selectModalResult.values?.[MEMORY_SELECT_ID];
        if (!selectModalInteraction || !selectedIndex) {
          log.error("Personal memory edit selection unexpectedly missing interaction or values");
          return;
        }

        const selectedMemory = currentMemories[Number.parseInt(selectedIndex, 10)];
        if (!selectedMemory) {
          await replyInfoEmbed(selectModalInteraction, locale, {
            titleKey: "general.errors.operation_failed_title",
            descriptionKey: "commands.forget.memory.personal.no_memories",
            color: ColorCode.ERROR,
          });
          return;
        }

        await acknowledgeModalSubmitForRefresh(selectModalInteraction);

        const confirmationResult = await promptWithUnacknowledgedConfirmation(interaction, locale, {
          embedTitleKey: "commands.memory.personal.edit.confirm_title",
          embedDescriptionKey: "commands.memory.personal.edit.confirm_description",
          embedDescriptionVars: {
            memory: selectedMemory.content,
          },
          embedColor: ColorCode.INFO,
          useComponentsV2: true,
          continueLabelKey: "general.confirm",
          cancelLabelKey: "general.pagination.cancel",
          continueCustomId: `memory_personal_edit_confirm_${selectModalInteraction.id}`,
          cancelCustomId: `memory_personal_edit_cancel_${selectModalInteraction.id}`,
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

        const editModalResult = await promptWithRawModal(confirmationResult.interaction, locale, {
          modalCustomId: EDIT_MODAL_CUSTOM_ID,
          modalTitleKey: "commands.memory.personal.edit.modal_title",
          components: [
            {
              customId: MEMORY_INPUT_ID,
              labelKey: "commands.memory.personal.edit.memory_input_label",
              descriptionKey: "commands.memory.personal.edit.memory_input_description",
              placeholder: "commands.memory.personal.edit.memory_input_placeholder",
              style: TextInputStyle.Paragraph,
              required: true,
              maxLength: memoryLimits.maxMemoryLength,
              value: selectedMemory.content,
            },
            {
              customId: MEMORY_TAGS_INPUT_ID,
              labelKey: "Memory Tags",
              descriptionKey:
                "Up to 5 comma-separated case-sensitive tags, use '/memory tagging set' to enable tagged memory",
              placeholder: "mango,drinks,snacks",
              style: TextInputStyle.Short,
              required: false,
              maxLength: MAX_TAGS * (MAX_TAG_LENGTH + 2),
              value: (selectedMemory.tags ?? []).join(", "),
            },
          ],
        });

        if (editModalResult.outcome !== "submit") {
          log.info(`Personal memory edit modal ${editModalResult.outcome} for user ${userData.user_id}`);
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
        const editedMemory = editModalResult.values?.[MEMORY_INPUT_ID]?.trim() ?? "";
        const rawTagsInput = editModalResult.values?.[MEMORY_TAGS_INPUT_ID]?.trim() ?? "";
        const editedTags = rawTagsInput
          ? [
              ...new Set(
                rawTagsInput
                  .split(",")
                  .map((t) => t.trim().replace(/^["']+|["']+$/g, ""))
                  .filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH),
              ),
            ].slice(0, MAX_TAGS)
          : [];
        if (!editModalInteraction) {
          log.error("Personal memory edit modal unexpectedly missing interaction");
          return;
        }

        const contentValidation = validateMemoryContent(editedMemory);
        if (!contentValidation.isValid) {
          await replyInfoEmbed(editModalInteraction, locale, {
            titleKey: "commands.teach.memory.personal.content_too_long_title",
            descriptionKey: "commands.teach.memory.personal.content_too_long_description",
            descriptionVars: {
              max_length: (contentValidation.maxAllowed || memoryLimits.maxMemoryLength).toString(),
            },
            color: ColorCode.ERROR,
          });
          continue;
        }

        const existingTags = selectedMemory.tags ?? [];
        const tagsUnchanged =
          editedTags.length === existingTags.length && editedTags.every((t, i) => t === existingTags[i]);
        if (editedMemory === selectedMemory.content.trim() && tagsUnchanged) {
          await replyInfoEmbed(editModalInteraction, locale, {
            titleKey: "commands.memory.personal.edit.no_changes_title",
            descriptionKey: "commands.memory.personal.edit.no_changes_description",
            color: ColorCode.WARN,
          });
          continue;
        }

        const duplicateExists = currentMemories.some(
          (memory) =>
            memory.personal_memory_id !== selectedMemory.personal_memory_id &&
            memory.content.trim().toLowerCase() === editedMemory.toLowerCase(),
        );
        if (duplicateExists) {
          await replyInfoEmbed(editModalInteraction, locale, {
            titleKey: "commands.memory.personal.edit.duplicate_title",
            descriptionKey: "commands.memory.personal.edit.duplicate_description",
            descriptionVars: {
              memory: formatMemoryPreview(editedMemory, 96),
            },
            color: ColorCode.WARN,
          });
          continue;
        }

        const editSucceeded = await performPersonalMemoryEdit(
          selectedMemory,
          editedMemory,
          editedTags,
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
          "commands.memory.personal.edit.success_title",
          "commands.memory.personal.edit.success_description",
          ColorCode.SUCCESS,
          {
            memory: formatMemoryPreview(editedMemory, 96),
          },
          "general.pagination.reloading_persona_picker",
        );

        if (personalizationDisabledWarning) {
          await editModalInteraction.followUp({
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
    }

    const userIsBlacklisted = interaction.guild
      ? ((await isBlacklisted(interaction.guild.id, interaction.user.id)) ?? false)
      : false;

    const globalMemories = userData.user_id
      ? await loadPersonalMemoriesForUserLineage(userData.user_id, GLOBAL_PERSONAL_MEMORY_LINEAGE_ID, false)
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

    const selectModalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: SELECT_MODAL_CUSTOM_ID,
      modalTitleKey: "commands.memory.personal.edit.select_modal_title",
      components: [
        {
          customId: MEMORY_SELECT_ID,
          labelKey: "commands.memory.personal.edit.select_label",
          descriptionKey: "commands.memory.personal.edit.select_description",
          placeholder: "commands.memory.personal.edit.select_placeholder",
          required: true,
          options: memorySelectOptions,
        },
      ],
    });

    if (selectModalResult.outcome !== "submit") {
      log.info(`Global personal memory edit selection modal ${selectModalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    const selectModalInteraction = selectModalResult.interaction;
    const selectedIndex = selectModalResult.values?.[MEMORY_SELECT_ID];
    if (!selectModalInteraction || !selectedIndex) {
      log.error("Global personal memory edit selection unexpectedly missing interaction or values");
      return;
    }

    const selectedMemory = globalMemories[Number.parseInt(selectedIndex, 10)];
    if (!selectedMemory) {
      await replyInfoEmbed(selectModalInteraction, locale, {
        titleKey: "general.errors.operation_failed_title",
        descriptionKey: "commands.forget.memory.personal.no_memories",
        color: ColorCode.ERROR,
      });
      return;
    }

    const confirmationResult = await promptWithUnacknowledgedConfirmation(selectModalInteraction, locale, {
      embedTitleKey: "commands.memory.personal.edit.confirm_title",
      embedDescriptionKey: "commands.memory.personal.edit.confirm_description",
      embedDescriptionVars: {
        memory: selectedMemory.content,
      },
      embedColor: ColorCode.INFO,
      continueLabelKey: "general.confirm",
      cancelLabelKey: "general.pagination.cancel",
      continueCustomId: `memory_personal_edit_confirm_${selectModalInteraction.id}`,
      cancelCustomId: `memory_personal_edit_cancel_${selectModalInteraction.id}`,
    });

    if (confirmationResult.outcome !== "continue" || !confirmationResult.interaction) {
      return;
    }

    const editModalResult = await promptWithRawModal(confirmationResult.interaction, locale, {
      modalCustomId: EDIT_MODAL_CUSTOM_ID,
      modalTitleKey: "commands.memory.personal.edit.modal_title",
      components: [
        {
          customId: MEMORY_INPUT_ID,
          labelKey: "commands.memory.personal.edit.memory_input_label",
          descriptionKey: "commands.memory.personal.edit.memory_input_description",
          placeholder: "commands.memory.personal.edit.memory_input_placeholder",
          style: TextInputStyle.Paragraph,
          required: true,
          maxLength: memoryLimits.maxMemoryLength,
          value: selectedMemory.content,
        },
        {
          customId: MEMORY_TAGS_INPUT_ID,
          labelKey: "Memory Tags",
          descriptionKey:
            "Up to 5 comma-separated case-sensitive tags, use '/memory tagging set' to enable tagged memory",
          placeholder: "mango,drinks,snacks",
          style: TextInputStyle.Short,
          required: false,
          maxLength: MAX_TAGS * (MAX_TAG_LENGTH + 2),
          value: (selectedMemory.tags ?? []).join(", "),
        },
      ],
    });

    if (editModalResult.outcome !== "submit") {
      log.info(`Global personal memory edit modal ${editModalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    const editModalInteraction = editModalResult.interaction;
    const editedMemory = editModalResult.values?.[MEMORY_INPUT_ID]?.trim() ?? "";
    const rawTagsInput = editModalResult.values?.[MEMORY_TAGS_INPUT_ID]?.trim() ?? "";
    const editedTags = rawTagsInput
      ? [
          ...new Set(
            rawTagsInput
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH),
          ),
        ].slice(0, MAX_TAGS)
      : [];
    if (!editModalInteraction) {
      log.error("Global personal memory edit modal unexpectedly missing interaction");
      return;
    }

    const contentValidation = validateMemoryContent(editedMemory);
    if (!contentValidation.isValid) {
      await replyInfoEmbed(editModalInteraction, locale, {
        titleKey: "commands.teach.memory.personal.content_too_long_title",
        descriptionKey: "commands.teach.memory.personal.content_too_long_description",
        descriptionVars: {
          max_length: (contentValidation.maxAllowed || memoryLimits.maxMemoryLength).toString(),
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    const globalExistingTags = selectedMemory.tags ?? [];
    const globalTagsUnchanged =
      editedTags.length === globalExistingTags.length && editedTags.every((t, i) => t === globalExistingTags[i]);
    if (editedMemory === selectedMemory.content.trim() && globalTagsUnchanged) {
      await replyInfoEmbed(editModalInteraction, locale, {
        titleKey: "commands.memory.personal.edit.no_changes_title",
        descriptionKey: "commands.memory.personal.edit.no_changes_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const duplicateExists = globalMemories.some(
      (memory) =>
        memory.personal_memory_id !== selectedMemory.personal_memory_id &&
        memory.content.trim().toLowerCase() === editedMemory.toLowerCase(),
    );
    if (duplicateExists) {
      await replyInfoEmbed(editModalInteraction, locale, {
        titleKey: "commands.memory.personal.edit.duplicate_title",
        descriptionKey: "commands.memory.personal.edit.duplicate_description",
        descriptionVars: {
          memory: formatMemoryPreview(editedMemory, 96),
        },
        color: ColorCode.WARN,
      });
      return;
    }

    const editSucceeded = await performPersonalMemoryEdit(
      selectedMemory,
      editedMemory,
      editedTags,
      userData,
      editModalInteraction,
      locale,
      true,
    );
    if (!editSucceeded) {
      return;
    }

    // deferUpdate on the edit modal submit targets the button's message (the confirmation),
    // so editReply in replyInfoEmbed will update that same ephemeral message in-place.
    await acknowledgeModalSubmitForRefresh(editModalInteraction);
    await replyInfoEmbed(editModalInteraction, locale, {
      titleKey: "commands.memory.personal.edit.success_title",
      descriptionKey: "commands.memory.personal.edit.success_description",
      descriptionVars: {
        memory: formatMemoryPreview(editedMemory, 96),
      },
      color: ColorCode.SUCCESS,
    });

    if (personalizationDisabledWarning) {
      await editModalInteraction.followUp({
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

    if (userIsBlacklisted) {
      log.info(
        `User ${interaction.user.id} edited a global personal memory while blacklisted in server ${interaction.guild?.id ?? "dm"}`,
      );
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      tomoriId: selectedPersona?.tomori_id ?? tomoriState?.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "memory personal edit",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /memory personal edit for user ${userData.user_disc_id}`,
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

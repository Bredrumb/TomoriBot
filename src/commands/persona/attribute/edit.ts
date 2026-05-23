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
import { getMemoryLimits, validateAttribute } from "@/utils/misc/memoryLimits";
import { splitPromptIntoModalParts, combineModalPromptParts } from "@/utils/text/modalPromptParts";
import type { SelectOption } from "@/types/discord/modal";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";

const SELECT_MODAL_CUSTOM_ID = "persona_attribute_edit_select_modal";
const EDIT_MODAL_CUSTOM_ID = "persona_attribute_edit_value_modal";
const ATTRIBUTE_SELECT_ID = "attribute_select";
const ATTRIBUTE_PART1_ID = "attribute_part1";
const ATTRIBUTE_PART2_ID = "attribute_part2";
const ATTRIBUTE_PART_MAX_LENGTH = 4000; // Discord text input character limit

const memoryLimits = getMemoryLimits();

function formatAttributePreview(attribute: string, maxLength = 120): string {
  return attribute.length > maxLength ? `${attribute.slice(0, maxLength)}...` : attribute;
}

async function performAttributeEdit(
  selectedPersona: TomoriState,
  selectedIndex: number,
  newAttribute: string,
  userData: UserRow,
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  if (selectedPersona.persona_id === undefined) {
    await log.error("Cannot edit attribute for persona without persona_id");
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  const pgIndex = selectedIndex + 1;
  const updated = await personaRepository.editAttributeAt(selectedPersona.persona_id, pgIndex, newAttribute);

  if (!updated) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: selectedPersona.server_id,
      personaId: selectedPersona.persona_id,
      errorType: "DatabaseUpdateError",
      metadata: {
        command: "persona attribute edit",
        selectedIndex,
      },
    };

    await log.error("Failed to update persona attribute list", new Error("Database update returned no rows"), context);

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
    `Updated attribute ${selectedIndex} for tomori ${selectedPersona.persona_id} by ${userData.user_disc_id}: "${formatAttributePreview(newAttribute, 60)}"`,
  );

  if (!suppressSuccessReply) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.persona.attribute.edit.success_title",
      descriptionKey: "commands.persona.attribute.edit.success_description",
      descriptionVars: {
        attribute: formatAttributePreview(newAttribute, 96),
      },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("edit").setDescription(localizer("en-US", "commands.persona.attribute.edit.description"));

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

      if (!tomoriState.config.attribute_memteaching_enabled && !hasManagePermission) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.teach.attribute.teaching_disabled_title",
          descriptionKey: "commands.teach.attribute.teaching_disabled_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const currentAttributes = selectedPersona.attribute_list ?? [];
      if (currentAttributes.length === 0) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "commands.forget.attribute.no_attributes_title",
          "commands.forget.attribute.no_attributes",
          ColorCode.WARN,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      const attributeSelectOptions: SelectOption[] = currentAttributes.map((attribute, index) => ({
        label: safeSelectOptionText(attribute),
        value: index.toString(),
      }));

      const selectModalResult = await promptWithPaginatedModal(personaSelectionInteraction, locale, {
        modalCustomId: SELECT_MODAL_CUSTOM_ID,
        modalTitleKey: "commands.persona.attribute.edit.select_modal_title",
        components: [
          {
            customId: ATTRIBUTE_SELECT_ID,
            labelKey: "commands.persona.attribute.edit.select_label",
            descriptionKey: "commands.persona.attribute.edit.select_description",
            placeholder: "commands.persona.attribute.edit.select_placeholder",
            required: true,
            options: attributeSelectOptions,
          },
        ],
      });

      if (selectModalResult.outcome !== "submit") {
        log.info(`Attribute edit selection modal ${selectModalResult.outcome} for user ${userData.user_id}`);
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
      const selectedIndexRaw = selectModalResult.values?.[ATTRIBUTE_SELECT_ID];
      if (!selectModalInteraction || !selectedIndexRaw) {
        log.error("Attribute edit selection unexpectedly missing interaction or values");
        return;
      }

      const selectedIndex = Number.parseInt(selectedIndexRaw, 10);
      const selectedAttribute = currentAttributes[selectedIndex];
      if (!selectedAttribute) {
        await replyInfoEmbed(selectModalInteraction, locale, {
          titleKey: "general.errors.operation_failed_title",
          descriptionKey: "general.errors.operation_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      await acknowledgeModalSubmitForRefresh(selectModalInteraction);

      const confirmationResult = await promptWithUnacknowledgedConfirmation(interaction, locale, {
        embedTitleKey: "commands.persona.attribute.edit.confirm_title",
        embedDescriptionKey: "commands.persona.attribute.edit.confirm_description",
        embedDescriptionVars: {
          attribute: formatAttributePreview(selectedAttribute, 3000)
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n"),
        },
        embedColor: ColorCode.INFO,
        useComponentsV2: true,
        continueLabelKey: "general.confirm",
        cancelLabelKey: "general.pagination.cancel",
        continueCustomId: `persona_attribute_edit_confirm_${selectModalInteraction.id}`,
        cancelCustomId: `persona_attribute_edit_cancel_${selectModalInteraction.id}`,
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

      const attributeParts = splitPromptIntoModalParts(selectedAttribute, 2, ATTRIBUTE_PART_MAX_LENGTH);

      const editModalResult = await promptWithRawModal(confirmationResult.interaction, locale, {
        modalCustomId: EDIT_MODAL_CUSTOM_ID,
        modalTitleKey: "commands.persona.attribute.edit.modal_title",
        components: [
          {
            customId: ATTRIBUTE_PART1_ID,
            labelKey: "commands.persona.attribute.edit.attribute_input_label",
            descriptionKey: "commands.persona.attribute.edit.attribute_input_description",
            placeholder: "commands.persona.attribute.edit.attribute_input_placeholder",
            style: TextInputStyle.Paragraph,
            required: true,
            maxLength: ATTRIBUTE_PART_MAX_LENGTH,
            value: attributeParts[0] || undefined,
          },
          {
            customId: ATTRIBUTE_PART2_ID,
            labelKey: "commands.persona.attribute.edit.attribute_input_part2_label",
            style: TextInputStyle.Paragraph,
            required: false,
            maxLength: ATTRIBUTE_PART_MAX_LENGTH,
            value: attributeParts[1] || undefined,
          },
        ],
      });

      if (editModalResult.outcome !== "submit") {
        log.info(`Attribute edit modal ${editModalResult.outcome} for user ${userData.user_id}`);
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
      const editedPart1 = editModalResult.values?.[ATTRIBUTE_PART1_ID]?.trim() ?? "";
      const editedPart2 = editModalResult.values?.[ATTRIBUTE_PART2_ID]?.trim() ?? "";
      const editedAttribute = combineModalPromptParts([editedPart1, editedPart2], ATTRIBUTE_PART_MAX_LENGTH);
      if (!editModalInteraction) {
        log.error("Attribute edit modal unexpectedly missing interaction");
        return;
      }

      const attributeValidation = validateAttribute(editedAttribute);
      if (!attributeValidation.isValid) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.teach.attribute.content_too_long_title",
          descriptionKey: "commands.teach.attribute.content_too_long_description",
          descriptionVars: {
            current_length: editedAttribute.length.toString(),
            max_allowed: (attributeValidation.maxAllowed || memoryLimits.maxAttributeLength).toString(),
          },
          color: ColorCode.ERROR,
        });
        continue;
      }

      if (editedAttribute === selectedAttribute.trim()) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.persona.attribute.edit.no_changes_title",
          descriptionKey: "commands.persona.attribute.edit.no_changes_description",
          color: ColorCode.WARN,
        });
        continue;
      }

      const duplicateExists = currentAttributes.some(
        (attribute, index) =>
          index !== selectedIndex && attribute.trim().toLowerCase() === editedAttribute.toLowerCase(),
      );
      if (duplicateExists) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.persona.attribute.edit.duplicate_title",
          descriptionKey: "commands.persona.attribute.edit.duplicate_description",
          descriptionVars: {
            attribute: formatAttributePreview(editedAttribute, 96),
          },
          color: ColorCode.WARN,
        });
        continue;
      }

      const editSucceeded = await performAttributeEdit(
        selectedPersona,
        selectedIndex,
        editedAttribute,
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
        "commands.persona.attribute.edit.success_title",
        "commands.persona.attribute.edit.success_description",
        ColorCode.SUCCESS,
        {
          attribute: formatAttributePreview(editedAttribute, 96),
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
        command: "persona attribute edit",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /persona attribute edit for user ${userData.user_disc_id}`,
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

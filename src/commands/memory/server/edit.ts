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
import { getMemoryLimits, validateMemoryContent } from "@/utils/misc/memoryLimits";
import { serverMemoryRepository } from "@/utils/db/repositories";
import type { SelectOption } from "@/types/discord/modal";
import type { ErrorContext, ServerMemoryRow, TomoriState, UserRow } from "@/types/db/schema";

const SELECT_MODAL_CUSTOM_ID = "memory_server_edit_select_modal";
const EDIT_MODAL_CUSTOM_ID = "memory_server_edit_value_modal";
const MEMORY_SELECT_ID = "memory_select";
const MEMORY_INPUT_ID = "server_memory_input";
const MEMORY_TAGS_INPUT_ID = "server_memory_tags_input";

const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 32;

const memoryLimits = getMemoryLimits();

function formatMemoryPreview(memory: string, maxLength = 120): string {
  return memory.length > maxLength ? `${memory.slice(0, maxLength)}...` : memory;
}

async function performServerMemoryEdit(
  selectedPersona: TomoriState,
  memoryToEdit: ServerMemoryRow,
  newContent: string,
  newTags: string[],
  userData: UserRow,
  hasManagePermission: boolean,
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  // Check permission: user must be owner or have manage permission
  // biome-ignore lint/style/noNonNullAssertion: userData.user_id is always provided by command framework
  if (!hasManagePermission && memoryToEdit.user_id !== userData.user_id!) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  if (!memoryToEdit.server_memory_id) {
    log.error(`performServerMemoryEdit called with memory row missing server_memory_id`);
    return false;
  }
  const ok = await serverMemoryRepository.edit(memoryToEdit.server_memory_id, newContent, newTags ?? []);
  if (!ok) {
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
    `Updated server memory ${memoryToEdit.server_memory_id} in server ${selectedPersona.server_id} by ${userData.user_disc_id}: "${formatMemoryPreview(newContent, 60)}"`,
  );

  if (!suppressSuccessReply) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.memory.server.edit.success_title",
      descriptionKey: "commands.memory.server.edit.success_description",
      descriptionVars: {
        memory: formatMemoryPreview(newContent, 96),
      },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("edit").setDescription(localizer("en-US", "commands.memory.server.edit.description"));

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

    const allPersonas = await personaRepository.loadAllForServer(interaction.guild?.id ?? interaction.user.id);
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

      if (!tomoriState.config.server_memteaching_enabled && !hasManagePermission) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.teach.memory.server.teaching_disabled_title",
          descriptionKey: "commands.teach.memory.server.teaching_disabled_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const targetPersonaLineageId = selectedPersona.persona_lineage_id ?? 0;
      const memories = await serverMemoryRepository.loadServerMemoriesScoped(
        tomoriState.server_id,
        targetPersonaLineageId,
        hasManagePermission ? undefined : userData.user_id,
      );

      if (memories.length === 0) {
        const descriptionKey = hasManagePermission
          ? "commands.forget.memory.server.no_memories"
          : "commands.forget.memory.server.no_owned_memories";
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "commands.forget.memory.server.no_memories_title",
          descriptionKey,
          ColorCode.WARN,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      const memorySelectOptions: SelectOption[] = memories.map((memory, index) => ({
        label: safeSelectOptionText(memory.content, 20),
        value: index.toString(),
        description: safeSelectOptionText(memory.content),
      }));

      const selectModalResult = await promptWithPaginatedModal(personaSelectionInteraction, locale, {
        modalCustomId: SELECT_MODAL_CUSTOM_ID,
        modalTitleKey: "commands.memory.server.edit.select_modal_title",
        components: [
          {
            customId: MEMORY_SELECT_ID,
            labelKey: "commands.memory.server.edit.select_label",
            descriptionKey: "commands.memory.server.edit.select_description",
            placeholder: "commands.memory.server.edit.select_placeholder",
            required: true,
            options: memorySelectOptions,
          },
        ],
      });

      if (selectModalResult.outcome !== "submit") {
        log.info(`Server memory edit selection modal ${selectModalResult.outcome} for user ${userData.user_id}`);
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
        log.error("Server memory edit selection unexpectedly missing interaction or values");
        return;
      }

      const selectedMemory = memories[Number.parseInt(selectedIndex, 10)];
      if (!selectedMemory) {
        await replyInfoEmbed(selectModalInteraction, locale, {
          titleKey: "general.errors.operation_failed_title",
          descriptionKey: "commands.forget.memory.server.memory_not_found",
          color: ColorCode.ERROR,
        });
        return;
      }

      await acknowledgeModalSubmitForRefresh(selectModalInteraction);

      const confirmationResult = await promptWithUnacknowledgedConfirmation(interaction, locale, {
        embedTitleKey: "commands.memory.server.edit.confirm_title",
        embedDescriptionKey: "commands.memory.server.edit.confirm_description",
        embedDescriptionVars: {
          memory: selectedMemory.content,
        },
        embedColor: ColorCode.INFO,
        useComponentsV2: true,
        continueLabelKey: "general.confirm",
        cancelLabelKey: "general.pagination.cancel",
        continueCustomId: `memory_server_edit_confirm_${selectModalInteraction.id}`,
        cancelCustomId: `memory_server_edit_cancel_${selectModalInteraction.id}`,
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
        modalTitleKey: "commands.memory.server.edit.modal_title",
        components: [
          {
            customId: MEMORY_INPUT_ID,
            labelKey: "commands.memory.server.edit.memory_input_label",
            descriptionKey: "commands.memory.server.edit.memory_input_description",
            placeholder: "commands.memory.server.edit.memory_input_placeholder",
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
        log.info(`Server memory edit modal ${editModalResult.outcome} for user ${userData.user_id}`);
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
        log.error("Server memory edit modal unexpectedly missing interaction");
        return;
      }

      const contentValidation = validateMemoryContent(editedMemory);
      if (!contentValidation.isValid) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.teach.memory.server.content_too_long_title",
          descriptionKey: "commands.teach.memory.server.content_too_long_description",
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
          titleKey: "commands.memory.server.edit.no_changes_title",
          descriptionKey: "commands.memory.server.edit.no_changes_description",
          color: ColorCode.WARN,
        });
        continue;
      }

      const duplicateExists = memories.some(
        (memory) =>
          memory.server_memory_id !== selectedMemory.server_memory_id &&
          memory.content.trim().toLowerCase() === editedMemory.toLowerCase(),
      );
      if (duplicateExists) {
        await replyInfoEmbed(editModalInteraction, locale, {
          titleKey: "commands.memory.server.edit.duplicate_title",
          descriptionKey: "commands.memory.server.edit.duplicate_description",
          descriptionVars: {
            memory: formatMemoryPreview(editedMemory, 96),
          },
          color: ColorCode.WARN,
        });
        continue;
      }

      const editSucceeded = await performServerMemoryEdit(
        selectedPersona,
        selectedMemory,
        editedMemory,
        editedTags,
        userData,
        hasManagePermission,
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
        "commands.memory.server.edit.success_title",
        "commands.memory.server.edit.success_description",
        ColorCode.SUCCESS,
        {
          memory: formatMemoryPreview(editedMemory, 96),
        },
        "general.pagination.reloading_persona_picker",
      );
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      personaId: selectedPersona?.persona_id ?? tomoriState?.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "memory server edit",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /memory server edit for user ${userData.user_disc_id}`,
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

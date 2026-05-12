import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  acknowledgeModalSubmitForRefresh,
  replyInfoEmbed,
  replyComponentsV2Status,
  updateButtonComponentsV2Status,
  type AvatarSessionCache,
  replyPaginatedPersonaChoicesV2,
  promptWithPaginatedModal,
  promptWithRawModal,
  safeSelectOptionText,
} from "@/utils/discord/interactionHelper";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { type UserRow, type ErrorContext, personaConfigSchema, type TomoriState } from "@/types/db/schema";
import type { CheckboxGroupOption, ModalCheckboxGroupField, SelectOption } from "@/types/discord/modal";
import { sql } from "@/utils/db/client";
import { loadAllPersonasForServer } from "@/utils/db/repositories";

const TRIGGER_MODAL_CUSTOM_ID = "server_triggerremove_trigger_modal";
const TRIGGER_SELECT_ID = "trigger_select";
const TRIGGER_CHECKBOX_ID_PREFIX = "server_trigger_checkbox_group";
const MAX_OPTIONS_PER_GROUP = 10;
const MAX_GROUPS_PER_MODAL = 5;
const MAX_ENTRIES_PER_MODAL = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;

const formatTextArrayLiteral = (items: string[]): string =>
  `{${items.map((item) => `"${item.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.server.trigger.remove.description"));

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

  let tomoriState: TomoriState | null = null;
  let responseInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction = interaction;
  let selectedPersona: TomoriState | null = null;

  try {
    const allPersonas = await loadAllPersonasForServer(interaction.guild.id);
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

      responseInteraction = personaSelection.interaction;
      selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
      tomoriState = selectedPersona;
      if (!selectedPersona?.tomori_id) {
        await updateButtonComponentsV2Status(
          personaSelection.interaction,
          locale,
          "general.errors.invalid_option_title",
          "general.errors.invalid_option_description",
          ColorCode.ERROR,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }
      const selectedPersonaWithId = selectedPersona as TomoriState & {
        tomori_id: number;
      };

      const currentTriggerWords = selectedPersonaWithId.trigger_words ?? [];
      if (currentTriggerWords.length === 0) {
        await updateButtonComponentsV2Status(
          personaSelection.interaction,
          locale,
          "commands.server.trigger.remove.no_triggers_title",
          "commands.server.trigger.remove.no_triggers_description",
          ColorCode.WARN,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      if (currentTriggerWords.length > MAX_ENTRIES_PER_MODAL) {
        const fallbackHandled = await handlePaginatedTriggerRemovalFallback(
          responseInteraction,
          selectedPersonaWithId,
          currentTriggerWords,
          userData,
          locale,
          interaction.guild.id,
        );
        if (!fallbackHandled) {
          return;
        }
        continue;
      }

      const triggerGroupCount = Math.ceil(currentTriggerWords.length / MAX_OPTIONS_PER_GROUP);
      const checkboxGroups = buildTriggerCheckboxGroups(currentTriggerWords);

      const triggerModalResult = await promptWithRawModal(responseInteraction, locale, {
        modalCustomId: TRIGGER_MODAL_CUSTOM_ID,
        modalTitleKey: "commands.server.trigger.remove.modal_title",
        components: checkboxGroups,
      });

      if (triggerModalResult.outcome !== "submit") {
        log.info(`Trigger delete modal ${triggerModalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      const triggerModalInteraction = triggerModalResult.interaction;
      if (!triggerModalInteraction) {
        log.error("Trigger delete modal unexpectedly missing interaction");
        return;
      }
      await acknowledgeModalSubmitForRefresh(triggerModalInteraction);
      responseInteraction = triggerModalInteraction;

      const checkedIndices = new Set<number>();
      for (let groupIndex = 0; groupIndex < triggerGroupCount; groupIndex++) {
        const groupValues = triggerModalResult.multiValues?.[`${TRIGGER_CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
        for (const index of groupValues) {
          checkedIndices.add(Number.parseInt(index, 10));
        }
      }

      const removedIndices = currentTriggerWords.flatMap((_, index) => (checkedIndices.has(index) ? [] : [index]));
      if (removedIndices.length === 0) {
        await replyComponentsV2Status(
          interaction,
          locale,
          "commands.server.trigger.remove.no_removals_title",
          "commands.server.trigger.remove.no_removals_description",
          ColorCode.INFO,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      const removalSucceeded = await performTriggerWordRemoval(
        selectedPersonaWithId,
        currentTriggerWords,
        removedIndices,
        userData,
        triggerModalInteraction,
        locale,
        interaction.guild.id,
        true,
      );
      if (!removalSucceeded) {
        return;
      }
      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.server.trigger.remove.success_title",
        "commands.server.trigger.remove.success_description",
        ColorCode.SUCCESS,
        {
          triggerWords: formatTriggerList(currentTriggerWords.filter((_, index) => removedIndices.includes(index))),
        },
        "general.pagination.reloading_persona_picker",
      );
    }
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: selectedPersona?.server_id ?? tomoriState?.server_id,
      tomoriId: selectedPersona?.tomori_id ?? tomoriState?.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server trigger remove",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /server trigger remove for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

    if (responseInteraction.deferred || responseInteraction.replied) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    } else {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

async function handlePaginatedTriggerRemovalFallback(
  responseInteraction: ChatInputCommandInteraction | ButtonInteraction,
  selectedPersona: TomoriState & { tomori_id: number },
  currentTriggerWords: string[],
  userData: UserRow,
  locale: string,
  guildId: string,
): Promise<boolean> {
  const triggerOptions: SelectOption[] = currentTriggerWords.map((trigger, index) => ({
    label: safeSelectOptionText(trigger, 50),
    value: index.toString(),
  }));

  const triggerModalResult = await promptWithPaginatedModal(responseInteraction, locale, {
    modalCustomId: TRIGGER_MODAL_CUSTOM_ID,
    modalTitleKey: "commands.server.trigger.remove.modal_title",
    components: [
      {
        customId: TRIGGER_SELECT_ID,
        labelKey: "commands.server.trigger.remove.select_label",
        descriptionKey: "commands.server.trigger.remove.select_description",
        placeholder: "commands.server.trigger.remove.select_placeholder",
        required: true,
        options: triggerOptions,
      },
    ],
  });

  if (triggerModalResult.outcome !== "submit") {
    log.info(`Trigger delete fallback modal ${triggerModalResult.outcome} for user ${userData.user_id}`);
    await replyComponentsV2Status(
      responseInteraction,
      locale,
      "general.pagination.select_persona_title",
      "general.pagination.reloading_persona_picker",
      ColorCode.INFO,
    );
    return true;
  }

  const triggerModalInteraction = triggerModalResult.interaction;
  const selectedTriggerIndex = triggerModalResult.values?.[TRIGGER_SELECT_ID];
  if (!triggerModalInteraction || !selectedTriggerIndex) {
    log.error("Trigger fallback modal result unexpectedly missing interaction or values");
    return false;
  }

  const parsedSelectedTriggerIndex = Number.parseInt(selectedTriggerIndex, 10);
  const selectedTriggerWord = currentTriggerWords[parsedSelectedTriggerIndex];
  if (!selectedTriggerWord) {
    await replyInfoEmbed(triggerModalInteraction, locale, {
      titleKey: "general.errors.invalid_option_title",
      descriptionKey: "general.errors.invalid_option_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  const removalSucceeded = await performTriggerWordRemoval(
    selectedPersona,
    currentTriggerWords,
    [parsedSelectedTriggerIndex],
    userData,
    triggerModalInteraction,
    locale,
    guildId,
    true,
  );
  if (!removalSucceeded) {
    return false;
  }
  await acknowledgeModalSubmitForRefresh(triggerModalInteraction);
  await replyComponentsV2Status(
    responseInteraction,
    locale,
    "commands.server.trigger.remove.success_title",
    "commands.server.trigger.remove.success_description",
    ColorCode.SUCCESS,
    {
      triggerWords: formatTriggerList([selectedTriggerWord]),
    },
    "general.pagination.reloading_persona_picker",
  );

  return true;
}

async function performTriggerWordRemoval(
  selectedPersona: TomoriState & { tomori_id: number },
  currentTriggerWords: string[],
  removedIndices: number[],
  userData: UserRow,
  replyInteraction: ModalSubmitInteraction,
  locale: string,
  guildId: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  const removedIndexSet = new Set(removedIndices);
  const remainingTriggerWords = currentTriggerWords.filter((_, index) => !removedIndexSet.has(index));
  const removedTriggerWords = currentTriggerWords.filter((_, index) => removedIndexSet.has(index));

  if (removedTriggerWords.length === 0) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.server.trigger.remove.no_removals_title",
      descriptionKey: "commands.server.trigger.remove.no_removals_description",
      color: ColorCode.INFO,
    });
    return false;
  }

  await sql`
		INSERT INTO persona_configs (tomori_id, trigger_words)
		VALUES (${selectedPersona.tomori_id}, ARRAY[]::text[])
		ON CONFLICT (tomori_id) DO NOTHING
	`;

  const triggerWordsArrayLiteral = formatTextArrayLiteral(remainingTriggerWords);
  const [updatedRow] = await sql`
		UPDATE persona_configs
		SET trigger_words = ${triggerWordsArrayLiteral}::text[]
		WHERE tomori_id = ${selectedPersona.tomori_id}
		RETURNING *
	`;

  const validatedConfig = personaConfigSchema.safeParse(updatedRow);
  if (!validatedConfig.success || !updatedRow) {
    const context: ErrorContext = {
      tomoriId: selectedPersona.tomori_id,
      serverId: selectedPersona.server_id,
      userId: userData.user_id,
      errorType: "DatabaseUpdateError",
      metadata: {
        command: "server trigger remove",
        guildId,
        removedIndices,
        removedTriggerWords,
        validationErrors: validatedConfig.success ? null : validatedConfig.error.flatten(),
      },
    };
    await log.error(
      "Failed to update or validate trigger_words in persona_configs table",
      validatedConfig.success
        ? new Error("Database update returned no rows")
        : new Error("Updated config data failed validation"),
      context,
    );

    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  invalidateTomoriStateCache(guildId);

  log.success(
    `Removed ${removedTriggerWords.length} trigger word(s) for tomori ${selectedPersona.tomori_id} by user ${userData.user_disc_id}: ${removedTriggerWords.join(", ")}`,
  );

  if (!suppressSuccessReply) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.server.trigger.remove.success_title",
      descriptionKey: "commands.server.trigger.remove.success_description",
      descriptionVars: {
        triggerWords: formatTriggerList(removedTriggerWords),
      },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

function buildTriggerCheckboxGroups(currentTriggerWords: string[]): ModalCheckboxGroupField[] {
  const checkboxGroups: ModalCheckboxGroupField[] = [];

  for (let i = 0; i < currentTriggerWords.length; i += MAX_OPTIONS_PER_GROUP) {
    const chunk = currentTriggerWords.slice(i, i + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((triggerWord, offset) => ({
      label: safeSelectOptionText(triggerWord, 50),
      value: (i + offset).toString(),
      default: true,
    }));

    checkboxGroups.push({
      kind: "checkboxGroup",
      customId: `${TRIGGER_CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.server.trigger.remove.checkbox_label"
          : "commands.server.trigger.remove.checkbox_label_continued",
      descriptionKey: groupIndex === 0 ? "commands.server.trigger.remove.checkbox_description" : undefined,
      minValues: 0,
      required: false,
      options,
    });
  }

  return checkboxGroups;
}

function formatTriggerList(triggerWords: string[]): string {
  const maxVisible = 10;
  const visibleWords = triggerWords.slice(0, maxVisible);
  const suffix = triggerWords.length > maxVisible ? ", ..." : "";
  return `${visibleWords.map((triggerWord) => `\`${triggerWord}\``).join(", ")}${suffix}`;
}

import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { CheckboxGroupOption, ModalCheckboxGroupField, ModalComponent } from "@/types/discord/modal";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { formatStopStringForDisplay, MAX_STOP_STRINGS_PER_SERVER } from "@/utils/provider/stopStringConfig";
import { localizer } from "@/utils/text/localizer";

const STOP_STRING_OPTIONS_PER_GROUP = 10;
const MAX_STOP_STRING_GROUPS_PER_MODAL = 4;
const SPEAKER_PATTERN_CHECKBOX_ID = "config_stop_strings_speaker_pattern";
const STOP_STRINGS_CHECKBOX_ID_PREFIX = "config_stop_strings_group";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("manage").setDescription(localizer("en-US", "commands.model.stop-strings.manage.description"));

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

  const guildKey = interaction.guild?.id ?? interaction.user.id;
  const tomoriState = await getCachedTomoriState(guildKey);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let modalInteraction: ModalSubmitInteraction | null = null;

  try {
    const stopStrings = tomoriState.config.llm_stop_strings ?? [];
    const maxEntries = STOP_STRING_OPTIONS_PER_GROUP * MAX_STOP_STRING_GROUPS_PER_MODAL;
    if (stopStrings.length > maxEntries || stopStrings.length > MAX_STOP_STRINGS_PER_SERVER) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.model.stop-strings.manage.too_many_title",
        descriptionKey: "commands.model.stop-strings.manage.too_many_description",
        descriptionVars: {
          count: stopStrings.length.toString(),
          max_entries: Math.min(maxEntries, MAX_STOP_STRINGS_PER_SERVER).toString(),
        },
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: `config_stop_strings_manage_modal_${interaction.id}`,
        modalTitleKey: "commands.model.stop-strings.manage.modal_title",
        components: buildModalComponents(
          stopStrings,
          tomoriState.config.llm_stop_speaker_pattern_enabled ?? false,
          locale,
        ),
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      return;
    }
    modalInteraction = modalResult.interaction;

    const speakerPatternEnabled = modalResult.values?.[SPEAKER_PATTERN_CHECKBOX_ID] === "true";
    const checkedStopIndexes = collectCheckedStopIndexes(modalResult.multiValues, stopStrings.length);
    const nextStopStrings = stopStrings.filter((_stop, index) => checkedStopIndexes.has(index));
    const removedStops = stopStrings.filter((_stop, index) => !checkedStopIndexes.has(index));

    const speakerPatternChanged =
      speakerPatternEnabled !== (tomoriState.config.llm_stop_speaker_pattern_enabled ?? false);
    const stopStringsChanged = removedStops.length > 0;

    if (!speakerPatternChanged && !stopStringsChanged) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.model.stop-strings.manage.no_changes_title",
        descriptionKey: "commands.model.stop-strings.manage.no_changes_description",
        color: ColorCode.WARN,
      });
      return;
    }

    const updated = await configRepository.updateChatConfig(tomoriState.server_id, {
      llm_stop_strings: nextStopStrings,
      llm_stop_speaker_pattern_enabled: speakerPatternEnabled,
    });

    if (!updated) {
      const context: ErrorContext = {
        userId: userData.user_id,
        serverId: tomoriState.server_id,
        tomoriId: tomoriState.persona_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config stop-strings manage",
        },
      };
      await log.error("Failed to update stop strings config", new Error("Database update failed"), context);
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(guildKey);

    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.model.stop-strings.manage.success_title",
      descriptionKey: "commands.model.stop-strings.manage.success_description",
      descriptionVars: {
        removed_count: removedStops.length.toString(),
        removed_stop_strings:
          removedStops.length > 0 ? formatStopStringList(removedStops, locale) : localizer(locale, "general.none"),
        speaker_pattern_state: localizer(
          locale,
          speakerPatternEnabled ? "commands.config.options.enable" : "commands.config.options.disable",
        ),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      tomoriId: tomoriState.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config stop-strings manage",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Error executing /config stop-strings manage for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

    await replyInfoEmbed(modalInteraction ?? interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

function buildModalComponents(
  stopStrings: readonly string[],
  speakerPatternEnabled: boolean,
  locale: string,
): ModalComponent[] {
  const components: ModalComponent[] = [
    {
      kind: "checkbox",
      customId: SPEAKER_PATTERN_CHECKBOX_ID,
      labelKey: "commands.model.stop-strings.manage.speaker_pattern_checkbox_label",
      descriptionKey: "commands.model.stop-strings.manage.speaker_pattern_checkbox_description",
      default: speakerPatternEnabled,
    },
  ];

  for (let index = 0; index < stopStrings.length; index += STOP_STRING_OPTIONS_PER_GROUP) {
    const chunk = stopStrings.slice(index, index + STOP_STRING_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(index / STOP_STRING_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((stop, chunkIndex) => {
      const stopIndex = index + chunkIndex;
      const display = formatStopStringForDisplay(stop);
      return {
        label: safeSelectOptionText(display || localizer(locale, "general.unknown")),
        value: getStopIndexValue(stopIndex),
        description: safeSelectOptionText(
          localizer(locale, "commands.model.stop-strings.manage.stop_string_option_description", {
            index: (stopIndex + 1).toString(),
          }),
        ),
        default: true,
      };
    });

    components.push({
      kind: "checkboxGroup",
      customId: `${STOP_STRINGS_CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.model.stop-strings.manage.stop_strings_checkbox_label"
          : "commands.model.stop-strings.manage.stop_strings_checkbox_label_continued",
      descriptionKey:
        groupIndex === 0 ? "commands.model.stop-strings.manage.stop_strings_checkbox_description" : undefined,
      minValues: 0,
      maxValues: options.length,
      required: false,
      options,
    } satisfies ModalCheckboxGroupField);
  }

  return components;
}

function collectCheckedStopIndexes(
  multiValues: Record<string, string[]> | undefined,
  stopStringCount: number,
): Set<number> {
  const groupCount = Math.ceil(stopStringCount / STOP_STRING_OPTIONS_PER_GROUP);
  const checkedIndexes = new Set<number>();

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const values = multiValues?.[`${STOP_STRINGS_CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
    for (const value of values) {
      const parsed = Number.parseInt(value.replace("stop_", ""), 10);
      if (Number.isInteger(parsed) && parsed >= 0 && parsed < stopStringCount) {
        checkedIndexes.add(parsed);
      }
    }
  }

  return checkedIndexes;
}

function getStopIndexValue(index: number): string {
  return `stop_${index}`;
}

function formatStopStringList(stops: readonly string[], locale: string): string {
  const visibleStops = stops.slice(0, 8).map((stop) => `\`${formatStopStringForDisplay(stop)}\``);
  if (stops.length > visibleStops.length) {
    visibleStops.push(
      localizer(locale, "commands.model.stop-strings.manage.more_removed", {
        count: stops.length - visibleStops.length,
      }),
    );
  }
  return visibleStops.join(", ");
}

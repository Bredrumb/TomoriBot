/**
 * /config remove modeloverride
 * Removes channel and persona model overrides from the server.
 * Presents one combined bulk-management modal with all current overrides
 * pre-checked. Unchecked entries are removed on submit.
 */

import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { getCachedTomoriState, getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { getAllChannelLlmOverridesForServer } from "@/utils/db/repositories";
import { deleteChannelLlmOverride, setPersonaLlmOverride } from "@/utils/db/repositories";
import type { UserRow, ErrorContext, TomoriState, LlmRow } from "@/types/db/schema";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";

const CHANNEL_CHECKBOX_ID_PREFIX = "channel_override_checkbox_group";
const PERSONA_CHECKBOX_ID_PREFIX = "persona_override_checkbox_group";
const MAX_OPTIONS_PER_GROUP = 10;
const MAX_GROUPS_PER_MODAL = 5;
const MAX_ENTRIES_PER_MODAL = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;

type ChannelOverrideEntry = {
  channelDiscId: string;
  llm: LlmRow;
};

type PersonaOverrideEntry = TomoriState & {
  persona_llm: LlmRow;
  tomori_id: number;
};

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.config.remove.modeloverride.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const modalCustomId = `config_remove_modeloverride_modal_${interaction.id}`;

  if (!interaction.guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const tomoriState = await getCachedTomoriState(interaction.guild.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [channelOverrides, allPersonas] = await Promise.all([
      getAllChannelLlmOverridesForServer(tomoriState.server_id),
      getCachedAllPersonas(interaction.guild.id),
    ]);
    const personasWithOverride = allPersonas.filter(
      (persona): persona is PersonaOverrideEntry => persona.persona_llm != null && persona.tomori_id != null,
    );

    if (channelOverrides.length === 0 && personasWithOverride.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.remove.modeloverride.none_title",
        descriptionKey: "commands.config.remove.modeloverride.none_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const checkboxGroups = [
      ...buildChannelOverrideCheckboxGroups(interaction, channelOverrides),
      ...buildPersonaOverrideCheckboxGroups(personasWithOverride),
    ];
    if (checkboxGroups.length > MAX_GROUPS_PER_MODAL) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.remove.modeloverride.too_many_title",
        descriptionKey: "commands.config.remove.modeloverride.too_many_description",
        descriptionVars: {
          channel_count: channelOverrides.length.toString(),
          persona_count: personasWithOverride.length.toString(),
          total_count: (channelOverrides.length + personasWithOverride.length).toString(),
          max_entries: MAX_ENTRIES_PER_MODAL.toString(),
          max_groups: MAX_GROUPS_PER_MODAL.toString(),
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
        modalCustomId,
        modalTitleKey: "commands.config.remove.modeloverride.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") return;

    if (!modalResult.interaction) {
      log.error("Model override removal modal unexpectedly missing interaction");
      return;
    }
    const modalInteraction = modalResult.interaction;

    const checkedChannelIds = collectCheckedStringValues(
      modalResult.multiValues,
      CHANNEL_CHECKBOX_ID_PREFIX,
      Math.ceil(channelOverrides.length / MAX_OPTIONS_PER_GROUP),
    );
    const checkedPersonaIds = collectCheckedNumberValues(
      modalResult.multiValues,
      PERSONA_CHECKBOX_ID_PREFIX,
      Math.ceil(personasWithOverride.length / MAX_OPTIONS_PER_GROUP),
    );

    const channelOverridesToRemove = channelOverrides.filter((entry) => !checkedChannelIds.has(entry.channelDiscId));
    const personasToClear = personasWithOverride.filter((persona) => !checkedPersonaIds.has(persona.tomori_id));

    if (channelOverridesToRemove.length === 0 && personasToClear.length === 0) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.config.remove.modeloverride.no_removals_title",
        descriptionKey: "commands.config.remove.modeloverride.no_removals_description",
        color: ColorCode.INFO,
      });
      return;
    }

    const [channelDeletionResults, personaClearResults] = await Promise.all([
      Promise.all(
        channelOverridesToRemove.map(async (entry) => ({
          entry,
          deleted: await deleteChannelLlmOverride(tomoriState.server_id, entry.channelDiscId),
        })),
      ),
      Promise.all(
        personasToClear.map(async (persona) => ({
          persona,
          cleared: await setPersonaLlmOverride(persona.tomori_id, null, {
            serverDiscId: interaction.guildId ?? undefined,
          }),
        })),
      ),
    ]);

    const removedChannelOverrides = channelDeletionResults
      .filter((result) => result.deleted)
      .map((result) => result.entry);
    const failedChannelOverrides = channelDeletionResults
      .filter((result) => !result.deleted)
      .map((result) => result.entry);
    const clearedPersonaOverrides = personaClearResults
      .filter((result) => result.cleared)
      .map((result) => result.persona);
    const failedPersonaOverrides = personaClearResults
      .filter((result) => !result.cleared)
      .map((result) => result.persona);

    if (failedChannelOverrides.length > 0 || failedPersonaOverrides.length > 0) {
      const context: ErrorContext = {
        serverId: tomoriState.server_id,
        errorType: "DatabaseDeleteError",
        metadata: {
          command: "config remove modeloverride",
          failedChannelDiscIds: failedChannelOverrides.map((entry) => entry.channelDiscId),
          failedTomoriIds: failedPersonaOverrides.map((persona) => persona.tomori_id),
        },
      };
      await log.error(
        "Failed to clear one or more model overrides",
        new Error("One or more model override deletes returned false"),
        context,
      );
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const removedSections: string[] = [];
    if (removedChannelOverrides.length > 0) {
      const channelMentions = removedChannelOverrides.map(
        (entry) =>
          interaction.guild?.channels.cache.get(entry.channelDiscId)?.toString() ?? `<#${entry.channelDiscId}>`,
      );
      removedSections.push(
        `**${localizer(locale, "commands.config.remove.modeloverride.channel_checkbox_label")}**\n${formatRemovedNames(channelMentions)}`,
      );
    }
    if (clearedPersonaOverrides.length > 0) {
      removedSections.push(
        `**${localizer(locale, "commands.config.remove.modeloverride.persona_checkbox_label")}**\n${formatRemovedNames(clearedPersonaOverrides.map((persona) => `**${persona.tomori_nickname}**`))}`,
      );
    }

    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.config.remove.modeloverride.success_title",
      descriptionKey: "commands.config.remove.modeloverride.success_description",
      descriptionVars: {
        removed_overrides: removedSections.join("\n\n"),
      },
      color: ColorCode.SUCCESS,
    });

    log.success(
      `Removed ${removedChannelOverrides.length} channel and ${clearedPersonaOverrides.length} persona model override(s) from server ${interaction.guild.id}`,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "config remove modeloverride" },
    };
    await log.error("Error in /config remove modeloverride", error as Error, context);

    if (!interaction.replied && !interaction.deferred) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.followUp({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

function buildChannelOverrideCheckboxGroups(
  interaction: ChatInputCommandInteraction,
  overrides: ChannelOverrideEntry[],
): ModalCheckboxGroupField[] {
  const checkboxGroups: ModalCheckboxGroupField[] = [];

  for (let i = 0; i < overrides.length; i += MAX_OPTIONS_PER_GROUP) {
    const chunk = overrides.slice(i, i + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((entry) => {
      const channel = interaction.guild?.channels.cache.get(entry.channelDiscId);
      return {
        label: channel?.isTextBased()
          ? `#${channel.name}`
          : (channel?.name ?? `Unknown (${entry.channelDiscId.substring(0, 10)}...)`),
        value: entry.channelDiscId,
        description: formatLlmSummary(entry.llm),
        default: true,
      };
    });

    checkboxGroups.push({
      kind: "checkboxGroup",
      customId: `${CHANNEL_CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.config.remove.modeloverride.channel_checkbox_label"
          : "commands.config.remove.modeloverride.channel_checkbox_label_continued",
      descriptionKey:
        groupIndex === 0 ? "commands.config.remove.modeloverride.channel_checkbox_description" : undefined,
      minValues: 0,
      required: false,
      options,
    });
  }

  return checkboxGroups;
}

function buildPersonaOverrideCheckboxGroups(personasWithOverride: PersonaOverrideEntry[]): ModalCheckboxGroupField[] {
  const checkboxGroups: ModalCheckboxGroupField[] = [];

  for (let i = 0; i < personasWithOverride.length; i += MAX_OPTIONS_PER_GROUP) {
    const chunk = personasWithOverride.slice(i, i + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((persona) => ({
      label: persona.tomori_nickname,
      value: persona.tomori_id.toString(),
      description: formatLlmSummary(persona.persona_llm),
      default: true,
    }));

    checkboxGroups.push({
      kind: "checkboxGroup",
      customId: `${PERSONA_CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.config.remove.modeloverride.persona_checkbox_label"
          : "commands.config.remove.modeloverride.persona_checkbox_label_continued",
      descriptionKey:
        groupIndex === 0 ? "commands.config.remove.modeloverride.persona_checkbox_description" : undefined,
      minValues: 0,
      required: false,
      options,
    });
  }

  return checkboxGroups;
}

function collectCheckedStringValues(
  multiValues: Record<string, string[]> | undefined,
  customIdPrefix: string,
  groupCount: number,
): Set<string> {
  const checkedValues = new Set<string>();
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const groupValues = multiValues?.[`${customIdPrefix}_${groupIndex}`] ?? [];
    for (const value of groupValues) {
      checkedValues.add(value);
    }
  }
  return checkedValues;
}

function collectCheckedNumberValues(
  multiValues: Record<string, string[]> | undefined,
  customIdPrefix: string,
  groupCount: number,
): Set<number> {
  const checkedValues = new Set<number>();
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const groupValues = multiValues?.[`${customIdPrefix}_${groupIndex}`] ?? [];
    for (const value of groupValues) {
      checkedValues.add(Number.parseInt(value, 10));
    }
  }
  return checkedValues;
}

function formatLlmSummary(llm: LlmRow): string {
  return `${llm.llm_codename} (${llm.llm_provider})`;
}

function formatRemovedNames(names: string[]): string {
  const maxVisibleNames = 10;
  const visibleNames = names.slice(0, maxVisibleNames);
  const suffix = names.length > maxVisibleNames ? ", ..." : "";
  return `${visibleNames.join(", ")}${suffix}`;
}

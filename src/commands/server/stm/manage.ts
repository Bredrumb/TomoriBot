import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";
import type { ShortTermMemoryEntry } from "@/utils/cache/shortTermMemoryCache";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import {
  clearShortTermMemoryForServerChannel,
  getShortTermMemoriesForServer,
} from "@/utils/cache/shortTermMemoryCache";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const MAX_OPTIONS_PER_GROUP = 10;
const MAX_GROUPS_PER_MODAL = 5;
const MAX_ENTRIES_PER_MODAL = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;
const STM_CHECKBOX_ID_PREFIX = "server_stm_manage_checkbox_group";

type ActiveServerStmEntry = ShortTermMemoryEntry & {
  personaName: string;
};

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("manage").setDescription(localizer("en-US", "commands.server.stm.manage.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const modalCustomId = `server_stm_manage_modal_${interaction.id}`;

  if (!interaction.guild || !interaction.guildId) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  try {
    const personas = await getCachedAllPersonas(interaction.guildId);
    if (personas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const activeEntries = getActiveServerStmEntries(interaction.guildId, personas, locale);
    if (activeEntries.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.stm.manage.none_title",
        descriptionKey: "commands.server.stm.manage.none_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const groupCount = Math.ceil(activeEntries.length / MAX_OPTIONS_PER_GROUP);
    if (groupCount > MAX_GROUPS_PER_MODAL) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.stm.manage.too_many_title",
        descriptionKey: "commands.server.stm.manage.too_many_description",
        descriptionVars: {
          count: activeEntries.length.toString(),
          max_entries: MAX_ENTRIES_PER_MODAL.toString(),
          max_groups: MAX_GROUPS_PER_MODAL.toString(),
        },
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const checkboxGroups = buildCheckboxGroups(activeEntries, interaction, locale);
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId,
        modalTitleKey: "commands.server.stm.manage.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") return;
    if (!modalResult.interaction) {
      log.error("Server STM manage modal unexpectedly missing interaction");
      return;
    }

    const modalInteraction = modalResult.interaction;
    const checkedEntryKeys = collectCheckedValues(modalResult.multiValues, groupCount);
    const entriesToClear = activeEntries.filter((entry) => !checkedEntryKeys.has(getEntryValue(entry)));

    if (entriesToClear.length === 0) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.server.stm.manage.no_changes_title",
        descriptionKey: "commands.server.stm.manage.no_changes_description",
        color: ColorCode.INFO,
      });
      return;
    }

    for (const entry of entriesToClear) {
      clearShortTermMemoryForServerChannel(interaction.guildId, entry.channelId, entry.tomoriId);
    }

    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.server.stm.manage.success_title",
      descriptionKey: "commands.server.stm.manage.success_description",
      descriptionVars: {
        cleared_count: entriesToClear.length.toString(),
        cleared_entries: formatClearedEntries(entriesToClear, locale),
      },
      color: ColorCode.SUCCESS,
    });

    log.success(
      `Cleared ${entriesToClear.length} server STM entr${entriesToClear.length === 1 ? "y" : "ies"} in guild ${interaction.guildId}`,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server stm manage",
        guildId: interaction.guildId,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /server stm manage", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}

function getActiveServerStmEntries(guildId: string, personas: TomoriState[], locale: string): ActiveServerStmEntry[] {
  const personaNameById = new Map<number, string>();
  for (const persona of personas) {
    if (persona.tomori_id != null) {
      personaNameById.set(persona.tomori_id, persona.tomori_nickname);
    }
  }

  return getShortTermMemoriesForServer(guildId)
    .map((entry) => ({
      ...entry,
      personaName:
        entry.tomoriId != null
          ? (personaNameById.get(entry.tomoriId) ?? `${localizer(locale, "general.unknown")} (${entry.tomoriId})`)
          : localizer(locale, "commands.server.stm.manage.unscoped_label"),
    }))
    .sort((a, b) => b.lastUpdated - a.lastUpdated);
}

function buildCheckboxGroups(
  entries: ActiveServerStmEntry[],
  interaction: ChatInputCommandInteraction,
  locale: string,
): ModalCheckboxGroupField[] {
  const checkboxGroups: ModalCheckboxGroupField[] = [];

  for (let i = 0; i < entries.length; i += MAX_OPTIONS_PER_GROUP) {
    const chunk = entries.slice(i, i + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((entry) => ({
      label: safeSelectOptionText(buildEntryLabel(entry, interaction, locale)),
      value: getEntryValue(entry),
      description: safeSelectOptionText(buildEntryDescription(entry, interaction, locale)),
      default: true,
    }));

    checkboxGroups.push({
      kind: "checkboxGroup",
      customId: `${STM_CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.server.stm.manage.checkbox_label"
          : "commands.server.stm.manage.checkbox_label_continued",
      descriptionKey: groupIndex === 0 ? "commands.server.stm.manage.checkbox_description" : undefined,
      minValues: 0,
      required: false,
      options,
    });
  }

  return checkboxGroups;
}

function buildEntryLabel(
  entry: ActiveServerStmEntry,
  interaction: ChatInputCommandInteraction,
  locale: string,
): string {
  const channelName = interaction.guild?.channels.cache.get(entry.channelId)?.name ?? entry.channelName;
  const fallbackChannelName = localizer(locale, "general.unknown");
  return `${entry.personaName} - #${channelName ?? fallbackChannelName}`;
}

function buildEntryDescription(
  entry: ActiveServerStmEntry,
  interaction: ChatInputCommandInteraction,
  locale: string,
): string {
  const channelName = interaction.guild?.channels.cache.get(entry.channelId)?.name ?? entry.channelName;
  const summaryText = entry.summary
    ? safeSelectOptionText(entry.summary.replace(/\s+/g, " "), 45)
    : localizer(locale, "commands.server.stm.manage.no_summary");

  return `#${channelName ?? localizer(locale, "general.unknown")} - ${formatRelativeTimestamp(entry.lastUpdated, locale)} - ${summaryText}`;
}

function getEntryValue(entry: ShortTermMemoryEntry): string {
  return `${entry.channelId}:${entry.tomoriId ?? "none"}`;
}

function collectCheckedValues(multiValues: Record<string, string[]> | undefined, groupCount: number): Set<string> {
  const checkedValues = new Set<string>();
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const groupValues = multiValues?.[`${STM_CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
    for (const value of groupValues) {
      checkedValues.add(value);
    }
  }
  return checkedValues;
}

function formatClearedEntries(entries: ActiveServerStmEntry[], locale: string): string {
  const visibleEntries = entries.slice(0, 10);
  const formattedEntries = visibleEntries.map((entry) => {
    const channelReference = `<#${entry.channelId}>`;
    return `- **${entry.personaName}** - ${channelReference}`;
  });

  if (entries.length > visibleEntries.length) {
    formattedEntries.push(
      localizer(locale, "commands.server.stm.manage.more_cleared", {
        count: entries.length - visibleEntries.length,
      }),
    );
  }

  return formattedEntries.join("\n");
}

function formatRelativeTimestamp(timestamp: number, locale: string): string {
  const diffMs = timestamp - Date.now();
  const diffMinutes = Math.round(diffMs / (60 * 1000));
  const diffHours = Math.round(diffMs / (60 * 60 * 1000));
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  const relativeTimeFormat = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (Math.abs(diffMinutes) < 60) {
    return relativeTimeFormat.format(diffMinutes, "minute");
  }
  if (Math.abs(diffHours) < 24) {
    return relativeTimeFormat.format(diffHours, "hour");
  }
  return relativeTimeFormat.format(diffDays, "day");
}

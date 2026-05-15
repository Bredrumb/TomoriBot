import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ModalCheckboxGroupField } from "@/types/discord/modal";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { invalidatePersonalSpotlightCache } from "@/utils/cache/personalSpotlightCache";
import { userRepository, type PersonalSpotlightStatus } from "@/utils/db/repositories/UserRepository";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const MAX_OPTIONS_PER_GROUP = 10;
const MAX_GROUPS_PER_MODAL = 5;
const MAX_ENTRIES_PER_MODAL = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;
const CHECKBOX_ID_PREFIX = "personal_spotlight_manage_checkbox_group";

type PersonaWithId = TomoriState & { tomori_id: number };

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("manage").setDescription(localizer("en-US", "commands.personal.spotlight.manage.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const errorContext: ErrorContext = {
    userId: userData.user_id,
    serverId: null,
    tomoriId: null,
    metadata: {
      command: "personal spotlight manage",
      guildId: interaction.guildId,
      executorDiscordId: interaction.user.id,
    },
  };

  try {
    if (!interaction.guild || !interaction.guildId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!userData.user_id) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.operation_failed_title",
        descriptionKey: "general.errors.operation_failed_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [tomoriState, allPersonasRaw] = await Promise.all([
      getCachedTomoriState(interaction.guildId),
      getCachedAllPersonas(interaction.guildId),
    ]);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    errorContext.serverId = tomoriState.server_id;
    errorContext.tomoriId = tomoriState.tomori_id;

    const personas = allPersonasRaw.filter(
      (persona): persona is PersonaWithId => typeof persona.tomori_id === "number",
    );
    const activeSpotlights = await userRepository.getActivePersonalSpotlightsForUser(
      tomoriState.server_id,
      userData.user_id,
    );
    if (activeSpotlights.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.spotlight.manage.none_title",
        descriptionKey: "commands.personal.spotlight.manage.none_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (activeSpotlights.length > MAX_ENTRIES_PER_MODAL) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.spotlight.manage.too_many_title",
        descriptionKey: "commands.personal.spotlight.manage.too_many_description",
        descriptionVars: {
          count: activeSpotlights.length.toString(),
          max_entries: MAX_ENTRIES_PER_MODAL.toString(),
          max_groups: MAX_GROUPS_PER_MODAL.toString(),
        },
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const checkboxGroups = buildCheckboxGroups(activeSpotlights, personas, interaction, locale);
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: `personal_spotlight_manage_modal_${interaction.id}`,
        modalTitleKey: "commands.personal.spotlight.manage.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      return;
    }

    const modalInteraction = modalResult.interaction;
    const checkedValues = collectCheckedValues(modalResult.multiValues, checkboxGroups.length);
    const entriesToRemove = activeSpotlights.filter((entry) => !checkedValues.has(getEntryValue(entry)));
    if (entriesToRemove.length === 0) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.personal.spotlight.manage.no_changes_title",
        descriptionKey: "commands.personal.spotlight.manage.no_changes_description",
        color: ColorCode.INFO,
      });
      return;
    }

    for (const entry of entriesToRemove) {
      const removed = await userRepository.removePersonalSpotlight(
        tomoriState.server_id,
        userData.user_id,
        entry.channelDiscId,
      );
      if (removed) {
        invalidatePersonalSpotlightCache(tomoriState.server_id, userData.user_id, entry.channelDiscId);
      }
    }

    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.personal.spotlight.manage.success_title",
      descriptionKey: "commands.personal.spotlight.manage.success_description",
      descriptionVars: {
        removed_count: entriesToRemove.length.toString(),
        removed_entries: formatRemovedEntries(entriesToRemove, interaction, locale),
      },
      color: ColorCode.SUCCESS,
    });

    log.success(
      `Removed ${entriesToRemove.length} personal spotlight entr${entriesToRemove.length === 1 ? "y" : "ies"} for user ${interaction.user.id} in guild ${interaction.guildId}`,
    );
  } catch (error) {
    await log.error("Error executing /personal spotlight manage", error as Error, errorContext);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

function buildCheckboxGroups(
  activeSpotlights: PersonalSpotlightStatus[],
  personas: PersonaWithId[],
  interaction: ChatInputCommandInteraction,
  locale: string,
): ModalCheckboxGroupField[] {
  const personaNameById = new Map(personas.map((persona) => [persona.tomori_id, persona.tomori_nickname]));
  const groups: ModalCheckboxGroupField[] = [];

  for (let index = 0; index < activeSpotlights.length; index += MAX_OPTIONS_PER_GROUP) {
    const chunk = activeSpotlights.slice(index, index + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(index / MAX_OPTIONS_PER_GROUP);
    groups.push({
      kind: "checkboxGroup",
      customId: `${CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.personal.spotlight.manage.checkbox_label"
          : "commands.personal.spotlight.manage.checkbox_label_continued",
      descriptionKey: groupIndex === 0 ? "commands.personal.spotlight.manage.checkbox_description" : undefined,
      minValues: 0,
      required: false,
      options: chunk.map((entry) => ({
        label: safeSelectOptionText(buildEntryLabel(entry, interaction, locale)),
        value: getEntryValue(entry),
        description: safeSelectOptionText(formatEntryDescription(entry, personaNameById, locale)),
        default: true,
      })),
    });
  }

  return groups;
}

function buildEntryLabel(
  entry: PersonalSpotlightStatus,
  interaction: ChatInputCommandInteraction,
  locale: string,
): string {
  const channelName =
    interaction.guild?.channels.cache.get(entry.channelDiscId)?.name ?? localizer(locale, "general.unknown");
  return `#${channelName}`;
}

function formatEntryDescription(
  entry: PersonalSpotlightStatus,
  personaNameById: Map<number, string>,
  locale: string,
): string {
  const durationText =
    entry.expiresAt === null
      ? localizer(locale, "commands.personal.spotlight.manage.permanent_badge")
      : localizer(locale, "commands.personal.spotlight.manage.until_badge", {
          expires_at: formatManageExpiry(entry.expiresAt, locale),
        });
  const autoTriggerText =
    entry.autoTriggerPersonaId !== null
      ? (personaNameById.get(entry.autoTriggerPersonaId) ?? entry.autoTriggerPersonaId.toString())
      : localizer(locale, "commands.personal.spotlight.set.auto_trigger_none");
  const personaText = formatPersonaNames(entry.personaIds, personaNameById, locale);

  return localizer(locale, "commands.personal.spotlight.manage.entry_description", {
    duration: durationText,
    auto_trigger: autoTriggerText,
    personas: personaText,
  });
}

function formatManageExpiry(expiresAt: Date, locale: string): string {
  return expiresAt.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPersonaNames(personaIds: number[], personaNameById: Map<number, string>, locale: string): string {
  const visibleNames = personaIds
    .slice(0, 4)
    .map((personaId) => personaNameById.get(personaId) ?? personaId.toString());
  if (personaIds.length > visibleNames.length) {
    visibleNames.push(
      localizer(locale, "commands.personal.spotlight.set.more_personas", {
        count: personaIds.length - visibleNames.length,
      }),
    );
  }

  return visibleNames.join(", ");
}

function collectCheckedValues(multiValues: Record<string, string[]> | undefined, groupCount: number): Set<string> {
  const checkedValues = new Set<string>();

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const values = multiValues?.[`${CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
    for (const value of values) {
      checkedValues.add(value);
    }
  }

  return checkedValues;
}

function getEntryValue(entry: PersonalSpotlightStatus): string {
  return entry.channelDiscId;
}

function formatRemovedEntries(
  entries: PersonalSpotlightStatus[],
  interaction: ChatInputCommandInteraction,
  locale: string,
): string {
  const visibleEntries = entries.slice(0, 8).map((entry) => {
    const channelReference = interaction.guild?.channels.cache.has(entry.channelDiscId)
      ? `<#${entry.channelDiscId}>`
      : `#${localizer(locale, "general.unknown")}`;
    return `- ${channelReference}`;
  });

  if (entries.length > visibleEntries.length) {
    visibleEntries.push(
      localizer(locale, "commands.personal.spotlight.manage.more_removed", {
        count: entries.length - visibleEntries.length,
      }),
    );
  }

  return visibleEntries.join("\n");
}

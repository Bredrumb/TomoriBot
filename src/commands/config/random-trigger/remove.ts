/**
 * /config random-trigger remove
 * Removes existing random triggers from the server.
 * Uses checkbox-group bulk removal when the full set fits in one modal,
 * and falls back to paginated single-removal when the list exceeds modal limits.
 */

import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  replyInfoEmbed,
  promptWithPaginatedModal,
  promptWithRawModal,
  safeSelectOptionText,
} from "@/utils/discord/interactionHelper";
import { getCachedTomoriState, getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { getServerRandomTriggers } from "@/utils/db/repositories";
import { deleteRandomTrigger } from "@/utils/db/repositories";
import type { UserRow, ErrorContext, RandomTriggerRow } from "@/types/db/schema";
import type { CheckboxGroupOption, ModalCheckboxGroupField, SelectOption } from "@/types/discord/modal";

const MODAL_CUSTOM_ID = "config_randomtrigger_remove_modal";
const TRIGGER_SELECT_ID = "trigger_select";
const TRIGGER_CHECKBOX_ID_PREFIX = "random_trigger_checkbox_group";
const MAX_OPTIONS_PER_GROUP = 10;
const MAX_GROUPS_PER_MODAL = 5;
const MAX_ENTRIES_PER_MODAL = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;

type RandomTriggerSummary = {
  trigger: RandomTriggerRow & { trigger_id: number };
  label: string;
  description: string;
  summary: string;
};

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.config.random-trigger.remove.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
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

    const triggers = await getServerRandomTriggers(tomoriState.server_id);
    if (triggers.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.random-trigger.remove.none_title",
        descriptionKey: "commands.config.random-trigger.remove.none_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const randomLabel = localizer(locale, "commands.config.random-trigger.add.persona_random_label");
    const allPersonas = await getCachedAllPersonas(interaction.guild.id);
    const personaNameById = new Map<number, string>();
    for (const persona of allPersonas) {
      if (persona.tomori_id != null) {
        personaNameById.set(persona.tomori_id, persona.tomori_nickname);
      }
    }

    const triggerSummaries = buildTriggerSummaries(interaction, triggers, personaNameById, randomLabel);

    if (triggerSummaries.length > MAX_ENTRIES_PER_MODAL) {
      await handlePaginatedRemovalFallback(interaction, locale, tomoriState.server_id, triggerSummaries);
      return;
    }

    const triggerGroupCount = Math.ceil(triggerSummaries.length / MAX_OPTIONS_PER_GROUP);
    const checkboxGroups = buildTriggerCheckboxGroups(triggerSummaries);

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.config.random-trigger.remove.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") {
      log.info(`Randomtrigger remove modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    if (!modalResult.interaction) {
      log.error("Random trigger removal modal unexpectedly missing interaction");
      return;
    }
    const modalInteraction = modalResult.interaction;

    const checkedTriggerIds = new Set<number>();
    for (let groupIndex = 0; groupIndex < triggerGroupCount; groupIndex++) {
      const groupValues = modalResult.multiValues?.[`${TRIGGER_CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
      for (const triggerId of groupValues) {
        checkedTriggerIds.add(Number.parseInt(triggerId, 10));
      }
    }

    const triggersToRemove = triggerSummaries.filter((summary) => !checkedTriggerIds.has(summary.trigger.trigger_id));
    if (triggersToRemove.length === 0) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.config.random-trigger.remove.no_removals_title",
        descriptionKey: "commands.config.random-trigger.remove.no_removals_description",
        color: ColorCode.INFO,
      });
      return;
    }

    await removeRandomTriggers(tomoriState.server_id, triggersToRemove, modalInteraction, locale);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "config randomtrigger remove" },
    };
    await log.error("Error in /config random-trigger remove", error as Error, context);

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

async function handlePaginatedRemovalFallback(
  interaction: ChatInputCommandInteraction,
  locale: string,
  serverId: number,
  triggerSummaries: RandomTriggerSummary[],
): Promise<void> {
  const triggerOptions: SelectOption[] = triggerSummaries.map((summary, index) => ({
    value: index.toString(),
    label: safeSelectOptionText(summary.summary),
  }));

  const modalResult = await promptWithPaginatedModal(interaction, locale, {
    modalCustomId: MODAL_CUSTOM_ID,
    modalTitleKey: "commands.config.random-trigger.remove.modal_title",
    components: [
      {
        customId: TRIGGER_SELECT_ID,
        labelKey: "commands.config.random-trigger.remove.select_label",
        descriptionKey: "commands.config.random-trigger.remove.select_description",
        placeholder: "commands.config.random-trigger.remove.select_placeholder",
        required: true,
        options: triggerOptions,
      },
    ],
  });

  if (modalResult.outcome !== "submit") {
    log.info(`Randomtrigger remove fallback modal ${modalResult.outcome} for user ${interaction.user.id}`);
    return;
  }

  const modalInteraction = modalResult.interaction;
  const selectedIndexRaw = modalResult.values?.[TRIGGER_SELECT_ID];
  if (!modalInteraction || !selectedIndexRaw) {
    log.error("Random trigger fallback modal unexpectedly missing interaction or values");
    return;
  }

  if (!modalInteraction.deferred && !modalInteraction.replied) {
    await modalInteraction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const selectedSummary = triggerSummaries[Number.parseInt(selectedIndexRaw, 10)];
  if (!selectedSummary) {
    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  await removeRandomTriggers(serverId, [selectedSummary], modalInteraction, locale);
}

async function removeRandomTriggers(
  serverId: number,
  triggerSummaries: RandomTriggerSummary[],
  replyInteraction: ModalSubmitInteraction,
  locale: string,
): Promise<void> {
  const deletionResults = await Promise.all(
    triggerSummaries.map(async (summary) => ({
      summary,
      deleted: await deleteRandomTrigger(summary.trigger.trigger_id),
    })),
  );
  const removedSummaries = deletionResults.filter((result) => result.deleted).map((result) => result.summary);
  const failedSummaries = deletionResults.filter((result) => !result.deleted).map((result) => result.summary);

  if (failedSummaries.length > 0) {
    const context: ErrorContext = {
      serverId,
      errorType: "DatabaseDeleteError",
      metadata: {
        operation: "deleteRandomTrigger",
        failedTriggerIds: failedSummaries.map((summary) => summary.trigger.trigger_id),
      },
    };
    await log.error(
      "Failed to delete one or more random triggers",
      new Error("deleteRandomTrigger returned false for one or more entries"),
      context,
    );
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  await replyInfoEmbed(replyInteraction, locale, {
    titleKey: "commands.config.random-trigger.remove.success_title",
    descriptionKey: "commands.config.random-trigger.remove.success_description",
    descriptionVars: {
      triggers_removed: formatRemovedSummaries(removedSummaries.map((summary) => summary.summary)),
    },
    color: ColorCode.SUCCESS,
  });

  log.success(
    `Removed ${removedSummaries.length} random trigger(s) from server ${serverId}: ${removedSummaries.map((summary) => summary.trigger.trigger_id).join(", ")}`,
  );
}

function buildTriggerSummaries(
  interaction: ChatInputCommandInteraction,
  triggers: RandomTriggerRow[],
  personaNameById: Map<number, string>,
  randomLabel: string,
): RandomTriggerSummary[] {
  return triggers
    .filter((trigger): trigger is RandomTriggerRow & { trigger_id: number } => trigger.trigger_id != null)
    .map((trigger) => {
      const guildChannel = interaction.guild?.channels.cache.get(trigger.channel_disc_id);
      const channelLabel = guildChannel
        ? `#${guildChannel.name}`
        : `Unknown (${trigger.channel_disc_id.slice(0, 10)}...)`;
      const personaName =
        trigger.tomori_id == null ? randomLabel : (personaNameById.get(trigger.tomori_id) ?? `ID:${trigger.tomori_id}`);
      const timingLabel = formatTimingLabel(trigger);
      return {
        trigger,
        label: `${channelLabel} | ${personaName}`,
        description: timingLabel,
        summary: `${channelLabel} | ${personaName} | ${timingLabel}`,
      };
    });
}

function buildTriggerCheckboxGroups(triggerSummaries: RandomTriggerSummary[]): ModalCheckboxGroupField[] {
  const checkboxGroups: ModalCheckboxGroupField[] = [];

  for (let i = 0; i < triggerSummaries.length; i += MAX_OPTIONS_PER_GROUP) {
    const chunk = triggerSummaries.slice(i, i + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((summary) => ({
      value: summary.trigger.trigger_id.toString(),
      label: summary.label,
      description: summary.description,
      default: true,
    }));

    checkboxGroups.push({
      kind: "checkboxGroup",
      customId: `${TRIGGER_CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.config.random-trigger.remove.checkbox_label"
          : "commands.config.random-trigger.remove.checkbox_label_continued",
      descriptionKey: groupIndex === 0 ? "commands.config.random-trigger.remove.checkbox_description" : undefined,
      minValues: 0,
      required: false,
      options,
    });
  }

  return checkboxGroups;
}

function formatTimingLabel(trigger: RandomTriggerRow): string {
  const offsetSegment =
    trigger.random_offset_range != null && trigger.random_offset_range > 0 ? ` +/-${trigger.random_offset_range}h` : "";
  return `${trigger.timer_hours}h${offsetSegment} / ${trigger.chance_percent}%`;
}

function formatRemovedSummaries(summaries: string[]): string {
  const maxVisible = 10;
  const visibleSummaries = summaries.slice(0, maxVisible);
  const suffix = summaries.length > maxVisible ? "\n..." : "";
  return visibleSummaries.join("\n") + suffix;
}

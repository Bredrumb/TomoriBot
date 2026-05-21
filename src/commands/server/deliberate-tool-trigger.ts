import {
  MessageFlags,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { sql } from "@/utils/db/client";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { promptWithRawModal, replyInfoEmbed, safeSelectOptionText } from "@/utils/discord/interactionHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { tomoriConfigSchema, type ErrorContext, type UserRow } from "@/types/db/schema";
import {
  DELIBERATE_TOOL_TRIGGER_TARGETS,
  getDeliberateToolTriggerTargetLabel,
  normalizeDeliberateToolRegexTrigger,
  normalizeDeliberateToolTrigger,
  type DeliberateToolTrigger,
  type DeliberateToolTriggerMap,
} from "@/utils/tools/deliberateToolMode";
import type { CheckboxGroupOption, ModalCheckboxGroupField, SelectOption } from "@/types/discord/modal";

const ACTIONS = ["add", "remove", "list"] as const;
const MAX_TRIGGERS_PER_TARGET = 16;
const MAX_TRIGGER_LENGTH = 40;
const ADD_MODAL_CUSTOM_ID = "server_deliberate_tool_trigger_add_modal";
const REMOVE_MODAL_CUSTOM_ID = "server_deliberate_tool_trigger_remove_modal";
const TOOL_SELECT_ID = "tool_select";
const TRIGGER_INPUT_ID = "trigger_input";
const REGEX_TRIGGER_INPUT_ID = "regex_trigger_input";
const REMOVE_CHECKBOX_ID_PREFIX = "trigger_remove_checkbox_group";
const MAX_OPTIONS_PER_GROUP = 10;
const MAX_GROUPS_PER_MODAL = 5;
const MAX_ENTRIES_PER_MODAL = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;
const MAX_REGEX_TRIGGER_LENGTH = 120;

type TriggerEntry = {
  id: string;
  target: string;
  trigger: DeliberateToolTrigger;
  label: string;
};

function formatTriggerList(triggerMap: DeliberateToolTriggerMap): string {
  const entries = Object.entries(triggerMap);
  if (entries.length === 0) {
    return "No custom deliberate tool triggers are configured.";
  }

  return entries
    .map(([target, triggers]) => {
      const label = getDeliberateToolTriggerTargetLabel(target);
      const triggerText = triggers.map((trigger) => formatTriggerForDisplay(trigger)).join(", ");
      return `**${label}**: ${triggerText}`;
    })
    .join("\n");
}

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("deliberate-tool-trigger")
    .setDescription(localizer("en-US", "commands.server.deliberate-tool-trigger.description"))
    .addStringOption((option) =>
      option
        .setName("action")
        .setDescription(localizer("en-US", "commands.server.deliberate-tool-trigger.action_description"))
        .setRequired(true)
        .addChoices(
          ...ACTIONS.map((action) => ({
            name: localizer("en-US", `commands.server.deliberate-tool-trigger.action_${action}`),
            value: action,
          })),
        ),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const guildId = interaction.guild?.id ?? "";

  try {
    const tomoriState = await getCachedTomoriState(guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const action = interaction.options.getString("action", true) as (typeof ACTIONS)[number];
    const triggerMap: DeliberateToolTriggerMap = { ...(tomoriState.config.deliberate_tool_triggers ?? {}) };

    if (action === "list") {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.deliberate-tool-trigger.list_title",
        description: formatTriggerList(triggerMap),
        color: ColorCode.INFO,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "add") {
      await handleAdd(interaction, locale, triggerMap, tomoriState.server_id, guildId);
      return;
    }

    await handleRemove(interaction, locale, triggerMap, tomoriState.server_id, guildId);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(guildId))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server deliberate-tool-trigger",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /server deliberate-tool-trigger command", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  locale: string,
  triggerMap: DeliberateToolTriggerMap,
  serverId: number,
  guildId: string,
): Promise<void> {
  const toolOptions: SelectOption[] = DELIBERATE_TOOL_TRIGGER_TARGETS.map((target) => ({
    label: safeSelectOptionText(target.label),
    value: target.value,
  }));

  const modalResult = await promptWithRawModal(
    interaction,
    locale,
    {
      modalCustomId: ADD_MODAL_CUSTOM_ID,
      modalTitleKey: "commands.server.deliberate-tool-trigger.add_modal_title",
      components: [
        {
          customId: TOOL_SELECT_ID,
          labelKey: "commands.server.deliberate-tool-trigger.tool_label",
          descriptionKey: "commands.server.deliberate-tool-trigger.tool_description",
          placeholder: "commands.server.deliberate-tool-trigger.tool_placeholder",
          required: true,
          options: toolOptions,
        },
        {
          customId: TRIGGER_INPUT_ID,
          labelKey: "commands.server.deliberate-tool-trigger.trigger_label",
          descriptionKey: "commands.server.deliberate-tool-trigger.trigger_description",
          placeholder: "commands.server.deliberate-tool-trigger.trigger_placeholder",
          style: TextInputStyle.Short,
          required: false,
          maxLength: MAX_TRIGGER_LENGTH,
        },
        {
          customId: REGEX_TRIGGER_INPUT_ID,
          labelKey: "commands.server.deliberate-tool-trigger.regex_trigger_label",
          descriptionKey: "commands.server.deliberate-tool-trigger.regex_trigger_description",
          placeholder: "commands.server.deliberate-tool-trigger.regex_trigger_placeholder",
          style: TextInputStyle.Short,
          required: false,
          maxLength: MAX_REGEX_TRIGGER_LENGTH,
        },
      ],
    },
    MessageFlags.Ephemeral,
  );

  if (modalResult.outcome !== "submit") return;

  const modalInteraction = modalResult.interaction;
  if (!modalInteraction) {
    log.error("Deliberate tool trigger add modal unexpectedly missing interaction");
    return;
  }

  const target = modalResult.values?.[TOOL_SELECT_ID];
  const trigger = normalizeDeliberateToolTrigger(modalResult.values?.[TRIGGER_INPUT_ID]);
  const regexTrigger = normalizeDeliberateToolRegexTrigger(modalResult.values?.[REGEX_TRIGGER_INPUT_ID]);
  if (!target || !DELIBERATE_TOOL_TRIGGER_TARGETS.some((candidate) => candidate.value === target)) {
    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.server.deliberate-tool-trigger.invalid_title",
      descriptionKey: "commands.server.deliberate-tool-trigger.missing_tool_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  if ((trigger && regexTrigger) || (!trigger && !regexTrigger)) {
    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.server.deliberate-tool-trigger.invalid_title",
      descriptionKey: "commands.server.deliberate-tool-trigger.exactly_one_trigger_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  if (regexTrigger) {
    try {
      new RegExp(regexTrigger, "iu");
    } catch {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.server.deliberate-tool-trigger.invalid_regex_title",
        descriptionKey: "commands.server.deliberate-tool-trigger.invalid_regex_description",
        descriptionVars: { trigger: regexTrigger },
        color: ColorCode.ERROR,
      });
      return;
    }
  }

  const triggerEntry: DeliberateToolTrigger = regexTrigger ? { type: "regex", value: regexTrigger } : trigger;
  const triggerDisplay = formatTriggerLabel(triggerEntry);
  const currentTriggers = triggerMap[target] ?? [];
  if (currentTriggers.some((candidate) => triggerKeysMatch(candidate, triggerEntry))) {
    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.server.deliberate-tool-trigger.duplicate_title",
      descriptionKey: "commands.server.deliberate-tool-trigger.duplicate_description",
      descriptionVars: { trigger: triggerDisplay, tool: getDeliberateToolTriggerTargetLabel(target) },
      color: ColorCode.WARN,
    });
    return;
  }

  if (currentTriggers.length >= MAX_TRIGGERS_PER_TARGET) {
    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.server.deliberate-tool-trigger.too_many_title",
      descriptionKey: "commands.server.deliberate-tool-trigger.too_many_description",
      descriptionVars: { max: MAX_TRIGGERS_PER_TARGET, tool: getDeliberateToolTriggerTargetLabel(target) },
      color: ColorCode.ERROR,
    });
    return;
  }

  triggerMap[target] = [...currentTriggers, triggerEntry].sort((left, right) =>
    getTriggerSortValue(left).localeCompare(getTriggerSortValue(right)),
  );

  const updated = await saveTriggerMap(serverId, triggerMap);
  if (!updated) {
    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  invalidateTomoriStateCache(guildId);

  await replyInfoEmbed(modalInteraction, locale, {
    titleKey: "commands.server.deliberate-tool-trigger.added_title",
    descriptionKey: "commands.server.deliberate-tool-trigger.added_description",
    descriptionVars: { trigger: triggerDisplay, tool: getDeliberateToolTriggerTargetLabel(target) },
    color: ColorCode.SUCCESS,
  });
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  locale: string,
  triggerMap: DeliberateToolTriggerMap,
  serverId: number,
  guildId: string,
): Promise<void> {
  const triggerEntries = getTriggerEntries(triggerMap);
  if (triggerEntries.length === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.server.deliberate-tool-trigger.none_title",
      descriptionKey: "commands.server.deliberate-tool-trigger.none_description",
      color: ColorCode.WARN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (triggerEntries.length > MAX_ENTRIES_PER_MODAL) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.server.deliberate-tool-trigger.remove_too_many_title",
      descriptionKey: "commands.server.deliberate-tool-trigger.remove_too_many_description",
      descriptionVars: {
        count: triggerEntries.length.toString(),
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
      modalCustomId: REMOVE_MODAL_CUSTOM_ID,
      modalTitleKey: "commands.server.deliberate-tool-trigger.remove_modal_title",
      components: buildRemoveCheckboxGroups(triggerEntries),
    },
    MessageFlags.Ephemeral,
  );

  if (modalResult.outcome !== "submit") return;

  const modalInteraction = modalResult.interaction;
  if (!modalInteraction) {
    log.error("Deliberate tool trigger removal modal unexpectedly missing interaction");
    return;
  }

  const checkedIds = collectCheckedIds(
    modalResult.multiValues,
    Math.ceil(triggerEntries.length / MAX_OPTIONS_PER_GROUP),
  );
  const entriesToRemove = triggerEntries.filter((entry) => !checkedIds.has(entry.id));
  if (entriesToRemove.length === 0) {
    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.server.deliberate-tool-trigger.no_removals_title",
      descriptionKey: "commands.server.deliberate-tool-trigger.no_removals_description",
      color: ColorCode.INFO,
    });
    return;
  }

  for (const entry of entriesToRemove) {
    const nextTriggers = (triggerMap[entry.target] ?? []).filter(
      (trigger) => !triggerKeysMatch(trigger, entry.trigger),
    );
    if (nextTriggers.length > 0) {
      triggerMap[entry.target] = nextTriggers;
    } else {
      delete triggerMap[entry.target];
    }
  }

  const updated = await saveTriggerMap(serverId, triggerMap);
  if (!updated) {
    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  invalidateTomoriStateCache(guildId);

  await replyInfoEmbed(modalInteraction, locale, {
    titleKey: "commands.server.deliberate-tool-trigger.removed_title",
    descriptionKey: "commands.server.deliberate-tool-trigger.removed_bulk_description",
    descriptionVars: {
      triggers: formatRemovedTriggers(entriesToRemove),
    },
    color: ColorCode.SUCCESS,
  });
}

async function saveTriggerMap(serverId: number, triggerMap: DeliberateToolTriggerMap): Promise<boolean> {
  const [updatedRow] = await sql`
    UPDATE tomori_configs
    SET deliberate_tool_triggers = ${JSON.stringify(triggerMap)}::jsonb
    WHERE server_id = ${serverId}
    RETURNING *
  `;

  const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);
  return Boolean(updatedRow && validatedConfig.success);
}

function getTriggerEntries(triggerMap: DeliberateToolTriggerMap): TriggerEntry[] {
  return Object.entries(triggerMap).flatMap(([target, triggers]) =>
    triggers.map((trigger, index) => ({
      id: `${target}_${index}`,
      target,
      trigger,
      label: formatTriggerLabel(trigger),
    })),
  );
}

function buildRemoveCheckboxGroups(triggerEntries: TriggerEntry[]): ModalCheckboxGroupField[] {
  const checkboxGroups: ModalCheckboxGroupField[] = [];

  for (let i = 0; i < triggerEntries.length; i += MAX_OPTIONS_PER_GROUP) {
    const chunk = triggerEntries.slice(i, i + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((entry) => ({
      label: safeSelectOptionText(entry.label),
      value: entry.id,
      description: safeSelectOptionText(getDeliberateToolTriggerTargetLabel(entry.target)),
      default: true,
    }));

    checkboxGroups.push({
      kind: "checkboxGroup",
      customId: `${REMOVE_CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.server.deliberate-tool-trigger.remove_checkbox_label"
          : "commands.server.deliberate-tool-trigger.remove_checkbox_label_continued",
      descriptionKey:
        groupIndex === 0 ? "commands.server.deliberate-tool-trigger.remove_checkbox_description" : undefined,
      minValues: 0,
      required: false,
      options,
    });
  }

  return checkboxGroups;
}

function collectCheckedIds(multiValues: Record<string, string[]> | undefined, groupCount: number): Set<string> {
  const checkedIds = new Set<string>();
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const groupValues = multiValues?.[`${REMOVE_CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
    for (const value of groupValues) {
      checkedIds.add(value);
    }
  }
  return checkedIds;
}

function formatRemovedTriggers(entries: TriggerEntry[]): string {
  const maxVisibleTriggers = 10;
  const visibleTriggers = entries.slice(0, maxVisibleTriggers).map((entry) => {
    const label = getDeliberateToolTriggerTargetLabel(entry.target);
    return `${formatTriggerForDisplay(entry.trigger)} (${label})`;
  });
  const suffix = entries.length > maxVisibleTriggers ? ", ..." : "";
  return `${visibleTriggers.join(", ")}${suffix}`;
}

function getTriggerStoredKey(trigger: DeliberateToolTrigger): string {
  if (typeof trigger === "string") return `literal:${trigger}`;
  return `${trigger.type}:${trigger.value}`;
}

function getTriggerSortValue(trigger: DeliberateToolTrigger): string {
  if (typeof trigger === "string") return `literal:${trigger}`;
  return `${trigger.type}:${trigger.value}`;
}

function triggerKeysMatch(left: DeliberateToolTrigger, right: DeliberateToolTrigger): boolean {
  return getTriggerStoredKey(left) === getTriggerStoredKey(right);
}

function formatTriggerLabel(trigger: DeliberateToolTrigger): string {
  if (typeof trigger === "string") return trigger;
  return trigger.type === "regex" ? `/${trigger.value}/` : trigger.value;
}

function formatTriggerForDisplay(trigger: DeliberateToolTrigger): string {
  return `\`${formatTriggerLabel(trigger)}\``;
}

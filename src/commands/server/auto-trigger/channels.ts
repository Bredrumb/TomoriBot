import {
  ChannelType,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type GuildTextBasedChannel,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ModalCheckboxGroupField, SelectOption } from "@/types/discord/modal";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import {
  CHECKLIST_CHANNELS_PER_PAGE,
  CHECKLIST_MAX_PAGE_BUTTONS,
  CHECKLIST_PAGE_SELECT_TIMEOUT_MS,
  buildChannelCheckboxGroups,
  buildChecklistPageActionRows,
  collectCheckedIds,
  formatChecklistChannelMentions,
  loadGuildTextChecklistChannels,
  type ChecklistChannelTarget,
} from "@/utils/discord/channelChecklistManager";
import { promptWithPaginatedModal, promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type {
  AutochatPersonaOverride as AutochatPersonaOverrideRow,
  ErrorContext,
  TomoriState,
  UserRow,
} from "@/types/db/schema";
import { getCachedAllPersonas, getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository } from "@/utils/db/repositories";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const MODAL_CUSTOM_ID = "server_auto_trigger_channels_modal";
const CHECKBOX_ID_PREFIX = "server_auto_trigger_channels_checkbox_group";
const PAGE_BUTTON_PREFIX = "server_auto_trigger_channels_page_";
const DONE_BUTTON_ID = "server_auto_trigger_channels_done";
const SINGLE_CHANNEL_MODAL_CUSTOM_ID = "server_auto_trigger_channel_modal";
const SINGLE_CHANNEL_ENABLED_ID = "server_auto_trigger_channel_enabled";
const SINGLE_CHANNEL_PERSONA_ID = "server_auto_trigger_channel_persona";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("channels")
    .setDescription(localizer("en-US", "commands.server.auto-trigger.channels.description"))
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(localizer("en-US", "commands.server.auto-trigger.channels.channel_description"))
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.guild || !interaction.guildId) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  try {
    const tomoriState = await getCachedTomoriState(interaction.guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const configuredChannel = interaction.options.getChannel("channel", false);
    if (configuredChannel) {
      await executeSingleChannel(interaction, locale, tomoriState, configuredChannel as GuildTextBasedChannel);
      return;
    }

    const availableChannels = await loadGuildTextChecklistChannels(interaction.guild);
    if (availableChannels.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.auto-trigger.channels.no_channels_title",
        descriptionKey: "commands.server.auto-trigger.channels.no_channels_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const initialSelectedIds = new Set(tomoriState.config.autoch_disc_ids ?? []);
    const initialPersonaOverrides = buildAutochatPersonaOverrideMap(tomoriState.config.autoch_persona_overrides);

    if (availableChannels.length <= CHECKLIST_CHANNELS_PER_PAGE) {
      await executeSinglePage(
        interaction,
        locale,
        tomoriState,
        interaction.guildId,
        availableChannels,
        initialSelectedIds,
        initialPersonaOverrides,
      );
      return;
    }

    await executeMultiPage(
      interaction,
      locale,
      tomoriState,
      interaction.guildId,
      availableChannels,
      initialSelectedIds,
      initialPersonaOverrides,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server auto-trigger channels",
        guildId: interaction.guildId,
      },
    };
    await log.error("Error in /server auto-trigger channels command", error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}

async function executeSinglePage(
  interaction: ChatInputCommandInteraction,
  locale: string,
  tomoriState: TomoriState,
  guildId: string,
  availableChannels: ChecklistChannelTarget[],
  selectedIds: Set<string>,
  personaOverrides: Map<string, number>,
): Promise<void> {
  const checkboxGroups = buildCheckboxGroups(availableChannels, selectedIds, locale);
  const modalResult = await promptWithRawModal(
    interaction,
    locale,
    {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.server.auto-trigger.channels.modal_title",
      components: checkboxGroups,
    },
    MessageFlags.Ephemeral,
  );

  if (modalResult.outcome !== "submit" || !modalResult.interaction) {
    return;
  }

  const nextSelectedIds = collectCheckedIds(modalResult.multiValues, CHECKBOX_ID_PREFIX, checkboxGroups.length);
  await persistUpdate(
    modalResult.interaction,
    locale,
    tomoriState,
    guildId,
    selectedIds,
    nextSelectedIds,
    personaOverrides,
    availableChannels,
  );
}

async function executeMultiPage(
  interaction: ChatInputCommandInteraction,
  locale: string,
  tomoriState: TomoriState,
  guildId: string,
  availableChannels: ChecklistChannelTarget[],
  initialSelectedIds: Set<string>,
  initialPersonaOverrides: Map<string, number>,
): Promise<void> {
  const totalPages = Math.ceil(availableChannels.length / CHECKLIST_CHANNELS_PER_PAGE);
  let selectedIds = new Set(initialSelectedIds);
  let personaOverrides = cloneAutochatPersonaOverrideMap(initialPersonaOverrides);

  if (totalPages > CHECKLIST_MAX_PAGE_BUTTONS) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.server.auto-trigger.channels.too_many_pages_title",
      descriptionKey: "commands.server.auto-trigger.channels.too_many_pages_description",
      descriptionVars: {
        channel_count: availableChannels.length.toString(),
        max_pages: CHECKLIST_MAX_PAGE_BUTTONS.toString(),
      },
      color: ColorCode.WARN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [buildPageSelectEmbed(locale, availableChannels.length, totalPages, selectedIds.size)],
    components: buildChecklistPageActionRows(
      totalPages,
      availableChannels.length,
      localizer(locale, "commands.server.auto-trigger.channels.done_button"),
      PAGE_BUTTON_PREFIX,
      DONE_BUTTON_ID,
    ),
    flags: MessageFlags.Ephemeral,
  });

  const pageSelectMessage = await interaction.fetchReply();

  while (true) {
    let buttonInteraction: ButtonInteraction;

    try {
      buttonInteraction = (await pageSelectMessage.awaitMessageComponent({
        filter: (i) =>
          i.user.id === interaction.user.id &&
          (i.customId.startsWith(PAGE_BUTTON_PREFIX) || i.customId === DONE_BUTTON_ID),
        time: CHECKLIST_PAGE_SELECT_TIMEOUT_MS,
      })) as ButtonInteraction;
    } catch {
      log.info("[AutoTriggerChannels] Page selection timed out");
      break;
    }

    if (buttonInteraction.customId === DONE_BUTTON_ID) {
      await buttonInteraction.deferUpdate();
      break;
    }

    const selectedPage = Number.parseInt(buttonInteraction.customId.replace(PAGE_BUTTON_PREFIX, ""), 10);
    if (!Number.isInteger(selectedPage) || selectedPage < 1 || selectedPage > totalPages) {
      await buttonInteraction.deferUpdate();
      continue;
    }

    const startIndex = (selectedPage - 1) * CHECKLIST_CHANNELS_PER_PAGE;
    const pageChannels = availableChannels.slice(startIndex, startIndex + CHECKLIST_CHANNELS_PER_PAGE);
    const checkboxGroups = buildCheckboxGroups(pageChannels, selectedIds, locale);

    const modalResult = await promptWithRawModal(
      buttonInteraction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.server.auto-trigger.channels.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome === "submit" && modalResult.interaction) {
      const pageSelectedIds = collectCheckedIds(modalResult.multiValues, CHECKBOX_ID_PREFIX, checkboxGroups.length);
      const nextSelectedIds = new Set(selectedIds);

      for (const channel of pageChannels) {
        nextSelectedIds.delete(channel.id);
      }
      for (const channelId of pageSelectedIds) {
        nextSelectedIds.add(channelId);
      }

      const updatedSelection = await persistUpdate(
        modalResult.interaction,
        locale,
        tomoriState,
        guildId,
        selectedIds,
        nextSelectedIds,
        personaOverrides,
        availableChannels,
      );
      selectedIds = updatedSelection.selectedIds;
      personaOverrides = updatedSelection.personaOverrides;
    }

    try {
      await interaction.editReply({
        embeds: [buildPageSelectEmbed(locale, availableChannels.length, totalPages, selectedIds.size)],
        components: buildChecklistPageActionRows(
          totalPages,
          availableChannels.length,
          localizer(locale, "commands.server.auto-trigger.channels.done_button"),
          PAGE_BUTTON_PREFIX,
          DONE_BUTTON_ID,
        ),
      });
    } catch {
      break;
    }
  }

  try {
    await interaction.editReply({
      embeds: [buildPageSelectEmbed(locale, availableChannels.length, totalPages, selectedIds.size)],
      components: [],
    });
  } catch {
    // Best effort cleanup.
  }
}

function buildCheckboxGroups(
  channels: ChecklistChannelTarget[],
  selectedIds: Set<string>,
  locale: string,
): ModalCheckboxGroupField[] {
  return buildChannelCheckboxGroups({
    channels,
    selectedIds,
    locale,
    checkboxIdPrefix: CHECKBOX_ID_PREFIX,
    labelKey: "commands.server.auto-trigger.channels.checkbox_label",
    labelKeyContinued: "commands.server.auto-trigger.channels.checkbox_label_continued",
    descriptionKey: "commands.server.auto-trigger.channels.checkbox_description",
  });
}

function buildPageSelectEmbed(locale: string, channelCount: number, totalPages: number, selectedCount: number) {
  return createStandardEmbed(locale, {
    titleKey: "commands.server.auto-trigger.channels.select_page_title",
    descriptionKey: "commands.server.auto-trigger.channels.select_page_description",
    descriptionVars: {
      channel_count: channelCount.toString(),
      total_pages: totalPages.toString(),
      selected_count: selectedCount.toString(),
    },
    color: ColorCode.INFO,
  });
}

async function persistUpdate(
  responseInteraction: ModalSubmitInteraction,
  locale: string,
  tomoriState: TomoriState,
  guildId: string,
  previousSelectedIds: Set<string>,
  nextSelectedIds: Set<string>,
  previousPersonaOverrides: Map<string, number>,
  availableChannels: ChecklistChannelTarget[],
): Promise<{ selectedIds: Set<string>; personaOverrides: Map<string, number> }> {
  const nextPersonaOverrides = pruneAutochatPersonaOverrides(previousPersonaOverrides, nextSelectedIds);
  const enabledIds = [...nextSelectedIds].filter((channelId) => !previousSelectedIds.has(channelId));
  const disabledIds = [...previousSelectedIds].filter((channelId) => !nextSelectedIds.has(channelId));

  if (
    enabledIds.length === 0 &&
    disabledIds.length === 0 &&
    areAutochatPersonaOverridesEqual(previousPersonaOverrides, nextPersonaOverrides)
  ) {
    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "commands.server.auto-trigger.channels.no_changes_title",
      descriptionKey: "commands.server.auto-trigger.channels.no_changes_description",
      color: ColorCode.INFO,
    });
    return {
      selectedIds: previousSelectedIds,
      personaOverrides: previousPersonaOverrides,
    };
  }

  const validatedConfig = await updateAutochatConfig(
    tomoriState,
    guildId,
    locale,
    responseInteraction,
    nextSelectedIds,
    nextPersonaOverrides,
  );
  if (!validatedConfig) {
    return {
      selectedIds: previousSelectedIds,
      personaOverrides: previousPersonaOverrides,
    };
  }

  invalidateTomoriStateCache(guildId);

  await replyInfoEmbed(responseInteraction, locale, {
    titleKey: "commands.server.auto-trigger.channels.success_title",
    descriptionKey: "commands.server.auto-trigger.channels.success_description",
    descriptionVars: {
      enabled_count: enabledIds.length.toString(),
      enabled_channels: formatChecklistChannelMentions(enabledIds, availableChannels, locale),
      disabled_count: disabledIds.length.toString(),
      disabled_channels: formatChecklistChannelMentions(disabledIds, availableChannels, locale),
      selected_count: nextSelectedIds.size.toString(),
    },
    color: ColorCode.SUCCESS,
  });

  return {
    selectedIds: nextSelectedIds,
    personaOverrides: nextPersonaOverrides,
  };
}

async function executeSingleChannel(
  interaction: ChatInputCommandInteraction,
  locale: string,
  tomoriState: TomoriState,
  channel: GuildTextBasedChannel,
): Promise<void> {
  const guild = interaction.guild;
  const guildId = interaction.guildId;
  if (!guild || !guildId) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const availableChannels = await loadGuildTextChecklistChannels(guild);
  const availableChannelIds = new Set(availableChannels.map((entry) => entry.id));
  if (!availableChannelIds.has(channel.id)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.server.auto-trigger.channels.invalid_channel_title",
      descriptionKey: "commands.server.auto-trigger.channels.invalid_channel_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const allPersonas = await getCachedAllPersonas(guildId);
  if (allPersonas.length === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const mainPersona = allPersonas.find((persona) => !persona.is_alter) ?? allPersonas[0];
  if (!mainPersona?.tomori_id) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedIds = new Set(tomoriState.config.autoch_disc_ids ?? []);
  const previousPersonaOverrides = buildAutochatPersonaOverrideMap(tomoriState.config.autoch_persona_overrides);
  const currentPersonaId = previousPersonaOverrides.get(channel.id) ?? mainPersona.tomori_id;
  const currentPersona = allPersonas.find((persona) => persona.tomori_id === currentPersonaId) ?? mainPersona;

  const personaOptions: SelectOption[] = allPersonas
    .filter((persona) => persona.tomori_id !== undefined)
    .map((persona) => ({
      label: safeSelectOptionText(persona.tomori_nickname),
      value: persona.tomori_id?.toString() ?? "",
      description: persona.is_alter
        ? localizer(locale, "commands.server.auto-trigger.channels.alter_persona_description")
        : localizer(locale, "commands.server.auto-trigger.channels.main_persona_description"),
    }))
    .filter((option) => option.value !== "");

  const modalResult = await promptWithPaginatedModal(interaction, locale, {
    modalCustomId: SINGLE_CHANNEL_MODAL_CUSTOM_ID,
    modalTitleKey: "commands.server.auto-trigger.channels.single_modal_title",
    components: [
      {
        kind: "checkbox",
        customId: SINGLE_CHANNEL_ENABLED_ID,
        labelKey: "commands.server.auto-trigger.channels.single_enabled_label",
        descriptionKey: "commands.server.auto-trigger.channels.single_enabled_description",
        default: selectedIds.has(channel.id),
      },
      {
        customId: SINGLE_CHANNEL_PERSONA_ID,
        labelKey: "commands.server.auto-trigger.channels.single_persona_label",
        descriptionKey: "commands.server.auto-trigger.channels.single_persona_description",
        placeholder: localizer(locale, "commands.server.auto-trigger.channels.single_persona_placeholder", {
          persona: currentPersona.tomori_nickname,
        }),
        required: false,
        options: personaOptions,
      },
    ],
  });

  if (modalResult.outcome !== "submit" || !modalResult.interaction) {
    return;
  }

  const isEnabled = modalResult.values?.[SINGLE_CHANNEL_ENABLED_ID] === "true";
  const selectedPersonaValue = modalResult.values?.[SINGLE_CHANNEL_PERSONA_ID];
  let desiredPersona = currentPersona;

  if (selectedPersonaValue) {
    const parsedPersonaId = Number.parseInt(selectedPersonaValue, 10);
    const resolvedPersona = allPersonas.find((persona) => persona.tomori_id === parsedPersonaId);
    if (!resolvedPersona || Number.isNaN(parsedPersonaId)) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    desiredPersona = resolvedPersona;
  }

  const nextSelectedIds = new Set(selectedIds);
  const nextPersonaOverrides = cloneAutochatPersonaOverrideMap(previousPersonaOverrides);

  if (isEnabled) {
    nextSelectedIds.add(channel.id);
    if (desiredPersona.tomori_id === mainPersona.tomori_id) {
      nextPersonaOverrides.delete(channel.id);
    } else if (desiredPersona.tomori_id) {
      nextPersonaOverrides.set(channel.id, desiredPersona.tomori_id);
    }
  } else {
    nextSelectedIds.delete(channel.id);
    nextPersonaOverrides.delete(channel.id);
  }

  if (
    areStringSetsEqual(selectedIds, nextSelectedIds) &&
    areAutochatPersonaOverridesEqual(previousPersonaOverrides, nextPersonaOverrides)
  ) {
    await replyInfoEmbed(modalResult.interaction, locale, {
      titleKey: "commands.server.auto-trigger.channels.no_changes_title",
      descriptionKey: "commands.server.auto-trigger.channels.no_changes_description",
      color: ColorCode.INFO,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await modalResult.interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const validatedConfig = await updateAutochatConfig(
    tomoriState,
    guildId,
    locale,
    modalResult.interaction,
    nextSelectedIds,
    nextPersonaOverrides,
  );
  if (!validatedConfig) return;

  invalidateTomoriStateCache(guildId);

  await replyInfoEmbed(modalResult.interaction, locale, {
    titleKey: "commands.server.auto-trigger.channels.single_success_title",
    descriptionKey: isEnabled
      ? "commands.server.auto-trigger.channels.single_success_enabled_description"
      : "commands.server.auto-trigger.channels.single_success_disabled_description",
    descriptionVars: {
      channel: `<#${channel.id}>`,
      persona: desiredPersona.tomori_nickname,
    },
    color: ColorCode.SUCCESS,
  });
}

function buildAutochatPersonaOverrideMap(
  overrides: AutochatPersonaOverrideRow[] | null | undefined,
): Map<string, number> {
  const entries = new Map<string, number>();
  for (const override of overrides ?? []) {
    if (!override?.channel_disc_id || !Number.isInteger(override.tomori_id)) {
      continue;
    }
    entries.set(override.channel_disc_id, override.tomori_id);
  }
  return entries;
}

function cloneAutochatPersonaOverrideMap(source: Map<string, number>): Map<string, number> {
  return new Map(source);
}

function pruneAutochatPersonaOverrides(overrides: Map<string, number>, selectedIds: Set<string>): Map<string, number> {
  const pruned = new Map<string, number>();
  for (const [channelId, personaId] of overrides) {
    if (selectedIds.has(channelId)) {
      pruned.set(channelId, personaId);
    }
  }
  return pruned;
}

function serializeAutochatPersonaOverrides(overrides: Map<string, number>): AutochatPersonaOverrideRow[] {
  return [...overrides.entries()]
    .sort(([leftChannelId], [rightChannelId]) => leftChannelId.localeCompare(rightChannelId))
    .map(([channel_disc_id, tomori_id]) => ({
      channel_disc_id,
      tomori_id,
    }));
}

function areStringSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function areAutochatPersonaOverridesEqual(left: Map<string, number>, right: Map<string, number>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const [channelId, personaId] of left) {
    if (right.get(channelId) !== personaId) {
      return false;
    }
  }

  return true;
}

async function updateAutochatConfig(
  tomoriState: TomoriState,
  guildId: string,
  locale: string,
  responseInteraction: ModalSubmitInteraction,
  nextSelectedIds: Set<string>,
  nextPersonaOverrides: Map<string, number>,
): Promise<true | null> {
  const updated = await configRepository.updateAutoTriggerConfig(tomoriState.server_id, {
    autoch_disc_ids: [...nextSelectedIds],
    autoch_persona_overrides: serializeAutochatPersonaOverrides(nextPersonaOverrides),
  });

  if (!updated) {
    const context: ErrorContext = {
      tomoriId: tomoriState.tomori_id,
      serverId: tomoriState.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server auto-trigger channels",
        guildId,
        targetTable: "server_auto_trigger_configs",
      },
    };
    await log.error("Failed to update auto-trigger channel config", new Error("Database update failed"), context);
    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return null;
  }

  return true;
}

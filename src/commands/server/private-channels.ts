import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ModalCheckboxGroupField } from "@/types/discord/modal";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import {
  CHECKLIST_CHANNELS_PER_PAGE,
  CHECKLIST_MAX_PAGE_BUTTONS,
  CHECKLIST_PAGE_SELECT_TIMEOUT_MS,
  buildChannelCheckboxGroups,
  buildChecklistPageActionRows,
  collectCheckedIds,
  formatChecklistChannelMentions,
  formatTextArrayLiteral,
  loadGuildTextChecklistChannels,
  type ChecklistChannelTarget,
} from "@/utils/discord/channelChecklistManager";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { tomoriConfigSchema, type ErrorContext, type TomoriState, type UserRow } from "@/types/db/schema";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { sql } from "@/utils/db/client";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const MODAL_CUSTOM_ID = "server_private_channels_modal";
const CHECKBOX_ID_PREFIX = "server_private_channels_checkbox_group";
const PAGE_BUTTON_PREFIX = "server_private_channels_page_";
const DONE_BUTTON_ID = "server_private_channels_done";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("private-channels")
    .setDescription(localizer("en-US", "commands.server.private-channels.description"));

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

    const availableChannels = await loadGuildTextChecklistChannels(interaction.guild);
    if (availableChannels.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.private-channels.no_channels_title",
        descriptionKey: "commands.server.private-channels.no_channels_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const initialSelectedIds = new Set(tomoriState.config.private_channel_ids ?? []);

    if (availableChannels.length <= CHECKLIST_CHANNELS_PER_PAGE) {
      await executeSinglePage(
        interaction,
        locale,
        tomoriState,
        interaction.guildId,
        availableChannels,
        initialSelectedIds,
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
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server private-channels",
        guildId: interaction.guildId,
      },
    };
    await log.error("Error in /server private-channels command", error, context);

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
): Promise<void> {
  const checkboxGroups = buildCheckboxGroups(availableChannels, selectedIds, locale);
  const modalResult = await promptWithRawModal(
    interaction,
    locale,
    {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.server.private-channels.modal_title",
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
): Promise<void> {
  const totalPages = Math.ceil(availableChannels.length / CHECKLIST_CHANNELS_PER_PAGE);
  let selectedIds = new Set(initialSelectedIds);

  if (totalPages > CHECKLIST_MAX_PAGE_BUTTONS) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.server.private-channels.too_many_pages_title",
      descriptionKey: "commands.server.private-channels.too_many_pages_description",
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
      localizer(locale, "commands.server.private-channels.done_button"),
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
      log.info("[PrivateChannels] Page selection timed out");
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
        modalTitleKey: "commands.server.private-channels.modal_title",
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

      selectedIds = await persistUpdate(
        modalResult.interaction,
        locale,
        tomoriState,
        guildId,
        selectedIds,
        nextSelectedIds,
        availableChannels,
      );
    }

    try {
      await interaction.editReply({
        embeds: [buildPageSelectEmbed(locale, availableChannels.length, totalPages, selectedIds.size)],
        components: buildChecklistPageActionRows(
          totalPages,
          availableChannels.length,
          localizer(locale, "commands.server.private-channels.done_button"),
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
    labelKey: "commands.server.private-channels.checkbox_label",
    labelKeyContinued: "commands.server.private-channels.checkbox_label_continued",
    descriptionKey: "commands.server.private-channels.checkbox_description",
  });
}

function buildPageSelectEmbed(locale: string, channelCount: number, totalPages: number, selectedCount: number) {
  return createStandardEmbed(locale, {
    titleKey: "commands.server.private-channels.select_page_title",
    descriptionKey: "commands.server.private-channels.select_page_description",
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
  availableChannels: ChecklistChannelTarget[],
): Promise<Set<string>> {
  const enabledIds = [...nextSelectedIds].filter((channelId) => !previousSelectedIds.has(channelId));
  const disabledIds = [...previousSelectedIds].filter((channelId) => !nextSelectedIds.has(channelId));

  if (enabledIds.length === 0 && disabledIds.length === 0) {
    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "commands.server.private-channels.no_changes_title",
      descriptionKey: "commands.server.private-channels.no_changes_description",
      color: ColorCode.INFO,
    });
    return previousSelectedIds;
  }

  const [updatedRow] = await sql`
    UPDATE tomori_configs
    SET private_channel_ids = ${formatTextArrayLiteral([...nextSelectedIds])}::text[]
    WHERE server_id = ${tomoriState.server_id}
    RETURNING *
  `;

  if (!updatedRow) {
    const context: ErrorContext = {
      tomoriId: tomoriState.tomori_id,
      serverId: tomoriState.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server private-channels",
        guildId,
      },
    };
    await log.error("Failed to update private_channel_ids config", new Error("Database update failed"), context);
    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return previousSelectedIds;
  }

  const validatedConfig = tomoriConfigSchema.safeParse(updatedRow);
  if (!validatedConfig.success) {
    const context: ErrorContext = {
      tomoriId: tomoriState.tomori_id,
      serverId: tomoriState.server_id,
      errorType: "SchemaValidationError",
      metadata: {
        command: "server private-channels",
        validationErrors: validatedConfig.error.flatten(),
      },
    };
    await log.error("Failed to validate updated config after private-channel update", validatedConfig.error, context);
    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return previousSelectedIds;
  }

  invalidateTomoriStateCache(guildId);

  await replyInfoEmbed(responseInteraction, locale, {
    titleKey: "commands.server.private-channels.success_title",
    descriptionKey: "commands.server.private-channels.success_description",
    descriptionVars: {
      enabled_count: enabledIds.length.toString(),
      enabled_channels: formatChecklistChannelMentions(enabledIds, availableChannels, locale),
      disabled_count: disabledIds.length.toString(),
      disabled_channels: formatChecklistChannelMentions(disabledIds, availableChannels, locale),
      selected_count: validatedConfig.data.private_channel_ids.length.toString(),
    },
    color: ColorCode.SUCCESS,
  });

  return new Set(validatedConfig.data.private_channel_ids);
}

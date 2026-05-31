import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
  type User,
} from "discord.js";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import { personaRepository, serverRepository, userRepository } from "@/utils/db/repositories";
import { invalidateUserBlacklistCache } from "@/utils/cache/userCache";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { ErrorContext, UserRow } from "@/types/db/schema";

const MODAL_CUSTOM_ID = "server_user_blacklist_remove_modal";
const CHECKBOX_ID_PREFIX = "server_user_blacklist_remove_checkbox_group";
const PAGE_BUTTON_PREFIX = "server_user_blacklist_remove_page_";
const DONE_BUTTON_ID = "server_user_blacklist_remove_done";
const MAX_OPTIONS_PER_GROUP = 10;
const MAX_GROUPS_PER_MODAL = 5;
const USERS_PER_PAGE = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;
const MAX_PAGE_BUTTONS = 24;
const PAGE_SELECT_TIMEOUT_MS = 300_000;

type BlacklistedUserTarget = {
  id: string;
  displayName: string;
};

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.server.user-blacklist.remove.description"));

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
    const tomoriState = await personaRepository.loadState(interaction.guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const blacklistedIds = await userRepository.getBlacklistedMemberIds(tomoriState.server_id);
    if (blacklistedIds.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.user-blacklist.remove.none_title",
        descriptionKey: "commands.server.user-blacklist.remove.none_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const availableUsers = await loadBlacklistedUsers(interaction, blacklistedIds);
    const initialSelectedIds = new Set(blacklistedIds);

    if (availableUsers.length <= USERS_PER_PAGE) {
      await executeSinglePage(interaction, locale, tomoriState.server_id, availableUsers, initialSelectedIds);
      return;
    }

    await executeMultiPage(interaction, locale, tomoriState.server_id, availableUsers, initialSelectedIds);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server user-blacklist remove",
        guildId: interaction.guildId,
      },
    };
    await log.error("Error in /server user-blacklist remove command", error, context);

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
  serverId: number,
  availableUsers: BlacklistedUserTarget[],
  selectedIds: Set<string>,
): Promise<void> {
  const checkboxGroups = buildCheckboxGroups(availableUsers, selectedIds);
  const modalResult = await promptWithRawModal(
    interaction,
    locale,
    {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.server.user-blacklist.remove.modal_title",
      components: checkboxGroups,
    },
    MessageFlags.Ephemeral,
  );

  if (modalResult.outcome !== "submit" || !modalResult.interaction) {
    return;
  }

  const nextSelectedIds = collectSelectedIds(modalResult.multiValues, checkboxGroups.length);
  await persistUpdate(modalResult.interaction, locale, serverId, selectedIds, nextSelectedIds, availableUsers);
}

async function executeMultiPage(
  interaction: ChatInputCommandInteraction,
  locale: string,
  serverId: number,
  availableUsers: BlacklistedUserTarget[],
  initialSelectedIds: Set<string>,
): Promise<void> {
  const totalPages = Math.ceil(availableUsers.length / USERS_PER_PAGE);
  let selectedIds = new Set(initialSelectedIds);

  if (totalPages > MAX_PAGE_BUTTONS) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.server.user-blacklist.remove.too_many_pages_title",
      descriptionKey: "commands.server.user-blacklist.remove.too_many_pages_description",
      descriptionVars: {
        user_count: availableUsers.length.toString(),
        max_pages: MAX_PAGE_BUTTONS.toString(),
      },
      color: ColorCode.WARN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [buildPageSelectEmbed(locale, availableUsers.length, totalPages, selectedIds.size)],
    components: buildPageActionRows(totalPages, availableUsers.length, locale),
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
        time: PAGE_SELECT_TIMEOUT_MS,
      })) as ButtonInteraction;
    } catch {
      log.info("[UserBlacklistRemove] Page selection timed out");
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

    const startIndex = (selectedPage - 1) * USERS_PER_PAGE;
    const pageUsers = availableUsers.slice(startIndex, startIndex + USERS_PER_PAGE);
    const checkboxGroups = buildCheckboxGroups(pageUsers, selectedIds);

    const modalResult = await promptWithRawModal(
      buttonInteraction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.server.user-blacklist.remove.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome === "submit" && modalResult.interaction) {
      const pageSelectedIds = collectSelectedIds(modalResult.multiValues, checkboxGroups.length);
      const nextSelectedIds = new Set(selectedIds);

      for (const user of pageUsers) {
        nextSelectedIds.delete(user.id);
      }
      for (const userId of pageSelectedIds) {
        nextSelectedIds.add(userId);
      }

      selectedIds = await persistUpdate(
        modalResult.interaction,
        locale,
        serverId,
        selectedIds,
        nextSelectedIds,
        availableUsers,
      );
    }

    try {
      await interaction.editReply({
        embeds: [buildPageSelectEmbed(locale, availableUsers.length, totalPages, selectedIds.size)],
        components: buildPageActionRows(totalPages, availableUsers.length, locale),
      });
    } catch {
      break;
    }
  }

  try {
    await interaction.editReply({
      embeds: [buildPageSelectEmbed(locale, availableUsers.length, totalPages, selectedIds.size)],
      components: [],
    });
  } catch {
    // Best effort cleanup.
  }
}

async function loadBlacklistedUsers(
  interaction: ChatInputCommandInteraction,
  userIds: string[],
): Promise<BlacklistedUserTarget[]> {
  const users: BlacklistedUserTarget[] = [];

  for (const userId of userIds) {
    let user: User | null = null;
    try {
      user = await interaction.client.users.fetch(userId);
    } catch {
      user = null;
    }

    users.push({
      id: userId,
      displayName: user?.username ?? userId,
    });
  }

  return users.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function buildCheckboxGroups(users: BlacklistedUserTarget[], selectedIds: Set<string>): ModalCheckboxGroupField[] {
  const checkboxGroups: ModalCheckboxGroupField[] = [];

  for (let index = 0; index < users.length; index += MAX_OPTIONS_PER_GROUP) {
    const chunk = users.slice(index, index + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(index / MAX_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((user) => ({
      label: safeSelectOptionText(user.displayName),
      value: user.id,
      default: selectedIds.has(user.id),
    }));

    checkboxGroups.push({
      kind: "checkboxGroup",
      customId: `${CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.server.user-blacklist.remove.checkbox_label"
          : "commands.server.user-blacklist.remove.checkbox_label_continued",
      descriptionKey: groupIndex === 0 ? "commands.server.user-blacklist.remove.checkbox_description" : undefined,
      minValues: 0,
      maxValues: options.length,
      required: false,
      options,
    });
  }

  return checkboxGroups;
}

function collectSelectedIds(multiValues: Record<string, string[]> | undefined, groupCount: number): Set<string> {
  const selectedIds = new Set<string>();

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const values = multiValues?.[`${CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
    for (const userId of values) {
      selectedIds.add(userId);
    }
  }

  return selectedIds;
}

function buildPageSelectEmbed(locale: string, userCount: number, totalPages: number, selectedCount: number) {
  return createStandardEmbed(locale, {
    titleKey: "commands.server.user-blacklist.remove.select_page_title",
    descriptionKey: "commands.server.user-blacklist.remove.select_page_description",
    descriptionVars: {
      user_count: userCount.toString(),
      total_pages: totalPages.toString(),
      selected_count: selectedCount.toString(),
    },
    color: ColorCode.INFO,
  });
}

function buildPageActionRows(
  totalPages: number,
  totalUsers: number,
  locale: string,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons: ButtonBuilder[] = [];

  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * USERS_PER_PAGE + 1;
    const end = Math.min(page * USERS_PER_PAGE, totalUsers);

    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${PAGE_BUTTON_PREFIX}${page}`)
        .setLabel(`${start}-${end}`)
        .setStyle(ButtonStyle.Primary),
    );
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(DONE_BUTTON_ID)
      .setLabel(localizer(locale, "commands.server.user-blacklist.remove.done_button"))
      .setStyle(ButtonStyle.Secondary),
  );

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(index, index + 5)));
  }

  return rows;
}

async function persistUpdate(
  responseInteraction: ModalSubmitInteraction,
  locale: string,
  serverId: number,
  previousSelectedIds: Set<string>,
  nextSelectedIds: Set<string>,
  availableUsers: BlacklistedUserTarget[],
): Promise<Set<string>> {
  const removedIds = [...previousSelectedIds].filter((userId) => !nextSelectedIds.has(userId));

  if (removedIds.length === 0) {
    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "commands.server.user-blacklist.remove.no_changes_title",
      descriptionKey: "commands.server.user-blacklist.remove.no_changes_description",
      color: ColorCode.INFO,
    });
    return previousSelectedIds;
  }

  await serverRepository.removeUserBlacklistMany(serverId, removedIds);

  for (const userId of removedIds) {
    invalidateUserBlacklistCache(responseInteraction.guildId ?? "", userId);
  }

  const userLookup = new Map(availableUsers.map((user) => [user.id, user.displayName]));
  await replyInfoEmbed(responseInteraction, locale, {
    titleKey: "commands.server.user-blacklist.remove.success_title",
    descriptionKey: "commands.server.user-blacklist.remove.success_description",
    descriptionVars: {
      removed_count: removedIds.length.toString(),
      removed_users: formatUserList(removedIds, userLookup),
      selected_count: nextSelectedIds.size.toString(),
    },
    color: ColorCode.SUCCESS,
  });

  return nextSelectedIds;
}

function formatUserList(userIds: string[], userLookup: Map<string, string>): string {
  return userIds.map((userId) => `\`${userLookup.get(userId) ?? userId}\``).join(", ");
}

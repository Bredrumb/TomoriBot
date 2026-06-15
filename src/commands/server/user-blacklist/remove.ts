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
import {
  personaRepository,
  personaUserBlockRepository,
  serverRepository,
  userRepository,
} from "@/utils/db/repositories";
import type {
  PersonaUserBlockKey,
  PersonaUserBlockWithPersona,
} from "@/utils/db/repositories/PersonaUserBlockRepository";
import { invalidatePersonaUserBlockCache } from "@/utils/cache/personaUserBlockCache";
import { invalidateUserBlacklistCache } from "@/utils/cache/userCache";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { formatTimeWithOffset, formatUTCOffset } from "@/utils/text/timezoneHelper";
import type { ErrorContext, PersonaUserBlockType, UserRow } from "@/types/db/schema";

const MODAL_CUSTOM_ID = "server_user_blacklist_remove_modal";
const CHECKBOX_ID_PREFIX = "server_user_blacklist_remove_checkbox_group";
const PAGE_BUTTON_PREFIX = "server_user_blacklist_remove_page_";
const DONE_BUTTON_ID = "server_user_blacklist_remove_done";
const MAX_OPTIONS_PER_GROUP = 10;
const MAX_GROUPS_PER_MODAL = 5;
const USERS_PER_PAGE = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;
const MAX_PAGE_BUTTONS = 24;
const PAGE_SELECT_TIMEOUT_MS = 300_000;

type RemovalEntryBase = {
  id: string;
  userId: string;
  displayName: string;
  label: string;
  description: string;
};

type PersonalizationBlacklistRemovalEntry = RemovalEntryBase & {
  source: "personalization";
};

type PersonaBlockRemovalEntry = RemovalEntryBase & {
  source: "persona_block";
  personaId: number;
  personaName: string;
  blockType: PersonaUserBlockType;
};

type UserBlacklistRemovalEntry = PersonalizationBlacklistRemovalEntry | PersonaBlockRemovalEntry;

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

    const [blacklistedIds, personaBlocks] = await Promise.all([
      userRepository.getBlacklistedMemberIds(tomoriState.server_id),
      personaUserBlockRepository.loadActiveBlocksForServer(tomoriState.server_id),
    ]);
    if (blacklistedIds.length === 0 && personaBlocks.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.server.user-blacklist.remove.none_title",
        descriptionKey: "commands.server.user-blacklist.remove.none_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const availableEntries = await loadRemovalEntries(
      interaction,
      locale,
      blacklistedIds,
      personaBlocks,
      tomoriState.config.timezone_offset ?? 0,
    );
    const initialSelectedIds = new Set(availableEntries.map((entry) => entry.id));

    if (availableEntries.length <= USERS_PER_PAGE) {
      await executeSinglePage(interaction, locale, tomoriState.server_id, availableEntries, initialSelectedIds);
      return;
    }

    await executeMultiPage(interaction, locale, tomoriState.server_id, availableEntries, initialSelectedIds);
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
  availableEntries: UserBlacklistRemovalEntry[],
  selectedIds: Set<string>,
): Promise<void> {
  const checkboxGroups = buildCheckboxGroups(availableEntries, selectedIds);
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
  await persistUpdate(modalResult.interaction, locale, serverId, selectedIds, nextSelectedIds, availableEntries);
}

async function executeMultiPage(
  interaction: ChatInputCommandInteraction,
  locale: string,
  serverId: number,
  availableEntries: UserBlacklistRemovalEntry[],
  initialSelectedIds: Set<string>,
): Promise<void> {
  const totalPages = Math.ceil(availableEntries.length / USERS_PER_PAGE);
  let selectedIds = new Set(initialSelectedIds);

  if (totalPages > MAX_PAGE_BUTTONS) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.server.user-blacklist.remove.too_many_pages_title",
      descriptionKey: "commands.server.user-blacklist.remove.too_many_pages_description",
      descriptionVars: {
        entry_count: availableEntries.length.toString(),
        max_pages: MAX_PAGE_BUTTONS.toString(),
      },
      color: ColorCode.WARN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [buildPageSelectEmbed(locale, availableEntries.length, totalPages, selectedIds.size)],
    components: buildPageActionRows(totalPages, availableEntries.length, locale),
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
    const pageEntries = availableEntries.slice(startIndex, startIndex + USERS_PER_PAGE);
    const checkboxGroups = buildCheckboxGroups(pageEntries, selectedIds);

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

      for (const entry of pageEntries) {
        nextSelectedIds.delete(entry.id);
      }
      for (const entryId of pageSelectedIds) {
        nextSelectedIds.add(entryId);
      }

      selectedIds = await persistUpdate(
        modalResult.interaction,
        locale,
        serverId,
        selectedIds,
        nextSelectedIds,
        availableEntries,
      );
    }

    try {
      await interaction.editReply({
        embeds: [buildPageSelectEmbed(locale, availableEntries.length, totalPages, selectedIds.size)],
        components: buildPageActionRows(totalPages, availableEntries.length, locale),
      });
    } catch {
      break;
    }
  }

  try {
    await interaction.editReply({
      embeds: [buildPageSelectEmbed(locale, availableEntries.length, totalPages, selectedIds.size)],
      components: [],
    });
  } catch {
    // Best effort cleanup.
  }
}

async function loadRemovalEntries(
  interaction: ChatInputCommandInteraction,
  locale: string,
  userIds: string[],
  personaBlocks: PersonaUserBlockWithPersona[],
  timezoneOffset: number,
): Promise<UserBlacklistRemovalEntry[]> {
  const entries: UserBlacklistRemovalEntry[] = [];
  const displayNameCache = new Map<string, string>();

  for (const userId of userIds) {
    const displayName = await resolveUserDisplayName(interaction, userId, displayNameCache);

    entries.push({
      id: `personalization:${userId}`,
      source: "personalization",
      userId,
      displayName,
      label: localizer(locale, "commands.server.user-blacklist.remove.personalization_entry_label", {
        user_name: displayName,
      }),
      description: localizer(locale, "commands.server.user-blacklist.remove.personalization_entry_description"),
    });
  }

  for (const block of personaBlocks) {
    const displayName = await resolveUserDisplayName(interaction, block.user_disc_id, displayNameCache);
    const blockTypeLabel = localizer(locale, `tools.user_block.type_${block.block_type}`);

    entries.push({
      id: `persona-block:${block.persona_id}:${block.user_disc_id}`,
      source: "persona_block",
      userId: block.user_disc_id,
      displayName,
      personaId: block.persona_id,
      personaName: block.persona_name,
      blockType: block.block_type,
      label: localizer(locale, "commands.server.user-blacklist.remove.persona_block_entry_label", {
        user_name: displayName,
        persona_name: block.persona_name,
        block_type: blockTypeLabel,
      }),
      description: localizer(locale, "commands.server.user-blacklist.remove.persona_block_entry_description", {
        block_type: blockTypeLabel,
        expires_at: formatEntryExpiry(block.expires_at, timezoneOffset),
      }),
    });
  }

  return entries.sort((a, b) => a.label.localeCompare(b.label));
}

async function resolveUserDisplayName(
  interaction: ChatInputCommandInteraction,
  userId: string,
  cache: Map<string, string>,
): Promise<string> {
  const cached = cache.get(userId);
  if (cached) {
    return cached;
  }

  let user: User | null = null;
  try {
    user = await interaction.client.users.fetch(userId);
  } catch {
    user = null;
  }

  const displayName = user?.username ?? userId;
  cache.set(userId, displayName);
  return displayName;
}

function formatEntryExpiry(expiresAt: Date, timezoneOffset: number): string {
  return `${formatTimeWithOffset(expiresAt, timezoneOffset, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })} ${formatUTCOffset(timezoneOffset)}`;
}

function buildCheckboxGroups(
  entries: UserBlacklistRemovalEntry[],
  selectedIds: Set<string>,
): ModalCheckboxGroupField[] {
  const checkboxGroups: ModalCheckboxGroupField[] = [];

  for (let index = 0; index < entries.length; index += MAX_OPTIONS_PER_GROUP) {
    const chunk = entries.slice(index, index + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(index / MAX_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((entry) => ({
      label: safeSelectOptionText(entry.label),
      value: entry.id,
      description: safeSelectOptionText(entry.description),
      default: selectedIds.has(entry.id),
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

function buildPageSelectEmbed(locale: string, entryCount: number, totalPages: number, selectedCount: number) {
  return createStandardEmbed(locale, {
    titleKey: "commands.server.user-blacklist.remove.select_page_title",
    descriptionKey: "commands.server.user-blacklist.remove.select_page_description",
    descriptionVars: {
      entry_count: entryCount.toString(),
      total_pages: totalPages.toString(),
      selected_count: selectedCount.toString(),
    },
    color: ColorCode.INFO,
  });
}

function buildPageActionRows(
  totalPages: number,
  totalEntries: number,
  locale: string,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons: ButtonBuilder[] = [];

  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * USERS_PER_PAGE + 1;
    const end = Math.min(page * USERS_PER_PAGE, totalEntries);

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
  availableEntries: UserBlacklistRemovalEntry[],
): Promise<Set<string>> {
  const removedIds = [...previousSelectedIds].filter((entryId) => !nextSelectedIds.has(entryId));
  const entryLookup = new Map(availableEntries.map((entry) => [entry.id, entry]));
  const removedEntries = removedIds.flatMap((entryId) => {
    const entry = entryLookup.get(entryId);
    return entry ? [entry] : [];
  });

  if (removedEntries.length === 0) {
    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "commands.server.user-blacklist.remove.no_changes_title",
      descriptionKey: "commands.server.user-blacklist.remove.no_changes_description",
      color: ColorCode.INFO,
    });
    return previousSelectedIds;
  }

  const personalizationUserIds = removedEntries
    .filter((entry): entry is PersonalizationBlacklistRemovalEntry => entry.source === "personalization")
    .map((entry) => entry.userId);
  const personaBlockEntries = removedEntries.filter(
    (entry): entry is PersonaBlockRemovalEntry => entry.source === "persona_block",
  );

  if (personalizationUserIds.length > 0) {
    await serverRepository.removeUserBlacklistMany(serverId, personalizationUserIds);

    for (const userId of personalizationUserIds) {
      invalidateUserBlacklistCache(responseInteraction.guildId ?? "", userId);
    }
  }

  if (personaBlockEntries.length > 0) {
    const keys: PersonaUserBlockKey[] = personaBlockEntries.map((entry) => ({
      personaId: entry.personaId,
      userDiscId: entry.userId,
    }));
    await personaUserBlockRepository.removeBlocksByKeys(serverId, keys);

    for (const entry of personaBlockEntries) {
      invalidatePersonaUserBlockCache(serverId, entry.personaId, entry.userId);
    }
  }

  await replyInfoEmbed(responseInteraction, locale, {
    titleKey: "commands.server.user-blacklist.remove.success_title",
    descriptionKey: "commands.server.user-blacklist.remove.success_description",
    descriptionVars: {
      removed_count: removedEntries.length.toString(),
      removed_entries: formatEntryList(removedEntries),
      selected_count: nextSelectedIds.size.toString(),
    },
    color: ColorCode.SUCCESS,
  });

  return nextSelectedIds;
}

function formatEntryList(entries: UserBlacklistRemovalEntry[]): string {
  return entries.map((entry) => `\`${entry.label}\``).join(", ");
}

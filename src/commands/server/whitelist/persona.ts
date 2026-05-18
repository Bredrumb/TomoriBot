import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ActionRowData,
  type ButtonComponentData,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ComponentInContainerData,
  type ContainerComponentData,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
  type TopLevelComponentData,
} from "discord.js";
import type { ModalCheckboxGroupField } from "@/types/discord/modal";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import {
  CHECKLIST_CHANNELS_PER_PAGE,
  CHECKLIST_MAX_PAGE_BUTTONS,
  CHECKLIST_PAGE_SELECT_TIMEOUT_MS,
  buildChannelCheckboxGroups,
  collectCheckedIds,
  formatChecklistChannelMentions,
  loadGuildTextChecklistChannels,
  type ChecklistChannelTarget,
} from "@/utils/discord/channelChecklistManager";
import { acknowledgeModalSubmitForRefresh, promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyComponentsV2Status, updateButtonComponentsV2Status } from "@/utils/discord/ui/statusComponents";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { type AvatarSessionCache, replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";

const MODAL_CUSTOM_ID = "server_whitelist_persona_modal";
const CHECKBOX_ID_PREFIX = "server_whitelist_persona_checkbox_group";
const PAGE_BUTTON_PREFIX = "server_whitelist_persona_page_";
const DONE_BUTTON_ID = "server_whitelist_persona_done";

type PersonaWithId = TomoriState & { persona_id: number };
type ResponseInteraction = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
type PageSelectionResult =
  | {
      outcome: "selected";
      interaction: ButtonInteraction;
      pageChannels: ChecklistChannelTarget[];
    }
  | {
      outcome: "done" | "timeout";
    };

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("persona").setDescription(localizer("en-US", "commands.server.whitelist.persona.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  user: UserRow,
  locale: string,
): Promise<void> {
  const errorContext: ErrorContext = {
    userId: user.user_id,
    serverId: null,
    tomoriId: null,
  };
  let responseInteraction: ResponseInteraction = interaction;

  try {
    if (!interaction.guild || !interaction.guildId) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
      });
      return;
    }

    const [tomoriState, allPersonasRaw, availableChannels] = await Promise.all([
      getCachedTomoriState(interaction.guildId),
      getCachedAllPersonas(interaction.guildId),
      loadGuildTextChecklistChannels(interaction.guild),
    ]);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
      });
      return;
    }

    errorContext.serverId = tomoriState.server_id;
    errorContext.tomoriId = tomoriState.persona_id;

    const allPersonas = allPersonasRaw.filter(
      (persona): persona is PersonaWithId => typeof persona.persona_id === "number",
    );
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.WARN,
        titleKey: "commands.server.whitelist.persona.no_personas_title",
        descriptionKey: "commands.server.whitelist.persona.no_personas_description",
      });
      return;
    }

    const avatarSessionCache: AvatarSessionCache = new Map();
    while (true) {
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        avatarSessionCache,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success) {
        if (personaSelection.reason === "cancelled" || personaSelection.reason === "fatal") return;
        continue;
      }
      if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
        return;
      }

      responseInteraction = personaSelection.interaction;
      const personaSelectionInteraction = personaSelection.interaction;
      const selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
      if (!selectedPersona?.persona_id) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "general.errors.invalid_option_title",
          "general.errors.invalid_option_description",
          ColorCode.ERROR,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      errorContext.tomoriId = selectedPersona.persona_id;

      if (availableChannels.length === 0) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "commands.server.whitelist.persona.no_channels_title",
          "commands.server.whitelist.persona.no_channels_description",
          ColorCode.WARN,
          {
            persona_name: selectedPersona.persona_nickname,
          },
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      if (availableChannels.length > CHECKLIST_MAX_PAGE_BUTTONS * CHECKLIST_CHANNELS_PER_PAGE) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "commands.server.whitelist.persona.too_many_pages_title",
          "commands.server.whitelist.persona.too_many_pages_description",
          ColorCode.WARN,
          {
            persona_name: selectedPersona.persona_nickname,
            channel_count: availableChannels.length.toString(),
            max_pages: CHECKLIST_MAX_PAGE_BUTTONS.toString(),
          },
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      const currentEntries = await whitelistRepository.getPersonaWhitelistChannels(
        tomoriState.server_id,
        selectedPersona.persona_id,
      );
      const currentSelectedIds = new Set(currentEntries.map((entry) => entry.channel_disc_id));

      if (availableChannels.length <= CHECKLIST_CHANNELS_PER_PAGE) {
        const checkboxGroups = buildCheckboxGroups(availableChannels, currentSelectedIds, locale);
        const modalResult = await promptWithRawModal(personaSelectionInteraction, locale, {
          modalCustomId: MODAL_CUSTOM_ID,
          modalTitleKey: "commands.server.whitelist.persona.modal_title",
          components: checkboxGroups,
        });

        if (modalResult.outcome !== "submit" || !modalResult.interaction) {
          log.info(`Persona whitelist modal ${modalResult.outcome} for user ${user.user_id}`);
          await replyComponentsV2Status(
            interaction,
            locale,
            "general.pagination.select_persona_title",
            "general.pagination.reloading_persona_picker",
            ColorCode.INFO,
          );
          continue;
        }

        responseInteraction = modalResult.interaction;
        await acknowledgeModalSubmitForRefresh(modalResult.interaction);
        const nextSelectedIds = collectCheckedIds(modalResult.multiValues, CHECKBOX_ID_PREFIX, checkboxGroups.length);
        await persistUpdateAndRefreshPicker(
          interaction,
          locale,
          tomoriState.server_id,
          interaction.guildId,
          selectedPersona,
          currentSelectedIds,
          nextSelectedIds,
          availableChannels,
        );
        continue;
      }

      const pageSelection = await promptForPageSelection(
        personaSelectionInteraction,
        locale,
        selectedPersona,
        availableChannels,
        currentSelectedIds,
      );

      if (pageSelection.outcome !== "selected") {
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      responseInteraction = pageSelection.interaction;
      const checkboxGroups = buildCheckboxGroups(pageSelection.pageChannels, currentSelectedIds, locale);
      const modalResult = await promptWithRawModal(pageSelection.interaction, locale, {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.server.whitelist.persona.modal_title",
        components: checkboxGroups,
      });

      if (modalResult.outcome !== "submit" || !modalResult.interaction) {
        log.info(`Persona whitelist page modal ${modalResult.outcome} for user ${user.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      responseInteraction = modalResult.interaction;
      await acknowledgeModalSubmitForRefresh(modalResult.interaction);
      const pageSelectedIds = collectCheckedIds(modalResult.multiValues, CHECKBOX_ID_PREFIX, checkboxGroups.length);
      const nextSelectedIds = new Set(currentSelectedIds);

      for (const channel of pageSelection.pageChannels) {
        nextSelectedIds.delete(channel.id);
      }
      for (const channelId of pageSelectedIds) {
        nextSelectedIds.add(channelId);
      }

      await persistUpdateAndRefreshPicker(
        interaction,
        locale,
        tomoriState.server_id,
        interaction.guildId,
        selectedPersona,
        currentSelectedIds,
        nextSelectedIds,
        availableChannels,
      );
    }
  } catch (error) {
    log.error("Error executing /server whitelist persona command", error, errorContext);

    if (responseInteraction.deferred || responseInteraction.replied) {
      await replyInfoEmbed(responseInteraction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
      });
    } else {
      await replyInfoEmbed(responseInteraction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        flags: MessageFlags.Ephemeral,
      });
    }
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
    labelKey: "commands.server.whitelist.persona.checkbox_label",
    labelKeyContinued: "commands.server.whitelist.persona.checkbox_label_continued",
    descriptionKey: "commands.server.whitelist.persona.checkbox_description",
  });
}

async function promptForPageSelection(
  interaction: ButtonInteraction,
  locale: string,
  persona: PersonaWithId,
  availableChannels: ChecklistChannelTarget[],
  selectedIds: Set<string>,
): Promise<PageSelectionResult> {
  const totalPages = Math.ceil(availableChannels.length / CHECKLIST_CHANNELS_PER_PAGE);
  const visibleSelectedCount = availableChannels.filter((channel) => selectedIds.has(channel.id)).length;

  await interaction.update({
    components: buildPageSelectComponents(locale, persona, availableChannels.length, totalPages, visibleSelectedCount),
    flags: MessageFlags.IsComponentsV2,
  });

  try {
    const pageButtonInteraction = (await interaction.message.awaitMessageComponent({
      filter: (i) =>
        i.user.id === interaction.user.id &&
        (i.customId.startsWith(PAGE_BUTTON_PREFIX) || i.customId === DONE_BUTTON_ID),
      time: CHECKLIST_PAGE_SELECT_TIMEOUT_MS,
    })) as ButtonInteraction;

    if (pageButtonInteraction.customId === DONE_BUTTON_ID) {
      await pageButtonInteraction.deferUpdate();
      return { outcome: "done" };
    }

    const selectedPage = Number.parseInt(pageButtonInteraction.customId.replace(PAGE_BUTTON_PREFIX, ""), 10);
    if (!Number.isInteger(selectedPage) || selectedPage < 1 || selectedPage > totalPages) {
      await pageButtonInteraction.deferUpdate();
      return { outcome: "done" };
    }

    const startIndex = (selectedPage - 1) * CHECKLIST_CHANNELS_PER_PAGE;
    return {
      outcome: "selected",
      interaction: pageButtonInteraction,
      pageChannels: availableChannels.slice(startIndex, startIndex + CHECKLIST_CHANNELS_PER_PAGE),
    };
  } catch {
    log.info("[WhitelistPersona] Page selection timed out");
    return { outcome: "timeout" };
  }
}

async function persistUpdateAndRefreshPicker(
  interaction: ChatInputCommandInteraction,
  locale: string,
  serverId: number,
  guildId: string,
  persona: PersonaWithId,
  previousSelectedIds: Set<string>,
  nextSelectedIds: Set<string>,
  availableChannels: ChecklistChannelTarget[],
): Promise<void> {
  const normalizedSelectedIds = availableChannels
    .filter((channel) => nextSelectedIds.has(channel.id))
    .map((channel) => channel.id);
  const enabledIds = normalizedSelectedIds.filter((channelId) => !previousSelectedIds.has(channelId));
  const disabledIds = [...previousSelectedIds].filter((channelId) => !nextSelectedIds.has(channelId));

  if (enabledIds.length === 0 && disabledIds.length === 0) {
    await replyComponentsV2Status(
      interaction,
      locale,
      "commands.server.whitelist.persona.no_changes_title",
      "commands.server.whitelist.persona.no_changes_description",
      ColorCode.INFO,
      {
        persona_name: persona.persona_nickname,
      },
      "general.pagination.reloading_persona_picker",
    );
    return;
  }

  await whitelistRepository.replacePersonaWhitelistChannels(serverId, persona.persona_id, normalizedSelectedIds);
  invalidateWhitelistCache(guildId);

  if (normalizedSelectedIds.length === 0) {
    await replyComponentsV2Status(
      interaction,
      locale,
      "commands.server.whitelist.persona.success_clear_title",
      "commands.server.whitelist.persona.success_clear_description",
      ColorCode.SUCCESS,
      {
        persona_name: persona.persona_nickname,
      },
      "general.pagination.reloading_persona_picker",
    );

    log.info(`Cleared channel whitelist restriction for persona ${persona.persona_id} in server ${guildId}`);
    return;
  }

  await replyComponentsV2Status(
    interaction,
    locale,
    "commands.server.whitelist.persona.success_title",
    "commands.server.whitelist.persona.success_description",
    ColorCode.SUCCESS,
    {
      persona_name: persona.persona_nickname,
      selected_count: normalizedSelectedIds.length.toString(),
      selected_channels: formatChecklistChannelMentions(normalizedSelectedIds, availableChannels, locale),
    },
    "general.pagination.reloading_persona_picker",
  );

  log.info(
    `Updated channel whitelist restriction for persona ${persona.persona_id} in server ${guildId}: [${normalizedSelectedIds.join(", ")}]`,
  );
}

function buildPageSelectComponents(
  locale: string,
  persona: PersonaWithId,
  channelCount: number,
  totalPages: number,
  selectedCount: number,
): TopLevelComponentData[] {
  const pageButtons: ButtonComponentData[] = [];

  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * CHECKLIST_CHANNELS_PER_PAGE + 1;
    const end = Math.min(page * CHECKLIST_CHANNELS_PER_PAGE, channelCount);
    pageButtons.push({
      type: ComponentType.Button,
      style: ButtonStyle.Primary,
      customId: `${PAGE_BUTTON_PREFIX}${page}`,
      label: `${start}-${end}`,
    });
  }

  pageButtons.push({
    type: ComponentType.Button,
    style: ButtonStyle.Secondary,
    customId: DONE_BUTTON_ID,
    label: localizer(locale, "commands.server.whitelist.persona.done_button"),
  });

  const actionRows: ActionRowData<ButtonComponentData>[] = [];
  for (let index = 0; index < pageButtons.length; index += 5) {
    actionRows.push({
      type: ComponentType.ActionRow,
      components: pageButtons.slice(index, index + 5),
    });
  }

  const container: ContainerComponentData<ComponentInContainerData> = {
    type: ComponentType.Container,
    accentColor: resolveAccentColor(ColorCode.INFO),
    components: [
      {
        type: ComponentType.TextDisplay,
        content: `## ${localizer(locale, "commands.server.whitelist.persona.select_page_title")}`,
      },
      {
        type: ComponentType.TextDisplay,
        content: localizer(locale, "commands.server.whitelist.persona.select_page_description", {
          persona_name: persona.persona_nickname,
          channel_count: channelCount.toString(),
          total_pages: totalPages.toString(),
          selected_count: selectedCount.toString(),
        }),
      },
      ...actionRows,
    ],
  };

  return [container];
}

function resolveAccentColor(color: string | number): number {
  if (typeof color === "number") {
    return color;
  }

  if (typeof color === "string" && color.startsWith("#")) {
    return Number.parseInt(color.replace("#", ""), 16);
  }

  return Number.parseInt(ColorCode.INFO.replace("#", ""), 16);
}

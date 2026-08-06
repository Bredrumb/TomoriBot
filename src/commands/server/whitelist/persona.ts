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
  type SlashCommandSubcommandBuilder,
  type TopLevelComponentData,
} from "discord.js";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import type { ModalCheckboxGroupField } from "@/types/discord/modal";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import { getCachedAllPersonas, getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
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
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  retryPersonaWorkflow,
  runPersonaPickerWorkflow,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/personaWorkflow";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const MODAL_CUSTOM_ID = "server_whitelist_persona_modal";
const CHECKBOX_ID_PREFIX = "server_whitelist_persona_checkbox_group";
const PAGE_BUTTON_PREFIX = "server_whitelist_persona_page_";
const DONE_BUTTON_ID = "server_whitelist_persona_done";

type PersonaWithId = TomoriState & { persona_id: number };

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("persona").setDescription(localizer("en-US", "commands.server.whitelist.persona.description"));

/** Configures per-persona channel whitelist entries. */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  user: UserRow,
  locale: string,
): Promise<void> {
  const errorContext: ErrorContext = {
    userId: user.user_id,
    serverId: null,
    personaId: null,
  };
  const workflowState: { message: PersonaWorkflowMessageController | null } = { message: null };

  try {
    if (!interaction.guild || !interaction.guildId) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
      });
      return;
    }

    const guildId = interaction.guildId;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const [tomoriState, allPersonasRaw, availableChannels] = await Promise.all([
      getCachedTomoriState(guildId),
      getCachedAllPersonas(guildId),
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
    errorContext.personaId = tomoriState.persona_id;
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

    await runPersonaPickerWorkflow(interaction, locale, {
      personas: allPersonas,
      color: ColorCode.INFO,
      onSelected: async (selection) => {
        workflowState.message = selection.message;
        const selectedPersona = selection.persona;
        errorContext.personaId = selectedPersona.persona_id;

        if (availableChannels.length === 0) {
          const work = await selection.beginInPlaceWork();
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.server.whitelist.persona.no_channels_title",
              descriptionKey: "commands.server.whitelist.persona.no_channels_description",
              descriptionVars: { persona_name: selectedPersona.persona_nickname },
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.WARN,
            }),
          );
          return retryPersonaWorkflow();
        }

        if (availableChannels.length > CHECKLIST_MAX_PAGE_BUTTONS * CHECKLIST_CHANNELS_PER_PAGE) {
          const work = await selection.beginInPlaceWork();
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "commands.server.whitelist.persona.too_many_pages_title",
              descriptionKey: "commands.server.whitelist.persona.too_many_pages_description",
              descriptionVars: {
                persona_name: selectedPersona.persona_nickname,
                channel_count: availableChannels.length.toString(),
                max_pages: CHECKLIST_MAX_PAGE_BUTTONS.toString(),
              },
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.WARN,
            }),
          );
          return retryPersonaWorkflow();
        }

        if (availableChannels.length <= CHECKLIST_CHANNELS_PER_PAGE) {
          let currentSelectedIds = new Set<string>();
          let checkboxGroups: ModalCheckboxGroupField[] = [];
          const modalResult = await selection.openModal(async () => {
            const currentEntries = await whitelistRepository.getPersonaWhitelistChannels(
              tomoriState.server_id,
              selectedPersona.persona_id,
            );
            currentSelectedIds = new Set(currentEntries.map((entry) => entry.channel_disc_id));
            checkboxGroups = buildCheckboxGroups(availableChannels, currentSelectedIds, locale);
            return {
              modalCustomId: MODAL_CUSTOM_ID,
              modalTitleKey: "commands.server.whitelist.persona.modal_title",
              components: checkboxGroups,
            };
          });
          if (modalResult.outcome !== "submitted") {
            log.info(`Persona whitelist modal ${modalResult.outcome} for user ${user.user_id}`);
            return modalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
          }

          const work = await modalResult.phase.beginInPlaceWork();
          const nextSelectedIds = collectCheckedIds(
            modalResult.phase.multiValues,
            CHECKBOX_ID_PREFIX,
            checkboxGroups.length,
          );
          await persistUpdate(
            work.message,
            locale,
            tomoriState.server_id,
            guildId,
            selectedPersona,
            currentSelectedIds,
            nextSelectedIds,
            availableChannels,
          );
          return retryPersonaWorkflow();
        }

        const work = await selection.beginInPlaceWork();
        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "general.persona_workflow.loading_title",
            descriptionKey: "general.persona_workflow.loading_description",
            color: ColorCode.INFO,
          }),
        );
        const currentEntries = await whitelistRepository.getPersonaWhitelistChannels(
          tomoriState.server_id,
          selectedPersona.persona_id,
        );
        const currentSelectedIds = new Set(currentEntries.map((entry) => entry.channel_disc_id));
        const totalPages = Math.ceil(availableChannels.length / CHECKLIST_CHANNELS_PER_PAGE);
        const visibleSelectedCount = availableChannels.filter((channel) => currentSelectedIds.has(channel.id)).length;
        await work.message.replace({
          components: buildPageSelectComponents(
            locale,
            selectedPersona,
            availableChannels.length,
            totalPages,
            visibleSelectedCount,
          ),
          flags: MessageFlags.IsComponentsV2,
        });

        let pageButton: ButtonInteraction;
        try {
          const message = await work.message.fetchMessage();
          pageButton = await message.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: (candidate) =>
              candidate.user.id === interaction.user.id &&
              (candidate.customId.startsWith(PAGE_BUTTON_PREFIX) || candidate.customId === DONE_BUTTON_ID),
            time: CHECKLIST_PAGE_SELECT_TIMEOUT_MS,
          });
        } catch {
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.interaction.timeout_title",
              descriptionKey: "general.pagination.timeout",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.WARN,
            }),
          );
          return retryPersonaWorkflow();
        }

        const pagePhase = selection.useButton(pageButton);
        if (pageButton.customId === DONE_BUTTON_ID) {
          const doneWork = await pagePhase.beginInPlaceWork();
          await doneWork.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.pagination.select_persona_title",
              descriptionKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.INFO,
            }),
          );
          return retryPersonaWorkflow();
        }

        const selectedPage = Number.parseInt(pageButton.customId.replace(PAGE_BUTTON_PREFIX, ""), 10);
        if (!Number.isInteger(selectedPage) || selectedPage < 1 || selectedPage > totalPages) {
          const invalidWork = await pagePhase.beginInPlaceWork();
          await invalidWork.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.invalid_option_title",
              descriptionKey: "general.errors.invalid_option_description",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.ERROR,
            }),
          );
          return retryPersonaWorkflow();
        }

        const startIndex = (selectedPage - 1) * CHECKLIST_CHANNELS_PER_PAGE;
        const pageChannels = availableChannels.slice(startIndex, startIndex + CHECKLIST_CHANNELS_PER_PAGE);
        const checkboxGroups = buildCheckboxGroups(pageChannels, currentSelectedIds, locale);
        const modalResult = await pagePhase.openModal({
          modalCustomId: MODAL_CUSTOM_ID,
          modalTitleKey: "commands.server.whitelist.persona.modal_title",
          components: checkboxGroups,
        });
        if (modalResult.outcome !== "submitted") {
          log.info(`Persona whitelist page modal ${modalResult.outcome} for user ${user.user_id}`);
          return modalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
        }

        const modalWork = await modalResult.phase.beginInPlaceWork();
        const pageSelectedIds = collectCheckedIds(
          modalResult.phase.multiValues,
          CHECKBOX_ID_PREFIX,
          checkboxGroups.length,
        );
        const nextSelectedIds = new Set(currentSelectedIds);
        for (const channel of pageChannels) nextSelectedIds.delete(channel.id);
        for (const channelId of pageSelectedIds) nextSelectedIds.add(channelId);
        await persistUpdate(
          modalWork.message,
          locale,
          tomoriState.server_id,
          guildId,
          selectedPersona,
          currentSelectedIds,
          nextSelectedIds,
          availableChannels,
        );
        return retryPersonaWorkflow();
      },
    });
  } catch (error) {
    log.error("Error executing /server whitelist persona command", error, errorContext);
    if (workflowState.message) {
      await workflowState.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        }),
      );
      return;
    }
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
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

async function persistUpdate(
  message: PersonaWorkflowMessageController,
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
    await message.replace(
      buildPersonaWorkflowNotice({
        locale,
        titleKey: "commands.server.whitelist.persona.no_changes_title",
        descriptionKey: "commands.server.whitelist.persona.no_changes_description",
        descriptionVars: { persona_name: persona.persona_nickname },
        footerKey: "general.pagination.reloading_persona_picker",
        color: ColorCode.INFO,
      }),
    );
    return;
  }

  await whitelistRepository.replacePersonaWhitelistChannels(serverId, persona.persona_id, normalizedSelectedIds);
  invalidateWhitelistCache(guildId);
  if (normalizedSelectedIds.length === 0) {
    await message.replace(
      buildPersonaWorkflowNotice({
        locale,
        titleKey: "commands.server.whitelist.persona.success_clear_title",
        descriptionKey: "commands.server.whitelist.persona.success_clear_description",
        descriptionVars: { persona_name: persona.persona_nickname },
        footerKey: "general.pagination.reloading_persona_picker",
        color: ColorCode.SUCCESS,
      }),
    );
    log.info(`Cleared channel whitelist restriction for persona ${persona.persona_id} in server ${guildId}`);
    return;
  }

  await message.replace(
    buildPersonaWorkflowNotice({
      locale,
      titleKey: "commands.server.whitelist.persona.success_title",
      descriptionKey: "commands.server.whitelist.persona.success_description",
      descriptionVars: {
        persona_name: persona.persona_nickname,
        selected_count: normalizedSelectedIds.length.toString(),
        selected_channels: formatChecklistChannelMentions(normalizedSelectedIds, availableChannels, locale),
      },
      footerKey: "general.pagination.reloading_persona_picker",
      color: ColorCode.SUCCESS,
    }),
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
    actionRows.push({ type: ComponentType.ActionRow, components: pageButtons.slice(index, index + 5) });
  }
  const container: ContainerComponentData<ComponentInContainerData> = {
    type: ComponentType.Container,
    accentColor: Number.parseInt(ColorCode.INFO.replace("#", ""), 16),
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

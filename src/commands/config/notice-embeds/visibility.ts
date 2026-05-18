import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { CheckboxGroupOption, ModalCheckboxGroupField } from "@/types/discord/modal";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { TOOL_NOTICE_DEFINITIONS, type ToolNoticeKey } from "@/constants/toolNotices";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const MODAL_CUSTOM_ID = "config_noticeembeds_visibility_modal";
const NOTICE_CHECKBOX_ID_PREFIX = "config_noticeembeds_visibility_group";
const MAX_OPTIONS_PER_GROUP = 10;
const MAX_GROUPS_PER_MODAL = 5;
const MAX_ENTRIES_PER_MODAL = MAX_OPTIONS_PER_GROUP * MAX_GROUPS_PER_MODAL;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("visibility")
    .setDescription(localizer("en-US", "commands.config.notice-embeds.visibility.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    const tomoriState = await getCachedTomoriState(serverDiscId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const groupCount = Math.ceil(TOOL_NOTICE_DEFINITIONS.length / MAX_OPTIONS_PER_GROUP);
    if (groupCount > MAX_GROUPS_PER_MODAL) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.notice-embeds.visibility.too_many_title",
        descriptionKey: "commands.config.notice-embeds.visibility.too_many_description",
        descriptionVars: {
          count: TOOL_NOTICE_DEFINITIONS.length.toString(),
          max_entries: MAX_ENTRIES_PER_MODAL.toString(),
          max_groups: MAX_GROUPS_PER_MODAL.toString(),
        },
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const checkboxGroups = buildCheckboxGroups(locale, tomoriState.config.tool_notice_hidden_keys ?? []);
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.config.notice-embeds.visibility.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") {
      log.info(`Notice embed visibility modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    if (!modalResult.interaction) {
      log.error("Notice embed visibility modal unexpectedly missing interaction");
      return;
    }

    const selectedVisibleKeys = collectCheckedKeys(modalResult.multiValues, groupCount);
    const hiddenKeys = TOOL_NOTICE_DEFINITIONS.filter((definition) => !selectedVisibleKeys.has(definition.key)).map(
      (definition) => definition.key,
    );
    const previousHiddenKeys = new Set<ToolNoticeKey>(tomoriState.config.tool_notice_hidden_keys ?? []);
    const nextHiddenKeys = new Set<ToolNoticeKey>(hiddenKeys);

    const hiddenNow = TOOL_NOTICE_DEFINITIONS.filter(
      (definition) => !previousHiddenKeys.has(definition.key) && nextHiddenKeys.has(definition.key),
    ).map((definition) => localizer(locale, definition.labelKey));
    const restoredNow = TOOL_NOTICE_DEFINITIONS.filter(
      (definition) => previousHiddenKeys.has(definition.key) && !nextHiddenKeys.has(definition.key),
    ).map((definition) => localizer(locale, definition.labelKey));

    if (hiddenNow.length === 0 && restoredNow.length === 0) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "commands.config.notice-embeds.visibility.no_changes_title",
        descriptionKey: "commands.config.notice-embeds.visibility.no_changes_description",
        color: ColorCode.INFO,
      });
      return;
    }

    const updated = await configRepository.updateNoticeEmbedsConfig(tomoriState.server_id, {
      tool_notice_hidden_keys: hiddenKeys,
    });

    if (!updated) {
      const context: ErrorContext = {
        userId: userData.user_id,
        serverId: tomoriState.server_id,
        tomoriId: tomoriState.persona_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "config notice-embeds visibility",
        },
      };
      await log.error("Failed to update notice embed visibility config", new Error("Database update failed"), context);
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(serverDiscId);

    await replyInfoEmbed(modalResult.interaction, locale, {
      titleKey: "commands.config.notice-embeds.visibility.success_title",
      descriptionKey: "commands.config.notice-embeds.visibility.success_description",
      descriptionVars: {
        hidden_count: hiddenNow.length.toString(),
        hidden_list: formatNoticeList(hiddenNow, locale),
        restored_count: restoredNow.length.toString(),
        restored_list: formatNoticeList(restoredNow, locale),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "config notice-embeds visibility",
        guildId: interaction.guild?.id ?? interaction.user.id,
      },
    };
    await log.error("Error executing /config notice-embeds visibility", error as Error, context);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}

function buildCheckboxGroups(locale: string, hiddenKeys: ToolNoticeKey[]): ModalCheckboxGroupField[] {
  const hiddenSet = new Set(hiddenKeys);
  const checkboxGroups: ModalCheckboxGroupField[] = [];

  for (let i = 0; i < TOOL_NOTICE_DEFINITIONS.length; i += MAX_OPTIONS_PER_GROUP) {
    const chunk = TOOL_NOTICE_DEFINITIONS.slice(i, i + MAX_OPTIONS_PER_GROUP);
    const groupIndex = Math.floor(i / MAX_OPTIONS_PER_GROUP);
    const options: CheckboxGroupOption[] = chunk.map((definition) => ({
      label: safeSelectOptionText(localizer(locale, definition.labelKey)),
      value: definition.key,
      description: localizer(locale, definition.descriptionKey),
      default: !hiddenSet.has(definition.key),
    }));

    checkboxGroups.push({
      kind: "checkboxGroup",
      customId: `${NOTICE_CHECKBOX_ID_PREFIX}_${groupIndex}`,
      labelKey:
        groupIndex === 0
          ? "commands.config.notice-embeds.visibility.checkbox_label"
          : "commands.config.notice-embeds.visibility.checkbox_label_continued",
      descriptionKey: groupIndex === 0 ? "commands.config.notice-embeds.visibility.checkbox_description" : undefined,
      minValues: 0,
      maxValues: options.length,
      required: false,
      options,
    });
  }

  return checkboxGroups;
}

function collectCheckedKeys(multiValues: Record<string, string[]> | undefined, groupCount: number): Set<ToolNoticeKey> {
  const selectedKeys = new Set<ToolNoticeKey>();

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const groupValues = multiValues?.[`${NOTICE_CHECKBOX_ID_PREFIX}_${groupIndex}`] ?? [];
    for (const value of groupValues) {
      selectedKeys.add(value as ToolNoticeKey);
    }
  }

  return selectedKeys;
}

function formatNoticeList(items: string[], locale: string): string {
  return items.length > 0 ? items.map((item) => `\`${item}\``).join(", ") : localizer(locale, "commands.choices.none");
}

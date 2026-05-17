import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { CheckboxGroupOption } from "@/types/discord/modal";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository } from "@/utils/db/repositories";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow, ErrorContext } from "@/types/db/schema";

const MODAL_CUSTOM_ID = "nsfw_jailbreaks_modal";
const CHECKBOX_ID = "nsfw_jailbreaks_checkbox_group";

const JAILBREAK_OPTIONS = [
  {
    id: "injection",
    columnName: "uncensor_injection_enabled",
    labelKey: "commands.nsfw.jailbreaks.injection_option",
  },
  {
    id: "unicode_spaces",
    columnName: "uncensor_unicode_space_enabled",
    labelKey: "commands.nsfw.jailbreaks.unicode_spaces_option",
  },
  {
    id: "sanitize",
    columnName: "uncensor_sanitize_enabled",
    labelKey: "commands.nsfw.jailbreaks.sanitize_option",
  },
] as const;

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("jailbreaks").setDescription(localizer("en-US", "commands.nsfw.jailbreaks.description"));

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
    });
    return;
  }

  try {
    const tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const checkboxOptions: CheckboxGroupOption[] = JAILBREAK_OPTIONS.map((option) => ({
      label: localizer(locale, option.labelKey),
      value: option.id,
      default:
        option.id === "injection"
          ? tomoriState.config.uncensor_injection_enabled
          : option.id === "unicode_spaces"
            ? tomoriState.config.uncensor_unicode_space_enabled
            : tomoriState.config.uncensor_sanitize_enabled,
    }));

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.nsfw.jailbreaks.modal_title",
        components: [
          {
            kind: "checkboxGroup",
            customId: CHECKBOX_ID,
            labelKey: "commands.nsfw.jailbreaks.checkbox_label",
            descriptionKey: "commands.nsfw.jailbreaks.checkbox_description",
            minValues: 0,
            maxValues: checkboxOptions.length,
            required: false,
            options: checkboxOptions,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      return;
    }

    const selectedIds = new Set(modalResult.multiValues?.[CHECKBOX_ID] ?? []);
    const nextState = {
      uncensor_injection_enabled: selectedIds.has("injection"),
      uncensor_unicode_space_enabled: selectedIds.has("unicode_spaces"),
      uncensor_sanitize_enabled: selectedIds.has("sanitize"),
    };

    const noChanges =
      nextState.uncensor_injection_enabled === tomoriState.config.uncensor_injection_enabled &&
      nextState.uncensor_unicode_space_enabled === tomoriState.config.uncensor_unicode_space_enabled &&
      nextState.uncensor_sanitize_enabled === tomoriState.config.uncensor_sanitize_enabled;

    if (noChanges) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "commands.nsfw.jailbreaks.no_changes_title",
        descriptionKey: "commands.nsfw.jailbreaks.no_changes_description",
        color: ColorCode.INFO,
      });
      return;
    }

    const updated = await configRepository.updateNsfwConfig(tomoriState.server_id, nextState);

    if (!updated) {
      const context: ErrorContext = {
        tomoriId: tomoriState.tomori_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "nsfw jailbreaks",
          guildId: interaction.guild?.id ?? interaction.user.id,
        },
      };
      await log.error("Failed to update jailbreak config", new Error("Database update failed"), context);
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    await replyInfoEmbed(modalResult.interaction, locale, {
      titleKey: "commands.nsfw.jailbreaks.success_title",
      descriptionKey: "commands.nsfw.jailbreaks.success_description",
      descriptionVars: {
        enabled_count: [
          nextState.uncensor_injection_enabled,
          nextState.uncensor_unicode_space_enabled,
          nextState.uncensor_sanitize_enabled,
        ]
          .filter(Boolean)
          .length.toString(),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const state = interaction.guild?.id ? await getCachedTomoriState(interaction.guild.id) : null;
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: state?.server_id ?? null,
      tomoriId: state?.tomori_id ?? null,
      errorType: "CommandExecutionError",
      metadata: {
        command: "nsfw jailbreaks",
        guildId: interaction.guild?.id ?? interaction.user.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /nsfw jailbreaks", error as Error, context);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: localizer(locale, "general.errors.unknown_error_description"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.followUp({
      content: localizer(locale, "general.errors.unknown_error_description"),
      flags: MessageFlags.Ephemeral,
    });
  }
}

import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ModalCheckboxGroupField } from "@/types/discord/modal";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { updateTomoriConfig } from "@/utils/db/dbWrite";
import { clearFastRegenerationEntriesForGuild } from "@/utils/discord/fastRegeneration";
import { promptWithRawModal, replyInfoEmbed } from "@/utils/discord/interactionHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const FAST_REGENERATION_FEATURES_CHECKBOX_ID = "fast_regeneration_features";
const RETRY_FEATURE_VALUE = "retry";
const CONTINUE_FEATURE_VALUE = "continue";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("fast-regeneration")
    .setDescription(localizer("en-US", "commands.server.fast-regeneration.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  const guildId = interaction.guild?.id ?? "";
  let responseInteraction: ChatInputCommandInteraction | ModalSubmitInteraction = interaction;

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

    const checkboxGroups: ModalCheckboxGroupField[] = [
      {
        kind: "checkboxGroup",
        customId: FAST_REGENERATION_FEATURES_CHECKBOX_ID,
        labelKey: "commands.server.fast-regeneration.checkbox_label",
        descriptionKey: "commands.server.fast-regeneration.checkbox_description",
        minValues: 0,
        maxValues: 2,
        required: false,
        options: [
          {
            label: localizer(locale, "commands.server.fast-regeneration.retry_label"),
            description: localizer(locale, "commands.server.fast-regeneration.retry_description"),
            value: RETRY_FEATURE_VALUE,
            default: tomoriState.config.fast_regeneration_retry_enabled === true,
          },
          {
            label: localizer(locale, "commands.server.fast-regeneration.continue_label"),
            description: localizer(locale, "commands.server.fast-regeneration.continue_description"),
            value: CONTINUE_FEATURE_VALUE,
            default: tomoriState.config.fast_regeneration_continue_enabled === true,
          },
        ],
      },
    ];

    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: "server_fast_regeneration",
        modalTitleKey: "commands.server.fast-regeneration.modal_title",
        components: checkboxGroups,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") return;
    if (!modalResult.interaction) {
      log.error("Fast regeneration modal unexpectedly missing interaction");
      return;
    }
    responseInteraction = modalResult.interaction;

    const selectedFeatures = new Set(modalResult.multiValues?.[FAST_REGENERATION_FEATURES_CHECKBOX_ID] ?? []);
    const retryEnabled = selectedFeatures.has(RETRY_FEATURE_VALUE);
    const continueEnabled = selectedFeatures.has(CONTINUE_FEATURE_VALUE);
    const anyEnabled = retryEnabled || continueEnabled;

    const updatedConfig = await updateTomoriConfig(tomoriState.server_id, {
      fast_regeneration_enabled: anyEnabled,
      fast_regeneration_retry_enabled: retryEnabled,
      fast_regeneration_continue_enabled: continueEnabled,
    });

    if (!updatedConfig) {
      const context: ErrorContext = {
        tomoriId: tomoriState.tomori_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "server fast-regeneration",
          retryEnabled,
          continueEnabled,
          targetTable: "tomori_configs",
        },
      };
      await log.error(
        "Failed to update fast_regeneration_enabled config",
        new Error("Database update returned no rows"),
        context,
      );

      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(guildId);

    if (!anyEnabled) {
      await clearFastRegenerationEntriesForGuild(guildId);
    }

    const enabledText = localizer(locale, "commands.server.fast-regeneration.enabled_status");
    const disabledText = localizer(locale, "commands.server.fast-regeneration.disabled_status");
    await replyInfoEmbed(modalResult.interaction, locale, {
      titleKey: "commands.server.fast-regeneration.updated_title",
      descriptionKey: "commands.server.fast-regeneration.updated_description",
      descriptionVars: {
        retry_status: retryEnabled ? enabledText : disabledText,
        continue_status: continueEnabled ? enabledText : disabledText,
      },
      color: anyEnabled ? ColorCode.SUCCESS : ColorCode.WARN,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(guildId))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server fast-regeneration",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /server fast-regeneration command", error as Error, context);

    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}

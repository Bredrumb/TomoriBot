import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow, ErrorContext } from "../../../types/db/schema";
import { localizer } from "../../../utils/text/localizer";
import { log, ColorCode } from "../../../utils/misc/logger";
import { replyInfoEmbed, promptWithRawModal } from "../../../utils/discord/interactionHelper";
import { userRepository, configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../../utils/cache/tomoriStateCache";
import type { ModalResult } from "../../../types/discord/modal";

const MODAL_CUSTOM_ID = "memory_tagging_set_modal";
const TAGGING_SELECT_ID = "tagging_select";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("set").setDescription(localizer("en-US", "commands.memory.tagging.set.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let modalResult: ModalResult | null = null;

  try {
    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

    if (interaction.guild) {
      const blacklisted = (await userRepository.isBlacklisted(interaction.guild.id, interaction.user.id)) ?? false;
      if (blacklisted && !hasManagePermission) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.user_blacklisted_title",
          descriptionKey: "general.errors.user_blacklisted_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    if (!hasManagePermission) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.permission_denied_title",
        descriptionKey: "general.errors.permission_denied_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    modalResult = await promptWithRawModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.memory.tagging.set.modal_title",
      components: [
        {
          customId: TAGGING_SELECT_ID,
          labelKey: "commands.memory.tagging.set.select_label",
          descriptionKey: "commands.memory.tagging.set.select_description",
          placeholder: "commands.memory.tagging.set.select_placeholder",
          required: true,
          options: [
            { label: "Enabled", value: "true" },
            { label: "Disabled", value: "false" },
          ],
        },
      ],
    });

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      log.info(`Memory tagging set modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    const modalInteraction = modalResult.interaction;
    const selectedValue = modalResult.values?.[TAGGING_SELECT_ID];
    if (selectedValue !== "true" && selectedValue !== "false") {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const enabled = selectedValue === "true";

    const updated = await configRepository.updateMemoryConfig(tomoriState.server_id, {
      memory_tagging_enabled: enabled,
    });

    if (!updated) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    log.success(
      `Memory tagging set to ${enabled} for server ${tomoriState.server_id} by user ${userData.user_disc_id}`,
    );

    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.memory.tagging.set.success_title",
      descriptionKey: enabled
        ? "commands.memory.tagging.set.success_enabled_description"
        : "commands.memory.tagging.set.success_disabled_description",
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "memory tagging set",
        guildId: interaction.guild?.id,
        userDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /memory tagging set command", error, context);

    const replyTarget =
      modalResult?.interaction && (modalResult.interaction.replied || modalResult.interaction.deferred)
        ? modalResult.interaction
        : interaction.replied || interaction.deferred
          ? interaction
          : null;

    if (replyTarget) {
      await replyInfoEmbed(replyTarget, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

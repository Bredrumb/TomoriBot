import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { sql } from "@/utils/db/client";
import type { UserRow, ErrorContext } from "../../../types/db/schema";
import { localizer } from "../../../utils/text/localizer";
import { log, ColorCode } from "../../../utils/misc/logger";
import { replyInfoEmbed, promptWithRawModal } from "../../../utils/discord/interactionHelper";
import { isBlacklisted } from "../../../utils/db/dbRead";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../../utils/cache/tomoriStateCache";
import type { ModalResult } from "../../../types/discord/modal";

const MODAL_CUSTOM_ID = "memory_tagging_set_modal";
const TAGGING_SELECT_ID = "tagging_select";
const CHANNEL_TAGGING_SELECT_ID = "channel_tagging_select";

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
      const blacklisted = (await isBlacklisted(interaction.guild.id, interaction.user.id)) ?? false;
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
        {
          customId: CHANNEL_TAGGING_SELECT_ID,
          labelKey: "commands.memory.tagging.set.channel_select_label",
          descriptionKey: "commands.memory.tagging.set.channel_select_description",
          placeholder: "commands.memory.tagging.set.channel_select_placeholder",
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
    const channelValue = modalResult.values?.[CHANNEL_TAGGING_SELECT_ID];
    if (
      (selectedValue !== "true" && selectedValue !== "false") ||
      (channelValue !== "true" && channelValue !== "false")
    ) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    const enabled = selectedValue === "true";
    const channelEnabled = channelValue === "true";

    const [updatedRow] = await sql`
      UPDATE tomori_configs
      SET memory_tagging_enabled = ${enabled},
          channel_memory_enabled = ${channelEnabled}
      WHERE server_id = ${tomoriState.server_id}
      RETURNING memory_tagging_enabled, channel_memory_enabled
    `;

    if (!updatedRow) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    log.success(
      `Memory tagging set to ${enabled}, channel memory set to ${channelEnabled} for server ${tomoriState.server_id} by user ${userData.user_disc_id}`,
    );

    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.memory.tagging.set.success_title",
      descriptionKey: "commands.memory.tagging.set.success_description",
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

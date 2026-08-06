import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { configRepository } from "@/utils/db/repositories";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow, ErrorContext } from "@/types/db/schema";

/**
 * Configures the `/server stm privacy-bypass` subcommand.
 * Toggles whether private-channel STMs are allowed to appear in non-private channels,
 * bypassing the default one-way isolation guard.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("privacy-bypass")
    .setDescription(localizer("en-US", "commands.server.stm.privacy-bypass.description"));

/**
 * Toggles the STM privacy bypass for this server.
 * Default (false): private-channel STMs are isolated and cannot leak into non-private channels.
 * When enabled (true): the isolation guard is lifted and private-channel STMs flow freely.
 *
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // Guild is guaranteed by command loader's server category gate
  const guildId = interaction.guild?.id ?? "";

  // Defer the reply before async work to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    // Toggle the current value (false = isolated, true = bypass)
    const newValue = !(tomoriState.config.stm_privacy_bypass ?? false);

    const updated = await configRepository.updateChannelScopeConfig(tomoriState.server_id, {
      stm_privacy_bypass: newValue,
    });

    if (!updated) {
      const context: ErrorContext = {
        personaId: tomoriState.persona_id,
        serverId: tomoriState.server_id,
        userId: userData.user_id,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "server stm privacy-bypass",
          newValue,
          targetTable: "server_channel_scope_configs",
        },
      };
      await log.error(
        "Failed to update stm_privacy_bypass config",
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

    // Invalidate cache after successful write
    invalidateTomoriStateCache(guildId);

    await replyInfoEmbed(interaction, locale, {
      titleKey: newValue
        ? "commands.server.stm.privacy-bypass.enabled_title"
        : "commands.server.stm.privacy-bypass.disabled_title",
      descriptionKey: newValue
        ? "commands.server.stm.privacy-bypass.enabled_description"
        : "commands.server.stm.privacy-bypass.disabled_description",
      color: newValue ? ColorCode.WARN : ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: (await getCachedTomoriState(guildId))?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server stm privacy-bypass",
        options: interaction.options?.data,
      },
    };
    await log.error("Error in /server stm privacy-bypass command", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}

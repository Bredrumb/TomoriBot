/**
 * /personal stm - Configure STM (short-term memory) settings
 *
 * Phase 4: User Controls & Privacy
 *
 * Allows users to:
 * 1. Toggle cross-server memory sharing (opt-in)
 * 2. Clear all short-term memories
 */

import type { Client, ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { toggleCrossServerShortTermMemoryOptIn } from "@/utils/db/repositories";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { clearShortTermMemoryForUser } from "@/utils/cache/shortTermMemoryCache";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/**
 * Configure the subcommand structure
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("stm")
    .setDescription(localizer("en-US", "commands.personal.stm.description"))
    .addStringOption((option) =>
      option
        .setName("setting")
        .setDescription(localizer("en-US", "commands.personal.stm.option_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.personal.stm.crossserver_option"),
            value: "crossserver",
          },
          {
            name: localizer("en-US", "commands.personal.stm.clear_option"),
            value: "clear",
          },
        ),
    );

/**
 * Execute the /personal stm command
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  const setting = interaction.options.getString("setting", true);

  // Defer before async work (Pattern 2: Commands with Async Work)
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (setting === "crossserver") {
      // Toggle cross-server opt-in
      const newValue = await toggleCrossServerShortTermMemoryOptIn(interaction.user.id);

      // Invalidate user cache to ensure fresh data on next access
      invalidateUserCache(interaction.user.id);

      log.success(
        `[personalStmCommand] Toggled cross-server short-term memory opt-in - userId=${interaction.user.id}, newValue=${newValue}`,
      );

      // Reply with status
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.SUCCESS,
        titleKey: "commands.personal.stm.crossserver.title",
        descriptionKey: newValue
          ? "commands.personal.stm.crossserver.enabled"
          : "commands.personal.stm.crossserver.disabled",
      });
    } else if (setting === "clear") {
      // Clear all short-term memories for user
      clearShortTermMemoryForUser(interaction.user.id);

      log.success(`[personalStmCommand] Cleared all short-term memories for user - userId=${interaction.user.id}`);

      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.SUCCESS,
        titleKey: "commands.personal.stm.clear.title",
        descriptionKey: "commands.personal.stm.clear.success",
      });
    } else {
      // Unknown setting (should not happen due to choices validation)
      log.warn(`[personalStmCommand] Unknown setting value - setting=${setting}, userId=${interaction.user.id}`);

      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
      });
    }
  } catch (error) {
    await log.error(
      `[personalStmCommand] Failed to execute stm command - setting=${setting}, userId=${interaction.user.id}`,
      error,
      {
        errorType: "CACHE_COMMAND_ERROR",
        metadata: { userDiscId: interaction.user.id, setting },
      },
    );

    await replyInfoEmbed(interaction, locale, {
      color: ColorCode.ERROR,
      titleKey: "general.errors.critical_error_title",
      descriptionKey: "general.errors.critical_error_description",
      footerKey: "genai.generic_error_footer",
    });
  }
}

import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/**
 * Configure the /help deliberate-trigger-mode subcommand.
 * Explains how normal triggering works and what DTM changes.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("deliberate-trigger-mode")
    .setDescription(localizer("en-US", "commands.help.deliberate-trigger-mode.description"));

/**
 * Execute the /help deliberate-trigger-mode command.
 *
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const serverDtm = commandRegistry.getCommandMention("server", "deliberate-trigger-mode");
    const personalDtm = commandRegistry.getCommandMention("personal", "deliberate-trigger-mode");
    const botRespond = commandRegistry.getCommandMention("bot", "respond");

    const embedOptions: SummaryEmbedOptions = {
      titleKey: "commands.help.deliberate-trigger-mode.title",
      descriptionKey: "commands.help.deliberate-trigger-mode.embed_description",
      color: ColorCode.INFO,
      fields: [
        {
          nameKey: "commands.help.deliberate-trigger-mode.normal_title",
          value: localizer(locale, "commands.help.deliberate-trigger-mode.normal_description", {
            botRespond,
          }),
          inline: false,
        },
        {
          nameKey: "commands.help.deliberate-trigger-mode.enabled_title",
          value: localizer(locale, "commands.help.deliberate-trigger-mode.enabled_description", {
            botRespond,
          }),
          inline: false,
        },
        {
          nameKey: "commands.help.deliberate-trigger-mode.personal_title",
          value: localizer(locale, "commands.help.deliberate-trigger-mode.personal_description", {
            personalDtm,
            serverDtm,
          }),
          inline: false,
        },
      ],
      footerKey: "commands.help.deliberate-trigger-mode.footer",
    };

    await replySummaryEmbed(interaction, locale, embedOptions, MessageFlags.Ephemeral);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help deliberate-trigger-mode",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help deliberate-trigger-mode command", error as Error, context);

    const errorMessage = localizer(locale, "general.errors.unknown_error_description");
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: errorMessage,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      log.error("Failed to send error reply for /help deliberate-trigger-mode", replyError, context);
    }
  }
}

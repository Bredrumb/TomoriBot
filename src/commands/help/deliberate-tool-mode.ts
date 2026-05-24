import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import { replySummaryEmbed } from "@/utils/discord/interactionHelper";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/**
 * Configure the /help deliberate-tool-mode subcommand.
 * Explains how deliberate tool mode scopes tool declarations.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("deliberate-tool-mode")
    .setDescription(localizer("en-US", "commands.help.deliberate-tool-mode.description"));

/**
 * Execute the /help deliberate-tool-mode command.
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
    const serverDtm = commandRegistry.getCommandMention("server", "deliberate-tool-mode");
    const personalDtm = commandRegistry.getCommandMention("personal", "deliberate-tool-mode");
    const triggerCommand = commandRegistry.getCommandMention("server", "deliberate-tool-trigger");
    const thoughtLogs = commandRegistry.getCommandMention("server", "thought-logs-channel");

    const embedOptions: SummaryEmbedOptions = {
      titleKey: "commands.help.deliberate-tool-mode.title",
      descriptionKey: "commands.help.deliberate-tool-mode.embed_description",
      color: ColorCode.INFO,
      fields: [
        {
          nameKey: "commands.help.deliberate-tool-mode.what_title",
          value: localizer(locale, "commands.help.deliberate-tool-mode.what_description"),
          inline: false,
        },
        {
          nameKey: "commands.help.deliberate-tool-mode.intent_title",
          value: localizer(locale, "commands.help.deliberate-tool-mode.intent_description"),
          inline: false,
        },
        {
          nameKey: "commands.help.deliberate-tool-mode.custom_title",
          value: localizer(locale, "commands.help.deliberate-tool-mode.custom_description", {
            triggerCommand,
          }),
          inline: false,
        },
        {
          nameKey: "commands.help.deliberate-tool-mode.control_title",
          value: localizer(locale, "commands.help.deliberate-tool-mode.control_description", {
            personalDtm,
            serverDtm,
            thoughtLogs,
          }),
          inline: false,
        },
      ],
      footerKey: "commands.help.deliberate-tool-mode.footer",
    };

    await replySummaryEmbed(interaction, locale, embedOptions, MessageFlags.Ephemeral);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help deliberate-tool-mode",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help deliberate-tool-mode command", error as Error, context);

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
      log.error("Failed to send error reply for /help deliberate-tool-mode", replyError, context);
    }
  }
}

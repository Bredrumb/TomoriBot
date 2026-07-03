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
import { DOCS_PATHS } from "@/utils/discord/docsLinks";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/**
 * Configure the /help spotlight subcommand.
 * Explains personal spotlight behavior, setup flow, auto-trigger, and limits.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("spotlight").setDescription(localizer("en-US", "commands.help.spotlight.description"));

/**
 * Execute the /help spotlight command.
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
    const personalSpotlightSet = commandRegistry.getCommandMention("personal", "spotlight", "set");
    const personalSpotlightManage = commandRegistry.getCommandMention("personal", "spotlight", "manage");
    const serverWhitelistPersona = commandRegistry.getCommandMention("server", "whitelist", "persona");

    const embedOptions: SummaryEmbedOptions = {
      titleKey: "commands.help.spotlight.title",
      descriptionKey: "commands.help.spotlight.embed_description",
      docsPath: DOCS_PATHS.PERSONAL_SPOTLIGHT,
      color: ColorCode.INFO,
      fields: [
        {
          nameKey: "commands.help.spotlight.what_title",
          value: localizer(locale, "commands.help.spotlight.what_description"),
          inline: false,
        },
        {
          nameKey: "commands.help.spotlight.set_title",
          value: localizer(locale, "commands.help.spotlight.set_description", {
            personalSpotlightSet,
          }),
          inline: false,
        },
        {
          nameKey: "commands.help.spotlight.auto_trigger_title",
          value: localizer(locale, "commands.help.spotlight.auto_trigger_description"),
          inline: false,
        },
        {
          nameKey: "commands.help.spotlight.rules_title",
          value: localizer(locale, "commands.help.spotlight.rules_description", {
            serverWhitelistPersona,
          }),
          inline: false,
        },
        {
          nameKey: "commands.help.spotlight.manage_title",
          value: localizer(locale, "commands.help.spotlight.manage_description", {
            personalSpotlightManage,
          }),
          inline: false,
        },
      ],
      footerKey: "commands.help.spotlight.footer",
    };

    await replySummaryEmbed(interaction, locale, embedOptions, MessageFlags.Ephemeral);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help spotlight",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help spotlight command", error as Error, context);

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
      log.error("Failed to send error reply for /help spotlight", replyError, context);
    }
  }
}

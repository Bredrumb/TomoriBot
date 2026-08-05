import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import type { ErrorContext } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { DOCS_PATHS } from "@/utils/discord/docsLinks";
import { version } from "../../../package.json";

/**
 * Configure the /help features subcommand
 * Shows users what TomoriBot can do based on chatCapabilities.md
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("features").setDescription(localizer("en-US", "commands.help.features.description"));

/**
 * Execute the /help features command
 * Displays TomoriBot's capabilities and features
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    await replySummaryEmbed(
      interaction,
      locale,
      {
        titleKey: "commands.help.features.title",
        titleVars: { version },
        descriptionKey: "commands.help.features.embed_description",
        docsPath: DOCS_PATHS.FEATURES,
        color: ColorCode.INFO,
        fields: [
          {
            nameKey: "commands.help.features.summary_chat_title",
            value: localizer(locale, "commands.help.features.summary_chat_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.features.summary_knowledge_title",
            value: localizer(locale, "commands.help.features.summary_knowledge_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.features.summary_capabilities_title",
            value: localizer(locale, "commands.help.features.summary_capabilities_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.features.summary_reference_title",
            value: localizer(locale, "commands.help.features.summary_reference_description"),
            inline: false,
          },
        ],
        footerKey: "commands.help.features.footer",
      },
      MessageFlags.Ephemeral,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help features",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help features command", error as Error, context);

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
      log.error("Failed to send error reply for /help features", replyError, context);
    }
  }
}

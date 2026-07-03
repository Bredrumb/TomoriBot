import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import type { ErrorContext } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { DOCS_PATHS } from "@/utils/discord/docsLinks";

/**
 * Configure the /help matrix subcommand
 * Explains Matrix bridge setup, usage, and current limitations
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("matrix").setDescription(localizer("en-US", "commands.help.matrix.description"));

/**
 * Execute the /help matrix command
 * Displays Matrix bridge setup and limitation guidance
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
    const serverMatrixLinkMention = commandRegistry.getCommandMention("server", "matrix", "link");
    const supportServerMention = commandRegistry.getCommandMention("support", "discord");
    const botUserId = process.env.MATRIX_BOT_USER_ID ?? localizer(locale, "commands.help.matrix.bot_user_fallback");

    await replySummaryEmbed(
      interaction,
      locale,
      {
        titleKey: "commands.help.matrix.title",
        descriptionKey: "commands.help.matrix.embed_description",
        docsPath: DOCS_PATHS.MATRIX_BRIDGE,
        color: ColorCode.INFO,
        fields: [
          {
            nameKey: "commands.help.matrix.setup_title",
            value: localizer(locale, "commands.help.matrix.setup_description", {
              botUserId,
              serverMatrixLink: serverMatrixLinkMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.matrix.room_id_title",
            value: localizer(locale, "commands.help.matrix.room_id_description", {
              serverMatrixLink: serverMatrixLinkMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.matrix.usage_title",
            value: localizer(locale, "commands.help.matrix.usage_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.matrix.limitations_title",
            value: localizer(locale, "commands.help.matrix.limitations_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.matrix.troubleshooting_title",
            value: localizer(locale, "commands.help.matrix.troubleshooting_description", {
              botUserId,
              serverMatrixLink: serverMatrixLinkMention,
              supportServer: supportServerMention,
            }),
            inline: false,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help matrix",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help matrix command", error as Error, context);

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
      log.error("Failed to send error reply for /help matrix", replyError, context);
    }
  }
}

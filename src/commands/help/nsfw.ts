import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import type { ErrorContext } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { DOCS_PATHS } from "@/utils/discord/docsLinks";

/**
 * Configure the /help nsfw subcommand
 * Guides users on how to enable age-restricted commands
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("nsfw").setDescription(localizer("en-US", "commands.help.nsfw.description"));

/**
 * Execute the /help nsfw command
 * Displays instructions for enabling and using NSFW commands
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
        titleKey: "commands.help.nsfw.title",
        descriptionKey: "commands.help.nsfw.embed_description",
        docsPath: DOCS_PATHS.AGE_RESTRICTED_COMMANDS,
        color: ColorCode.WARN,
        fields: [
          {
            nameKey: "commands.help.nsfw.enable_title",
            value: localizer(locale, "commands.help.nsfw.enable_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.nsfw.channel_title",
            value: localizer(locale, "commands.help.nsfw.channel_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.nsfw.warning_title",
            value: localizer(locale, "commands.help.nsfw.warning_description"),
            inline: false,
          },
        ],
        footerKey: "commands.help.nsfw.footer",
      },
      MessageFlags.Ephemeral,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help nsfw",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help nsfw command", error as Error, context);

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
      log.error("Failed to send error reply for /help nsfw", replyError, context);
    }
  }
}

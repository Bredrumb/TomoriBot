import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { DOCS_PATHS } from "@/utils/discord/docsLinks";

/**
 * Configure the /help mcp subcommand.
 * Covers adding online MCPs (Smithery), local MCPs (self-hosted only),
 * removing servers, and security warnings.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("mcp").setDescription(localizer("en-US", "commands.help.mcp.description"));

/**
 * Execute the /help mcp command.
 * Displays a step-by-step guide for setting up MCP tool servers.
 *
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const configMcpAddMention = commandRegistry.getCommandMention("mcp", "add");

    const embedOptions: SummaryEmbedOptions = {
      titleKey: "commands.help.mcp.title",
      descriptionKey: "commands.help.mcp.description_text",
      docsPath: DOCS_PATHS.MCP,
      color: ColorCode.INFO,
      fields: [
        {
          nameKey: "commands.help.mcp.online_title",
          value: localizer(locale, "commands.help.mcp.online_summary_description", {
            configMcpAdd: configMcpAddMention,
          }),
          inline: false,
        },
        {
          nameKey: "commands.help.mcp.local_title",
          value: localizer(locale, "commands.help.mcp.local_summary_description"),
          inline: false,
        },
        {
          nameKey: "commands.help.mcp.security_title",
          value: localizer(locale, "commands.help.mcp.security_description"),
          inline: false,
        },
      ],
      footerKey: "commands.help.mcp.footer",
    };

    await replySummaryEmbed(interaction, locale, embedOptions, MessageFlags.Ephemeral);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help mcp",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help mcp command", error as Error, context);

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
      log.error("Failed to send error reply for /help mcp", replyError, context);
    }
  }
}

import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { commandRegistry } from "@/utils/discord/commandRegistry";

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
    // Resolve command mentions for cross-references in the guide
    const configMcpAddMention = commandRegistry.getCommandMention("mcp", "add");
    const configMcpRemoveMention = commandRegistry.getCommandMention("mcp", "remove");

    const embedOptions: SummaryEmbedOptions = {
      titleKey: "commands.help.mcp.title",
      descriptionKey: "commands.help.mcp.description_text",
      color: ColorCode.INFO,
      fields: [
        // 1. Smithery.ai online MCP walkthrough
        {
          nameKey: "commands.help.mcp.online_title",
          value: localizer(locale, "commands.help.mcp.online_description", {
            configMcpAdd: configMcpAddMention,
          }),
          inline: false,
        },
        // 2. Local MCP servers (self-hosted instances only)
        {
          nameKey: "commands.help.mcp.local_title",
          value: localizer(locale, "commands.help.mcp.local_description"),
          inline: false,
        },
        // 3. How to remove an MCP server
        {
          nameKey: "commands.help.mcp.removing_title",
          value: localizer(locale, "commands.help.mcp.removing_description", {
            configMcpRemove: configMcpRemoveMention,
          }),
          inline: false,
        },
        // 4. Security warning about malicious MCP servers
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

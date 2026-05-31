import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import type { ErrorContext } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/interactionHelper";
import { commandRegistry } from "@/utils/discord/commandRegistry";

/**
 * Configure the /help memory subcommand
 * Explains the memory command system
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("memory").setDescription(localizer("en-US", "commands.help.memory.description"));

/**
 * Execute the /help memory command
 * Displays information about TomoriBot's memory system
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
    // Get command mentions for cross-references
    const memoryPersonalAddMention = commandRegistry.getCommandMention("memory", "personal", "add");
    const memoryPersonalRemoveMention = commandRegistry.getCommandMention("memory", "personal", "remove");
    const memoryPersonalExportMention = commandRegistry.getCommandMention("memory", "personal", "export");
    const memoryServerAddMention = commandRegistry.getCommandMention("memory", "server", "add");
    const memoryServerRemoveMention = commandRegistry.getCommandMention("memory", "server", "remove");
    const memoryServerExportMention = commandRegistry.getCommandMention("memory", "server", "export");
    const statusMention = commandRegistry.getCommandMention("tool", "status");
    const helpCustomizationMention = commandRegistry.getCommandMention("help", "customization");
    const personalStmMention = commandRegistry.getCommandMention("personal", "stm");

    // Use replySummaryEmbed to show structured memory guide
    await replySummaryEmbed(
      interaction,
      locale,
      {
        titleKey: "commands.help.memory.title",
        descriptionKey: "commands.help.memory.embed_description",
        descriptionVars: {
          helpCustomization: helpCustomizationMention,
        },
        color: ColorCode.INFO,
        fields: [
          {
            nameKey: "commands.help.memory.teaching_title",
            value: localizer(locale, "commands.help.memory.teaching_description", {
              memoryPersonalAdd: memoryPersonalAddMention,
              memoryServerAdd: memoryServerAddMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.memory.forgetting_title",
            value: localizer(locale, "commands.help.memory.forgetting_description", {
              memoryPersonalRemove: memoryPersonalRemoveMention,
              memoryServerRemove: memoryServerRemoveMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.memory.how_it_works_title",
            value: localizer(locale, "commands.help.memory.how_it_works_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.memory.tips_title",
            value: localizer(locale, "commands.help.memory.tips_description", {
              memoryPersonalExport: memoryPersonalExportMention,
              memoryServerExport: memoryServerExportMention,
              status: statusMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.memory.documents_title",
            value: localizer(locale, "commands.help.memory.documents_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.memory.shortterm_title",
            value: localizer(locale, "commands.help.memory.shortterm_description", {
              personalStm: personalStmMention,
              personalStmClear: personalStmMention,
            }),
            inline: false,
          },
        ],
      },

      MessageFlags.Ephemeral,
    );
  } catch (error) {
    // Log error with context
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help memory",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help memory command", error as Error, context);

    // Inform user of error (ephemeral)
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
      // Log if even the error reply fails
      log.error("Failed to send error reply for /help memory", replyError, context);
    }
  }
}

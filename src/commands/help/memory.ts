import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import type { ErrorContext } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { DOCS_PATHS } from "@/utils/discord/docsLinks";
import { legalNoticeSuffix } from "@/utils/misc/legalNotice";

/**
 * Configure the /help memory subcommand
 * Explains the memory command system
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("memory").setDescription(localizer("en-US", "commands.help.memory.description"));

/**
 * Execute the /help memory command
 * Displays information about TomoriBot's memory system
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const memoryPersonalAddMention = commandRegistry.getCommandMention("memory", "personal", "add");
    const memoryPersonalRemoveMention = commandRegistry.getCommandMention("memory", "personal", "remove");
    const memoryPersonalExportMention = commandRegistry.getCommandMention("memory", "personal", "export");
    const memoryServerAddMention = commandRegistry.getCommandMention("memory", "server", "add");
    const memoryServerRemoveMention = commandRegistry.getCommandMention("memory", "server", "remove");
    const memoryServerExportMention = commandRegistry.getCommandMention("memory", "server", "export");
    const statusMention = commandRegistry.getCommandMention("tool", "status");
    const helpCustomizationMention = commandRegistry.getCommandMention("help", "customization");
    const personalStmMention = commandRegistry.getCommandMention("personal", "stm");

    await replySummaryEmbed(
      interaction,
      locale,
      {
        titleKey: "commands.help.memory.title",
        descriptionKey: "commands.help.memory.embed_description",
        descriptionVars: {
          helpCustomization: helpCustomizationMention,
        },
        docsPath: DOCS_PATHS.MEMORY,
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
              legalNotice: legalNoticeSuffix(locale, "general.legal.data_handling_reference"),
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
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help memory",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help memory command", error as Error, context);

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
      log.error("Failed to send error reply for /help memory", replyError, context);
    }
  }
}

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
import { DOCS_PATHS } from "@/utils/discord/docsLinks";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/**
 * Configure the /help memory-tagging subcommand.
 * Explains keyword and channel tag behavior for memories.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("memory-tagging").setDescription(localizer("en-US", "commands.help.memory-tagging.description"));

/**
 * Execute the /help memory-tagging command.
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
    const memoryTaggingSetMention = commandRegistry.getCommandMention("memory", "tagging", "set");
    const toolPromptSnapshotMention = commandRegistry.getCommandMention("tool", "prompt", "snapshot");

    const embedOptions: SummaryEmbedOptions = {
      titleKey: "commands.help.memory-tagging.title",
      descriptionKey: "commands.help.memory-tagging.embed_description",
      descriptionVars: {
        memoryTaggingSet: memoryTaggingSetMention,
      },
      docsPath: DOCS_PATHS.MEMORY_TAGGING,
      color: ColorCode.INFO,
      fields: [
        {
          nameKey: "commands.help.memory-tagging.keywords_title",
          value: localizer(locale, "commands.help.memory-tagging.keywords_description", {
            toolPromptSnapshot: toolPromptSnapshotMention,
          }),
          inline: false,
        },
        {
          nameKey: "commands.help.memory-tagging.channels_title",
          value: localizer(locale, "commands.help.memory-tagging.channels_description"),
          inline: false,
        },
      ],
    };

    await replySummaryEmbed(interaction, locale, embedOptions, MessageFlags.Ephemeral);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help memory-tagging",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help memory-tagging command", error as Error, context);

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
      log.error("Failed to send error reply for /help memory-tagging", replyError, context);
    }
  }
}

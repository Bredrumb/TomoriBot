import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { commandRegistry } from "@/utils/discord/commandRegistry";

/**
 * Configure the /help stm subcommand.
 * Explains the server-admin short-term memory (STM) customization surface.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("stm").setDescription(localizer("en-US", "commands.help.stm.description"));

/**
 * Execute the /help stm command.
 * Displays a structured guide to the `/server stm …` and `/persona stm …`
 * configuration commands: cadence, render modes, crude-message depth, nudge
 * placement, categories, and prompt overrides.
 *
 * @param _client - Discord client instance (unused)
 * @param interaction - Command interaction
 * @param userData - Invoking user's row (for error context)
 * @param locale - Resolved interaction locale
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    // Resolve cross-references into clickable command mentions.
    //    slash-command chip, falling back to plain text if not yet registered.
    const stmParametersMention = commandRegistry.getCommandMention("server", "stm", "parameters");
    const stmPromptEditMention = commandRegistry.getCommandMention("server", "stm", "prompt-edit");
    const stmCategoriesEditMention = commandRegistry.getCommandMention("server", "stm", "categories-edit");
    const stmManageMention = commandRegistry.getCommandMention("server", "stm", "manage");
    const stmPrivacyBypassMention = commandRegistry.getCommandMention("server", "stm", "privacy-bypass");
    const personaStmEditMention = commandRegistry.getCommandMention("persona", "stm", "edit");
    const helpMemoryMention = commandRegistry.getCommandMention("help", "memory");
    await replySummaryEmbed(
      interaction,
      locale,
      {
        titleKey: "commands.help.stm.title",
        descriptionKey: "commands.help.stm.embed_description",
        descriptionVars: {
          helpMemory: helpMemoryMention,
        },
        color: ColorCode.INFO,
        fields: [
          {
            // Command mentions live in the field TITLES, so they must be passed as
            // nameVars: the field value carries no mention placeholders.
            nameKey: "commands.help.stm.parameters_title",
            nameVars: { stmParameters: stmParametersMention },
            value: localizer(locale, "commands.help.stm.parameters_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.stm.nudge_title",
            value: localizer(locale, "commands.help.stm.nudge_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.stm.categories_title",
            nameVars: { stmCategoriesEdit: stmCategoriesEditMention },
            value: localizer(locale, "commands.help.stm.categories_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.stm.prompts_title",
            nameVars: { stmPromptEdit: stmPromptEditMention },
            value: localizer(locale, "commands.help.stm.prompts_description"),
            inline: false,
          },
          {
            // This field keeps its mentions in the value, so they go in the value vars.
            nameKey: "commands.help.stm.manage_title",
            value: localizer(locale, "commands.help.stm.manage_description", {
              stmManage: stmManageMention,
              stmPrivacyBypass: stmPrivacyBypassMention,
              personaStmEdit: personaStmEditMention,
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
        commandName: "/help stm",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help stm command", error as Error, context);

    const errorMessage = localizer(locale, "general.errors.unknown_error_description");
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
      }
    } catch (replyError) {
      log.error("Failed to send error reply for /help stm", replyError, context);
    }
  }
}

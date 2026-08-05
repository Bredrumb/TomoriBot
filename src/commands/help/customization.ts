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
 * Configure the /help customization subcommand
 * Comprehensive guide to customizing TomoriBot's behavior and personality
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("customization").setDescription(localizer("en-US", "commands.help.customization.description"));

/**
 * Execute the /help customization command
 * Displays comprehensive customization guide in 5 consecutive embeds
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const helpMemoryMention = commandRegistry.getCommandMention("help", "memory");
    const personaCreateMention = commandRegistry.getCommandMention("persona", "create");
    const personaGenerateMention = commandRegistry.getCommandMention("persona", "generate");
    const personaAttributeAddMention = commandRegistry.getCommandMention("persona", "attribute", "add");
    const personaSampleDialogueAddMention = commandRegistry.getCommandMention("persona", "sample-dialogue", "add");
    const configModelMention = commandRegistry.getCommandMention("model", "text");
    const configHumanizerMention = commandRegistry.getCommandMention("config", "humanizer");
    const configSystemPromptSetMention = commandRegistry.getCommandMention("config", "system-prompt", "set");
    const capabilitiesManageMention = commandRegistry.getCommandMention("capabilities", "manage");
    const serverWhitelistChannelMention = commandRegistry.getCommandMention("server", "whitelist", "channel");

    await replySummaryEmbed(
      interaction,
      locale,
      {
        titleKey: "commands.help.customization.embed1_title",
        descriptionKey: "commands.help.customization.embed1_description",
        descriptionVars: {
          helpMemory: helpMemoryMention,
        },
        docsPath: DOCS_PATHS.MULTIPLE_PERSONAS,
        color: ColorCode.INFO,
        fields: [
          {
            nameKey: "commands.help.customization.summary_personas_title",
            value: localizer(locale, "commands.help.customization.summary_personas_description", {
              personaCreate: personaCreateMention,
              personaGenerate: personaGenerateMention,
              personaAttributeAdd: personaAttributeAddMention,
              personaSampleDialogueAdd: personaSampleDialogueAddMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.customization.summary_behavior_title",
            value: localizer(locale, "commands.help.customization.summary_behavior_description", {
              configModel: configModelMention,
              configHumanizer: configHumanizerMention,
              configSystemPromptSet: configSystemPromptSetMention,
              capabilitiesManage: capabilitiesManageMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.customization.summary_server_title",
            value: localizer(locale, "commands.help.customization.summary_server_description", {
              serverWhitelistChannel: serverWhitelistChannelMention,
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
        commandName: "/help customization",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help customization command", error as Error, context);

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
      log.error("Failed to send error reply for /help customization", replyError, context);
    }
  }
}

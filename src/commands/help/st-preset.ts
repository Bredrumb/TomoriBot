import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyPaginatedStatusPages } from "@/utils/discord/ui/statusComponents";
import { commandRegistry } from "@/utils/discord/commandRegistry";

/**
 * Configure the /help st-preset subcommand.
 * Explains how SillyTavern preset import and prompt assembly behave in TomoriBot.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("st-preset").setDescription(localizer("en-US", "commands.help.st-preset.description"));

/**
 * Execute the /help st-preset command.
 * Sends an ephemeral paginated guide focused on ST-facing behavior and limitations.
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const stPresetImportMention = commandRegistry.getCommandMention("st-preset", "import");
    const stPresetToggleMention = commandRegistry.getCommandMention("st-preset", "node", "toggle");
    const stPresetRemoveMention = commandRegistry.getCommandMention("st-preset", "remove");
    const configSystemPromptSetMention = commandRegistry.getCommandMention("config", "system-prompt", "set");
    const personaPromptSetMention = commandRegistry.getCommandMention("persona", "prompt", "set");
    const personaAttributeAddMention = commandRegistry.getCommandMention("persona", "attribute", "add");
    const personaSampleDialogueAddMention = commandRegistry.getCommandMention("persona", "sample-dialogue", "add");
    const botImpersonateMention = commandRegistry.getCommandMention("bot", "impersonate");

    const pages: SummaryEmbedOptions[] = [
      {
        titleKey: "commands.help.st-preset.embed1_title",
        descriptionKey: "commands.help.st-preset.embed1_description",
        descriptionVars: {
          stPresetImport: stPresetImportMention,
          stPresetToggle: stPresetToggleMention,
          stPresetRemove: stPresetRemoveMention,
        },
        color: ColorCode.INFO,
        fields: [
          {
            nameKey: "commands.help.st-preset.embed1_controls_title",
            value: localizer(locale, "commands.help.st-preset.embed1_controls_description"),
            inline: false,
          },
          {
            nameKey: "commands.help.st-preset.embed1_still_sent_title",
            value: localizer(locale, "commands.help.st-preset.embed1_still_sent_description", {
              configSystemPromptSet: configSystemPromptSetMention,
              personaPromptSet: personaPromptSetMention,
              personaAttributeAdd: personaAttributeAddMention,
              personaSampleDialogueAdd: personaSampleDialogueAddMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.st-preset.embed1_mapping_title",
            value: localizer(locale, "commands.help.st-preset.embed1_mapping_description", {
              configSystemPromptSet: configSystemPromptSetMention,
              personaPromptSet: personaPromptSetMention,
              personaAttributeAdd: personaAttributeAddMention,
              personaSampleDialogueAdd: personaSampleDialogueAddMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.st-preset.embed1_system_prompt_title",
            value: localizer(locale, "commands.help.st-preset.embed1_system_prompt_description", {
              configSystemPromptSet: configSystemPromptSetMention,
            }),
            inline: false,
          },
        ],
        footerKey: "commands.help.st-preset.embed1_footer",
      },
      {
        titleKey: "commands.help.st-preset.embed2_title",
        descriptionKey: "commands.help.st-preset.embed2_description",
        descriptionVars: {
          stPresetToggle: stPresetToggleMention,
        },
        color: ColorCode.INFO,
        fields: [],
        footerKey: "commands.help.st-preset.embed2_footer",
        footerVars: {
          stPresetToggle: stPresetToggleMention,
        },
      },
      {
        titleKey: "commands.help.st-preset.embed3_title",
        descriptionKey: "commands.help.st-preset.embed3_description",
        descriptionVars: {
          botImpersonate: botImpersonateMention,
          configSystemPromptSet: configSystemPromptSetMention,
          stPresetRemove: stPresetRemoveMention,
        },
        color: ColorCode.INFO,
        fields: [],
        footerKey: "commands.help.st-preset.embed3_footer",
        footerVars: {
          stPresetRemove: stPresetRemoveMention,
        },
      },
    ];

    await replyPaginatedStatusPages(interaction, locale, pages, MessageFlags.Ephemeral);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help st-preset",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help st-preset command", error as Error, context);

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
      log.error("Failed to send error reply for /help st-preset", replyError, context);
    }
  }
}

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
 * Configure the /help setup subcommand
 * Guides new users through first-time server configuration
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("setup").setDescription(localizer("en-US", "commands.help.setup.description"));

/**
 * Execute the /help setup command
 * Displays first-time setup guide for TomoriBot
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const helpApikeyMention = commandRegistry.getCommandMention("help", "api-key");
    const configSetupMention = commandRegistry.getCommandMention("config", "setup");
    const serverInitializeExpressionsMention = commandRegistry.getCommandMention("server", "initialize", "expressions");
    const serverTriggerMention = commandRegistry.getCommandMention("server", "trigger", "add");
    const configPermissionsMention = commandRegistry.getCommandMention("config", "tools", "manage");
    const serverAutotriggerMention = commandRegistry.getCommandMention("server", "auto-trigger", "channels");
    const personaMention = commandRegistry.getCommandMention("persona");
    const serverMention = commandRegistry.getCommandMention("server");
    const personalMention = commandRegistry.getCommandMention("personal");
    const memoryMention = commandRegistry.getCommandMention("memory");
    const configMention = commandRegistry.getCommandMention("config");
    const helpFeaturesMention = commandRegistry.getCommandMention("help", "features");
    const helpMemoryMention = commandRegistry.getCommandMention("help", "memory");
    const helpCustomizationMention = commandRegistry.getCommandMention("help", "customization");
    const supportServerMention = commandRegistry.getCommandMention("support", "discord");
    const configApiKeySetMention = commandRegistry.getCommandMention("provider", "add");

    await replySummaryEmbed(
      interaction,
      locale,
      {
        titleKey: "commands.help.setup.title",
        descriptionKey: "commands.help.setup.embed_description",
        docsPath: DOCS_PATHS.QUICKSTART,
        color: ColorCode.SUCCESS,
        fields: [
          {
            nameKey: "commands.help.setup.step1_title",
            value: localizer(locale, "commands.help.setup.step1_description", {
              helpApikey: helpApikeyMention,
              configApiKeySet: configApiKeySetMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.setup.step2_title",
            value: localizer(locale, "commands.help.setup.step2_description", {
              configSetup: configSetupMention,
              serverInitializeExpressions: serverInitializeExpressionsMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.setup.step3_title",
            value: localizer(locale, "commands.help.setup.step3_description", {
              serverTrigger: serverTriggerMention,
              configPermissions: configPermissionsMention,
              serverAutotrigger: serverAutotriggerMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.setup.step4_title",
            value: localizer(locale, "commands.help.setup.step4_description", {
              persona: personaMention,
              server: serverMention,
              personal: personalMention,
              memory: memoryMention,
              config: configMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.setup.need_help_title",
            value: localizer(locale, "commands.help.setup.need_help_description", {
              helpFeatures: helpFeaturesMention,
              helpMemory: helpMemoryMention,
              helpCustomization: helpCustomizationMention,
              supportServer: supportServerMention,
              legalNotice: legalNoticeSuffix(locale, "general.legal.setup_agreement"),
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
        commandName: "/help setup",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help setup command", error as Error, context);

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
      log.error("Failed to send error reply for /help setup", replyError, context);
    }
  }
}

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
 * Configure the /help data subcommand
 * Explains data management (export, import, delete) and privacy policy
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("data").setDescription(localizer("en-US", "commands.help.data.description"));

/**
 * Execute the /help data command
 * Displays data management and privacy information
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const memoryPersonalExportMention = commandRegistry.getCommandMention("memory", "personal", "export");
    const memoryServerExportMention = commandRegistry.getCommandMention("memory", "server", "export");
    const personalConfigExportMention = commandRegistry.getCommandMention("personal", "config", "export");
    const serverConfigExportMention = commandRegistry.getCommandMention("server", "config", "export");
    const memoryPersonalImportMention = commandRegistry.getCommandMention("memory", "personal", "import");
    const memoryServerImportMention = commandRegistry.getCommandMention("memory", "server", "import");
    const personalConfigImportMention = commandRegistry.getCommandMention("personal", "config", "import");
    const serverConfigImportMention = commandRegistry.getCommandMention("server", "config", "import");
    const memoryPersonalRemoveMention = commandRegistry.getCommandMention("memory", "personal", "remove");
    const memoryServerRemoveMention = commandRegistry.getCommandMention("memory", "server", "remove");
    const personalConfigRemoveMention = commandRegistry.getCommandMention("personal", "config", "remove");
    const serverConfigRemoveMention = commandRegistry.getCommandMention("server", "config", "remove");
    const personaExportMention = commandRegistry.getCommandMention("persona", "export");
    const personalPrivacyMention = commandRegistry.getCommandMention("personal", "privacy");
    const configPermissionsMention = commandRegistry.getCommandMention("config", "tools", "manage");

    await replySummaryEmbed(
      interaction,
      locale,
      {
        titleKey: "commands.help.data.title",
        descriptionKey: "commands.help.data.embed_description",
        docsPath: DOCS_PATHS.DATA_HANDLING,
        color: ColorCode.INFO,
        fields: [
          {
            nameKey: "commands.help.data.export_title",
            value: localizer(locale, "commands.help.data.export_description", {
              memoryPersonalExport: memoryPersonalExportMention,
              memoryServerExport: memoryServerExportMention,
              personalConfigExport: personalConfigExportMention,
              serverConfigExport: serverConfigExportMention,
              personaExport: personaExportMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.data.import_title",
            value: localizer(locale, "commands.help.data.import_description", {
              memoryPersonalImport: memoryPersonalImportMention,
              memoryServerImport: memoryServerImportMention,
              personalConfigImport: personalConfigImportMention,
              serverConfigImport: serverConfigImportMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.data.delete_title",
            value: localizer(locale, "commands.help.data.delete_description", {
              memoryPersonalRemove: memoryPersonalRemoveMention,
              memoryServerRemove: memoryServerRemoveMention,
              personalConfigRemove: personalConfigRemoveMention,
              serverConfigRemove: serverConfigRemoveMention,
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.data.privacy_title",
            value: localizer(locale, "commands.help.data.privacy_description", {
              personalPrivacy: personalPrivacyMention,
              configPermissions: configPermissionsMention,
            }),
            inline: false,
          },
        ],
        footerKey: "commands.help.data.footer",
        footerVars: {
          legalNotice: legalNoticeSuffix(locale, "general.legal.provider_policy_reference", " "),
        },
      },
      MessageFlags.Ephemeral,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        commandName: "/help data",
        guildDiscordId: interaction.guild?.id,
      },
    };
    await log.error("Error executing /help data command", error as Error, context);

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
      log.error("Failed to send error reply for /help data", replyError, context);
    }
  }
}

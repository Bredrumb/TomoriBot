import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction, Client, SlashCommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getLocaleEndonym, getSupportedLocales, localizer } from "@/utils/text/localizer";
import { log } from "@/utils/misc/logger";
import { startSetupWizard } from "@/utils/discord/interactions/setupRoutes";

export const managerOnly = true;

export const configureCommand = (command: SlashCommandBuilder) =>
  command
    .setName("setup")
    .setDescription(localizer("en-US", "commands.setup.description"))
    .addStringOption((option) =>
      option
        .setName("language")
        .setDescription(localizer("en-US", "commands.setup.language_description"))
        .setRequired(true)
        .addChoices(
          ...getSupportedLocales().map((language) => ({
            name: getLocaleEndonym(language),
            value: language,
          })),
        ),
    );

/**
 * Starts the guided setup wizard.
 *
 * The command is only the entry point. Authorization, the workspace-health guard, the draft, and the
 * commit all live behind {@link startSetupWizard} and the routed setup namespace, because the same
 * guards have to run again on every button, select, and modal submission the wizard produces.
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  let language = locale;

  try {
    const selectedLanguage = interaction.options.getString("language", true);
    if (!getSupportedLocales().includes(selectedLanguage)) {
      throw new Error(`Unsupported setup language: ${selectedLanguage}`);
    }
    language = selectedLanguage;
    const isDMChannel = interaction.channel?.isDMBased() ?? false;
    const serverId = isDMChannel ? interaction.user.id : interaction.guild?.id;

    if (!serverId) {
      await interaction.reply({
        content: localizer(language, "general.errors.critical_error_description"),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await startSetupWizard(interaction, { locale: language });
  } catch (error) {
    log.error("Error during setup process:", error);
    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({
          content: localizer(language, "general.errors.unknown_error_description"),
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          content: localizer(language, "general.errors.unknown_error_description"),
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      log.error("Failed to send setup error reply:", replyError);
    }
  }
}

import type { ChatInputCommandInteraction, Client, SlashCommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getLocaleEndonym, getSupportedLocales, localizer } from "@/utils/text/localizer";
import { ColorCode, log } from "@/utils/misc/logger";
import { startSetupWizard } from "@/utils/discord/interactions/setupRoutes";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { buildPanelReceiptMessage, replyPanelReceipt } from "@/utils/discord/ui/panel";

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
      await replyInfoEmbed(interaction, language, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.critical_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await startSetupWizard(interaction, { locale: language });
  } catch (error) {
    log.error("Error during setup process:", error);
    const errorReceipt = {
      tone: "error",
      heading: localizer(language, "general.errors.unknown_error_title"),
      detail: localizer(language, "general.errors.unknown_error_description"),
    } as const;
    try {
      // A receipt card, not an embed, because this reply may already hold the Components V2 setup panel.
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply(buildPanelReceiptMessage(errorReceipt));
      } else if (!interaction.replied) {
        await replyPanelReceipt(interaction, errorReceipt);
      }
    } catch (replyError) {
      log.error("Failed to send setup error reply:", replyError);
    }
  }
}

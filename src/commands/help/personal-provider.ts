import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { DOCS_PATHS } from "@/utils/discord/docsLinks";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("personal-provider")
    .setDescription(localizer("en-US", "commands.help.personal-provider.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const addMention = commandRegistry.getCommandMention("personal", "provider", "add");
    const textModelMention = commandRegistry.getCommandMention("personal", "provider", "model-text");
    const toggleMention = commandRegistry.getCommandMention("personal", "provider", "toggle-models");
    const samplersMention = commandRegistry.getCommandMention("personal", "parameters");
    const fallbackMention = commandRegistry.getCommandMention("personal", "model", "fallback");
    const byokMention = commandRegistry.getCommandMention("server", "user-byok", "toggle");

    await replySummaryEmbed(interaction, locale, {
      titleKey: "commands.help.personal-provider.title",
      descriptionKey: "commands.help.personal-provider.description_body",
      docsPath: DOCS_PATHS.PERSONAL_PROVIDERS,
      color: ColorCode.INFO,
      fields: [
        {
          nameKey: "commands.help.personal-provider.setup_field",
          value: localizer(locale, "commands.help.personal-provider.setup_value", {
            add_command: addMention,
            model_command: textModelMention,
            toggle_command: toggleMention,
          }),
          inline: false,
        },
        {
          nameKey: "commands.help.personal-provider.behavior_field",
          value: localizer(locale, "commands.help.personal-provider.behavior_value", {
            samplers_command: samplersMention,
            fallback_command: fallbackMention,
          }),
          inline: false,
        },
        {
          nameKey: "commands.help.personal-provider.byok_field",
          value: localizer(locale, "commands.help.personal-provider.byok_value", {
            byok_command: byokMention,
          }),
          inline: false,
        },
      ],
      footerKey: "commands.help.personal-provider.footer",
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "help personal-provider",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /help personal-provider", error as Error, context);

    await interaction.reply({
      content: localizer(locale, "general.errors.unknown_error_description"),
      flags: MessageFlags.Ephemeral,
    });
  }
}

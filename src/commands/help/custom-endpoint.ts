import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { DOCS_PATHS } from "@/utils/discord/docsLinks";
import { replySummaryEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("custom-endpoint")
    .setDescription(localizer("en-US", "commands.help.custom_models.description"))
    .addStringOption((option) =>
      option
        .setName("endpoint")
        .setDescription(localizer("en-US", "commands.help.custom_models.endpoint_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.help.custom_models.choice_overview"),
            value: "overview",
          },
          {
            name: localizer("en-US", "commands.help.custom_models.choice_comfyui"),
            value: "comfyui",
          },
        ),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    const endpoint = interaction.options.getString("endpoint", true);

    if (endpoint === "overview") {
      await replySummaryEmbed(interaction, locale, {
        titleKey: "commands.help.custom_models.title",
        descriptionKey: "commands.help.custom_models.description_body",
        docsPath: DOCS_PATHS.CUSTOM_ENDPOINTS,
        color: ColorCode.INFO,
        fields: [
          {
            nameKey: "commands.help.custom_models.server_field",
            value: localizer(locale, "commands.help.custom_models.server_value", {
              add_command: commandRegistry.getCommandMention("provider", "custom-endpoint", "add"),
              remove_command: commandRegistry.getCommandMention("provider", "custom-endpoint", "remove"),
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.custom_models.personal_field",
            value: localizer(locale, "commands.help.custom_models.personal_value", {
              add_command: commandRegistry.getCommandMention("personal", "custom-endpoint", "add"),
              remove_command: commandRegistry.getCommandMention("personal", "custom-endpoint", "remove"),
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.custom_models.selection_field",
            value: localizer(locale, "commands.help.custom_models.selection_summary_value", {
              text_command: commandRegistry.getCommandMention("model", "text"),
              image_command: commandRegistry.getCommandMention("model", "image"),
              video_command: commandRegistry.getCommandMention("model", "video"),
            }),
            inline: false,
          },
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (endpoint === "comfyui") {
      await replySummaryEmbed(interaction, locale, {
        titleKey: "commands.help.custom_models.comfyui_page1_title",
        descriptionKey: "commands.help.custom_models.comfyui_summary_description",
        docsPath: DOCS_PATHS.COMFYUI_SETUP,
        color: ColorCode.INFO,
        fields: [
          {
            nameKey: "commands.help.custom_models.comfyui_summary_register_field",
            value: localizer(locale, "commands.help.custom_models.comfyui_summary_register_value", {
              server_add_command: commandRegistry.getCommandMention("provider", "custom-endpoint", "add"),
              personal_add_command: commandRegistry.getCommandMention("personal", "custom-endpoint", "add"),
              image_command: commandRegistry.getCommandMention("model", "image"),
              video_command: commandRegistry.getCommandMention("model", "video"),
            }),
            inline: false,
          },
        ],
      });
      return;
    }

    throw new Error(`Unknown custom endpoint help target: ${endpoint}`);
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "help custom-endpoint",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /help custom-endpoint", error as Error, context);
    await interaction.reply({
      content: localizer(locale, "general.errors.unknown_error_description"),
      flags: MessageFlags.Ephemeral,
    });
  }
}

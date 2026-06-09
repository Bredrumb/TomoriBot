import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { replyPaginatedStatusPages } from "@/utils/discord/ui/statusComponents";
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
            value: localizer(locale, "commands.help.custom_models.selection_value", {
              text_command: commandRegistry.getCommandMention("model", "text"),
              image_command: commandRegistry.getCommandMention("model", "image"),
              video_command: commandRegistry.getCommandMention("model", "video"),
            }),
            inline: false,
          },
          {
            nameKey: "commands.help.custom_models.labels_field",
            value: localizer(locale, "commands.help.custom_models.labels_value", {
              server_remove_command: commandRegistry.getCommandMention("provider", "custom-endpoint", "remove"),
              server_provider_remove_command: commandRegistry.getCommandMention("provider", "remove"),
              personal_remove_command: commandRegistry.getCommandMention("personal", "custom-endpoint", "remove"),
              personal_provider_remove_command: commandRegistry.getCommandMention("personal", "provider", "remove"),
            }),
            inline: false,
          },
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (endpoint === "comfyui") {
      const pages: SummaryEmbedOptions[] = [
        {
          titleKey: "commands.help.custom_models.comfyui_page1_title",
          descriptionKey: "commands.help.custom_models.comfyui_page1_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.custom_models.comfyui_page1_workflow_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page1_workflow_value"),
              inline: false,
            },
            {
              nameKey: "commands.help.custom_models.comfyui_page1_placeholders_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page1_placeholders_value"),
              inline: false,
            },
            {
              nameKey: "commands.help.custom_models.comfyui_page1_export_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page1_export_value"),
              inline: false,
            },
            {
              nameKey: "commands.help.custom_models.comfyui_page1_register_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page1_register_value", {
                server_add_command: commandRegistry.getCommandMention("provider", "custom-endpoint", "add"),
                personal_add_command: commandRegistry.getCommandMention("personal", "custom-endpoint", "add"),
                image_command: commandRegistry.getCommandMention("model", "image"),
                video_command: commandRegistry.getCommandMention("model", "video"),
              }),
              inline: false,
            },
          ],
        },
        {
          titleKey: "commands.help.custom_models.comfyui_page2_title",
          descriptionKey: "commands.help.custom_models.comfyui_page2_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.custom_models.comfyui_page2_core_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page2_core_value"),
              inline: false,
            },
            {
              nameKey: "commands.help.custom_models.comfyui_page2_numeric_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page2_numeric_value"),
              inline: false,
            },
            {
              nameKey: "commands.help.custom_models.comfyui_page2_video_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page2_video_value"),
              inline: false,
            },
          ],
        },
        {
          titleKey: "commands.help.custom_models.comfyui_page3_title",
          descriptionKey: "commands.help.custom_models.comfyui_page3_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.custom_models.comfyui_page3_image_refs_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page3_image_refs_value"),
              inline: false,
            },
            {
              nameKey: "commands.help.custom_models.comfyui_page3_reference_tokens_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page3_reference_tokens_value"),
              inline: false,
            },
            {
              nameKey: "commands.help.custom_models.comfyui_page3_reference_note_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page3_reference_note_value"),
              inline: false,
            },
          ],
        },
        {
          titleKey: "commands.help.custom_models.comfyui_page4_title",
          descriptionKey: "commands.help.custom_models.comfyui_page4_description",
          color: ColorCode.INFO,
          fields: [
            {
              nameKey: "commands.help.custom_models.comfyui_page4_video_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page4_video_value"),
              inline: false,
            },
            {
              nameKey: "commands.help.custom_models.comfyui_page4_output_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page4_output_value"),
              inline: false,
            },
            {
              nameKey: "commands.help.custom_models.comfyui_page4_metadata_field",
              value: localizer(locale, "commands.help.custom_models.comfyui_page4_metadata_value"),
              inline: false,
            },
          ],
        },
      ];

      await replyPaginatedStatusPages(interaction, locale, pages, MessageFlags.Ephemeral);
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

import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { AttachmentBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import type { UserRow } from "@/types/db/schema";
import { exportPersonalSettings } from "@/utils/db/repositories";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("export").setDescription(localizer("en-US", "commands.personal.config.export.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const exportResult = await exportPersonalSettings(interaction.user.id);
    if (!exportResult.success || !exportResult.data) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.data.export.failed_title"))
            .setDescription(
              exportResult.error
                ? localizer(locale, exportResult.error)
                : localizer(locale, "commands.data.export.failed_description"),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    const typeLabel = localizer(locale, "commands.data.export.type_choice_personal_settings");
    const attachment = new AttachmentBuilder(Buffer.from(JSON.stringify(exportResult.data, null, 2), "utf-8"), {
      name: `tomori-personal-settings-${interaction.user.id}-${Date.now()}.json`,
    });

    try {
      await interaction.user.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.data.export.dm_title"))
            .setDescription(localizer(locale, "commands.data.export.dm_description", { type: typeLabel }))
            .setColor(ColorCode.INFO),
        ],
        files: [attachment],
      });

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.data.export.success_title"))
            .setDescription(localizer(locale, "commands.data.export.success_description", { type: typeLabel }))
            .setColor(ColorCode.SUCCESS),
        ],
      });
    } catch (dmError) {
      log.warn(`Failed to send personal config export DM to user ${interaction.user.id}:`, dmError as Error);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.data.export.dm_failed_title"))
            .setDescription(localizer(locale, "commands.data.export.dm_failed_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
    }
  } catch (error) {
    log.error("Error executing /personal config export:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "personal config export" },
    });

    if (!interaction.replied && !interaction.deferred) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "general.errors.unknown_error_title"))
          .setDescription(localizer(locale, "general.errors.unknown_error_description"))
          .setColor(ColorCode.ERROR),
      ],
    });
  }
}

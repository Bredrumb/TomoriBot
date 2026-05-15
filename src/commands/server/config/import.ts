import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow } from "@/types/db/schema";
import { importRepository } from "@/utils/db/repositories";
import type { ServerConfigOnlyExportData } from "@/types/db/dataExport";
import { IMPORT_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("import")
    .setDescription(localizer("en-US", "commands.server.config.import.description"))
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription(localizer("en-US", "commands.server.config.import.file_description"))
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("confirmation")
        .setDescription(localizer("en-US", "commands.server.config.import.confirmation_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "commands.server.config.import.confirmation_choice_yes"), value: "yes" },
          { name: localizer("en-US", "commands.server.config.import.confirmation_choice_no"), value: "no" },
        ),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  try {
    if (interaction.guild) {
      const hasPermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
      if (!hasPermission) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.data.import.no_permission_title",
          descriptionKey: "commands.data.import.no_permission_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    if (interaction.options.getString("confirmation", true) !== "yes") {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.import.cancelled_title",
        descriptionKey: "commands.data.import.cancelled_description",
        color: ColorCode.INFO,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const attachment = interaction.options.getAttachment("file", true);
    const response = await safeDownload(attachment.url, {
      maxSizeMB: IMPORT_LIMITS.MAX_DATA_IMPORT_SIZE_MB,
      timeoutMs: 10_000,
      knownSize: attachment.size,
    });
    if (!response.success || !response.buffer) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.import.invalid_file_title",
        descriptionKey: "commands.data.import.invalid_file_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const jsonData = JSON.parse(response.buffer.toString("utf8"));
    const validation = importRepository.validateImportFile(jsonData);
    if (!validation.valid || !validation.type || !validation.data || validation.type !== "server_config") {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.import.invalid_file_title",
        descriptionKey: "commands.data.import.invalid_file_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const importResult = await importRepository.importServerConfig(
      interaction.guild?.id ?? interaction.user.id,
      (validation.data as ServerConfigOnlyExportData).config,
    );
    if (!importResult.success) {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.data.import.failed_title"))
            .setDescription(
              importResult.error
                ? localizer(locale, importResult.error)
                : localizer(locale, "commands.data.import.failed_description"),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.data.import.success_title"))
          .setDescription(
            localizer(locale, "commands.data.import.success_description", {
              type: localizer(locale, "commands.data.export.type_choice_server_config"),
              memories_count: 0,
              config_count: importResult.itemsImported?.configFieldsCount || 0,
            }),
          )
          .setColor(ColorCode.SUCCESS),
      ],
    });
  } catch (error) {
    log.error("Error executing /server config import:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "server config import" },
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

import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { sql } from "@/utils/db/client";
import { localizer } from "@/utils/text/localizer";
import { ColorCode, log } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow } from "@/types/db/schema";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("remove")
    .setDescription(localizer("en-US", "commands.server.config.remove.description"))
    .addStringOption((option) =>
      option
        .setName("confirmation")
        .setDescription(localizer("en-US", "commands.server.config.remove.confirmation_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "commands.server.config.remove.confirmation_choice_yes"), value: "yes" },
          { name: localizer("en-US", "commands.server.config.remove.confirmation_choice_no"), value: "no" },
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
          titleKey: "commands.data.delete.no_permission_title",
          descriptionKey: "commands.data.delete.no_permission_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const confirmation = interaction.options.getString("confirmation", true);
    if (confirmation !== "yes") {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.delete.confirmation_required_title",
        descriptionKey: "commands.data.delete.confirmation_required_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const serverDiscId = interaction.guild?.id ?? interaction.user.id;
    const serverRows = await sql<Array<{ server_id: number }>>`
      SELECT server_id
      FROM servers
      WHERE server_disc_id = ${serverDiscId}
      LIMIT 1
    `;
    const serverId = serverRows[0]?.server_id;
    if (!serverId) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.delete.no_server_data_title",
        descriptionKey: "commands.data.delete.no_server_data_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let updatedRows = await sql<Array<{ tomori_config_id: number }>>`
      UPDATE tomori_configs
      SET
        llm_temperature = 1.2,
        llm_top_p = 0.95,
        llm_min_p = 0.05,
        llm_disabled_params = ARRAY[]::text[],
        llm_stop_strings = ARRAY[]::text[],
        llm_stop_speaker_pattern_enabled = false,
        humanizer_degree = 1,
        thinking_level = 'auto',
        timezone_offset = 0,
        message_fetch_limit = 80,
        server_memteaching_enabled = true,
        attribute_memteaching_enabled = false,
        sampledialogue_memteaching_enabled = false,
        self_teaching_enabled = true,
        web_search_enabled = true,
        personal_memories_enabled = true,
        emoji_usage_enabled = true,
        sticker_usage_enabled = true,
        imagegen_enabled = true,
        tool_notice_hidden_keys = ARRAY[]::text[],
        self_debug_enabled = false
      WHERE server_id = ${serverId}
      RETURNING tomori_config_id
    `;

    if (!updatedRows.length) {
      const mainTomoriRows = await sql<Array<{ tomori_id: number }>>`
        SELECT tomori_id
        FROM tomoris
        WHERE server_id = ${serverId}
          AND is_alter = false
        ORDER BY updated_at DESC NULLS LAST, tomori_id DESC
        LIMIT 1
      `;
      const mainTomoriId = mainTomoriRows[0]?.tomori_id;
      if (mainTomoriId) {
        updatedRows = await sql<Array<{ tomori_config_id: number }>>`
          UPDATE tomori_configs
          SET
            llm_temperature = 1.2,
            llm_top_p = 0.95,
            llm_min_p = 0.05,
            llm_disabled_params = ARRAY[]::text[],
            llm_stop_strings = ARRAY[]::text[],
            llm_stop_speaker_pattern_enabled = false,
            humanizer_degree = 1,
            thinking_level = 'auto',
            timezone_offset = 0,
            message_fetch_limit = 80,
            server_memteaching_enabled = true,
            attribute_memteaching_enabled = false,
            sampledialogue_memteaching_enabled = false,
            self_teaching_enabled = true,
            web_search_enabled = true,
            personal_memories_enabled = true,
            emoji_usage_enabled = true,
            sticker_usage_enabled = true,
            imagegen_enabled = true,
            tool_notice_hidden_keys = ARRAY[]::text[],
            self_debug_enabled = false
          WHERE tomori_id = ${mainTomoriId}
          RETURNING tomori_config_id
        `;
      }
    }

    if (!updatedRows.length) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.data.delete.no_server_data_title",
        descriptionKey: "commands.data.delete.no_server_data_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    invalidateTomoriStateCache(serverDiscId);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.data.delete.success_server_config_title",
      descriptionKey: "commands.data.delete.success_server_config_description",
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    log.error("Error executing /server config remove:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "server config remove" },
    });

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}

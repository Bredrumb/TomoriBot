/**
 * /server matrix unlink
 * Removes the Matrix bridge link from a Discord channel.
 *
 * Interaction pattern: Pattern 2 (defer before async work)
 * Permission required: ManageGuild
 */

import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { sql } from "@/utils/db/client";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { invalidateMatrixLinkCache } from "@/utils/bridges/matrix";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "@/types/db/schema";

/**
 * Configure the /server matrix unlink subcommand builder.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("unlink")
    .setDescription(localizer("en-US", "commands.server.matrix.unlink.description"))
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(localizer("en-US", "commands.server.matrix.unlink.channel_description"))
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    );

/**
 * Execute the /server matrix unlink command.
 * Removes the Matrix bridge link for the given channel.
 *
 * @param _client     - Discord.js client (unused here)
 * @param interaction - The slash command interaction
 * @param user        - Resolved user row for error context
 * @param locale      - User's preferred locale
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  user: UserRow,
  locale: string,
): Promise<void> {
  const errorContext: ErrorContext = {
    userId: user.user_id,
    serverId: null,
    tomoriId: null,
  };

  try {
    // 1. Validate guild context
    if (!interaction.guild || !interaction.guildId) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
      });
      return;
    }

    // 2. Validate ManageGuild permission
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.permission_denied_title",
        descriptionKey: "general.errors.permission_denied_description",
      });
      return;
    }

    // 3. Defer before async work (Pattern 2)
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // 4. Load Tomori state (bot must be set up)
    const tomoriState = await getCachedTomoriState(interaction.guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
      });
      return;
    }

    errorContext.serverId = tomoriState.server_id;
    errorContext.tomoriId = tomoriState.tomori_id;

    // 5. Get command options
    const channel = interaction.options.getChannel("channel", true);

    // 6. Query existing link so we can invalidate the room-side cache too
    const [existingLink] = await sql<{ matrix_room_id: string }[]>`
			SELECT matrix_room_id
			FROM matrix_channel_links
			WHERE channel_disc_id = ${channel.id}
			LIMIT 1
		`;

    if (!existingLink) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.WARN,
        titleKey: "commands.server.matrix.unlink.not_linked_title",
        descriptionKey: "commands.server.matrix.unlink.not_linked_description",
        descriptionVars: { channel_id: channel.id },
      });
      return;
    }

    const roomId = existingLink.matrix_room_id;

    // 7. Delete the link record
    await sql`
			DELETE FROM matrix_channel_links
			WHERE channel_disc_id = ${channel.id}
		`;

    // 8. Invalidate both cache directions
    invalidateMatrixLinkCache(channel.id, roomId);

    // 9. Reply success
    await replyInfoEmbed(interaction, locale, {
      color: ColorCode.SUCCESS,
      titleKey: "commands.server.matrix.unlink.success_title",
      descriptionKey: "commands.server.matrix.unlink.success_description",
      descriptionVars: { channel_id: channel.id },
    });

    log.info(
      `Matrix bridge: unlinked channel ${channel.id} (${channel.name}) from room ${roomId} in guild ${interaction.guildId}`,
    );
  } catch (error) {
    log.error("Error executing /server matrix unlink", error, errorContext);
    await replyInfoEmbed(interaction, locale, {
      color: ColorCode.ERROR,
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
    });
  }
}

/**
 * /server matrix link
 * Links a Discord channel to a Matrix room for bidirectional message relay.
 * Uses upsert semantics so re-linking replaces any existing mapping.
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
import {
  isMatrixConfigured,
  joinMatrixRoom,
  isRoomEncrypted,
  invalidateMatrixLinkCache,
  sendMatrixLinkedSetupNotice,
} from "@/utils/bridges/matrix";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "@/types/db/schema";

/**
 * Configure the /server matrix link subcommand builder.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("link")
    .setDescription(localizer("en-US", "commands.server.matrix.link.description"))
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(localizer("en-US", "commands.server.matrix.link.channel_description"))
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("room")
        .setDescription(localizer("en-US", "commands.server.matrix.link.room_description"))
        .setRequired(true),
    );

/**
 * Execute the /server matrix link command.
 * Links the chosen Discord channel to the given Matrix room ID.
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

    // 4. Check Matrix bridge is configured
    if (!isMatrixConfigured()) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "commands.server.matrix.link.matrix_not_configured_title",
        descriptionKey: "commands.server.matrix.link.matrix_not_configured_description",
      });
      return;
    }

    // 5. Load Tomori state (bot must be set up)
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

    // 6. Get command options
    const channel = interaction.options.getChannel("channel", true);
    const roomId = interaction.options.getString("room", true).trim();

    // 7. Validate Matrix room ID format: must start with "!" and contain ":"
    if (!roomId.startsWith("!") || !roomId.includes(":")) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "commands.server.matrix.link.invalid_room_title",
        descriptionKey: "commands.server.matrix.link.invalid_room_description",
      });
      return;
    }

    // 8. Reject encrypted rooms — Matrix encryption is permanent and cannot be
    //    disabled, so bridging would never work for this room.
    if (await isRoomEncrypted(roomId)) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.ERROR,
        titleKey: "commands.server.matrix.link.encrypted_room_title",
        descriptionKey: "commands.server.matrix.link.encrypted_room_description",
        descriptionVars: {
          room_id: roomId,
          bot_user_id: process.env.MATRIX_BOT_USER_ID ?? "the Matrix bot account",
        },
      });
      return;
    }

    // 10. Fetch previous room ID for this channel (to invalidate old cache entry)
    const [existingLink] = await sql<{ matrix_room_id: string }[]>`
			SELECT matrix_room_id
			FROM matrix_channel_links
			WHERE channel_disc_id = ${channel.id}
			LIMIT 1
		`;
    const oldRoomId = existingLink?.matrix_room_id;

    // 11. Upsert: insert or replace existing link for this channel
    await sql`
			INSERT INTO matrix_channel_links (server_id, channel_disc_id, matrix_room_id)
			VALUES (${tomoriState.server_id}, ${channel.id}, ${roomId})
			ON CONFLICT (channel_disc_id) DO UPDATE
				SET matrix_room_id = EXCLUDED.matrix_room_id
		`;

    // 12. Invalidate cache entries for both old and new room IDs
    invalidateMatrixLinkCache(channel.id, oldRoomId);
    invalidateMatrixLinkCache(channel.id, roomId);

    // 13. Attempt to join the Matrix room as the bot account (non-critical)
    let joinFailed = false;
    try {
      await joinMatrixRoom(roomId);
    } catch (joinError) {
      log.warn(`Matrix link: could not auto-join room ${roomId} — user must invite the bot`, joinError);
      joinFailed = true;
    }

    // 14. Reply success (with note if join failed)
    const botUserId = process.env.MATRIX_BOT_USER_ID ?? "the Matrix bot account";
    const helpMatrixMention = commandRegistry.getCommandMention("help", "matrix");

    if (joinFailed) {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.WARN,
        titleKey: "commands.server.matrix.link.success_title",
        descriptionKey: "commands.server.matrix.link.join_failed_description",
        descriptionVars: {
          channel_id: channel.id,
          room_id: roomId,
          bot_user_id: botUserId,
          help_matrix: helpMatrixMention,
        },
      });
    } else {
      await replyInfoEmbed(interaction, locale, {
        color: ColorCode.SUCCESS,
        titleKey: "commands.server.matrix.link.success_title",
        descriptionKey: "commands.server.matrix.link.success_description",
        descriptionVars: {
          channel_id: channel.id,
          room_id: roomId,
          help_matrix: helpMatrixMention,
        },
      });
    }

    if (!joinFailed && oldRoomId !== roomId) {
      const channelName = channel.name ?? channel.id;

      void sendMatrixLinkedSetupNotice(roomId, locale, channelName).catch((noticeError) => {
        log.warn(`Matrix link: failed to post onboarding notice to room ${roomId}`, noticeError);
      });
    }

    log.info(
      `Matrix bridge: linked channel ${channel.id} (${channel.name}) to room ${roomId} in guild ${interaction.guildId}`,
    );
  } catch (error) {
    log.error("Error executing /server matrix link", error, errorContext);
    await replyInfoEmbed(interaction, locale, {
      color: ColorCode.ERROR,
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
    });
  }
}

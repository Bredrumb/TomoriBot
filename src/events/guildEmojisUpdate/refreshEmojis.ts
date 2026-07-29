import { type Client, type Guild, GuildEmoji } from "discord.js"; // Import GuildEmoji
import { sql } from "@/utils/db/client";
import type { EventFunction, EventArg } from "../../types/discord/global";
import type { ErrorContext } from "../../types/db/schema";
import { log } from "../../utils/misc/logger";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { invalidateEmojiStickerCache } from "../../utils/cache/emojiStickerCache";

/**
 * JSDoc comment for exported function
 * Handles emoji create, delete, and update events by refreshing the guild's emoji list in the database.
 * @param args - Event arguments (expected: GuildEmoji or [GuildEmoji, GuildEmoji])
 */
const handleGuildEmojisUpdate: EventFunction = async (_client: Client, ...args: EventArg[]): Promise<void> => {
  // Identify the GuildEmoji and Guild from the event arguments
  // The first argument should always be a GuildEmoji object for these events
  const emoji = args[0];
  if (!(emoji instanceof GuildEmoji) || !emoji.guild) {
    log.warn("guildEmojisUpdate event triggered without a valid GuildEmoji or Guild.", { args });
    return; // Cannot proceed without guild info
  }
  const guild: Guild = emoji.guild;
  log.info(`Emoji change detected in guild: ${guild.name} (${guild.id})`);

  let serverId: number | undefined; // Variable to hold the internal server ID

  try {
    serverId = (await serverRepository.loadServerIdByDiscId(guild.id)) ?? undefined;

    if (!serverId) {
      log.warn(`Received emoji update for guild ${guild.id} but server is not registered in DB. Skipping refresh.`);
      return; // Server not setup, nothing to refresh
    }

    // Fetch the current complete list of emojis from Discord API
    // CRITICAL: Must fetch() to ensure cache is complete - cache may be incomplete on startup
    await guild.emojis.fetch();
    const currentEmojis = Array.from(guild.emojis.cache.values());
    log.info(`Fetched and cached ${currentEmojis.length} emojis for guild ${guild.id}. Refreshing DB...`);

    await sql.transaction(async (tx) => {
      // biome-ignore lint/style/noNonNullAssertion: serverId is guaranteed to exist after checks above
      await serverRepository.syncEmojis(tx, serverId!, currentEmojis);
    });

    // Invalidate in-memory cache to force refresh on next message
    // biome-ignore lint/style/noNonNullAssertion: serverId is guaranteed to exist after checks above
    invalidateEmojiStickerCache(serverId!);

    log.success(`Successfully refreshed emojis for guild ${guild.id} (Server ID: ${serverId}).`);
  } catch (error) {
    const context: ErrorContext = {
      serverId: serverId, // Use the serverId if found, otherwise undefined
      errorType: "EmojiRefreshError", // Specific error type
      metadata: { guildId: guild.id, eventArgsCount: args.length },
    };
    await log.error(`Failed to refresh emojis for guild ${guild.id}`, error, context);
  }
};

export default handleGuildEmojisUpdate;

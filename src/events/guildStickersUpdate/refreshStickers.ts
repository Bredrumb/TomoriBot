import { type Client, type Guild, Sticker } from "discord.js";
import { sql } from "@/utils/db/client";
import type { EventFunction, EventArg } from "../../types/discord/global";
import type { ErrorContext } from "../../types/db/schema"; // Import ServerRow
import { log } from "../../utils/misc/logger";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { invalidateEmojiStickerCache } from "../../utils/cache/emojiStickerCache";

/**
 * JSDoc comment for exported function
 * Handles sticker create, delete, and update events by refreshing the guild's sticker list in the database.
 * @param args - Event arguments (expected: Sticker or [Sticker, Sticker])
 */
const handleGuildStickersUpdate: EventFunction = async (_client: Client, ...args: EventArg[]): Promise<void> => {
  const sticker = args[0];
  if (!(sticker instanceof Sticker) || !sticker.guild) {
    log.warn("guildStickersUpdate event triggered without a valid Sticker or Guild.", { args });
    return; // Cannot proceed without guild info
  }
  const guild: Guild = sticker.guild;
  log.info(`Sticker change detected in guild: ${guild.name} (${guild.id})`);

  let serverId: number | undefined; // Variable to hold the internal server ID

  try {
    serverId = (await serverRepository.loadServerIdByDiscId(guild.id)) ?? undefined;

    if (!serverId) {
      log.warn(`Received sticker update for guild ${guild.id} but server is not registered in DB. Skipping refresh.`);
      return; // Server not setup, nothing to refresh
    }

    // Fetch the current complete list of stickers from Discord API
    // CRITICAL: Must fetch() to ensure cache is complete - cache may be incomplete on startup
    await guild.stickers.fetch();
    const currentStickers = Array.from(guild.stickers.cache.values());
    log.info(`Fetched and cached ${currentStickers.length} stickers for guild ${guild.id}. Refreshing DB...`);

    await sql.transaction(async (tx) => {
      // biome-ignore lint/style/noNonNullAssertion: serverId is guaranteed to exist after checks above
      await serverRepository.syncStickers(tx, serverId!, currentStickers);
    });

    // Invalidate in-memory cache to force refresh on next message
    // biome-ignore lint/style/noNonNullAssertion: serverId is guaranteed to exist after checks above
    invalidateEmojiStickerCache(serverId!);

    log.success(`Successfully refreshed stickers for guild ${guild.id} (Server ID: ${serverId}).`);
  } catch (error) {
    // Log error with context
    // serverId might be undefined if the initial SELECT failed
    const context: ErrorContext = {
      serverId: serverId, // Use the serverId if found, otherwise undefined
      errorType: "StickerRefreshError",
      metadata: { guildId: guild.id, eventArgsCount: args.length },
    };
    await log.error(`Failed to refresh stickers for guild ${guild.id}`, error, context);
  }
};

export default handleGuildStickersUpdate;

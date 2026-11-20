import { Sticker } from "discord.js";
import { sql, withTransientDbRetry } from "@/utils/db/client";
import type { EventArg, EventFunction } from "../../types/discord/global";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { createGuildExpressionRefresh } from "../shared/guildExpressionRefresh";

/**
 * Refreshes the guild's sticker rows for sticker create, delete, and update events.
 * @param args - Event arguments (expected: Sticker or [Sticker, Sticker])
 */
const handleGuildStickersUpdate: EventFunction = createGuildExpressionRefresh({
  resolvePayload: (args: EventArg[]) => {
    const sticker = args[0];
    if (!(sticker instanceof Sticker) || !sticker.guild) return null;
    return { guild: sticker.guild };
  },
  retrieve: async (guild) => {
    await guild.stickers.fetch();
    return Array.from(guild.stickers.cache.values());
  },
  sync: async (serverId, guildId, items) => {
    await withTransientDbRetry(
      () =>
        sql.transaction(async (tx) => {
          await serverRepository.syncStickers(tx, serverId, items);
        }),
      `refresh stickers for guild ${guildId}`,
    );
  },
  label: "sticker",
  logPrefix: "stickers",
  errorType: "StickerRefreshError",
  invalidPayloadMessage: "guildStickersUpdate event triggered without a valid Sticker or Guild.",
  startMessage: (guildName, guildId) => `Sticker change detected in guild: ${guildName} (${guildId})`,
});

export default handleGuildStickersUpdate;

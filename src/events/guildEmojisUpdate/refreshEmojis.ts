import { GuildEmoji } from "discord.js";
import { sql, withTransientDbRetry } from "@/utils/db/client";
import type { EventArg, EventFunction } from "../../types/discord/global";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { createGuildExpressionRefresh } from "../shared/guildExpressionRefresh";

/**
 * Refreshes the guild's emoji rows for emoji create, delete, and update events.
 * @param args - Event arguments (expected: GuildEmoji or [GuildEmoji, GuildEmoji])
 */
const handleGuildEmojisUpdate: EventFunction = createGuildExpressionRefresh({
  resolvePayload: (args: EventArg[]) => {
    const emoji = args[0];
    if (!(emoji instanceof GuildEmoji) || !emoji.guild) return null;
    return { guild: emoji.guild };
  },
  retrieve: async (guild) => {
    await guild.emojis.fetch();
    return Array.from(guild.emojis.cache.values());
  },
  sync: async (serverId, guildId, items) => {
    await withTransientDbRetry(
      () =>
        sql.transaction(async (tx) => {
          await serverRepository.syncEmojis(tx, serverId, items);
        }),
      `refresh emojis for guild ${guildId}`,
    );
  },
  label: "emoji",
  logPrefix: "emojis",
  errorType: "EmojiRefreshError",
  invalidPayloadMessage: "guildEmojisUpdate event triggered without a valid GuildEmoji or Guild.",
  startMessage: (guildName, guildId) => `Emoji change detected in guild: ${guildName} (${guildId})`,
});

export default handleGuildEmojisUpdate;

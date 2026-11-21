import type { Client, Guild } from "discord.js";
import type { EventArg, EventFunction } from "@/types/discord/global";
import { invalidateEmojiStickerCache } from "@/utils/cache/emojiStickerCache";
import { log } from "@/utils/misc/logger";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";

/**
 * What the two expression-refresh events, `guildEmojisUpdate` and `guildStickersUpdate`,
 * differ by. Discord models emojis and stickers as separate manager types, so the shared
 * flow below cannot reach either one generically without this seam.
 */
export interface GuildExpressionRefreshSpec<TPayload, TItem> {
  /** Null when the event carried nothing this handler can act on. */
  resolvePayload(args: EventArg[]): TPayload | null;
  /** Re-read the expression collection for the guild. */
  retrieve(guild: Guild): Promise<TItem[]>;
  /**
   * Sync the rows for the internal server id. The guild snowflake is passed for the retry
   * label only, so an operator can trace a failure back to the guild Discord named.
   */
  sync(serverId: number, guildId: string, items: TItem[]): Promise<void>;
  /** Names the asset in every log line, so an operator can tell the two events apart. */
  label: string;
  logPrefix: string;
  errorType: string;
  /** Log line for a payload that arrived without a usable guild. */
  invalidPayloadMessage: string;
  startMessage: (guildName: string, guildId: string) => string;
}

/**
 * Build the event handler for a guild expression type.
 *
 * The two handlers are one flow because Discord delivers them the same way: a payload
 * carrying the guild, an internal server id resolved from the snowflake, a full re-read of
 * the expression collection, a sync into the database, and an invalidation of the
 * in-memory cache the message path reads.
 *
 * The re-read has to be `fetch()`. The discord.js collection only holds the guilds the
 * gateway populated at startup, so a collection that is present can still be incomplete,
 * and syncing that partial list would delete the rows it never saw.
 */
export function createGuildExpressionRefresh<TPayload extends { guild: Guild | null }, TItem>(
  spec: GuildExpressionRefreshSpec<TPayload, TItem>,
): EventFunction {
  return async (_client: Client, ...args: EventArg[]): Promise<void> => {
    const payload = spec.resolvePayload(args);
    const guild = payload?.guild;
    if (!payload || !guild) {
      log.warn(spec.invalidPayloadMessage, { args });
      return;
    }

    log.info(spec.startMessage(guild.name, guild.id));

    let serverId: number | undefined;

    try {
      serverId = (await serverRepository.loadServerIdByDiscId(guild.id)) ?? undefined;

      if (!serverId) {
        log.warn(
          `Received ${spec.label} update for guild ${guild.id} but server is not registered in DB. Skipping refresh.`,
        );
        return;
      }

      const resolvedServerId = serverId;
      const items = await spec.retrieve(guild);
      log.info(`Fetched and cached ${items.length} ${spec.logPrefix} for guild ${guild.id}. Refreshing DB...`);

      await spec.sync(resolvedServerId, guild.id, items);

      invalidateEmojiStickerCache(resolvedServerId);

      log.success(`Successfully refreshed ${spec.logPrefix} for guild ${guild.id} (Server ID: ${resolvedServerId}).`);
    } catch (error) {
      const context = {
        serverId,
        errorType: spec.errorType,
        metadata: { guildId: guild.id, eventArgsCount: args.length },
      };
      await log.error(`Failed to refresh ${spec.logPrefix} for guild ${guild.id}`, error, context);
    }
  };
}

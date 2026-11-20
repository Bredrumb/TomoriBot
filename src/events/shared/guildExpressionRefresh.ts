import type { Client, Guild } from "discord.js";
import type { EventArg, EventFunction } from "@/types/discord/global";
import { invalidateEmojiStickerCache } from "@/utils/cache/emojiStickerCache";
import { log } from "@/utils/misc/logger";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";

export interface GuildExpressionRefreshSpec<TPayload, TItem> {
  resolvePayload(args: EventArg[]): TPayload | null;
  retrieve(guild: Guild): Promise<TItem[]>;
  // guildId is passed only for retry log labels so operators can trace sync failures back to the Discord guild.
  sync(serverId: number, guildId: string, items: TItem[]): Promise<void>;
  label: string;
  logPrefix: string;
  errorType: string;
  invalidPayloadMessage: string;
  startMessage: (guildName: string, guildId: string) => string;
}

// retrieve must call fetch() rather than reading cache because a populated discord.js cache can be incomplete and
// syncing it would delete missing rows.
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

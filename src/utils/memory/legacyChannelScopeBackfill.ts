import { ChannelType, type Guild } from "discord.js";
import { serverMemoryRepository } from "@/utils/db/repositories";
import type { PendingLegacyChannelScope } from "@/utils/db/repositories/ServerMemoryRepository";

type CachedGuild = Pick<Guild, "available" | "channels">;

// Each tag name keeps every matching text or announcement channel because the legacy name filter matched all of them.
function resolveLegacyChannelTags(channelTags: readonly string[], guild: Pick<Guild, "channels">): string[] {
  const channelIdsByName = new Map<string, string[]>();
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) continue;
    const name = channel.name.toLowerCase();
    channelIdsByName.set(name, [...(channelIdsByName.get(name) ?? []), channel.id]);
  }
  const channelIds = new Set<string>();
  for (const tag of channelTags) {
    const name = tag
      .replace(/^["']+|["']+$/g, "")
      .trim()
      .replace(/^#+/, "")
      .toLowerCase();
    for (const id of channelIdsByName.get(name) ?? []) channelIds.add(id);
  }
  return [...channelIds];
}

// Unmatched rows stay pending (active in all channels), and unfiltered runs prune deleted-item rows first so
// deletions do not leave fake unmatched counts.
export async function backfillLegacyChannelScopes(
  findGuild: (guildDiscId: string) => CachedGuild | undefined,
  serverDiscId?: string,
): Promise<{ scoped: number; unmatched: number; deferred: number }> {
  if (serverDiscId === undefined) await serverMemoryRepository.pruneOrphanedLegacyChannelScopes();
  const pending = await serverMemoryRepository.loadPendingLegacyChannelScopes(serverDiscId);
  const rowsByServer = new Map<number, PendingLegacyChannelScope[]>();
  for (const row of pending) rowsByServer.set(row.server_id, [...(rowsByServer.get(row.server_id) ?? []), row]);

  const totals = { scoped: 0, unmatched: 0, deferred: 0 };
  for (const [serverId, rows] of rowsByServer) {
    const guild = findGuild(rows[0]?.server_disc_id ?? "");
    if (!guild?.available) {
      totals.deferred += rows.length;
      continue;
    }
    const resolutions = [];
    for (const row of rows) {
      const channelDiscIds = resolveLegacyChannelTags(row.channel_tags, guild);
      if (channelDiscIds.length === 0) {
        totals.unmatched += 1;
        continue;
      }
      resolutions.push({ sourceTable: row.source_table, rowId: row.row_id, channelDiscIds });
    }
    if (resolutions.length > 0) await serverMemoryRepository.applyLegacyChannelScopes(serverId, resolutions);
    totals.scoped += resolutions.length;
  }
  return totals;
}

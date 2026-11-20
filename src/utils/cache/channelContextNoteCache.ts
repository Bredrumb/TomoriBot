import {
  type ChannelContextNote,
  getChannelContextNoteCacheEntry,
  setChannelContextNoteCache,
} from "@/utils/cache/channelContextNoteCacheStore";
import { channelContextNoteRepo } from "@/utils/db/repositories/ChannelContextNoteRepository";
import { log } from "@/utils/misc/logger";

export type { ChannelContextNote };

export async function getCachedChannelContextNote(
  serverId: number,
  channelDiscId: string,
): Promise<ChannelContextNote | null> {
  const cached = getChannelContextNoteCacheEntry(serverId, channelDiscId);
  if (cached !== undefined) return cached;

  try {
    const entry = await channelContextNoteRepo.getChannelContextNote(serverId, channelDiscId);
    setChannelContextNoteCache(serverId, channelDiscId, entry);
    return entry;
  } catch (error) {
    log.error(
      `[ChannelContextNoteCache] Failed to fetch channel context note for ${serverId}:${channelDiscId}:`,
      error,
    );
    return null;
  }
}

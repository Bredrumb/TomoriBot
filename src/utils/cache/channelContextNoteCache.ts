/**
 * Channel Context Note Cache
 * Provides in-memory TTL caching for per-channel context note entries.
 * Prevents a DB query per-message for the channel context note lookup step.
 *
 * When a row exists for a channel, its note is injected into the dialogue
 * history at the configured depth alongside any active persona-scoped note.
 */

import {
  type ChannelContextNote,
  clearChannelContextNoteCache,
  getChannelContextNoteCacheEntry,
  getChannelContextNoteCacheSize,
  invalidateAllChannelContextNoteCacheForServer,
  invalidateChannelContextNoteCache,
  setChannelContextNoteCache,
} from "@/utils/cache/channelContextNoteCacheStore";
import { channelContextNoteRepo } from "@/utils/db/repositories/ChannelContextNoteRepository";
import { log } from "@/utils/misc/logger";

export type { ChannelContextNote };
export {
  clearChannelContextNoteCache,
  getChannelContextNoteCacheSize,
  invalidateAllChannelContextNoteCacheForServer,
  invalidateChannelContextNoteCache,
  setChannelContextNoteCache,
};

/**
 * Gets the channel-level context note for a given server/channel pair.
 * Checks the in-memory cache first; falls back to the database on miss.
 * Caches negative results (null) to avoid repeated DB round-trips for channels without notes.
 *
 * @param serverId      - Database integer server ID
 * @param channelDiscId - Discord channel snowflake ID
 * @returns The note `{ note, depth }`, or null if no channel note is set
 */
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

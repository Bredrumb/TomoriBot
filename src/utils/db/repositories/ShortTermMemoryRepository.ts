/**
 * ShortTermMemoryRepository: manages in-conversation short-term working memory.
 *
 * Short-term memory is currently stored in-process (shortTermMemoryCache) and
 * is not persisted to the database. This repository wraps the cache layer so
 * callers are insulated from that detail; when a DB-backed STM table ships
 * in a future phase, only this file changes (per OD-R-2).
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition. Since STM
 * is ephemeral by design, both are no-ops that return null / false.
 */
import {
  storeShortTermMemory,
  getShortTermMemoriesForUser,
  getShortTermMemoriesForServer,
  getShortTermMemoryForUserChannel,
  getShortTermMemoryForServerChannel,
  getShortTermMemoryForChannel,
  updateShortTermMemorySummary,
  invalidateShortTermMemory,
  clearShortTermMemoryForChannel,
  clearShortTermMemoryForServerChannel,
  clearShortTermMemoryForUser,
  type ShortTermMemoryEntry,
} from "@/utils/cache/shortTermMemoryCache";
import type { IRepository } from "./IRepository";

/** STM is ephemeral: no portable export shape exists yet. */
export type ShortTermMemoryExportShape = Record<string, never>;

export class ShortTermMemoryRepository implements IRepository<ShortTermMemoryExportShape> {
  /**
   * Returns all active short-term memory entries for a user across channels.
   *
   */
  getForUser(userId: string): ShortTermMemoryEntry[] {
    return getShortTermMemoriesForUser(userId);
  }

  /**
   * Returns all active short-term memory entries for a server across channels.
   *
   */
  getForServer(serverId: string): ShortTermMemoryEntry[] {
    return getShortTermMemoriesForServer(serverId);
  }

  /**
   * Returns the STM entry for a specific user in a specific channel.
   *
   */
  getForUserChannel(userId: string, channelId: string): ShortTermMemoryEntry | undefined {
    return getShortTermMemoryForUserChannel(userId, channelId);
  }

  /**
   * Returns the server-scoped STM entry for a specific channel.
   *
   */
  getForServerChannel(serverId: string, channelId: string): ShortTermMemoryEntry | undefined {
    return getShortTermMemoryForServerChannel(serverId, channelId);
  }

  /**
   * Returns the best available STM entry for a channel (user-scoped preferred,
   * falls back to server-scoped).
   *
   */
  getForChannel(
    ...args: Parameters<typeof getShortTermMemoryForChannel>
  ): ReturnType<typeof getShortTermMemoryForChannel> {
    return getShortTermMemoryForChannel(...args);
  }

  /**
   * Stores a new short-term memory entry.
   *
   */
  store(...args: Parameters<typeof storeShortTermMemory>): ReturnType<typeof storeShortTermMemory> {
    return storeShortTermMemory(...args);
  }

  /**
   * Updates the summary text of an existing STM entry identified by
   * userCacheKey + serverCacheKey + channelId.
   *
   */
  updateSummary(
    ...args: Parameters<typeof updateShortTermMemorySummary>
  ): ReturnType<typeof updateShortTermMemorySummary> {
    return updateShortTermMemorySummary(...args);
  }

  /**
   * Invalidates (expires) a short-term memory entry by its cache key.
   *
   */
  invalidate(...args: Parameters<typeof invalidateShortTermMemory>): void {
    invalidateShortTermMemory(...args);
  }

  /**
   * Clears all STM entries for a channel.
   *
   */
  clearForChannel(channelId: string): void {
    clearShortTermMemoryForChannel(channelId);
  }

  /**
   * Clears STM entries scoped to a server + channel pair.
   *
   */
  clearForServerChannel(...args: Parameters<typeof clearShortTermMemoryForServerChannel>): void {
    clearShortTermMemoryForServerChannel(...args);
  }

  /**
   * Clears all STM entries for a user across all channels.
   *
   */
  clearForUser(userId: string): void {
    clearShortTermMemoryForUser(userId);
  }

  /**
   * Short-term memory is ephemeral: nothing to export.
   * Returns null always.
   */
  async toExportShape(_ownerId: string | number): Promise<ShortTermMemoryExportShape | null> {
    return null;
  }

  /**
   * Short-term memory is ephemeral: nothing to import.
   * Returns false always.
   */
  async fromExportShape(_ownerId: string | number, _data: ShortTermMemoryExportShape): Promise<boolean> {
    return false;
  }
}

/** Singleton instance: import this in callers. */
export const shortTermMemoryRepository = new ShortTermMemoryRepository();

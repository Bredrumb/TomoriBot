/**
 * ChannelContextNoteRepository: manages per-channel context note entries.
 *
 * Covered table: channel_context_notes.
 *
 * Per-channel data is server-local and transient (not exported per-server),
 * so this repository implements no IRepository interface.
 */
import { invalidateChannelContextNoteCache, type ChannelContextNote } from "@/utils/cache/channelContextNoteCacheStore";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

export class ChannelContextNoteRepository {
  /**
   * Returns the per-channel context note, or null if none is set.
   *
   * @param serverId      - Internal server DB ID
   * @param channelDiscId - Discord snowflake ID of the channel
   */
  async getChannelContextNote(serverId: number, channelDiscId: string): Promise<ChannelContextNote | null> {
    try {
      const rows = await sql`
        SELECT context_note, context_note_depth
        FROM channel_context_notes
        WHERE server_id = ${serverId}
          AND channel_disc_id = ${channelDiscId}
        LIMIT 1
      `;
      if (!rows.length) return null;

      return {
        note: rows[0].context_note as string,
        depth: rows[0].context_note_depth as number,
      };
    } catch (error) {
      log.error(`Error fetching channel context note for server ${serverId} channel ${channelDiscId}:`, error);
      return null;
    }
  }

  /**
   * Upserts a per-channel context note and invalidates its cache.
   *
   * @param serverId      - Internal server DB ID
   * @param channelDiscId - Discord snowflake ID of the channel
   * @param depth         - Injection depth (0 = closest to reply, max 100)
   */
  async setChannelContextNote(serverId: number, channelDiscId: string, note: string, depth: number): Promise<boolean> {
    try {
      await sql`
        INSERT INTO channel_context_notes (server_id, channel_disc_id, context_note, context_note_depth)
        VALUES (${serverId}, ${channelDiscId}, ${note}, ${depth})
        ON CONFLICT (server_id, channel_disc_id)
        DO UPDATE SET
          context_note       = EXCLUDED.context_note,
          context_note_depth = EXCLUDED.context_note_depth,
          updated_at         = CURRENT_TIMESTAMP
      `;
      invalidateChannelContextNoteCache(serverId, channelDiscId);
      return true;
    } catch (error) {
      log.error(`Error setting channel context note for server ${serverId} channel ${channelDiscId}:`, error);
      return false;
    }
  }

  /**
   * Deletes the per-channel context note for a single channel and invalidates its cache.
   *
   * @param serverId      - Internal server DB ID
   * @param channelDiscId - Discord snowflake ID of the channel
   */
  async deleteChannelContextNote(serverId: number, channelDiscId: string): Promise<boolean> {
    try {
      await sql`
        DELETE FROM channel_context_notes
        WHERE server_id = ${serverId}
          AND channel_disc_id = ${channelDiscId}
      `;
      invalidateChannelContextNoteCache(serverId, channelDiscId);
      return true;
    } catch (error) {
      log.error(`Error deleting channel context note for server ${serverId} channel ${channelDiscId}:`, error);
      return false;
    }
  }
}

export const channelContextNoteRepo = new ChannelContextNoteRepository();

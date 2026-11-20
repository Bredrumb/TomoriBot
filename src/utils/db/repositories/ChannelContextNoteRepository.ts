import { invalidateChannelContextNoteCache, type ChannelContextNote } from "@/utils/cache/channelContextNoteCacheStore";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

class ChannelContextNoteRepository {
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

  // Depth counts backward from the reply (0 is closest to the reply, max 100) so callers order injections
  // consistently.
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

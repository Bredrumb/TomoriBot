/**
 * ChannelPromptRepository: manages per-channel system prompt overrides.
 *
 * Covered table: channel_prompt_overrides.
 *
 * Per-channel data is server-local and transient (not exported per-server),
 * so this repository implements no IRepository interface.
 */
import type { ChannelPromptMode } from "@/types/db/schema";
import { type ChannelPromptOverride, invalidateChannelPromptCache } from "@/utils/cache/channelPromptCacheStore";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

class ChannelPromptRepository {
  /**
   * Returns the per-channel system prompt override, or null if none is set.
   *
   * @param serverId      - Internal server DB ID
   * @param channelDiscId - Discord snowflake ID of the channel
   */
  async getChannelPromptOverride(serverId: number, channelDiscId: string): Promise<ChannelPromptOverride | null> {
    try {
      const rows = await sql`
        SELECT channel_prompt, channel_prompt_mode
        FROM channel_prompt_overrides
        WHERE server_id = ${serverId}
          AND channel_disc_id = ${channelDiscId}
        LIMIT 1
      `;
      if (!rows.length) return null;

      return {
        prompt: rows[0].channel_prompt as string,
        mode: rows[0].channel_prompt_mode as ChannelPromptMode,
      };
    } catch (error) {
      log.error(`Error fetching channel prompt override for server ${serverId} channel ${channelDiscId}:`, error);
      return null;
    }
  }

  /**
   * Upserts a per-channel system prompt override and invalidates its cache.
   *
   * @param serverId      - Internal server DB ID
   * @param channelDiscId - Discord snowflake ID of the channel
   * @param mode          - "append" or "replace"
   */
  async setChannelPromptOverride(
    serverId: number,
    channelDiscId: string,
    prompt: string,
    mode: ChannelPromptMode,
  ): Promise<boolean> {
    try {
      await sql`
        INSERT INTO channel_prompt_overrides (server_id, channel_disc_id, channel_prompt, channel_prompt_mode)
        VALUES (${serverId}, ${channelDiscId}, ${prompt}, ${mode})
        ON CONFLICT (server_id, channel_disc_id)
        DO UPDATE SET
          channel_prompt = EXCLUDED.channel_prompt,
          channel_prompt_mode = EXCLUDED.channel_prompt_mode,
          updated_at = CURRENT_TIMESTAMP
      `;
      // Invalidate only after a successful write
      invalidateChannelPromptCache(serverId, channelDiscId);
      return true;
    } catch (error) {
      log.error(`Error setting channel prompt override for server ${serverId} channel ${channelDiscId}:`, error);
      return false;
    }
  }

  /**
   * Deletes the per-channel system prompt override for a single channel and invalidates its cache.
   *
   * @param serverId      - Internal server DB ID
   * @param channelDiscId - Discord snowflake ID of the channel
   */
  async deleteChannelPromptOverride(serverId: number, channelDiscId: string): Promise<boolean> {
    try {
      await sql`
        DELETE FROM channel_prompt_overrides
        WHERE server_id = ${serverId}
          AND channel_disc_id = ${channelDiscId}
      `;
      // Invalidate only after a successful write
      invalidateChannelPromptCache(serverId, channelDiscId);
      return true;
    } catch (error) {
      log.error(`Error deleting channel prompt override for server ${serverId} channel ${channelDiscId}:`, error);
      return false;
    }
  }
}

export const channelPromptRepo = new ChannelPromptRepository();

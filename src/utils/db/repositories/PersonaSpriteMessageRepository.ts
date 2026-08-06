import { personaSpriteMessageSchema, type PersonaSpriteMessageRow } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

export type PersonaSpriteMessageRecordInput = {
  messageDiscId: string;
  personaId: number;
  spriteName: string;
  channelDiscId: string;
};

/**
 * Persists the message → sprite-label mapping for webhook-delivered sprite messages.
 *
 * Rows are immutable (a sent message's sprite never changes), so writes never
 * require cache invalidation, so callers seed the read cache directly instead.
 * Missing rows degrade gracefully: context rebuilding falls back to the plain
 * persona name, never an error.
 */
class PersonaSpriteMessageRepository {
  /**
   * Records that a webhook message was delivered with a sprite label.
   *
   * @returns true when the row was written (or already existed), false on error
   */
  async record(input: PersonaSpriteMessageRecordInput): Promise<boolean> {
    try {
      await sql`
        INSERT INTO persona_sprite_messages (message_disc_id, persona_id, sprite_name, channel_disc_id)
        VALUES (${input.messageDiscId}, ${input.personaId}, ${input.spriteName}, ${input.channelDiscId})
        ON CONFLICT (message_disc_id) DO NOTHING
      `;
      return true;
    } catch (error) {
      log.error(`Error recording persona sprite message ${input.messageDiscId} for persona ${input.personaId}:`, error);
      return false;
    }
  }

  /**
   * Batch-loads sprite mappings for a set of Discord message IDs.
   * Single round trip via `message_disc_id = ANY(...)` so context builds can
   * resolve an entire history window in one query.
   *
   * @returns null on query failure, so callers must NOT cache misses in that case,
   *   or a transient DB error would negative-cache real sprite messages
   */
  async getByMessageIds(messageDiscIds: string[]): Promise<Map<string, PersonaSpriteMessageRow> | null> {
    const result = new Map<string, PersonaSpriteMessageRow>();
    if (messageDiscIds.length === 0) {
      return result;
    }

    try {
      const rows = await sql<PersonaSpriteMessageRow[]>`
        SELECT message_disc_id, persona_id, sprite_name, channel_disc_id, created_at
        FROM persona_sprite_messages
        WHERE message_disc_id = ANY(${sql.array(messageDiscIds, "TEXT")})
      `;

      for (const row of rows) {
        const parsed = personaSpriteMessageSchema.safeParse(row);
        if (!parsed.success) {
          log.warn(`Invalid persona_sprite_messages row for message ${row.message_disc_id}: ${parsed.error.message}`);
          continue;
        }
        result.set(parsed.data.message_disc_id, parsed.data);
      }
      return result;
    } catch (error) {
      log.error(`Error loading persona sprite messages (${messageDiscIds.length} ids):`, error);
      return null;
    }
  }

  /**
   * Deletes mappings older than the retention window. Old rows only matter while
   * their messages can still appear in a fetched history window.
   *
   * @returns number of rows deleted, or 0 on error
   */
  async pruneOlderThanDays(retentionDays: number): Promise<number> {
    try {
      const rows = await sql<Array<{ message_disc_id: string }>>`
        DELETE FROM persona_sprite_messages
        WHERE created_at < NOW() - make_interval(days => ${retentionDays})
        RETURNING message_disc_id
      `;
      return rows.length;
    } catch (error) {
      log.error(`Error pruning persona sprite messages older than ${retentionDays} days:`, error);
      return 0;
    }
  }
}

export const personaSpriteMessageRepository = new PersonaSpriteMessageRepository();

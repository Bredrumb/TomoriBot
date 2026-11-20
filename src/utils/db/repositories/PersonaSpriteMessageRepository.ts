import { personaSpriteMessageSchema, type PersonaSpriteMessageRow } from "@/types/db/schema";
import { sql, withTransientDbRetry } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

export type PersonaSpriteMessageRecordInput = {
  messageDiscId: string;
  personaId: number;
  spriteName: string;
  channelDiscId: string;
};

// Rows are immutable, so writes skip cache invalidation and seed the cache directly; missing rows degrade context
// rebuilding to the plain persona name.
class PersonaSpriteMessageRepository {
  async record(input: PersonaSpriteMessageRecordInput): Promise<boolean> {
    try {
      await sql`
        INSERT INTO persona_sprite_messages (message_disc_id, persona_id, sprite_name, channel_disc_id)
        VALUES (${input.messageDiscId}, ${input.personaId}, ${input.spriteName}, ${input.channelDiscId})
        ON CONFLICT (message_disc_id) DO NOTHING
      `;
      return true;
    } catch (error) {
      if (typeof error === "object" && error !== null && "errno" in error && error.errno === "23503") {
        log.metric("persona_sprite_message_skipped", { reason: "persona_deleted" });
        log.warn("Skipped sprite message mapping for a deleted persona", error, {
          personaId: input.personaId,
        });
        return false;
      }
      log.error(`Error recording persona sprite message ${input.messageDiscId} for persona ${input.personaId}:`, error);
      return false;
    }
  }

  // Query failures return null instead of an empty map so callers do not negative-cache real sprite messages during
  // transient DB errors.
  async getByMessageIds(messageDiscIds: string[]): Promise<Map<string, PersonaSpriteMessageRow> | null> {
    const result = new Map<string, PersonaSpriteMessageRow>();
    if (messageDiscIds.length === 0) {
      return result;
    }

    try {
      const rows = await withTransientDbRetry(
        () => sql<PersonaSpriteMessageRow[]>`
        SELECT message_disc_id, persona_id, sprite_name, channel_disc_id, created_at
        FROM persona_sprite_messages
        WHERE message_disc_id = ANY(${sql.array(messageDiscIds, "TEXT")})
        `,
        "load persona sprite messages",
      );

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

import { personaSpriteSchema, type PersonaSpriteRow } from "@/types/db/schema";
import { invalidatePersonaSpriteCache } from "@/utils/cache/personaSpriteCacheStore";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

export type PersonaSpriteUpsertInput = {
  personaId: number;
  spriteName: string;
  spriteKey: string;
  avatarUrl: string;
  usageInstructions: string;
  isIdentity: boolean;
};

export type PersonaSpriteUpsertResult = {
  sprite: PersonaSpriteRow;
  previousAvatarUrl: string | null;
  replaced: boolean;
};

export type PersonaSpriteMetadataUpdateInput = {
  spriteId: number;
  personaId: number;
  spriteName: string;
  spriteKey: string;
  avatarUrl?: string;
  usageInstructions: string;
  isIdentity: boolean;
};

type PersonaSpriteUpsertRow = PersonaSpriteRow & {
  previous_avatar_url: string | null;
  previous_sprite_id: number | null;
};

type PersonaSpriteUpdateRow = PersonaSpriteRow & {
  previous_avatar_url: string | null;
};

export type PersonaSpriteMetadataUpdateResult = {
  sprite: PersonaSpriteRow;
  previousAvatarUrl: string | null;
};

export class PersonaSpriteRepository {
  async listForPersona(personaId: number): Promise<PersonaSpriteRow[]> {
    try {
      const rows = await sql<PersonaSpriteRow[]>`
        SELECT sprite_id, persona_id, sprite_name, sprite_key, avatar_url, usage_instructions, is_identity, created_at, updated_at
        FROM persona_sprites
        WHERE persona_id = ${personaId}
        ORDER BY sprite_key ASC, sprite_id ASC
      `;

      return this.parseRows(rows, `persona ${personaId}`);
    } catch (error) {
      log.error(`Error loading persona sprites for persona ${personaId}:`, error);
      return [];
    }
  }

  async countForPersona(personaId: number): Promise<number> {
    try {
      const [row] = await sql<Array<{ count: string | number }>>`
        SELECT COUNT(*) AS count
        FROM persona_sprites
        WHERE persona_id = ${personaId}
      `;
      return Number(row?.count ?? 0);
    } catch (error) {
      log.error(`Error counting persona sprites for persona ${personaId}:`, error);
      return 0;
    }
  }

  async getByKey(personaId: number, spriteKey: string): Promise<PersonaSpriteRow | null> {
    try {
      const [row] = await sql<PersonaSpriteRow[]>`
        SELECT sprite_id, persona_id, sprite_name, sprite_key, avatar_url, usage_instructions, is_identity, created_at, updated_at
        FROM persona_sprites
        WHERE persona_id = ${personaId}
          AND sprite_key = ${spriteKey}
        LIMIT 1
      `;
      return row ? this.parseRow(row, `persona ${personaId} sprite ${spriteKey}`) : null;
    } catch (error) {
      log.error(`Error loading persona sprite ${spriteKey} for persona ${personaId}:`, error);
      return null;
    }
  }

  async upsertSprite(input: PersonaSpriteUpsertInput): Promise<PersonaSpriteUpsertResult | null> {
    try {
      const [row] = await sql<PersonaSpriteUpsertRow[]>`
        WITH existing AS (
          SELECT sprite_id, avatar_url
          FROM persona_sprites
          WHERE persona_id = ${input.personaId}
            AND sprite_key = ${input.spriteKey}
        ),
        upserted AS (
          INSERT INTO persona_sprites (persona_id, sprite_name, sprite_key, avatar_url, usage_instructions, is_identity)
          VALUES (
            ${input.personaId},
            ${input.spriteName},
            ${input.spriteKey},
            ${input.avatarUrl},
            ${input.usageInstructions},
            ${input.isIdentity}
          )
          ON CONFLICT (persona_id, sprite_key) DO UPDATE
          SET
            sprite_name = EXCLUDED.sprite_name,
            avatar_url = EXCLUDED.avatar_url,
            usage_instructions = EXCLUDED.usage_instructions,
            is_identity = EXCLUDED.is_identity,
            updated_at = NOW()
          RETURNING sprite_id, persona_id, sprite_name, sprite_key, avatar_url, usage_instructions, is_identity, created_at, updated_at
        )
        SELECT
          upserted.*,
          existing.avatar_url AS previous_avatar_url,
          existing.sprite_id AS previous_sprite_id
        FROM upserted
        LEFT JOIN existing ON true
      `;

      if (!row) {
        return null;
      }

      const sprite = this.parseRow(row, `persona ${input.personaId} sprite ${input.spriteKey}`);
      if (!sprite) {
        return null;
      }

      invalidatePersonaSpriteCache(input.personaId);
      return {
        sprite,
        previousAvatarUrl: row.previous_avatar_url ?? null,
        replaced: row.previous_sprite_id !== null,
      };
    } catch (error) {
      log.error(`Error upserting persona sprite ${input.spriteKey} for persona ${input.personaId}:`, error);
      return null;
    }
  }

  /**
   * Updates a sprite's metadata in place (name, lookup key, usage instructions,
   * and identity flag). When `avatarUrl` is provided, the stored image reference
   * is replaced in the same write.
   *
   * Renaming changes `sprite_key`; callers must guarantee the new key does not
   * collide with another sprite on the same persona (the `(persona_id, sprite_key)`
   * unique constraint). A collision surfaces as a caught error returning null.
   *
   * @param input - target sprite identifiers plus the new metadata values
   * @returns the updated row and previous avatar URL, or null when no row matched or the update failed
   */
  async updateSpriteMetadata(
    input: PersonaSpriteMetadataUpdateInput,
  ): Promise<PersonaSpriteMetadataUpdateResult | null> {
    try {
      const [row] = await sql<PersonaSpriteUpdateRow[]>`
        WITH existing AS (
          SELECT avatar_url
          FROM persona_sprites
          WHERE sprite_id = ${input.spriteId}
            AND persona_id = ${input.personaId}
        ),
        updated AS (
          UPDATE persona_sprites
          SET
            sprite_name = ${input.spriteName},
            sprite_key = ${input.spriteKey},
            avatar_url = COALESCE(${input.avatarUrl ?? null}, avatar_url),
            usage_instructions = ${input.usageInstructions},
            is_identity = ${input.isIdentity},
            updated_at = NOW()
          WHERE sprite_id = ${input.spriteId}
            AND persona_id = ${input.personaId}
          RETURNING sprite_id, persona_id, sprite_name, sprite_key, avatar_url, usage_instructions, is_identity, created_at, updated_at
        )
        SELECT updated.*, existing.avatar_url AS previous_avatar_url
        FROM updated
        LEFT JOIN existing ON true
      `;

      if (!row) {
        return null;
      }

      const sprite = this.parseRow(row, `persona ${input.personaId} sprite ${input.spriteId}`);
      if (!sprite) {
        return null;
      }

      invalidatePersonaSpriteCache(input.personaId);
      return {
        sprite,
        previousAvatarUrl: row.previous_avatar_url ?? null,
      };
    } catch (error) {
      log.error(`Error updating persona sprite ${input.spriteId} for persona ${input.personaId}:`, error);
      return null;
    }
  }

  async deleteSpritesByIds(personaId: number, spriteIds: number[]): Promise<PersonaSpriteRow[]> {
    if (spriteIds.length === 0) {
      return [];
    }

    try {
      const rows = await sql<PersonaSpriteRow[]>`
        DELETE FROM persona_sprites
        WHERE persona_id = ${personaId}
          AND sprite_id = ANY(${sql.array(spriteIds, "int4")})
        RETURNING sprite_id, persona_id, sprite_name, sprite_key, avatar_url, usage_instructions, is_identity, created_at, updated_at
      `;
      const parsedRows = this.parseRows(rows, `persona ${personaId} sprite deletion`);
      if (parsedRows.length > 0) {
        invalidatePersonaSpriteCache(personaId);
      }
      return parsedRows;
    } catch (error) {
      log.error(`Error deleting persona sprites for persona ${personaId}:`, error);
      return [];
    }
  }

  private parseRows(rows: PersonaSpriteRow[], context: string): PersonaSpriteRow[] {
    const parsedRows: PersonaSpriteRow[] = [];
    for (const row of rows) {
      const parsed = this.parseRow(row, context);
      if (parsed) {
        parsedRows.push(parsed);
      }
    }
    return parsedRows;
  }

  private parseRow(row: unknown, context: string): PersonaSpriteRow | null {
    const parsed = personaSpriteSchema.safeParse(row);
    if (!parsed.success) {
      log.warn(`Invalid persona_sprites row for ${context}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  }
}

export const personaSpriteRepository = new PersonaSpriteRepository();

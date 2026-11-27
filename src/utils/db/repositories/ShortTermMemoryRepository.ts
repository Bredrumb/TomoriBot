import { isDeepStrictEqual } from "node:util";
import { sql, withTransientDbRetry } from "@/utils/db/client";
import type { ServerStmConfigRow, ShortTermMemoryRow, StmCategoryRow } from "@/types/db/schema";
import { normalizeStmCategories, serverStmConfigSchema, stmCategorySchema } from "@/types/db/schema";
import {
  storeShortTermMemory,
  getShortTermMemoriesForUser,
  getShortTermMemoriesForServer,
  getShortTermMemoryForUserChannel,
  getShortTermMemoryForServerChannel,
  updateShortTermMemorySummary,
  clearShortTermMemorySummary,
  updateShortTermMemoryCategories,
  incrementStmTurnCounter,
  filterUnwarmedStmUsers,
  warmUserStmRows,
  invalidateShortTermMemory,
  clearShortTermMemoryForChannel,
  clearShortTermMemoryForServerChannel,
  clearShortTermMemoryForUser,
  type ShortTermMemoryEntry,
} from "@/utils/cache/shortTermMemoryCache";
import { log } from "@/utils/misc/logger";
import type { IRepository } from "./IRepository";

export type StmContent = { summary: string } | { categories: Record<string, string> };

type StmCategory = Pick<StmCategoryRow, "position" | "label" | "description">;
type StmContentRow = Pick<
  ShortTermMemoryRow,
  "scope_kind" | "summary" | "categories" | "summarized_through" | "last_refreshed_turn"
> & { stm_id: number };

const STM_SNAPSHOT_CHANGED = new Error("STM snapshot changed during the write");
const DEFAULT_STM_CATEGORY = {
  position: 0,
  label: "summary",
  description: "A running summary of recent events, topics, and context from this conversation.",
} satisfies StmCategory;

type ShortTermMemoryExportShape = {
  stm_config: {
    refresh_cadence: number;
    render_mode: "supersede" | "crude_summary";
    crude_message_count: number;
    summarizer_instructions_override?: string | null;
    content_injection_depth?: number;
  } | null;
  stm_categories: Array<{
    position: number;
    label: string;
    description: string;
  }>;
};

class ShortTermMemoryRepository implements IRepository<ShortTermMemoryExportShape> {
  getForUser(userId: string): ShortTermMemoryEntry[] {
    return getShortTermMemoriesForUser(userId);
  }

  getForServer(serverId: string): ShortTermMemoryEntry[] {
    return getShortTermMemoriesForServer(serverId);
  }

  getForUserChannel(userId: string, channelId: string): ShortTermMemoryEntry | undefined {
    return getShortTermMemoryForUserChannel(userId, channelId);
  }

  getForServerChannel(serverId: string, channelId: string): ShortTermMemoryEntry | undefined {
    return getShortTermMemoryForServerChannel(serverId, channelId);
  }

  getForChannel(
    ...args: Parameters<typeof getShortTermMemoryForUserChannel>
  ): ReturnType<typeof getShortTermMemoryForUserChannel> {
    return getShortTermMemoryForUserChannel(...args);
  }

  store(...args: Parameters<typeof storeShortTermMemory>): ReturnType<typeof storeShortTermMemory> {
    return storeShortTermMemory(...args);
  }

  updateSummary(
    ...args: Parameters<typeof updateShortTermMemorySummary>
  ): ReturnType<typeof updateShortTermMemorySummary> {
    return updateShortTermMemorySummary(...args);
  }

  updateCategories(
    ...args: Parameters<typeof updateShortTermMemoryCategories>
  ): ReturnType<typeof updateShortTermMemoryCategories> {
    return updateShortTermMemoryCategories(...args);
  }

  clearSummary(
    ...args: Parameters<typeof clearShortTermMemorySummary>
  ): ReturnType<typeof clearShortTermMemorySummary> {
    return clearShortTermMemorySummary(...args);
  }

  incrementTurnCounter(
    ...args: Parameters<typeof incrementStmTurnCounter>
  ): ReturnType<typeof incrementStmTurnCounter> {
    return incrementStmTurnCounter(...args);
  }

  invalidate(...args: Parameters<typeof invalidateShortTermMemory>): void {
    invalidateShortTermMemory(...args);
  }

  clearForChannel(channelId: string): void {
    clearShortTermMemoryForChannel(channelId);
  }

  clearForServerChannel(...args: Parameters<typeof clearShortTermMemoryForServerChannel>): void {
    clearShortTermMemoryForServerChannel(...args);
  }

  clearForUser(userId: string): void {
    clearShortTermMemoryForUser(userId);
  }

  async writeSummarization(
    scope: { serverId: string | null; userId: string; channelId: string; personaId: number | null },
    snapshot: {
      summary: string | undefined;
      categories: Record<string, string>;
      summarizedThrough: number | undefined;
      lastRefreshedTurn: number;
    },
    content: StmContent,
    summarizedThrough: number | undefined,
    categorySnapshot: { serverId: number; categories: readonly StmCategory[] } | undefined,
    isCurrent: () => boolean,
  ): Promise<boolean> {
    const { serverId, userId, channelId, personaId } = scope;
    return await sql
      .begin(async (tx) => {
        if (categorySnapshot) {
          await tx`SELECT server_id FROM servers WHERE server_id = ${categorySnapshot.serverId} FOR NO KEY UPDATE`;
          const categories = await tx<StmCategory[]>`
            SELECT position, label, description FROM stm_categories
            WHERE server_id = ${categorySnapshot.serverId} ORDER BY position ASC
          `;
          if (
            !isDeepStrictEqual(
              (categories.length > 0 ? categories : [DEFAULT_STM_CATEGORY]).map(
                ({ position, label, description }) => ({ position, label, description }),
              ),
              categorySnapshot.categories.map(({ position, label, description }) => ({ position, label, description })),
            )
          )
            return false;
        }
        const rows = await tx<StmContentRow[]>`
          SELECT stm_id, scope_kind, summary, categories, summarized_through, last_refreshed_turn
          FROM short_term_memories
          WHERE COALESCE(server_disc_id, '') = COALESCE(${serverId}, '')
            AND channel_disc_id = ${channelId}
            AND COALESCE(persona_id, 0) = COALESCE(${personaId}, 0)
            AND ((scope_kind = 'user' AND user_disc_id = ${userId})
              OR (scope_kind = 'server' AND user_disc_id IS NULL AND ${serverId}::TEXT IS NOT NULL))
          ORDER BY stm_id
          FOR UPDATE
        `;
        const liveRow = rows.find((row) => row.scope_kind === (serverId ? "server" : "user"));
        if (
          rows.length !== (serverId ? 2 : 1) ||
          !liveRow ||
          !isCurrent() ||
          (liveRow.summary ?? undefined) !== snapshot.summary ||
          liveRow.summarized_through?.getTime() !== snapshot.summarizedThrough ||
          liveRow.last_refreshed_turn !== snapshot.lastRefreshedTurn ||
          !isDeepStrictEqual(normalizeStmCategories(liveRow.categories), snapshot.categories)
        ) {
          return false;
        }

        const summary = "summary" in content ? content.summary : null;
        const categories = "categories" in content ? JSON.stringify(content.categories) : null;
        await tx`
          UPDATE short_term_memories
          SET summary = COALESCE(${summary}, summary),
              categories = COALESCE(${categories}::JSONB, categories),
              summarized_through = ${summarizedThrough === undefined ? null : new Date(summarizedThrough)}
          WHERE stm_id IN (${rows[0].stm_id}, ${rows[1]?.stm_id ?? rows[0].stm_id})
        `;
        await tx`
          UPDATE short_term_memories
          SET turns_since_refresh = 0, last_refreshed_turn = last_refreshed_turn + 1
          WHERE stm_id = ${liveRow.stm_id}
        `;
        if (!isCurrent()) throw STM_SNAPSHOT_CHANGED;
        return true;
      })
      .catch((error: unknown) => {
        if (error === STM_SNAPSHOT_CHANGED) return false;
        throw error;
      });
  }

  async getStmConfig(serverId: number): Promise<ServerStmConfigRow | null> {
    try {
      const [row] = await withTransientDbRetry(
        async () => await sql`SELECT * FROM server_stm_configs WHERE server_id = ${serverId}`,
        "load short-term memory configuration",
      );
      if (!row) return null;
      const parsed = serverStmConfigSchema.safeParse(row);
      return parsed.success ? parsed.data : null;
    } catch (error) {
      log.error(`[STMRepo] Failed to load server_stm_configs for server ${serverId}`, error);
      return null;
    }
  }

  // One query for many users, so ranking a server's members does not issue a query per member.
  async preWarmUsers(userDiscIds: readonly string[]): Promise<void> {
    const cold = filterUnwarmedStmUsers(userDiscIds);
    if (cold.length === 0) return;
    try {
      const rows = await sql<ShortTermMemoryRow[]>`
        SELECT * FROM short_term_memories
        WHERE scope_kind = 'user' AND user_disc_id = ANY(${sql.array(cold, "TEXT")})
      `;
      warmUserStmRows(cold, rows);
    } catch (error) {
      log.warn("[STMRepo] Batch user STM warm failed", error, { metadata: { userCount: cold.length } });
    }
  }

  async personaIdsWithStm(scopeKind: "server" | "user", discId: string, channelId: string): Promise<Set<number>> {
    try {
      const serverDiscId = scopeKind === "server" ? discId : null;
      const userDiscId = scopeKind === "user" ? discId : null;
      const rows = await withTransientDbRetry(
        async () =>
          await sql<{ persona_id: number }[]>`
          SELECT persona_id
          FROM short_term_memories
          WHERE scope_kind = ${scopeKind}
            AND COALESCE(server_disc_id, '') = COALESCE(${serverDiscId}, '')
            AND COALESCE(user_disc_id, '')   = COALESCE(${userDiscId}, '')
            AND channel_disc_id = ${channelId}
            AND persona_id IS NOT NULL
            AND persona_id > 0
            AND (
              (summary IS NOT NULL AND TRIM(summary) != '')
              OR (categories IS NOT NULL AND categories != '{}'::jsonb)
            )
        `,
        "list personas with short-term memory",
      );
      return new Set(rows.map((r) => r.persona_id));
    } catch (error) {
      log.error("[STMRepo] Failed to resolve personaIdsWithStm", error);
      return new Set();
    }
  }

  async getStmCategories(serverId: number): Promise<StmCategoryRow[]> {
    try {
      const rows = await withTransientDbRetry(
        async () =>
          await sql`
          SELECT * FROM stm_categories
          WHERE server_id = ${serverId}
          ORDER BY position ASC
        `,
        "load short-term memory categories",
      );

      const categories: StmCategoryRow[] = [];
      for (const row of rows) {
        const parsed = stmCategorySchema.safeParse(row);
        if (parsed.success) categories.push(parsed.data);
      }

      if (categories.length === 0) {
        // Fallback: return the implicit default so callers never get an empty list
        return [{ server_id: serverId, ...DEFAULT_STM_CATEGORY }];
      }

      return categories;
    } catch (error) {
      log.error(`[STMRepo] Failed to load stm_categories for server ${serverId}`, error);
      return [{ server_id: serverId, ...DEFAULT_STM_CATEGORY }];
    }
  }

  async upsertStmConfig(serverId: number, patch: Partial<Omit<ServerStmConfigRow, "server_id">>): Promise<boolean> {
    // Allowlist guards against column-name injection when building dynamic SQL.
    const ALLOWED_STM_CONFIG_COLS = new Set<string>([
      "refresh_cadence",
      "render_mode",
      "crude_message_count",
      "summarizer_instructions_override",
      "content_injection_depth",
    ]);

    const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && ALLOWED_STM_CONFIG_COLS.has(k));
    if (entries.length === 0) return false;

    try {
      const cols = ["server_id", ...entries.map(([k]) => k)];
      const vals: unknown[] = [serverId, ...entries.map(([, v]) => v)];
      const setClause = entries.map(([k], i) => `${k} = $${i + 2}`).join(", ");
      const colList = cols.join(", ");
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");

      await sql.unsafe(
        `INSERT INTO server_stm_configs (${colList})
         VALUES (${placeholders})
         ON CONFLICT (server_id)
         DO UPDATE SET ${setClause}`,
        vals,
      );
      return true;
    } catch (error) {
      log.error(`[STMRepo] Failed to upsert server_stm_configs for server ${serverId}`, error);
      return false;
    }
  }

  async upsertStmCategories(
    serverId: number,
    categories: Array<{ position: number; label: string; description: string }>,
  ): Promise<boolean> {
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT server_id FROM servers WHERE server_id = ${serverId} FOR NO KEY UPDATE`;
        await tx`DELETE FROM stm_categories WHERE server_id = ${serverId}`;
        for (const cat of categories) {
          await tx`
            INSERT INTO stm_categories (server_id, position, label, description)
            VALUES (${serverId}, ${cat.position}, ${cat.label}, ${cat.description})
          `;
        }
      });
      return true;
    } catch (error) {
      log.error(`[STMRepo] Failed to upsert stm_categories for server ${serverId}`, error);
      return false;
    }
  }

  // Cache entries are left untouched because they age out on their own TTL.
  async purgeStaleEntries(retentionDays: number): Promise<number> {
    const rows = await sql`
      DELETE FROM short_term_memories
      WHERE updated_at < NOW() - (${retentionDays} || ' days')::INTERVAL
      RETURNING stm_id
    `;
    return rows.length;
  }

  async toExportShape(ownerId: string | number): Promise<ShortTermMemoryExportShape | null> {
    try {
      const serverDiscId = String(ownerId);

      const [serverRow] = await withTransientDbRetry(
        async () => await sql`SELECT server_id FROM servers WHERE server_disc_id = ${serverDiscId}`,
        "resolve server for short-term memory export",
      );
      if (!serverRow) return null;
      const serverId = serverRow.server_id as number;

      const [config, categories] = await Promise.all([this.getStmConfig(serverId), this.getStmCategories(serverId)]);

      return {
        stm_config: config
          ? {
              refresh_cadence: config.refresh_cadence,
              render_mode: config.render_mode,
              crude_message_count: config.crude_message_count,
              summarizer_instructions_override: config.summarizer_instructions_override ?? null,
              content_injection_depth: config.content_injection_depth,
            }
          : null,
        stm_categories: categories.map((c) => ({
          position: c.position,
          label: c.label,
          description: c.description,
        })),
      };
    } catch (error) {
      log.error("[STMRepo] toExportShape failed", error);
      return null;
    }
  }

  async fromExportShape(ownerId: string | number, data: ShortTermMemoryExportShape): Promise<boolean> {
    try {
      const serverDiscId = String(ownerId);
      const [serverRow] = await sql`SELECT server_id FROM servers WHERE server_disc_id = ${serverDiscId}`;
      if (!serverRow) {
        log.error(`[STMRepo] fromExportShape: server ${serverDiscId} not found`);
        return false;
      }
      const serverId = serverRow.server_id as number;

      const writes: Promise<boolean>[] = [];

      if (data.stm_config) {
        writes.push(this.upsertStmConfig(serverId, data.stm_config));
      }

      if (data.stm_categories.length > 0) {
        writes.push(this.upsertStmCategories(serverId, data.stm_categories));
      }

      if (writes.length === 0) return true;

      const results = await Promise.all(writes);
      return results.every(Boolean);
    } catch (error) {
      log.error("[STMRepo] fromExportShape failed", error);
      return false;
    }
  }
}

export const shortTermMemoryRepository = new ShortTermMemoryRepository();

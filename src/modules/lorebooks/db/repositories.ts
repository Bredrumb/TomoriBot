import type { SQL, TransactionSQL } from "bun";
import {
  LOREBOOK_ENTRIES_PER_SCOPE_MAX,
  lorebookEntryFlagsSchema,
  lorebookEntryInputSchema,
  lorebookEntryRowSchema,
  lorebookScopeSchema,
  type LorebookEntryFlags,
  type LorebookEntryInput,
  type LorebookEntryRow,
} from "@/modules/lorebooks/db/types";
import { sql, withTransientDbRetry } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

export type LorebookScopeReadResult =
  | { status: "fresh"; entries: LorebookEntryRow[] }
  | { status: "unavailable"; entries: [] };
export type LorebookInsertResult = number | "limit" | "invalid" | "failed";
export type LorebookUpdateResult = "updated" | "missing" | "invalid" | "failed";
export type LorebookDeleteResult = "deleted" | "missing" | "invalid" | "failed";
export type LorebookReplaceResult = "replaced" | "limit" | "invalid" | "failed";

function validScope(serverId: number, lineageId: number | null): boolean {
  return lorebookScopeSchema.safeParse({ serverId, lineageId }).success;
}

function validEntryId(entryId: number): boolean {
  return Number.isSafeInteger(entryId) && entryId > 0 && entryId <= 2147483647;
}

async function insertEntry(
  tx: TransactionSQL,
  serverId: number,
  lineageId: number | null,
  input: LorebookEntryInput,
): Promise<number> {
  const [row] = await tx<Array<{ entry_id: number }>>`
    INSERT INTO persona_lorebook_entries
      (server_id, persona_lineage_id, title, content, keys, secondary_keys, selective_logic, scan_depth,
       trigger_chance, insertion_order, placement, constant, enabled, channel_disc_ids)
    VALUES (${serverId}, ${lineageId}::bigint, ${input.title}, ${input.content}, ${tx.array(input.keys, "TEXT")},
      ${tx.array(input.secondary_keys, "TEXT")}, ${input.selective_logic}, ${input.scan_depth},
      ${input.trigger_chance}, ${input.insertion_order}, ${input.placement}, ${input.constant}, ${input.enabled},
      ${tx.array(input.channel_disc_ids, "TEXT")})
    RETURNING entry_id
  `;
  if (!row) throw new Error("Lorebook insertion returned no row");
  return row.entry_id;
}

export class LorebookRepository {
  constructor(private readonly db: SQL = sql) {}

  async loadEnabledForScope(serverId: number, lineageId: number | null): Promise<LorebookEntryRow[]> {
    if (!validScope(serverId, lineageId)) return [];
    try {
      const rows = await withTransientDbRetry(
        async () =>
          await this.db`
        SELECT * FROM persona_lorebook_entries
        WHERE server_id = ${serverId} AND enabled
          AND (persona_lineage_id IS NULL OR persona_lineage_id = ${lineageId}::bigint)
        ORDER BY insertion_order, entry_id
      `,
        "load lorebook context",
      );
      return lorebookEntryRowSchema.array().parse(rows);
    } catch (error) {
      log.warn("Lorebooks: failed to load context entries", error, { metadata: { serverId, lineageId } });
      return [];
    }
  }

  async listScope(serverId: number, lineageId: number | null): Promise<LorebookScopeReadResult> {
    if (!validScope(serverId, lineageId)) return { status: "unavailable", entries: [] };
    try {
      const rows = await this.db`
        SELECT * FROM persona_lorebook_entries
        WHERE server_id = ${serverId} AND persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint
        ORDER BY insertion_order, entry_id
      `;
      return { status: "fresh", entries: lorebookEntryRowSchema.array().parse(rows) };
    } catch (error) {
      await log.error(
        "Lorebooks: failed to list a scope",
        error,
        { metadata: { serverId, lineageId } },
        { persist: false },
      );
      return { status: "unavailable", entries: [] };
    }
  }

  async countsByLineage(serverId: number): Promise<Map<number | null, number> | null> {
    if (!validScope(serverId, null)) return null;
    try {
      const rows = await this.db<Array<{ persona_lineage_id: number | string | null; count: number }>>`
        SELECT persona_lineage_id, COUNT(*)::int AS count
        FROM persona_lorebook_entries WHERE server_id = ${serverId} GROUP BY persona_lineage_id
      `;
      return new Map(
        rows.map((row) => [row.persona_lineage_id === null ? null : Number(row.persona_lineage_id), row.count]),
      );
    } catch (error) {
      await log.error("Lorebooks: failed to count scopes", error, { metadata: { serverId } }, { persist: false });
      return null;
    }
  }

  async insert(serverId: number, lineageId: number | null, input: LorebookEntryInput): Promise<LorebookInsertResult> {
    const parsed = lorebookEntryInputSchema.safeParse(input);
    if (!validScope(serverId, lineageId) || !parsed.success) return "invalid";
    try {
      return await this.db.begin(async (tx): Promise<LorebookInsertResult> => {
        // Lock the server before counting so concurrent inserts and replacements cannot exceed a scope's limit.
        await tx`SELECT server_id FROM servers WHERE server_id = ${serverId} FOR UPDATE`;
        const [row] = await tx<Array<{ count: number }>>`
          SELECT COUNT(*)::int AS count FROM persona_lorebook_entries
          WHERE server_id = ${serverId} AND persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint
        `;
        if (row && row.count >= LOREBOOK_ENTRIES_PER_SCOPE_MAX) return "limit";
        return insertEntry(tx, serverId, lineageId, parsed.data);
      });
    } catch (error) {
      await log.error(
        "Lorebooks: failed to insert an entry",
        error,
        { metadata: { serverId, lineageId } },
        { persist: false },
      );
      return "failed";
    }
  }

  async replaceLineageEntries(
    serverId: number,
    lineageId: number,
    entries: readonly LorebookEntryInput[],
  ): Promise<LorebookReplaceResult> {
    if (!validScope(serverId, lineageId) || lineageId === null) return "invalid";
    if (entries.length > LOREBOOK_ENTRIES_PER_SCOPE_MAX) return "limit";
    const parsed = lorebookEntryInputSchema.array().safeParse(entries);
    if (!parsed.success) return "invalid";
    try {
      await this.db.begin(async (tx) => {
        const servers = await tx`SELECT server_id FROM servers WHERE server_id = ${serverId} FOR UPDATE`;
        if (servers.length === 0) throw new Error("Lorebook server does not exist");
        await tx`DELETE FROM persona_lorebook_entries WHERE server_id = ${serverId} AND persona_lineage_id = ${lineageId}`;
        for (const entry of parsed.data) await insertEntry(tx, serverId, lineageId, entry);
      });
      return "replaced";
    } catch (error) {
      await log.error(
        "Lorebooks: failed to replace persona entries",
        error,
        { metadata: { serverId, lineageId } },
        { persist: false },
      );
      return "failed";
    }
  }

  async update(
    serverId: number,
    lineageId: number | null,
    entryId: number,
    input: LorebookEntryInput,
  ): Promise<LorebookUpdateResult> {
    const parsed = lorebookEntryInputSchema.safeParse(input);
    if (!validScope(serverId, lineageId) || !validEntryId(entryId) || !parsed.success) return "invalid";
    const entry = parsed.data;
    try {
      const rows = await this.db`
        UPDATE persona_lorebook_entries SET title = ${entry.title}, content = ${entry.content},
          keys = ${this.db.array(entry.keys, "TEXT")}, secondary_keys = ${this.db.array(entry.secondary_keys, "TEXT")},
          selective_logic = ${entry.selective_logic}, scan_depth = ${entry.scan_depth}, trigger_chance = ${entry.trigger_chance},
          insertion_order = ${entry.insertion_order}, placement = ${entry.placement}, constant = ${entry.constant},
          enabled = ${entry.enabled}, channel_disc_ids = ${this.db.array(entry.channel_disc_ids, "TEXT")}
        WHERE server_id = ${serverId} AND persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint AND entry_id = ${entryId}
        RETURNING entry_id
      `;
      return rows.length > 0 ? "updated" : "missing";
    } catch (error) {
      await log.error(
        "Lorebooks: failed to update an entry",
        error,
        { metadata: { serverId, lineageId, entryId } },
        { persist: false },
      );
      return "failed";
    }
  }

  async setFlags(
    serverId: number,
    lineageId: number | null,
    entryId: number,
    flags: LorebookEntryFlags,
  ): Promise<LorebookUpdateResult> {
    const parsed = lorebookEntryFlagsSchema.safeParse(flags);
    if (!validScope(serverId, lineageId) || !validEntryId(entryId) || !parsed.success) return "invalid";
    try {
      return await this.db.begin(async (tx): Promise<LorebookUpdateResult> => {
        const [row] = await tx<Array<{ keys: string[] }>>`
          SELECT keys FROM persona_lorebook_entries
          WHERE server_id = ${serverId} AND persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint AND entry_id = ${entryId}
          FOR UPDATE
        `;
        if (!row) return "missing";
        if (parsed.data.constant === false && row.keys.length === 0) return "invalid";
        await tx`
          UPDATE persona_lorebook_entries
          SET enabled = COALESCE(${parsed.data.enabled ?? null}::boolean, enabled),
              constant = COALESCE(${parsed.data.constant ?? null}::boolean, constant)
          WHERE server_id = ${serverId} AND persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint AND entry_id = ${entryId}
        `;
        return "updated";
      });
    } catch (error) {
      await log.error(
        "Lorebooks: failed to change flags",
        error,
        { metadata: { serverId, lineageId, entryId } },
        { persist: false },
      );
      return "failed";
    }
  }

  async delete(serverId: number, lineageId: number | null, entryId: number): Promise<LorebookDeleteResult> {
    if (!validScope(serverId, lineageId) || !validEntryId(entryId)) return "invalid";
    try {
      const rows = await this.db`
        DELETE FROM persona_lorebook_entries
        WHERE server_id = ${serverId} AND persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint AND entry_id = ${entryId}
        RETURNING entry_id
      `;
      return rows.length > 0 ? "deleted" : "missing";
    } catch (error) {
      await log.error(
        "Lorebooks: failed to delete an entry",
        error,
        { metadata: { serverId, lineageId, entryId } },
        { persist: false },
      );
      return "failed";
    }
  }
}

export const lorebookRepository = new LorebookRepository();

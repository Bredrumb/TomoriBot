import type { SQL, TransactionSQL } from "bun";
import {
  LOREBOOK_ENTRIES_PER_SCOPE_MAX,
  lorebookEntryFlagsSchema,
  lorebookEntryIdentity,
  lorebookEntryInputSchema,
  lorebookEntryToInput,
  lorebookEntryRowSchema,
  lorebookScopeSchema,
  type LorebookEntryFlags,
  type LorebookEntryInput,
  type LorebookEntryRow,
  type ServerLorebook,
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
export type LorebookAppendResult =
  | { status: "appended"; added: number; skipped: number }
  | { status: "limit" | "invalid" | "failed" };

export type LorebookNewBookImportResult =
  | { status: "appended"; bookId: number; added: number; skipped: number }
  | { status: "exists" | "limit" | "invalid" | "failed" };

function validScope(serverId: number, lineageId: number | null): boolean {
  return lorebookScopeSchema.safeParse({ serverId, lineageId }).success;
}

function validEntryId(entryId: number): boolean {
  return Number.isSafeInteger(entryId) && entryId > 0 && entryId <= 2147483647;
}

async function matchesBook(
  tx: TransactionSQL,
  serverId: number,
  bookId: number | undefined,
  name: string | undefined,
): Promise<boolean> {
  if (bookId === undefined) return true;
  if (!validEntryId(bookId) || !name) return false;
  const rows = await tx`SELECT lorebook_id FROM server_lorebooks
    WHERE server_id = ${serverId} AND lorebook_id = ${bookId} AND name = ${name}`;
  return rows.length > 0;
}

async function insertEntry(
  tx: TransactionSQL,
  serverId: number,
  lineageId: number | null,
  input: LorebookEntryInput,
): Promise<number> {
  const bookName = lineageId === null ? (input.lorebook_name ?? "General") : null;
  if (bookName !== null) {
    await tx`INSERT INTO server_lorebooks (server_id, name, enabled, channel_disc_ids)
      VALUES (${serverId}, ${bookName}, ${input.lorebook_enabled ?? true}, ${tx.array(input.lorebook_channel_disc_ids ?? [], "TEXT")})
      ON CONFLICT (server_id, name) DO NOTHING`;
  }
  const [row] = await tx<Array<{ entry_id: number }>>`
    INSERT INTO persona_lorebook_entries
      (server_id, persona_lineage_id, lorebook_name, title, content, keys, secondary_keys, selective_logic, scan_depth,
       trigger_chance, insertion_order, placement, constant, enabled, channel_disc_ids)
    VALUES (${serverId}, ${lineageId}::bigint, ${bookName}, ${input.title}, ${input.content}, ${tx.array(input.keys, "TEXT")},
      ${tx.array(input.secondary_keys, "TEXT")}, ${input.selective_logic}, ${input.scan_depth},
      ${input.trigger_chance}, ${input.insertion_order}, ${input.placement}, ${input.constant}, ${input.enabled},
      ${tx.array(lineageId === null ? [] : input.channel_disc_ids, "TEXT")})
    RETURNING entry_id
  `;
  if (!row) throw new Error("Lorebook insertion returned no row");
  if (lineageId !== null && input.legacy_channel_tags?.length) {
    await tx`INSERT INTO legacy_channel_scope_tags (source_table, row_id, server_id, channel_tags)
      VALUES ('persona_lorebook_entries', ${row.entry_id}, ${serverId}, ${tx.array(input.legacy_channel_tags, "TEXT")})`;
  }
  return row.entry_id;
}

export class LorebookRepository {
  constructor(private readonly db: SQL = sql) {}

  async listBooks(serverId: number): Promise<ServerLorebook[] | null> {
    try {
      return await this.db<ServerLorebook[]>`SELECT lorebook_id, name, enabled, channel_disc_ids FROM server_lorebooks
        WHERE server_id = ${serverId} ORDER BY lorebook_id`;
    } catch (error) {
      log.warn("Lorebooks: failed to list collections", error, { metadata: { serverId } });
      return null;
    }
  }

  async createBook(serverId: number, name: string): Promise<number | null> {
    const title = name.trim();
    if (!validScope(serverId, null) || !title || title.length > 128) return null;
    try {
      return await this.db.begin(async (tx) => {
        await tx`SELECT server_id FROM servers WHERE server_id = ${serverId} FOR UPDATE`;
        const existing = await tx<
          ServerLorebook[]
        >`SELECT lorebook_id, name, enabled, channel_disc_ids FROM server_lorebooks WHERE server_id = ${serverId}`;
        const found = existing.find((book) => book.name === title);
        if (found) return found.lorebook_id;
        if (existing.length >= LOREBOOK_ENTRIES_PER_SCOPE_MAX) return null;
        const [row] = await tx<ServerLorebook[]>`INSERT INTO server_lorebooks (server_id, name)
          VALUES (${serverId}, ${title}) RETURNING lorebook_id, name, enabled, channel_disc_ids`;
        return row?.lorebook_id ?? null;
      });
    } catch (error) {
      log.warn("Lorebooks: failed to create collection", error, { metadata: { serverId } });
      return null;
    }
  }

  async importNewBook(
    serverId: number,
    name: string,
    entries: readonly LorebookEntryInput[],
  ): Promise<LorebookNewBookImportResult> {
    const title = name.trim();
    if (!validScope(serverId, null) || !title || title.length > 128 || entries.length === 0)
      return { status: "invalid" };
    try {
      return await this.db.begin(async (tx): Promise<LorebookNewBookImportResult> => {
        await tx`SELECT server_id FROM servers WHERE server_id = ${serverId} FOR UPDATE`;
        const books = await tx<
          ServerLorebook[]
        >`SELECT lorebook_id, name, enabled, channel_disc_ids FROM server_lorebooks WHERE server_id = ${serverId}`;
        if (books.some((book) => book.name === title)) return { status: "exists" };
        if (books.length >= LOREBOOK_ENTRIES_PER_SCOPE_MAX) return { status: "limit" };
        const result = await this.appendScopeEntries(
          serverId,
          null,
          entries.map((entry) => ({ ...entry, lorebook_name: title })),
          tx,
        );
        if (result.status === "failed") throw new Error("Lorebook collection import failed");
        if (result.status !== "appended") return result;
        const [book] = await tx<
          ServerLorebook[]
        >`SELECT lorebook_id, name, enabled, channel_disc_ids FROM server_lorebooks WHERE server_id = ${serverId} AND name = ${title}`;
        if (!book) throw new Error("Imported lorebook collection is missing");
        return { ...result, bookId: book.lorebook_id };
      });
    } catch (error) {
      log.warn("Lorebooks: failed to import collection", error, { metadata: { serverId } });
      return { status: "failed" };
    }
  }

  async renameBook(serverId: number, bookId: number, name: string): Promise<boolean> {
    const title = name.trim();
    if (!validScope(serverId, null) || !validEntryId(bookId) || !title || title.length > 128) return false;
    try {
      return await this.db.begin(async (tx) => {
        await tx`SELECT server_id FROM servers WHERE server_id = ${serverId} FOR UPDATE`;
        const rows = await tx`UPDATE server_lorebooks SET name = ${title}
          WHERE server_id = ${serverId} AND lorebook_id = ${bookId} RETURNING lorebook_id`;
        return rows.length > 0;
      });
    } catch (error) {
      log.warn("Lorebooks: failed to rename collection", error, { metadata: { serverId, bookId } });
      return false;
    }
  }

  async setBookEnabled(serverId: number, bookId: number, enabled: boolean): Promise<boolean> {
    if (!validScope(serverId, null) || !validEntryId(bookId)) return false;
    try {
      const rows = await this.db`UPDATE server_lorebooks SET enabled = ${enabled}
        WHERE server_id = ${serverId} AND lorebook_id = ${bookId} RETURNING lorebook_id`;
      return rows.length > 0;
    } catch (error) {
      log.warn("Lorebooks: failed to change collection state", error, { metadata: { serverId, bookId } });
      return false;
    }
  }

  async setBookChannels(serverId: number, bookId: number, channels: string[]): Promise<boolean> {
    if (
      !validScope(serverId, null) ||
      !validEntryId(bookId) ||
      !channels.every((channel) => /^\d{17,20}$/.test(channel))
    )
      return false;
    try {
      const rows = await this.db`UPDATE server_lorebooks SET channel_disc_ids = ${this.db.array(channels, "TEXT")}
        WHERE server_id = ${serverId} AND lorebook_id = ${bookId} RETURNING lorebook_id`;
      return rows.length > 0;
    } catch (error) {
      log.warn("Lorebooks: failed to change collection channels", error, { metadata: { serverId, bookId } });
      return false;
    }
  }

  async deleteBook(serverId: number, bookId: number): Promise<boolean> {
    if (!validScope(serverId, null) || !validEntryId(bookId)) return false;
    try {
      return await this.db.begin(async (tx) => {
        await tx`SELECT server_id FROM servers WHERE server_id = ${serverId} FOR UPDATE`;
        await tx`DELETE FROM legacy_channel_scope_tags l USING persona_lorebook_entries e, server_lorebooks b
          WHERE l.source_table = 'persona_lorebook_entries' AND l.row_id = e.entry_id
            AND e.server_id = ${serverId} AND e.lorebook_name = b.name AND b.server_id = e.server_id
            AND b.lorebook_id = ${bookId}`;
        const rows = await tx`DELETE FROM server_lorebooks WHERE server_id = ${serverId}
          AND lorebook_id = ${bookId} RETURNING lorebook_id`;
        return rows.length > 0;
      });
    } catch (error) {
      log.warn("Lorebooks: failed to delete collection", error, { metadata: { serverId, bookId } });
      return false;
    }
  }

  async loadEnabledForScope(serverId: number, lineageId: number | null): Promise<LorebookEntryRow[]> {
    if (!validScope(serverId, lineageId)) return [];
    try {
      const rows = await withTransientDbRetry(
        async () =>
          await this.db`
        SELECT e.*, b.enabled AS lorebook_enabled, b.channel_disc_ids AS lorebook_channel_disc_ids, COALESCE((SELECT channel_tags FROM legacy_channel_scope_tags l
          WHERE l.source_table = 'persona_lorebook_entries' AND l.row_id = e.entry_id
            AND l.resolved_at IS NULL), ARRAY[]::TEXT[]) AS legacy_channel_tags
        FROM persona_lorebook_entries e
        LEFT JOIN server_lorebooks b ON b.server_id = e.server_id AND b.name = e.lorebook_name
        WHERE e.server_id = ${serverId} AND e.enabled AND (e.persona_lineage_id IS NOT NULL OR b.enabled)
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

  async listScope(
    serverId: number,
    lineageId: number | null,
    transaction?: TransactionSQL,
  ): Promise<LorebookScopeReadResult> {
    if (!validScope(serverId, lineageId)) return { status: "unavailable", entries: [] };
    try {
      const rows = await (transaction ?? this.db)`
        SELECT e.*, b.enabled AS lorebook_enabled, b.channel_disc_ids AS lorebook_channel_disc_ids, COALESCE((SELECT channel_tags FROM legacy_channel_scope_tags l
          WHERE l.source_table = 'persona_lorebook_entries' AND l.row_id = e.entry_id
            AND l.resolved_at IS NULL), ARRAY[]::TEXT[]) AS legacy_channel_tags
        FROM persona_lorebook_entries e
        LEFT JOIN server_lorebooks b ON b.server_id = e.server_id AND b.name = e.lorebook_name
        WHERE e.server_id = ${serverId} AND e.persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint
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

  async listServer(serverId: number): Promise<LorebookScopeReadResult> {
    if (!validScope(serverId, null)) return { status: "unavailable", entries: [] };
    try {
      const rows = await this.db`
        SELECT e.*, b.enabled AS lorebook_enabled, b.channel_disc_ids AS lorebook_channel_disc_ids, COALESCE((SELECT channel_tags FROM legacy_channel_scope_tags l
          WHERE l.source_table = 'persona_lorebook_entries' AND l.row_id = e.entry_id
            AND l.resolved_at IS NULL), ARRAY[]::TEXT[]) AS legacy_channel_tags
        FROM persona_lorebook_entries e LEFT JOIN server_lorebooks b ON b.server_id = e.server_id AND b.name = e.lorebook_name WHERE e.server_id = ${serverId}
        ORDER BY insertion_order, entry_id`;
      return { status: "fresh", entries: lorebookEntryRowSchema.array().parse(rows) };
    } catch (error) {
      await log.error(
        "Lorebooks: failed to export server entries",
        error,
        { metadata: { serverId } },
        { persist: false },
      );
      return { status: "unavailable", entries: [] };
    }
  }

  async deleteServerwide(serverId: number, tx: TransactionSQL): Promise<number> {
    await tx`DELETE FROM legacy_channel_scope_tags l USING persona_lorebook_entries e
      WHERE l.source_table = 'persona_lorebook_entries' AND l.row_id = e.entry_id
        AND e.server_id = ${serverId} AND e.persona_lineage_id IS NULL`;
    const entries = await tx`DELETE FROM persona_lorebook_entries
      WHERE server_id = ${serverId} AND persona_lineage_id IS NULL`;
    const books = await tx`DELETE FROM server_lorebooks WHERE server_id = ${serverId}`;
    return entries.count + books.count;
  }

  async pruneLegacyChannelScopes(): Promise<void> {
    await this.db`DELETE FROM legacy_channel_scope_tags l
      WHERE l.source_table = 'persona_lorebook_entries'
        AND NOT EXISTS (SELECT 1 FROM persona_lorebook_entries e WHERE e.entry_id = l.row_id)`;
  }

  async resolveLegacyChannelScope(
    tx: TransactionSQL,
    serverId: number,
    entryId: number,
    channels: string[],
  ): Promise<void> {
    await tx`UPDATE persona_lorebook_entries SET channel_disc_ids = ${tx.array(channels, "TEXT")}
      WHERE server_id = ${serverId} AND entry_id = ${entryId}`;
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

  async insert(
    serverId: number,
    lineageId: number | null,
    input: LorebookEntryInput,
    transaction?: TransactionSQL,
    bookId?: number,
  ): Promise<LorebookInsertResult> {
    const parsed = lorebookEntryInputSchema.safeParse(input);
    if (!validScope(serverId, lineageId) || !parsed.success) return "invalid";
    try {
      const write = async (tx: TransactionSQL): Promise<LorebookInsertResult> => {
        // Lock the server before counting so concurrent inserts and replacements cannot exceed a scope's limit.
        await tx`SELECT server_id FROM servers WHERE server_id = ${serverId} FOR UPDATE`;
        if (!(await matchesBook(tx, serverId, bookId, parsed.data.lorebook_name))) return "invalid";
        const [row] = await tx<Array<{ count: number }>>`
          SELECT COUNT(*)::int AS count FROM persona_lorebook_entries
          WHERE server_id = ${serverId} AND persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint
        `;
        if (row && row.count >= LOREBOOK_ENTRIES_PER_SCOPE_MAX) return "limit";
        return insertEntry(tx, serverId, lineageId, parsed.data);
      };
      return transaction ? await write(transaction) : await this.db.begin(write);
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
    transaction?: TransactionSQL,
  ): Promise<LorebookReplaceResult> {
    return this.replaceScopeEntries(serverId, lineageId, entries, transaction);
  }

  async replaceScopeEntries(
    serverId: number,
    lineageId: number | null,
    entries: readonly LorebookEntryInput[],
    transaction?: TransactionSQL,
    bookName?: string,
    bookId?: number,
  ): Promise<LorebookReplaceResult> {
    if (!validScope(serverId, lineageId)) return "invalid";
    if (entries.length > LOREBOOK_ENTRIES_PER_SCOPE_MAX) return "limit";
    const parsed = lorebookEntryInputSchema.array().safeParse(entries);
    if (!parsed.success) return "invalid";
    if (bookName !== undefined && (lineageId !== null || parsed.data.some((entry) => entry.lorebook_name !== bookName)))
      return "invalid";
    const settings = new Map<string, LorebookEntryInput>();
    if (lineageId === null && bookName === undefined) {
      for (const entry of parsed.data) {
        const name = entry.lorebook_name ?? "General";
        const prior = settings.get(name);
        if (
          prior &&
          ((prior.lorebook_enabled ?? true) !== (entry.lorebook_enabled ?? true) ||
            JSON.stringify(prior.lorebook_channel_disc_ids ?? []) !==
              JSON.stringify(entry.lorebook_channel_disc_ids ?? []))
        )
          return "invalid";
        settings.set(name, entry);
      }
    }
    try {
      const write = async (tx: TransactionSQL): Promise<LorebookReplaceResult> => {
        const servers = await tx`SELECT server_id FROM servers WHERE server_id = ${serverId} FOR UPDATE`;
        if (servers.length === 0) throw new Error("Lorebook server does not exist");
        if (!(await matchesBook(tx, serverId, bookId, bookName))) return "invalid";
        const [other] = await tx<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM persona_lorebook_entries
          WHERE server_id = ${serverId} AND persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint
            AND ${bookName ?? null}::text IS NOT NULL AND lorebook_name <> ${bookName ?? null}`;
        if ((other?.count ?? 0) + parsed.data.length > LOREBOOK_ENTRIES_PER_SCOPE_MAX) return "limit";

        await tx`DELETE FROM legacy_channel_scope_tags l USING persona_lorebook_entries e
          WHERE l.source_table = 'persona_lorebook_entries' AND l.row_id = e.entry_id
            AND e.server_id = ${serverId} AND e.persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint
            AND (${bookName ?? null}::text IS NULL OR e.lorebook_name = ${bookName ?? null})`;
        await tx`DELETE FROM persona_lorebook_entries WHERE server_id = ${serverId}
          AND persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint
          AND (${bookName ?? null}::text IS NULL OR lorebook_name = ${bookName ?? null})`;
        if (lineageId === null && bookName === undefined) {
          for (const [name, entry] of settings) {
            await tx`INSERT INTO server_lorebooks (server_id, name, enabled, channel_disc_ids)
              VALUES (${serverId}, ${name}, ${entry.lorebook_enabled ?? true}, ${tx.array(entry.lorebook_channel_disc_ids ?? [], "TEXT")})
              ON CONFLICT (server_id, name) DO UPDATE SET enabled = EXCLUDED.enabled, channel_disc_ids = EXCLUDED.channel_disc_ids`;
          }
        }
        for (const entry of parsed.data) await insertEntry(tx, serverId, lineageId, entry);
        return "replaced";
      };
      return transaction ? await write(transaction) : await this.db.begin(write);
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

  async importEntries(
    serverId: number,
    lineageId: number | null,
    payload: readonly LorebookEntryInput[] | undefined,
    converted: readonly LorebookEntryInput[],
    transaction: TransactionSQL,
  ): Promise<LorebookReplaceResult> {
    if (payload !== undefined)
      return this.replaceScopeEntries(serverId, lineageId, [...payload, ...converted], transaction);
    if (converted.length === 0) return "replaced";
    const appended = await this.appendScopeEntries(serverId, lineageId, converted, transaction);
    return appended.status === "appended" ? "replaced" : appended.status;
  }

  /**
   * Adds entries to an existing scope, skipping ones it already holds.
   *
   * The whole batch is refused when it would cross the scope limit, so an oversized book never
   * lands half imported.
   */
  async appendScopeEntries(
    serverId: number,
    lineageId: number | null,
    entries: readonly LorebookEntryInput[],
    transaction?: TransactionSQL,
    bookId?: number,
  ): Promise<LorebookAppendResult> {
    if (!validScope(serverId, lineageId)) return { status: "invalid" };
    const parsed = lorebookEntryInputSchema.array().safeParse(entries);
    if (!parsed.success) return { status: "invalid" };
    try {
      const write = async (tx: TransactionSQL): Promise<LorebookAppendResult> => {
        const servers = await tx`SELECT server_id FROM servers WHERE server_id = ${serverId} FOR UPDATE`;
        if (servers.length === 0) return { status: "invalid" };
        if (!(await matchesBook(tx, serverId, bookId, parsed.data[0]?.lorebook_name))) return { status: "invalid" };
        const existing = await this.listScope(serverId, lineageId, tx);
        if (existing.status !== "fresh") return { status: "failed" };
        const seen = new Set(existing.entries.map((entry) => lorebookEntryIdentity(lorebookEntryToInput(entry))));
        const unique: LorebookEntryInput[] = [];
        for (const entry of parsed.data) {
          const identity = lorebookEntryIdentity({
            ...entry,
            lorebook_name: lineageId === null ? (entry.lorebook_name ?? "General") : undefined,
          });
          if (seen.has(identity)) continue;
          seen.add(identity);
          unique.push(entry);
        }
        if (existing.entries.length + unique.length > LOREBOOK_ENTRIES_PER_SCOPE_MAX) return { status: "limit" };
        for (const entry of unique) await insertEntry(tx, serverId, lineageId, entry);
        return { status: "appended", added: unique.length, skipped: parsed.data.length - unique.length };
      };
      return transaction ? await write(transaction) : await this.db.begin(write);
    } catch (error) {
      await log.error(
        "Lorebooks: failed to append entries",
        error,
        { metadata: { serverId, lineageId } },
        { persist: false },
      );
      return { status: "failed" };
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
      return await this.db.begin(async (tx): Promise<LorebookUpdateResult> => {
        const rows = await tx`
        UPDATE persona_lorebook_entries SET title = ${entry.title}, content = ${entry.content},
          keys = ${this.db.array(entry.keys, "TEXT")}, secondary_keys = ${this.db.array(entry.secondary_keys, "TEXT")},
          selective_logic = ${entry.selective_logic}, scan_depth = ${entry.scan_depth}, trigger_chance = ${entry.trigger_chance},
          insertion_order = ${entry.insertion_order}, placement = ${entry.placement}, constant = ${entry.constant},
          enabled = ${entry.enabled}, channel_disc_ids = ${this.db.array(lineageId === null ? [] : entry.channel_disc_ids, "TEXT")}
        WHERE server_id = ${serverId} AND persona_lineage_id IS NOT DISTINCT FROM ${lineageId}::bigint AND entry_id = ${entryId}
        RETURNING entry_id
      `;
        if (rows.length === 0) return "missing";
        await tx`DELETE FROM legacy_channel_scope_tags
        WHERE source_table = 'persona_lorebook_entries' AND row_id = ${entryId}`;
        if (lineageId !== null && entry.legacy_channel_tags?.length) {
          await tx`INSERT INTO legacy_channel_scope_tags (source_table, row_id, server_id, channel_tags)
          VALUES ('persona_lorebook_entries', ${entryId}, ${serverId}, ${tx.array(entry.legacy_channel_tags, "TEXT")})`;
        }
        return "updated";
      });
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

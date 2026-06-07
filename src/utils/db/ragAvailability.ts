import type { SQL } from "bun";
import { sql } from "@/utils/db/client";

/** Cached result of pgvector availability check */
let cachedResult: boolean | null = null;

/**
 * Checks whether the pgvector extension is available in the connected PostgreSQL server.
 *
 * Queries `pg_available_extensions` rather than `pg_extension` so that the check
 * succeeds even if `CREATE EXTENSION vector` hasn't been run yet — the RAG schema
 * will handle that via `CREATE EXTENSION IF NOT EXISTS`.
 *
 * The result is cached after the first call.
 *
 * @returns `true` if pgvector is available, `false` otherwise
 */
export async function detectRagAvailability(client: SQL = sql): Promise<boolean> {
  const shouldUseCache = client === sql;
  if (shouldUseCache && cachedResult !== null) return cachedResult;

  try {
    const [row] = await client<{ available: boolean }[]>`
			SELECT EXISTS(
				SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
			) AS available
		`;
    const available = Boolean(row?.available);
    if (shouldUseCache) cachedResult = available;
    return available;
  } catch {
    if (shouldUseCache) cachedResult = false;
    return false;
  }
}

/**
 * Returns the cached RAG availability flag.
 *
 * **Must** call `detectRagAvailability()` during startup before using this.
 * Returns `false` if detection hasn't run yet.
 */
export function isRagAvailable(): boolean {
  return cachedResult === true;
}

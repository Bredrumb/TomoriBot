import type { TransactionSQL } from "bun";
import { sql } from "@/utils/db/client";
import { isRagAvailable } from "@/utils/db/ragAvailability";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { formatVector } from "@/utils/documents/documentService";
import { MEMORY_DORMANT_DAYS, MEMORY_RECALL_LIMIT, MEMORY_RECALL_MIN_SIMILARITY } from "@/utils/memory/memoryDecay";

export type MemoryRef = { kind: "server" | "personal"; id: number };
export type MemoryCandidateIds = { serverMemoryIds: number[]; personalMemoryIds: number[] };
type ScoredMemory = MemoryRef & { similarity: number };
export type MissingMemoryVector = MemoryRef & { content: string };
type MemoryStageChange = MemoryRef & { decay_days: number; previous_decay_days: number };
export type MemorySaveResult<T> =
  | { status: "saved"; memory: T; evicted: { id: number; content: string; decay_days: number } | null }
  | { status: "refused"; currentCount: number; limit: number };

function vectorLiteral(vector: number[]): string {
  if (!vector.length || vector.some((value) => !Number.isFinite(value)) || vector.every((value) => value === 0)) {
    throw new Error("Memory embeddings must be finite nonzero vectors");
  }
  return formatVector(vector);
}

class MemoryDecayRepository {
  /** Scores only supplied candidates in one family, returning at most three above the cosine floor without querying when RAG is unavailable. */
  async scoreCandidates(
    queryVector: number[],
    family: string,
    candidates: MemoryCandidateIds,
  ): Promise<ScoredMemory[]> {
    if (!isRagAvailable() || (!candidates.serverMemoryIds.length && !candidates.personalMemoryIds.length)) return [];
    const vector = vectorLiteral(queryVector);
    return await sql<ScoredMemory[]>`
      SELECT CASE WHEN server_memory_id IS NOT NULL THEN 'server' ELSE 'personal' END AS kind,
        COALESCE(server_memory_id, personal_memory_id) AS id, 1 - (embedding <=> ${vector}::vector) AS similarity
      FROM memory_embeddings
      WHERE embedding_family = ${family}
        AND (server_memory_id = ANY(${sql.array(candidates.serverMemoryIds, "INT")})
          OR personal_memory_id = ANY(${sql.array(candidates.personalMemoryIds, "INT")}))
        AND 1 - (embedding <=> ${vector}::vector) >= ${MEMORY_RECALL_MIN_SIMILARITY}
      ORDER BY similarity DESC, kind, id
      LIMIT ${MEMORY_RECALL_LIMIT}
    `;
  }

  /** Returns live content only for supplied memories lacking this family, without querying when RAG is unavailable. */
  async findMissingVectors(candidates: MemoryCandidateIds, family: string): Promise<MissingMemoryVector[]> {
    if (!isRagAvailable() || (!candidates.serverMemoryIds.length && !candidates.personalMemoryIds.length)) return [];
    return await sql<MissingMemoryVector[]>`
      SELECT 'server' AS kind, m.server_memory_id AS id, m.content FROM server_memories m
      WHERE m.server_memory_id = ANY(${sql.array(candidates.serverMemoryIds, "INT")})
        AND NOT EXISTS (SELECT 1 FROM memory_embeddings e WHERE e.server_memory_id = m.server_memory_id AND e.embedding_family = ${family})
      UNION ALL
      SELECT 'personal' AS kind, m.personal_memory_id AS id, m.content FROM personal_memories m
      WHERE m.personal_memory_id = ANY(${sql.array(candidates.personalMemoryIds, "INT")})
        AND NOT EXISTS (SELECT 1 FROM memory_embeddings e WHERE e.personal_memory_id = m.personal_memory_id AND e.embedding_family = ${family})
    `;
  }

  /** Inserts one family once under the memory row lock, refusing deleted or changed content so an edit cannot receive a stale vector. */
  async upsertVector(
    memory: MemoryRef,
    family: string,
    modelId: number,
    vector: number[],
    content: string,
  ): Promise<boolean> {
    if (!isRagAvailable()) return false;
    const embedding = vectorLiteral(vector);
    return await sql.transaction(async (tx) => {
      const [row] =
        memory.kind === "server"
          ? await tx`SELECT content FROM server_memories WHERE server_memory_id = ${memory.id} FOR UPDATE`
          : await tx`SELECT content FROM personal_memories WHERE personal_memory_id = ${memory.id} FOR UPDATE`;
      if (!row || row.content !== content) return false;
      const inserted = await tx`
        INSERT INTO memory_embeddings (server_memory_id, personal_memory_id, embedding_family, embedding_model_id, embedding)
        VALUES (${memory.kind === "server" ? memory.id : null}, ${memory.kind === "personal" ? memory.id : null}, ${family}, ${modelId}, ${embedding}::vector)
        ON CONFLICT DO NOTHING RETURNING memory_embedding_id
      `;
      return inserted.length > 0;
    });
  }

  /** Deletes every vector family inside an editor's transaction only if content changed and the optional table exists. */
  async deleteVectorsForEdit(
    tx: TransactionSQL,
    memory: MemoryRef,
    previousContent: string,
    content: string,
  ): Promise<void> {
    if (previousContent === content) return;
    const [table] = await tx`SELECT to_regclass('public.memory_embeddings') IS NOT NULL AS present`;
    if (!table?.present) return;
    if (memory.kind === "server") await tx`DELETE FROM memory_embeddings WHERE server_memory_id = ${memory.id}`;
    else await tx`DELETE FROM memory_embeddings WHERE personal_memory_id = ${memory.id}`;
  }

  /** Counts supplied scored rows at most once per UTC day, lets reinforcement win concurrent turns, and returns threshold crossings after invalidating changed server snapshots. */
  async recordRecallDay(scored: MemoryCandidateIds, reinforced: MemoryCandidateIds): Promise<MemoryStageChange[]> {
    const result = await sql.transaction(async (tx) => {
      const changes: MemoryStageChange[] = [];
      const servers = new Set<string>();
      if (scored.serverMemoryIds.length || reinforced.serverMemoryIds.length) {
        const rows = await tx<Array<{ id: number; previous_decay_days: number; decay_days: number }>>`
          WITH locked AS MATERIALIZED (
            SELECT server_memory_id, decay_days FROM server_memories
            WHERE server_memory_id = ANY(${sql.array([...scored.serverMemoryIds, ...reinforced.serverMemoryIds], "INT")})
            ORDER BY server_memory_id FOR UPDATE
          )
          UPDATE server_memories m SET
            decay_days = CASE WHEN m.server_memory_id = ANY(${sql.array(reinforced.serverMemoryIds, "INT")}) THEN 0 ELSE m.decay_days + 1 END,
            decay_counted_on = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
            reinforced_on = CASE WHEN m.server_memory_id = ANY(${sql.array(reinforced.serverMemoryIds, "INT")})
              THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date ELSE m.reinforced_on END
          FROM locked old
          WHERE m.server_memory_id = old.server_memory_id AND (
            (m.server_memory_id = ANY(${sql.array(reinforced.serverMemoryIds, "INT")})
              AND m.reinforced_on IS DISTINCT FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date)
            OR (NOT (m.server_memory_id = ANY(${sql.array(reinforced.serverMemoryIds, "INT")}))
              AND (m.decay_counted_on IS NULL OR m.decay_counted_on < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date))
          )
          RETURNING m.server_memory_id AS id, old.decay_days AS previous_decay_days, m.decay_days
        `;
        for (const row of rows) {
          if (row.previous_decay_days >= MEMORY_DORMANT_DAYS !== row.decay_days >= MEMORY_DORMANT_DAYS) {
            changes.push({ kind: "server", ...row });
          }
        }
        if (rows.length) {
          const affected =
            await tx`SELECT DISTINCT s.server_disc_id FROM servers s JOIN server_memories m USING (server_id)
            WHERE m.server_memory_id = ANY(${sql.array(
              rows.map((row) => row.id),
              "INT",
            )})`;
          for (const row of affected) servers.add(row.server_disc_id);
        }
      }
      if (scored.personalMemoryIds.length || reinforced.personalMemoryIds.length) {
        const rows = await tx<Array<{ id: number; previous_decay_days: number; decay_days: number }>>`
          WITH locked AS MATERIALIZED (
            SELECT personal_memory_id, decay_days FROM personal_memories
            WHERE personal_memory_id = ANY(${sql.array([...scored.personalMemoryIds, ...reinforced.personalMemoryIds], "INT")})
            ORDER BY personal_memory_id FOR UPDATE
          )
          UPDATE personal_memories m SET
            decay_days = CASE WHEN m.personal_memory_id = ANY(${sql.array(reinforced.personalMemoryIds, "INT")}) THEN 0 ELSE m.decay_days + 1 END,
            decay_counted_on = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date,
            reinforced_on = CASE WHEN m.personal_memory_id = ANY(${sql.array(reinforced.personalMemoryIds, "INT")})
              THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date ELSE m.reinforced_on END
          FROM locked old
          WHERE m.personal_memory_id = old.personal_memory_id AND (
            (m.personal_memory_id = ANY(${sql.array(reinforced.personalMemoryIds, "INT")})
              AND m.reinforced_on IS DISTINCT FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date)
            OR (NOT (m.personal_memory_id = ANY(${sql.array(reinforced.personalMemoryIds, "INT")}))
              AND (m.decay_counted_on IS NULL OR m.decay_counted_on < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date))
          )
          RETURNING m.personal_memory_id AS id, old.decay_days AS previous_decay_days, m.decay_days
        `;
        for (const row of rows) {
          if (row.previous_decay_days >= MEMORY_DORMANT_DAYS !== row.decay_days >= MEMORY_DORMANT_DAYS) {
            changes.push({ kind: "personal", ...row });
          }
        }
      }
      return { changes, servers };
    });
    for (const server of result.servers) invalidateTomoriStateCache(server);
    return result.changes;
  }
}

export const memoryDecayRepository = new MemoryDecayRepository();

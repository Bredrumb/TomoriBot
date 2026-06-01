/**
 * ConditioningMemoryRepository — manages the `conditioning_history` table.
 *
 * Conditioning memories record reward/punishment events that shape Tomori's
 * persona behavior over time. Reads are aggregated into ConditioningGroup
 * summaries; writes record individual events or toggle enablement flags.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import {
  conditioningHistorySchema,
  conditioningTypeSchema,
  personaConfigSchema,
  type ConditioningHistoryRow,
  type ConditioningType,
} from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import {
  normalizeConditioningReason,
  normalizeConditioningReasonKey,
  type ConditioningActionKey,
} from "@/utils/conditioning/conditioning";
import type { IRepository } from "./IRepository";

/** Portable conditioning export shape (expanded in Phase 6 #16.7). */
export type ConditioningExportShape = {
  persona_lineage_id: number;
  groups: ConditioningGroup[];
};

type ConditioningGroupRow = {
  conditioning_id: number;
  conditioning_type: ConditioningType;
  action_key: string;
  reason_text: string;
  reason_normalized: string;
  action_text: string | null;
  count: number;
  updated_at: Date;
  user_disc_id: string;
};

export type ConditioningGroup = {
  conditioningType: ConditioningType;
  actionKey: string;
  reasonText: string;
  reasonNormalized: string;
  actionText: string | null;
  totalCount: number;
  updatedAt: Date;
  userDiscIds: string[];
  conditioningIds: number[];
};

export class ConditioningMemoryRepository implements IRepository<ConditioningExportShape> {
  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * Loads aggregated conditioning groups for a persona lineage.
   * Groups cluster related events so the prompt assembly can summarize them.
   *
   * @param serverId         - Internal server DB ID
   * @param personaLineageId - Persona lineage to load for
   * @param conditioningType - Optional filter by conditioning type
   * @returns Array of ConditioningGroup aggregates
   */
  async loadGroupsForPersona(
    serverId: number,
    personaLineageId: number,
    conditioningType?: ConditioningType,
  ): Promise<ConditioningGroup[]> {
    return this.sqlLoadConditioningGroupsForPersona(serverId, personaLineageId, conditioningType);
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Records a single conditioning event (reward or punishment).
   *
   * @param params - Event parameters (serverId, personaLineageId, conditioningType, actionKey, userId, reason, actionText)
   * @returns Inserted or updated ConditioningHistoryRow, or null on failure
   */
  async recordEvent(params: {
    serverId: number;
    personaLineageId: number;
    conditioningType: ConditioningType;
    actionKey: ConditioningActionKey;
    userId: number;
    reason?: string | null;
    actionText?: string | null;
  }): Promise<ConditioningHistoryRow | null> {
    return this.sqlRecordConditioningEvent(params);
  }

  /**
   * Enables or disables reward/punishment conditioning for a specific persona.
   *
   * @param personaId        - Internal tomori DB ID
   * @param conditioningType - Type to toggle (reward | punish)
   * @param enabled         - New enabled state
   */
  async setPersonaConditioningEnabled(
    personaId: number,
    conditioningType: ConditioningType,
    enabled: boolean,
  ): Promise<boolean> {
    return this.sqlSetPersonaConditioningEnabled(personaId, conditioningType, enabled);
  }

  /**
   * Enables or disables conditioning for all personas in a server.
   *
   * @param serverId        - Internal server DB ID
   * @param conditioningType - Type to toggle (reward | punish)
   * @param enabled         - New enabled state
   * @returns Number of personas updated
   */
  async setServerConditioningEnabled(
    serverId: number,
    conditioningType: ConditioningType,
    enabled: boolean,
  ): Promise<number> {
    return this.sqlSetServerConditioningEnabled(serverId, conditioningType, enabled);
  }

  /**
   * Deletes specific conditioning groups for a persona lineage.
   * Returns the count of deleted rows.
   *
   * @param serverId         - Internal server DB ID
   * @param personaLineageId - Persona lineage to purge
   * @param groups           - Groups to delete (conditioningType + actionKey + reasonNormalized)
   */
  async deleteGroupsForPersona(
    serverId: number,
    personaLineageId: number,
    groups: Array<Pick<ConditioningGroup, "conditioningType" | "actionKey" | "reasonNormalized">>,
  ): Promise<number> {
    return this.sqlDeleteConditioningGroupsForPersona(serverId, personaLineageId, groups);
  }

  // ── private SQL ────────────────────────────────────────────────────────────

  private async sqlRecordConditioningEvent(params: {
    serverId: number;
    personaLineageId: number;
    conditioningType: ConditioningType;
    actionKey: ConditioningActionKey;
    userId: number;
    reason?: string | null;
    actionText?: string | null;
  }): Promise<ConditioningHistoryRow | null> {
    const reasonText = normalizeConditioningReason(params.reason);
    const reasonNormalized = normalizeConditioningReasonKey(params.reason);

    try {
      const [row] = await sql`
        INSERT INTO conditioning_history (
          server_id, persona_lineage_id, conditioning_type, action_key,
          reason_text, reason_normalized, action_text, user_id, count
        )
        VALUES (
          ${params.serverId}, ${params.personaLineageId}, ${params.conditioningType}, ${params.actionKey},
          ${reasonText}, ${reasonNormalized}, ${params.actionText ?? null}, ${params.userId}, 1
        )
        ON CONFLICT (server_id, persona_lineage_id, conditioning_type, action_key, reason_normalized, user_id)
        DO UPDATE SET
          reason_text = EXCLUDED.reason_text,
          action_text = EXCLUDED.action_text,
          count = conditioning_history.count + 1,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;

      const parsed = conditioningHistorySchema.safeParse(row);
      if (!parsed.success) {
        await log.error("Failed to validate conditioning history row after upsert", parsed.error, {
          serverId: params.serverId,
          userId: params.userId,
          errorType: "SchemaValidationError",
          metadata: {
            operation: "recordConditioningEvent",
            conditioningType: params.conditioningType,
            actionKey: params.actionKey,
          },
        });
        return null;
      }

      return parsed.data;
    } catch (error) {
      await log.error("Failed to record conditioning event", error, {
        serverId: params.serverId,
        userId: params.userId,
        errorType: "DatabaseInsertError",
        metadata: {
          operation: "recordConditioningEvent",
          conditioningType: params.conditioningType,
          actionKey: params.actionKey,
        },
      });
      return null;
    }
  }

  private async sqlSetPersonaConditioningEnabled(
    personaId: number,
    conditioningType: ConditioningType,
    enabled: boolean,
  ): Promise<boolean> {
    const column = conditioningType === "reward" ? "reward_conditioning_enabled" : "punish_conditioning_enabled";

    try {
      const [row] =
        column === "reward_conditioning_enabled"
          ? await sql`
              INSERT INTO persona_configs (persona_id, reward_conditioning_enabled)
              VALUES (${personaId}, ${enabled})
              ON CONFLICT (persona_id)
              DO UPDATE SET reward_conditioning_enabled = EXCLUDED.reward_conditioning_enabled, updated_at = CURRENT_TIMESTAMP
              RETURNING *
            `
          : await sql`
              INSERT INTO persona_configs (persona_id, punish_conditioning_enabled)
              VALUES (${personaId}, ${enabled})
              ON CONFLICT (persona_id)
              DO UPDATE SET punish_conditioning_enabled = EXCLUDED.punish_conditioning_enabled, updated_at = CURRENT_TIMESTAMP
              RETURNING *
            `;

      const parsed = personaConfigSchema.safeParse(row);
      if (!parsed.success) {
        await log.error("Failed to validate persona conditioning toggle update", parsed.error, {
          personaId,
          errorType: "SchemaValidationError",
          metadata: { operation: "setPersonaConditioningEnabled", conditioningType, enabled },
        });
        return false;
      }

      return true;
    } catch (error) {
      await log.error("Failed to update persona conditioning toggle", error, {
        personaId,
        errorType: "DatabaseUpdateError",
        metadata: { operation: "setPersonaConditioningEnabled", conditioningType, enabled },
      });
      return false;
    }
  }

  private async sqlSetServerConditioningEnabled(
    serverId: number,
    conditioningType: ConditioningType,
    enabled: boolean,
  ): Promise<number> {
    const column = conditioningType === "reward" ? "reward_conditioning_enabled" : "punish_conditioning_enabled";

    try {
      const updatedRows =
        column === "reward_conditioning_enabled"
          ? await sql<Array<{ persona_id: number }>>`
              INSERT INTO persona_configs (persona_id, reward_conditioning_enabled)
              SELECT persona_id, ${enabled} FROM personas WHERE server_id = ${serverId}
              ON CONFLICT (persona_id)
              DO UPDATE SET reward_conditioning_enabled = EXCLUDED.reward_conditioning_enabled, updated_at = CURRENT_TIMESTAMP
              RETURNING persona_id
            `
          : await sql<Array<{ persona_id: number }>>`
              INSERT INTO persona_configs (persona_id, punish_conditioning_enabled)
              SELECT persona_id, ${enabled} FROM personas WHERE server_id = ${serverId}
              ON CONFLICT (persona_id)
              DO UPDATE SET punish_conditioning_enabled = EXCLUDED.punish_conditioning_enabled, updated_at = CURRENT_TIMESTAMP
              RETURNING persona_id
            `;

      return updatedRows.length;
    } catch (error) {
      await log.error("Failed to update server-wide conditioning toggle", error, {
        serverId,
        errorType: "DatabaseUpdateError",
        metadata: { operation: "setServerConditioningEnabled", conditioningType },
      });
      return 0;
    }
  }

  private async sqlLoadConditioningGroupsForPersona(
    serverId: number,
    personaLineageId: number,
    conditioningType?: ConditioningType,
  ): Promise<ConditioningGroup[]> {
    try {
      const rows =
        conditioningType === undefined
          ? await sql<Array<ConditioningGroupRow>>`
              SELECT ch.conditioning_id, ch.conditioning_type, ch.action_key,
                     ch.reason_text, ch.reason_normalized, ch.action_text,
                     ch.count, ch.updated_at, u.user_disc_id
              FROM conditioning_history ch
              JOIN users u ON u.user_id = ch.user_id
              WHERE ch.server_id = ${serverId} AND ch.persona_lineage_id = ${personaLineageId}
              ORDER BY ch.updated_at DESC, ch.conditioning_id DESC
            `
          : await sql<Array<ConditioningGroupRow>>`
              SELECT ch.conditioning_id, ch.conditioning_type, ch.action_key,
                     ch.reason_text, ch.reason_normalized, ch.action_text,
                     ch.count, ch.updated_at, u.user_disc_id
              FROM conditioning_history ch
              JOIN users u ON u.user_id = ch.user_id
              WHERE ch.server_id = ${serverId}
                AND ch.persona_lineage_id = ${personaLineageId}
                AND ch.conditioning_type = ${conditioningType}
              ORDER BY ch.updated_at DESC, ch.conditioning_id DESC
            `;

      const groups = new Map<string, ConditioningGroup>();

      for (const row of rows) {
        const parsedType = conditioningTypeSchema.safeParse(row.conditioning_type);
        if (!parsedType.success) {
          log.warn(`Skipping conditioning row with invalid type for server ${serverId}`);
          continue;
        }

        const key = `${parsedType.data}:${row.action_key}:${row.reason_normalized}`;
        const existing = groups.get(key);

        if (!existing) {
          groups.set(key, {
            conditioningType: parsedType.data,
            actionKey: row.action_key,
            reasonText: row.reason_text,
            reasonNormalized: row.reason_normalized,
            actionText: row.action_text ?? null,
            totalCount: row.count,
            updatedAt: row.updated_at,
            userDiscIds: [row.user_disc_id],
            conditioningIds: [row.conditioning_id],
          });
          continue;
        }

        existing.totalCount += row.count;
        existing.conditioningIds.push(row.conditioning_id);
        if (!existing.userDiscIds.includes(row.user_disc_id)) {
          existing.userDiscIds.push(row.user_disc_id);
        }
        if (row.updated_at > existing.updatedAt) {
          existing.updatedAt = row.updated_at;
          existing.reasonText = row.reason_text;
          existing.actionText = row.action_text ?? null;
        }
      }

      return Array.from(groups.values()).sort((a, b) => {
        const timestampDiff = b.updatedAt.getTime() - a.updatedAt.getTime();
        if (timestampDiff !== 0) return timestampDiff;
        return b.totalCount - a.totalCount;
      });
    } catch (error) {
      await log.error("Failed to load conditioning groups", error, {
        serverId,
        errorType: "DatabaseReadError",
        metadata: { operation: "loadConditioningGroupsForPersona", personaLineageId, conditioningType },
      });
      return [];
    }
  }

  private async sqlDeleteConditioningGroupsForPersona(
    serverId: number,
    personaLineageId: number,
    groups: Array<Pick<ConditioningGroup, "conditioningType" | "actionKey" | "reasonNormalized">>,
  ): Promise<number> {
    if (groups.length === 0) return 0;

    try {
      let deletedCount = 0;

      await sql.transaction(async (tx) => {
        for (const group of groups) {
          const deletedRows = await tx<Array<{ conditioning_id: number }>>`
            DELETE FROM conditioning_history
            WHERE server_id = ${serverId}
              AND persona_lineage_id = ${personaLineageId}
              AND conditioning_type = ${group.conditioningType}
              AND action_key = ${group.actionKey}
              AND reason_normalized = ${group.reasonNormalized}
            RETURNING conditioning_id
          `;
          deletedCount += deletedRows.length;
        }
      });

      return deletedCount;
    } catch (error) {
      await log.error("Failed to delete conditioning groups", error, {
        serverId,
        errorType: "DatabaseDeleteError",
        metadata: { operation: "deleteConditioningGroupsForPersona", personaLineageId, groupCount: groups.length },
      });
      return 0;
    }
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Exports conditioning groups for a persona lineage.
   * The ownerId is interpreted as personaLineageId; serverId defaults to 0
   * (caller should pass a composite key in Phase 6 #16.7).
   *
   * @param ownerId - Persona lineage ID
   */
  async toExportShape(ownerId: string | number): Promise<ConditioningExportShape | null> {
    const personaLineageId = Number(ownerId);
    // serverId=0 is a placeholder; Phase 6 #16.7 will refine the owner key shape.
    const groups = await this.sqlLoadConditioningGroupsForPersona(0, personaLineageId);
    if (!groups.length) return null;
    return { persona_lineage_id: personaLineageId, groups };
  }

  /**
   * Conditioning import is handled by ImportExportRepository.
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   */
  async fromExportShape(_ownerId: string | number, _data: ConditioningExportShape): Promise<boolean> {
    return false;
  }
}

/** Singleton instance — import this in callers. */
export const conditioningMemoryRepository = new ConditioningMemoryRepository();

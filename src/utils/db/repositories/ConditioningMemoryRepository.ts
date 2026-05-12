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
import type { ConditioningHistoryRow } from "@/types/db/schema";
import type { ConditioningType } from "@/types/db/schema";
import {
  recordConditioningEvent,
  setPersonaConditioningEnabled,
  setServerConditioningEnabled,
  loadConditioningGroupsForPersona,
  deleteConditioningGroupsForPersona,
  type ConditioningGroup,
} from "@/utils/db/conditioningDb";
import type { ConditioningActionKey } from "@/utils/conditioning/conditioning";
import type { IRepository } from "./IRepository";

/** Portable conditioning export shape (expanded in Phase 6 #16.7). */
export type ConditioningExportShape = {
  persona_lineage_id: number;
  groups: ConditioningGroup[];
};

export class ConditioningMemoryRepository implements IRepository<ConditioningExportShape> {
  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * Loads aggregated conditioning groups for a persona lineage.
   * Groups cluster related events so the prompt assembly can summarize them.
   *
   * @param serverId         - Internal server DB ID
   * @param personaLineageId - Persona lineage to load for
   * @returns Array of ConditioningGroup aggregates
   */
  async loadGroupsForPersona(serverId: number, personaLineageId: number): Promise<ConditioningGroup[]> {
    return loadConditioningGroupsForPersona(serverId, personaLineageId);
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Records a single conditioning event (reward or punishment).
   *
   * @param params - Event parameters forwarded to conditioningDb
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
    return recordConditioningEvent(params);
  }

  /**
   * Enables or disables reward/punishment conditioning for a specific persona.
   *
   * @param args - Forwarded to setPersonaConditioningEnabled
   */
  async setPersonaConditioningEnabled(
    ...args: Parameters<typeof setPersonaConditioningEnabled>
  ): ReturnType<typeof setPersonaConditioningEnabled> {
    return setPersonaConditioningEnabled(...args);
  }

  /**
   * Enables or disables conditioning for all personas in a server.
   *
   * @param args - Forwarded to setServerConditioningEnabled
   */
  async setServerConditioningEnabled(
    ...args: Parameters<typeof setServerConditioningEnabled>
  ): ReturnType<typeof setServerConditioningEnabled> {
    return setServerConditioningEnabled(...args);
  }

  /**
   * Deletes specific conditioning groups for a persona lineage.
   * Returns the count of deleted rows.
   * Used during persona reset or targeted lineage cleanup.
   *
   * @param serverId         - Internal server DB ID
   * @param personaLineageId - Persona lineage to purge
   * @param groups           - Specific groups to delete (conditioningType + actionKey + reasonNormalized)
   */
  async deleteGroupsForPersona(
    serverId: number,
    personaLineageId: number,
    groups: Parameters<typeof deleteConditioningGroupsForPersona>[2],
  ): Promise<number> {
    return deleteConditioningGroupsForPersona(serverId, personaLineageId, groups);
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
    const groups = await loadConditioningGroupsForPersona(0, personaLineageId);
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

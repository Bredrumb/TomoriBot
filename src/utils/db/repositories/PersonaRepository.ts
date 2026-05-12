/**
 * PersonaRepository — manages the `tomoris` and persona resolution tables.
 *
 * Owns TomoriState loading (composite persona + config + memories read) and
 * all writes to the `tomoris` table. Configuration writes live in
 * ConfigRepository; the split mirrors the planned #14 DB partition.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import type { TomoriRow, TomoriState } from "@/types/db/schema";
import { loadTomoriState, loadAllPersonasForServer, loadPersonaConfigRow } from "@/utils/db/repositoryReadSql";
import { updateTomori } from "@/utils/db/repositoryWriteSql";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { IRepository } from "./IRepository";

/** Minimal portable shape for a persona export (expanded in Phase 6 #16.7). */
export type PersonaExportShape = {
  tomori_nickname: string;
  persona_lineage_id: number | null;
};

export class PersonaRepository implements IRepository<PersonaExportShape> {
  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * Loads the full composite TomoriState for a server's main persona.
   * Returns null if the server has no registered persona.
   *
   * @param serverDiscId - Discord server snowflake
   */
  async loadState(serverDiscId: string): Promise<TomoriState | null> {
    return loadTomoriState(serverDiscId);
  }

  /**
   * Loads TomoriState for every persona registered in the server.
   *
   * @param serverDiscId - Discord server snowflake
   */
  async loadAllForServer(serverDiscId: string): Promise<TomoriState[]> {
    return loadAllPersonasForServer(serverDiscId);
  }

  /**
   * Loads the PersonaConfigRow for a specific tomori by internal ID.
   *
   * @param tomoriId - Internal tomori DB ID
   */
  async loadPersonaConfig(tomoriId: number) {
    return loadPersonaConfigRow(tomoriId);
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Updates arbitrary fields on a Tomori row.
   * Invalidates the server's tomori state cache after write.
   *
   * @param tomoriId      - Internal tomori DB ID
   * @param tomoriData    - Partial TomoriRow with fields to update
   * @param serverDiscId  - Discord server snowflake (required for cache invalidation)
   * @returns Updated TomoriRow or null on failure
   */
  async update(tomoriId: number, tomoriData: Partial<TomoriRow>, serverDiscId?: string): Promise<TomoriRow | null> {
    const row = await updateTomori(tomoriId, tomoriData);
    if (row && serverDiscId) invalidateTomoriStateCache(serverDiscId);
    return row;
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Exports a minimal portable persona shape for a given server.
   * The ownerId is the Discord snowflake of the server.
   *
   * @param ownerId - Discord server snowflake
   */
  async toExportShape(ownerId: string | number): Promise<PersonaExportShape | null> {
    const state = await loadTomoriState(String(ownerId));
    if (!state) return null;
    return {
      tomori_nickname: state.tomori_nickname,
      persona_lineage_id: state.persona_lineage_id ?? null,
    };
  }

  /**
   * Persona import is handled by ImportExportRepository (full server export).
   * This stub satisfies the IRepository contract; expansion is deferred to Phase 6 #16.7.
   */
  async fromExportShape(_ownerId: string | number, _data: PersonaExportShape): Promise<boolean> {
    return false;
  }
}

/** Singleton instance — import this in callers. */
export const personaRepository = new PersonaRepository();

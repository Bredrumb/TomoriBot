/**
 * ImportExportRepository — owns import/export database operations.
 *
 * Owns the full data portability pipeline: personal and server exports,
 * per-domain slice exports (memories, settings, config, personality),
 * and the corresponding import paths with validation.
 *
 * This is the only repository with a concrete IRepository implementation
 * for server-level exports — other repositories defer to this one for their
 * Phase 6 (#16.7) export pipeline composition.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import type { ExportResult, PersonalityExportResult } from "@/types/db/dataExport";
import type { ServerConfigExport } from "@/types/db/dataExport";
import {
  exportPersonalData,
  exportServerData,
  exportPersonaPersonalMemories,
  exportGlobalPersonalMemories,
  exportPersonalSettings,
  exportPersonaServerMemories,
  exportServerConfig,
  exportPersonalityData,
} from "@/utils/db/repositoryExportSql";
import {
  importPersonalMemories,
  importPersonalSettings,
  importServerConfig,
  importServerMemories,
  importPersonalData,
  importServerData,
  validateImportFile,
  type ImportValidationResult,
} from "@/utils/db/repositoryImportSql";
import type { PersonalExportData } from "@/types/db/dataExport";
import type { IRepository } from "./IRepository";

/** Full personal export shape produced by exportPersonalData. */
export type ImportExportShape = ExportResult;

export class ImportExportRepository implements IRepository<ImportExportShape> {
  // ── exports ────────────────────────────────────────────────────────────────

  /**
   * Exports all personal data for a user (memories + settings).
   *
   * @param userDiscId             - Discord user snowflake
   * @param personaLineageId       - Persona lineage to export memories for (default 0)
   * @param includeGlobalMemories  - Whether to include lineage-0 memories (default true)
   */
  async exportPersonalData(
    userDiscId: string,
    personaLineageId = 0,
    includeGlobalMemories = true,
  ): Promise<ExportResult> {
    return exportPersonalData(userDiscId, personaLineageId, includeGlobalMemories);
  }

  /**
   * Exports all server data (config + memories + personality).
   *
   * @param serverDiscId - Discord server snowflake
   * @param tomoriId     - Optional specific tomori ID to scope the export
   */
  async exportServerData(serverDiscId: string, tomoriId?: number): Promise<ExportResult> {
    return exportServerData(serverDiscId, tomoriId);
  }

  /**
   * Exports personal memories scoped to a specific persona lineage.
   *
   * @param userDiscId       - Discord user snowflake
   * @param personaLineageId - Persona lineage to export
   */
  async exportPersonaPersonalMemories(userDiscId: string, personaLineageId: number): Promise<ExportResult> {
    return exportPersonaPersonalMemories(userDiscId, personaLineageId);
  }

  /**
   * Exports all global (lineage-0) personal memories for a user.
   *
   * @param userDiscId - Discord user snowflake
   */
  async exportGlobalPersonalMemories(userDiscId: string): Promise<ExportResult> {
    return exportGlobalPersonalMemories(userDiscId);
  }

  /**
   * Exports only the user's personal settings (privacy, language, nickname, etc.).
   *
   * @param userDiscId - Discord user snowflake
   */
  async exportPersonalSettings(userDiscId: string): Promise<ExportResult> {
    return exportPersonalSettings(userDiscId);
  }

  /**
   * Exports server memories scoped to a specific persona lineage.
   *
   * @param serverDiscId     - Discord server snowflake
   * @param tomoriId         - Internal tomori DB ID
   */
  async exportPersonaServerMemories(serverDiscId: string, tomoriId: number): Promise<ExportResult> {
    return exportPersonaServerMemories(serverDiscId, tomoriId);
  }

  /**
   * Exports only the server's configuration (no memories or personality).
   *
   * @param serverDiscId - Discord server snowflake
   */
  async exportServerConfig(serverDiscId: string): Promise<ExportResult> {
    return exportServerConfig(serverDiscId);
  }

  /**
   * Exports personality data (system prompt, persona config, presets).
   *
   * @param serverDiscId - Discord server snowflake
   * @param tomoriId     - Optional specific tomori ID
   */
  async exportPersonalityData(serverDiscId: string, tomoriId?: number): Promise<PersonalityExportResult> {
    return exportPersonalityData(serverDiscId, tomoriId);
  }

  // ── imports ────────────────────────────────────────────────────────────────

  /**
   * Validates a raw JSON import payload and returns the detected type + data.
   *
   * @param jsonData - Raw JSON object from the uploaded import file
   */
  validateImportFile(jsonData: unknown): ImportValidationResult {
    return validateImportFile(jsonData);
  }

  /**
   * Imports personal memories for a user from an export payload.
   *
   * @param args - Forwarded to importPersonalMemories
   */
  async importPersonalMemories(
    ...args: Parameters<typeof importPersonalMemories>
  ): ReturnType<typeof importPersonalMemories> {
    return importPersonalMemories(...args);
  }

  /**
   * Imports personal settings for a user from an export payload.
   *
   * @param args - Forwarded to importPersonalSettings
   */
  async importPersonalSettings(
    ...args: Parameters<typeof importPersonalSettings>
  ): ReturnType<typeof importPersonalSettings> {
    return importPersonalSettings(...args);
  }

  /**
   * Imports server configuration from an export payload.
   *
   * @param serverDiscId - Discord server snowflake
   * @param config       - ServerConfigExport payload
   */
  async importServerConfig(serverDiscId: string, config: ServerConfigExport): ReturnType<typeof importServerConfig> {
    return importServerConfig(serverDiscId, config);
  }

  /**
   * Imports server memories from an export payload.
   *
   * @param args - Forwarded to importServerMemories
   */
  async importServerMemories(
    ...args: Parameters<typeof importServerMemories>
  ): ReturnType<typeof importServerMemories> {
    return importServerMemories(...args);
  }

  /**
   * Imports the full personal data bundle (memories + settings).
   *
   * @param args - Forwarded to importPersonalData
   */
  async importPersonalData(...args: Parameters<typeof importPersonalData>): ReturnType<typeof importPersonalData> {
    return importPersonalData(...args);
  }

  /**
   * Imports the full server data bundle (config + memories + personality).
   *
   * @param args - Forwarded to importServerData
   */
  async importServerData(...args: Parameters<typeof importServerData>): ReturnType<typeof importServerData> {
    return importServerData(...args);
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Exports a user's full personal data bundle.
   * The ownerId is the Discord snowflake of the user.
   *
   * @param ownerId - Discord user snowflake
   */
  async toExportShape(ownerId: string | number): Promise<ImportExportShape | null> {
    const result = await exportPersonalData(String(ownerId));
    return result.success ? result : null;
  }

  /**
   * Imports a previously exported personal data bundle.
   * Accepts the ExportResult envelope from toExportShape.
   *
   * @param ownerId - Discord user snowflake
   * @param data    - Previously exported ExportResult
   */
  async fromExportShape(ownerId: string | number, data: ImportExportShape): Promise<boolean> {
    if (!data.success || !data.data) return false;
    // ExportResult.data is a union; personal exports carry a nested .data: PersonalExportData.
    const envelope = data.data as { type?: string; data?: PersonalExportData };
    if (envelope.type !== "personal" || !envelope.data) return false;
    const result = await importPersonalData(String(ownerId), envelope.data);
    return result.success;
  }
}

/** Singleton instance — import this in callers. */
export const importExportRepository = new ImportExportRepository();

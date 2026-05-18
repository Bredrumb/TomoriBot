/**
 * PresetRepository — manages SillyTavern preset data, persona preset import/export,
 * and SillyTavern card conversion.
 *
 * Consolidates stPresetDb.ts, presetExport.ts, presetImport.ts, sillyTavernImport.ts.
 *
 * Size note: this file exceeds 1,000 lines. Split decision documented here:
 * sillyTavernImport.ts (545 lines) is pure text-processing tightly coupled to
 * convertSillyTavernJsonToPresetData. A separate SillyTavernConverter class would
 * add an import dependency layer without meaningful cohesion gain. Single class accepted.
 */
import { sql } from "@/utils/db/client";
import type { StPresetRow, StPresetNodeRow } from "@/types/db/schema";
import {
  PRESET_EXPORT_VERSION,
  PRESET_MAX_ATTRIBUTES,
  UNPAIRED_SAMPLE_DIALOGUE_SENTINEL,
  presetExportSchema,
  presetExportDataSchema,
  type PresetExport,
  type ExportResult,
  type ImportResult,
  type ValidationResult,
  type PresetExportData,
} from "@/types/preset/presetExport";
import { log } from "@/utils/misc/logger";
import { invalidateStPresetCache } from "@/utils/cache/stPresetCache";
import { validateTomoriConfigFields } from "@/utils/db/sqlSecurity";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import type { SillyTavernCardMetadata } from "@/utils/image/pngMetadata";

// ── SillyTavern conversion private types ──────────────────────────────────────

type JsonObject = Record<string, unknown>;

type DialoguePair = {
  input: string;
  output: string;
};

type DialogueTurn = {
  speaker: "user" | "char";
  content: string;
};

type ContentSection = {
  heading?: string;
  content: string;
};

export type SillyTavernConversionResult =
  | {
      success: true;
      data: PresetExportData;
    }
  | {
      success: false;
      error: string;
    };

const CONTINUATION_MARKER = " [truncated]";

export class PresetRepository {
  // ── SillyTavern conversion private helpers (from sillyTavernImport.ts) ───────

  private asObject(value: unknown): JsonObject | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as JsonObject;
  }

  private hasOwnKey(obj: JsonObject, key: string): boolean {
    return Object.hasOwn(obj, key);
  }

  private getStringField(obj: JsonObject | null, key: string): string | null {
    if (!obj) return null;
    const value = obj[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private getStringArrayField(obj: JsonObject | null, key: string): string[] {
    if (!obj) return [];
    const value = obj[key];
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private sanitizeSillyTavernText(input: string): string {
    return input
      .replace(/\r\n/g, "\n")
      .replace(/<!--[\s\S]*?--!?>/g, "")
      .trim();
  }

  private capitalizeFirstLetter(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return "Imported Persona";
    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  }

  private truncateToMaxLength(input: string, maxLength: number): string {
    const text = input.trim();
    if (text.length <= maxLength) return text;
    const maxBody = Math.max(maxLength - CONTINUATION_MARKER.length, 0);
    return `${text.slice(0, maxBody).trimEnd()}${CONTINUATION_MARKER}`;
  }

  private splitLongTextIntoChunks(input: string, maxLength: number): string[] {
    const text = input.trim();
    if (!text) return [];
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    const paragraphs = text.split(/\n{2,}/).map((paragraph) => paragraph.trim());
    let currentChunk = "";

    for (const paragraph of paragraphs) {
      if (!paragraph) continue;

      if (paragraph.length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = "";
        }
        let offset = 0;
        while (offset < paragraph.length) {
          const rawChunk = paragraph.slice(offset, offset + maxLength);
          const chunk = rawChunk.trim();
          if (chunk) chunks.push(chunk);
          offset += maxLength;
        }
        continue;
      }

      if (!currentChunk) {
        currentChunk = paragraph;
        continue;
      }

      if (currentChunk.length + 2 + paragraph.length <= maxLength) {
        currentChunk = `${currentChunk}\n\n${paragraph}`;
      } else {
        chunks.push(currentChunk);
        currentChunk = paragraph;
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  private buildAttributeSectionChunks(
    heading: string | undefined,
    content: string,
    maxAttributeLength: number,
  ): string[] {
    const sanitized = this.sanitizeSillyTavernText(content);
    if (!sanitized) return [];
    const prefix = heading ? `${heading}\n` : "";
    const maxContentLength = Math.max(maxAttributeLength - prefix.length, 200);
    const contentChunks = this.splitLongTextIntoChunks(sanitized, maxContentLength);
    return contentChunks.map((chunk) => this.truncateToMaxLength(`${prefix}${chunk}`, maxAttributeLength));
  }

  private normalizeSpeaker(rawLabel: string): "user" | "char" | null {
    const normalized = rawLabel.toLowerCase().replace(/[{}\s]/g, "");
    if (normalized === "user" || normalized === "you") return "user";
    if (normalized === "char" || normalized === "bot" || normalized === "assistant" || normalized === "character") {
      return "char";
    }
    return null;
  }

  private collapseConsecutiveTurns(turns: DialogueTurn[]): DialogueTurn[] {
    const collapsed: DialogueTurn[] = [];
    for (const turn of turns) {
      const previous = collapsed[collapsed.length - 1];
      if (previous && previous.speaker === turn.speaker) {
        previous.content = `${previous.content}\n\n${turn.content}`.trim();
      } else {
        collapsed.push({ ...turn });
      }
    }
    return collapsed;
  }

  private parseSpeakerTurns(segment: string): DialogueTurn[] {
    const speakerPattern =
      /(?:^|\n)\s*(\{\{\s*(?:user|char|bot)\s*\}\}|\{\s*(?:user|char|bot)\s*\}|user|you|char|bot|character|assistant)\s*:\s*/gim;

    const matches: Array<{
      speaker: "user" | "char";
      start: number;
      end: number;
    }> = [];
    let match: RegExpExecArray | null;

    // biome-ignore lint/suspicious/noAssignInExpressions: Regex iteration idiom
    while ((match = speakerPattern.exec(segment)) !== null) {
      const speaker = this.normalizeSpeaker(match[1]);
      if (!speaker) continue;
      matches.push({
        speaker,
        start: match.index ?? 0,
        end: speakerPattern.lastIndex,
      });
    }

    if (matches.length === 0) return [];

    const turns: DialogueTurn[] = [];
    for (let i = 0; i < matches.length; i++) {
      const current = matches[i];
      const next = matches[i + 1];
      const contentStart = current.end;
      const contentEnd = next ? next.start : segment.length;
      const rawContent = segment.slice(contentStart, contentEnd).trim();
      if (!rawContent) continue;
      turns.push({
        speaker: current.speaker,
        content: this.sanitizeSillyTavernText(rawContent),
      });
    }

    return this.collapseConsecutiveTurns(turns);
  }

  private buildPairsFromTurns(
    turns: DialogueTurn[],
    maxDialogueLength: number,
    syntheticInput: string,
  ): DialoguePair[] {
    const pairs: DialoguePair[] = [];
    let pendingUser: string | null = null;

    for (const turn of turns) {
      if (turn.speaker === "user") {
        pendingUser = this.truncateToMaxLength(turn.content, maxDialogueLength);
        continue;
      }
      const output = this.truncateToMaxLength(turn.content, maxDialogueLength);
      if (!output) continue;
      const input = pendingUser ?? syntheticInput;
      pairs.push({
        input: this.truncateToMaxLength(input, maxDialogueLength),
        output,
      });
      pendingUser = null;
    }

    return pairs;
  }

  private parseMesExamplePairs(mesExample: string | null, maxDialogueLength: number): DialoguePair[] {
    if (!mesExample) return [];
    const cleaned = this.sanitizeSillyTavernText(mesExample);
    if (!cleaned) return [];

    const segments = cleaned
      .split(/(?:^|\n)\s*<START>\s*(?:\n|$)/gi)
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    const blocks = segments.length > 0 ? segments : [cleaned];
    const pairs: DialoguePair[] = [];

    for (const block of blocks) {
      const turns = this.parseSpeakerTurns(block);
      if (turns.length === 0) {
        pairs.push({
          input: UNPAIRED_SAMPLE_DIALOGUE_SENTINEL,
          output: this.truncateToMaxLength(block, maxDialogueLength),
        });
        continue;
      }
      pairs.push(...this.buildPairsFromTurns(turns, maxDialogueLength, UNPAIRED_SAMPLE_DIALOGUE_SENTINEL));
    }

    return pairs;
  }

  private buildGreetingPairs(
    firstMessage: string | null,
    alternateGreetings: string[],
    maxDialogueLength: number,
  ): DialoguePair[] {
    const rawOutputs: string[] = [];
    if (firstMessage) rawOutputs.push(firstMessage);
    rawOutputs.push(...alternateGreetings);

    return rawOutputs
      .map((text) => this.sanitizeSillyTavernText(text))
      .filter((text) => text.length > 0)
      .map((text) => ({
        input: UNPAIRED_SAMPLE_DIALOGUE_SENTINEL,
        output: this.truncateToMaxLength(text, maxDialogueLength),
      }));
  }

  private generateDefaultTriggerWords(name: string, maxTriggerWords: number): string[] {
    const triggers: string[] = [];
    const seen = new Set<string>();

    const pushUnique = (value: string) => {
      const normalized = value.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      triggers.push(normalized);
    };

    pushUnique(name);
    for (const part of name.split(/[\s_-]+/)) {
      const alphanumeric = part.replace(/[^a-zA-Z0-9]/g, "").trim();
      if (alphanumeric.length >= 2) pushUnique(alphanumeric);
    }

    return triggers.slice(0, maxTriggerWords);
  }

  private pickStringFromCard(cardData: JsonObject | null, rootData: JsonObject, key: string): string | null {
    return this.getStringField(cardData, key) ?? this.getStringField(rootData, key);
  }

  private pickStringArrayFromCard(cardData: JsonObject | null, rootData: JsonObject, key: string): string[] {
    const fromData = this.getStringArrayField(cardData, key);
    if (fromData.length > 0) return fromData;
    return this.getStringArrayField(rootData, key);
  }

  private pickObjectFromCard(cardData: JsonObject | null, rootData: JsonObject, key: string): JsonObject | null {
    return this.asObject(cardData?.[key]) ?? this.asObject(rootData[key]);
  }

  private collectCharacterBookSections(characterBook: JsonObject | null): ContentSection[] {
    if (!characterBook) return [];
    const entriesRaw = characterBook.entries;
    if (!Array.isArray(entriesRaw)) return [];

    const sections: ContentSection[] = [];
    for (const entryRaw of entriesRaw) {
      const entry = this.asObject(entryRaw);
      if (!entry) continue;
      const isEnabled = entry.enabled !== false;
      if (!isEnabled) continue;
      const content = this.getStringField(entry, "content");
      if (!content) continue;

      let entryTitle = this.getStringField(entry, "name") ?? "";
      if (!entryTitle) {
        const keys = this.getStringArrayField(entry, "keys");
        if (keys.length > 0) entryTitle = keys.slice(0, 3).join(", ");
      }

      sections.push({
        heading: entryTitle ? `Character Book - ${entryTitle}` : "Character Book Entry",
        content,
      });
    }

    return sections;
  }

  /** Returns true if the given unknown value looks like a SillyTavern character card JSON. */
  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505"
    );
  }

  // ── ST preset DB operations (from stPresetDb.ts) ──────────────────────────

  /**
   * Insert a new ST preset with its parsed nodes in a single transaction.
   * If a preset with the same name already exists for this server, the
   * insert fails (unique constraint on server_id + preset_name).
   *
   * @param serverId - Internal server_id (FK to servers table)
   * @param presetName - Display name for the preset (from filename or JSON metadata)
   * @param rawJson - The full raw SillyTavern preset JSON object
   * @param nodes - Parsed toggleable nodes to insert (order matters)
   * @returns The inserted preset row, or null on failure
   */
  async insertPresetWithNodes(
    serverId: number,
    presetName: string,
    rawJson: unknown,
    nodes: Omit<StPresetNodeRow, "node_id" | "preset_id">[],
  ): Promise<StPresetRow | null> {
    try {
      // 1. Use a transaction to ensure atomicity (preset + all nodes or nothing)
      const result = await sql.begin(async (tx) => {
        // 2. Remove any existing preset with the same name for this server.
        //    The FK cascade on st_preset_nodes deletes old nodes automatically.
        await tx`
          DELETE FROM st_presets
          WHERE server_id = ${serverId} AND preset_name = ${presetName}
        `;

        // 3. Insert the preset metadata + raw JSON
        const [preset] = await tx`
          INSERT INTO st_presets (server_id, preset_name, raw_json)
          VALUES (${serverId}, ${presetName}, ${JSON.stringify(rawJson)})
          RETURNING *
        `;

        // 4. Insert each node with a reference to the new preset_id
        for (const node of nodes) {
          await tx`
            INSERT INTO st_preset_nodes (
              preset_id, identifier, name, role, content,
              is_marker, is_enabled, is_comment, node_order,
              injection_position, injection_depth, injection_order
            )
            VALUES (
              ${preset.preset_id},
              ${node.identifier},
              ${node.name},
              ${node.role},
              ${node.content},
              ${node.is_marker},
              ${node.is_enabled},
              ${node.is_comment},
              ${node.node_order},
              ${node.injection_position},
              ${node.injection_depth},
              ${node.injection_order}
            )
          `;
        }

        return preset;
      });

      log.success(
        `[PresetRepository] Inserted preset "${presetName}" with ${nodes.length} nodes for server ${serverId}`,
      );
      invalidateStPresetCache(serverId);
      return result as StPresetRow;
    } catch (error) {
      log.error(`[PresetRepository] Failed to insert preset "${presetName}" for server ${serverId}`, error);
      return null;
    }
  }

  /**
   * Load all ST presets for a server (metadata only, no nodes).
   *
   * @param serverId - Internal server_id
   * @returns Array of preset rows ordered by creation date
   */
  async loadPresetsForServer(serverId: number): Promise<StPresetRow[]> {
    try {
      const rows = await sql`
        SELECT preset_id, server_id, preset_name, is_active, created_at, updated_at
        FROM st_presets
        WHERE server_id = ${serverId}
        ORDER BY created_at ASC
      `;
      return rows as StPresetRow[];
    } catch (error) {
      log.error(`[PresetRepository] Failed to load presets for server ${serverId}`, error);
      return [];
    }
  }

  /**
   * Load a single preset by ID (with raw JSON).
   *
   * @param presetId - The preset_id to load
   * @returns The preset row or null if not found
   */
  async loadPresetById(presetId: number): Promise<StPresetRow | null> {
    try {
      const [row] = await sql`
        SELECT * FROM st_presets WHERE preset_id = ${presetId}
      `;
      return (row as StPresetRow) ?? null;
    } catch (error) {
      log.error(`[PresetRepository] Failed to load preset ${presetId}`, error);
      return null;
    }
  }

  /**
   * Load the currently active preset for a server, if any.
   *
   * @param serverId - Internal server_id
   * @returns The active preset row or null
   */
  async loadActivePreset(serverId: number): Promise<StPresetRow | null> {
    try {
      const [row] = await sql`
        SELECT * FROM st_presets
        WHERE server_id = ${serverId} AND is_active = true
        LIMIT 1
      `;
      return (row as StPresetRow) ?? null;
    } catch (error) {
      log.error(`[PresetRepository] Failed to load active preset for server ${serverId}`, error);
      return null;
    }
  }

  /**
   * Load all toggleable (non-marker, non-comment-only) nodes for a preset,
   * ordered by node_order. These are the nodes shown in the toggle UI.
   *
   * @param presetId - The preset_id to load nodes for
   * @returns Array of node rows in prompt_order sequence
   */
  async loadToggleableNodes(presetId: number): Promise<StPresetNodeRow[]> {
    try {
      const rows = await sql`
        SELECT * FROM st_preset_nodes
        WHERE preset_id = ${presetId}
          AND is_marker = false
        ORDER BY node_order ASC
      `;
      return rows as StPresetNodeRow[];
    } catch (error) {
      log.error(`[PresetRepository] Failed to load toggleable nodes for preset ${presetId}`, error);
      return [];
    }
  }

  /**
   * Load ALL nodes for a preset (including markers), ordered by node_order.
   * Used by the context builder when assembling the full prompt.
   *
   * @param presetId - The preset_id to load nodes for
   * @returns Array of all node rows in prompt_order sequence
   */
  async loadAllNodes(presetId: number): Promise<StPresetNodeRow[]> {
    try {
      const rows = await sql`
        SELECT * FROM st_preset_nodes
        WHERE preset_id = ${presetId}
        ORDER BY node_order ASC
      `;
      return rows as StPresetNodeRow[];
    } catch (error) {
      log.error(`[PresetRepository] Failed to load all nodes for preset ${presetId}`, error);
      return [];
    }
  }

  /**
   * Batch-update enabled states for multiple nodes in a single transaction.
   * Accepts a map of identifier → is_enabled for all nodes in the preset.
   *
   * @param presetId - The preset_id owning these nodes
   * @param enabledMap - Map of node identifier → desired enabled state
   * @param serverId - Internal server_id for cache invalidation
   * @returns True if the update succeeded
   */
  async updateNodeEnabledStates(
    presetId: number,
    enabledMap: Map<string, boolean>,
    serverId: number,
  ): Promise<boolean> {
    try {
      await sql.begin(async (tx) => {
        for (const [identifier, isEnabled] of enabledMap) {
          await tx`
            UPDATE st_preset_nodes
            SET is_enabled = ${isEnabled}
            WHERE preset_id = ${presetId} AND identifier = ${identifier}
          `;
        }
      });

      log.info(`[PresetRepository] Updated ${enabledMap.size} node states for preset ${presetId}`);
      invalidateStPresetCache(serverId);
      return true;
    } catch (error) {
      log.error(`[PresetRepository] Failed to update node states for preset ${presetId}`, error);
      return false;
    }
  }

  /**
   * Delete a preset and all its nodes (CASCADE handles node cleanup).
   *
   * @param presetId - The preset_id to delete
   * @param serverId - Internal server_id for cache invalidation
   * @returns True if a row was deleted
   */
  async deletePreset(presetId: number, serverId: number): Promise<boolean> {
    try {
      const result = await sql`
        DELETE FROM st_presets WHERE preset_id = ${presetId}
      `;
      const deleted = (result as unknown[]).length > 0 || (result as { count?: number }).count === 1;
      if (deleted) {
        log.success(`[PresetRepository] Deleted preset ${presetId}`);
        invalidateStPresetCache(serverId);
      }
      return deleted;
    } catch (error) {
      log.error(`[PresetRepository] Failed to delete preset ${presetId}`, error);
      return false;
    }
  }

  /**
   * Set a preset as active and deactivate all others for the same server.
   * Uses a transaction to ensure only one preset is active at a time.
   *
   * @param serverId - Internal server_id
   * @param presetId - The preset_id to activate
   * @returns True if the activation succeeded
   */
  async setActivePreset(serverId: number, presetId: number): Promise<boolean> {
    try {
      await sql.begin(async (tx) => {
        // 1. Deactivate all presets for this server
        await tx`
          UPDATE st_presets SET is_active = false
          WHERE server_id = ${serverId}
        `;
        // 2. Activate the target preset
        await tx`
          UPDATE st_presets SET is_active = true
          WHERE preset_id = ${presetId} AND server_id = ${serverId}
        `;
      });

      log.success(`[PresetRepository] Activated preset ${presetId} for server ${serverId}`);
      invalidateStPresetCache(serverId);
      return true;
    } catch (error) {
      log.error(`[PresetRepository] Failed to activate preset ${presetId} for server ${serverId}`, error);
      return false;
    }
  }

  // ── Preset export (from presetExport.ts) ──────────────────────────────────

  /**
   * Exports TomoriBot preset personality data for a given server.
   * Queries data from tomoris and persona_configs (tomori_configs was dropped in Task F2, migration 008).
   *
   * @param serverDiscId - Discord server ID to export preset for
   * @param targetTomoriId - Optional persona ID to export; defaults to current main persona
   * @returns ExportResult containing the exported preset data or error
   */
  async exportPresetData(serverDiscId: string, targetTomoriId?: number): Promise<ExportResult> {
    try {
      // 1. Get internal server ID
      const serverRows = await sql`
        SELECT server_id
        FROM servers
        WHERE server_disc_id = ${serverDiscId}
        LIMIT 1
      `;

      if (!serverRows.length) {
        return { success: false, error: "commands.persona.export.error_no_server_data" };
      }

      const serverId = serverRows[0].server_id;

      // 2. Query target persona row (explicit selection) or default main persona
      const personaRows =
        typeof targetTomoriId === "number"
          ? await sql`
              SELECT
                tomori_id, tomori_nickname, persona_lineage_id,
                attribute_list, sample_dialogues_in, sample_dialogues_out,
                is_alter, nai_tags, nai_char_ref_url,
                nai_attg_author, nai_attg_title, nai_attg_tags, nai_attg_genre, nai_attg_stars
              FROM tomoris
              WHERE server_id = ${serverId}
                AND tomori_id = ${targetTomoriId}
              LIMIT 1
            `
          : await sql`
              SELECT
                tomori_id, tomori_nickname, persona_lineage_id,
                attribute_list, sample_dialogues_in, sample_dialogues_out,
                is_alter, nai_tags, nai_char_ref_url,
                nai_attg_author, nai_attg_title, nai_attg_tags, nai_attg_genre, nai_attg_stars
              FROM tomoris
              WHERE server_id = ${serverId}
                AND is_alter = false
              ORDER BY updated_at DESC NULLS LAST, tomori_id DESC
              LIMIT 1
            `;

      if (!personaRows.length) {
        return { success: false, error: "commands.persona.export.error_no_preset_data" };
      }

      const presetData = personaRows[0];
      if (typeof targetTomoriId !== "number") {
        const mainCountRows = await sql`
          SELECT COUNT(*)::int AS count
          FROM tomoris
          WHERE server_id = ${serverId}
          AND is_alter = false
        `;
        const mainCount = Number(mainCountRows[0]?.count ?? 0);
        if (mainCount > 1) {
          log.warn(
            `Multiple main personas found for server ${serverDiscId} (${mainCount}). Export will use the most recently updated.`,
          );
        }
      }

      const lineageIdRaw = presetData.persona_lineage_id;
      const lineageId =
        typeof lineageIdRaw === "bigint"
          ? Number(lineageIdRaw)
          : typeof lineageIdRaw === "string"
            ? Number(lineageIdRaw)
            : lineageIdRaw;

      // 3. Load trigger words + persona prompt from persona-scoped config first
      let triggerWords: string[] | null = null;
      let personaPrompt: string | null = null;
      const personaConfigRows = await sql`
        SELECT trigger_words, persona_prompt
        FROM persona_configs
        WHERE tomori_id = ${presetData.tomori_id}
        LIMIT 1
      `;
      if (personaConfigRows.length) {
        triggerWords = personaConfigRows[0].trigger_words ?? null;
        personaPrompt = personaConfigRows[0].persona_prompt ?? null;
      }

      // 4. Build export object with metadata (includes NovelAI persona fields)
      const exportData: PresetExport = {
        version: PRESET_EXPORT_VERSION,
        type: "preset",
        exported_at: new Date().toISOString(),
        data: {
          tomori_nickname: presetData.tomori_nickname,
          attribute_list: presetData.attribute_list || [],
          sample_dialogues_in: presetData.sample_dialogues_in || [],
          sample_dialogues_out: presetData.sample_dialogues_out || [],
          trigger_words: triggerWords || [],
          persona_prompt: personaPrompt,
          persona_lineage_id: lineageId,
          nai_tags: presetData.nai_tags || [],
          nai_char_ref_url: presetData.nai_char_ref_url ?? null,
          nai_attg_author: presetData.nai_attg_author ?? null,
          nai_attg_title: presetData.nai_attg_title ?? null,
          nai_attg_tags: presetData.nai_attg_tags ?? null,
          nai_attg_genre: presetData.nai_attg_genre ?? null,
          nai_attg_stars: presetData.nai_attg_stars ?? null,
        },
      };

      // 5. Validate export data structure
      const validated = presetExportSchema.safeParse(exportData);
      if (!validated.success) {
        log.error(`Preset export validation failed for server ${serverDiscId}:`, validated.error);
        return { success: false, error: "commands.persona.export.error_validation_failed" };
      }

      log.success(
        `Successfully exported preset for server ${serverDiscId}, persona ${presetData.tomori_id}: ${presetData.tomori_nickname}`,
      );

      return { success: true, data: validated.data };
    } catch (error) {
      log.error(`Error exporting preset data for server ${serverDiscId}:`, error);
      return { success: false, error: "commands.persona.export.error_export_failed" };
    }
  }

  // ── Preset import + validation (from presetImport.ts) ────────────────────

  /**
   * Imports TomoriBot preset personality data, replacing existing personality.
   *
   * @param serverDiscId - Discord server ID to import preset for
   * @param importData - The validated preset export data to import
   * @param identityMode - preserve: keep/import lineage, fork: assign a fresh lineage
   * @returns ImportResult indicating success or failure with item counts
   */
  async importPresetData(
    serverDiscId: string,
    importData: PresetExportData,
    identityMode: "preserve" | "fork" = "preserve",
  ): Promise<ImportResult> {
    try {
      const importValidation = this.validatePresetData(importData);
      if (!importValidation.valid || !importValidation.data) {
        return {
          success: false,
          error: importValidation.error ?? "commands.persona.import.error_invalid_format",
        };
      }
      const validatedImportData = importValidation.data;

      // 1. Validate trigger_words field for SQL security
      try {
        validateTomoriConfigFields(["trigger_words"]);
      } catch (error) {
        log.error("Config field validation failed during preset import:", error);
        return { success: false, error: "commands.persona.import.error_invalid_config" };
      }

      // 2. Get internal server ID and tomori ID (main persona only)
      const serverRows = await sql`
        SELECT s.server_id, t.tomori_id, t.persona_lineage_id
        FROM servers s
        JOIN tomoris t ON s.server_id = t.server_id
        WHERE s.server_disc_id = ${serverDiscId}
        AND t.is_alter = false
        LIMIT 1
      `;

      if (!serverRows.length) {
        return { success: false, error: "commands.persona.import.error_no_server_data" };
      }

      const serverId = serverRows[0].server_id;
      const mainTomoriId = serverRows[0].tomori_id;
      const importedLineageId = validatedImportData.persona_lineage_id ?? null;

      // 3. Enforce persona nickname uniqueness within this server (excluding current main persona)
      const conflictingNameRows = await sql<Array<{ tomori_id: number }>>`
        SELECT tomori_id
        FROM tomoris
        WHERE server_id = ${serverId}
          AND tomori_id <> ${mainTomoriId}
          AND lower(btrim(tomori_nickname)) = lower(btrim(${validatedImportData.tomori_nickname}))
        LIMIT 1
      `;
      if (conflictingNameRows.length > 0) {
        return {
          success: false,
          error: `commands.persona.import.error_name_conflict|${validatedImportData.tomori_nickname}`,
        };
      }

      // 4. Format arrays as PostgreSQL array literals for safe insertion
      const attributeArrayLiteral = `{${validatedImportData.attribute_list
        .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
        .join(",")}}`;

      const dialoguesInArrayLiteral = `{${validatedImportData.sample_dialogues_in
        .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
        .join(",")}}`;

      const dialoguesOutArrayLiteral = `{${validatedImportData.sample_dialogues_out
        .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
        .join(",")}}`;

      const triggerWordsArrayLiteral = `{${validatedImportData.trigger_words
        .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
        .join(",")}}`;
      const shouldUseImportedLineage = identityMode === "preserve" && importedLineageId !== null;

      // 5. Build NAI tags array literal for safe insertion
      const naiTagsArrayLiteral = `{${(validatedImportData.nai_tags ?? [])
        .map((item: string) => `"${item.replace(/(["\\])/g, "\\$1")}"`)
        .join(",")}}`;

      // 6. Update tomoris table with personality data, lineage behavior, and NovelAI fields
      try {
        await sql`
          UPDATE tomoris
          SET
            tomori_nickname = ${validatedImportData.tomori_nickname},
            attribute_list = ${attributeArrayLiteral}::text[],
            sample_dialogues_in = ${dialoguesInArrayLiteral}::text[],
            sample_dialogues_out = ${dialoguesOutArrayLiteral}::text[],
            persona_lineage_id = CASE
              WHEN ${identityMode} = 'fork' THEN nextval('persona_lineage_id_seq')
              WHEN ${shouldUseImportedLineage} THEN ${importedLineageId}::bigint
              ELSE persona_lineage_id
            END,
            nai_tags = ${naiTagsArrayLiteral}::text[],
            nai_char_ref_url = ${validatedImportData.nai_char_ref_url ?? null},
            nai_attg_author = ${validatedImportData.nai_attg_author ?? null},
            nai_attg_title = ${validatedImportData.nai_attg_title ?? null},
            nai_attg_tags = ${validatedImportData.nai_attg_tags ?? null},
            nai_attg_genre = ${validatedImportData.nai_attg_genre ?? null},
            nai_attg_stars = ${validatedImportData.nai_attg_stars ?? null}
          WHERE tomori_id = ${mainTomoriId}
        `;
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          return {
            success: false,
            error: `commands.persona.import.error_name_conflict|${validatedImportData.tomori_nickname}`,
          };
        }
        throw error;
      }

      // 7. Update persona-scoped trigger words + optional persona prompt
      const importedPersonaPrompt =
        typeof validatedImportData.persona_prompt === "string" ? validatedImportData.persona_prompt : null;

      await sql`
        INSERT INTO persona_configs (tomori_id, trigger_words, persona_prompt)
        VALUES (
          ${mainTomoriId},
          ${triggerWordsArrayLiteral}::text[],
          ${importedPersonaPrompt}
        )
        ON CONFLICT (tomori_id) DO UPDATE
        SET
          trigger_words = EXCLUDED.trigger_words,
          persona_prompt = EXCLUDED.persona_prompt
      `;

      log.success(`Successfully imported preset for server ${serverDiscId}: ${validatedImportData.tomori_nickname}`);

      return {
        success: true,
        itemsImported: {
          nickname: validatedImportData.tomori_nickname,
          attributeCount: validatedImportData.attribute_list.length,
          dialogueCount: validatedImportData.sample_dialogues_in.length,
          triggerWordCount: validatedImportData.trigger_words.length,
        },
      };
    } catch (error) {
      log.error(`Error importing preset data for server ${serverDiscId}:`, error);
      return { success: false, error: "commands.persona.import.error_import_failed" };
    }
  }

  /**
   * Validates already-extracted preset data, including converted imports and
   * command-added trigger words.
   * Runtime memory env limits are intentionally not applied here; preset import
   * uses schema safety limits.
   */
  validatePresetData(data: unknown): ValidationResult {
    const validated = presetExportDataSchema.safeParse(data);
    if (!validated.success) {
      log.error("Preset import data validation failed:", validated.error);
      return { valid: false, error: "commands.persona.import.error_invalid_format" };
    }

    if (validated.data.sample_dialogues_in.length !== validated.data.sample_dialogues_out.length) {
      return { valid: false, error: "commands.persona.import.error_dialogue_mismatch" };
    }

    return { valid: true, data: validated.data };
  }

  /**
   * Validates and parses a preset import file.
   *
   * @param jsonData - The parsed JSON data from the PNG metadata
   * @returns Validation result with parsed data or error message
   */
  validatePresetFile(jsonData: unknown): ValidationResult {
    // 1. Check if data is an object
    if (typeof jsonData !== "object" || jsonData === null) {
      return { valid: false, error: "commands.persona.import.error_not_json" };
    }

    // 2. Check version compatibility
    const version = (jsonData as { version?: string }).version;
    if (version !== PRESET_EXPORT_VERSION) {
      return {
        valid: false,
        error: `commands.persona.import.error_incompatible_version|${PRESET_EXPORT_VERSION}|${version || "unknown"}`,
      };
    }

    // 3. Check type field
    const type = (jsonData as { type?: string }).type;
    if (type !== "preset") {
      return { valid: false, error: `commands.persona.import.error_invalid_type|${type}` };
    }

    // 4. Validate with Zod schema
    const validated = presetExportSchema.safeParse(jsonData);
    if (!validated.success) {
      log.error("Preset import validation failed:", validated.error);
      return { valid: false, error: "commands.persona.import.error_invalid_format" };
    }

    return this.validatePresetData(validated.data.data);
  }

  // ── SillyTavern conversion public API (from sillyTavernImport.ts) ─────────

  /**
   * Returns true if the given unknown value looks like a SillyTavern character card JSON.
   *
   * @param input - Unknown value to inspect
   */
  looksLikeSillyTavernCardJson(input: unknown): boolean {
    const rootData = this.asObject(input);
    if (!rootData) return false;

    const spec = this.getStringField(rootData, "spec");
    if (spec?.toLowerCase().startsWith("chara_card")) return true;

    const cardData = this.asObject(rootData.data);
    const candidateFields = ["name", "description", "personality", "scenario", "first_mes", "mes_example"];
    const matchedFieldCount = candidateFields.reduce((count, key) => {
      const value = this.pickStringFromCard(cardData, rootData, key);
      return value ? count + 1 : count;
    }, 0);

    if (matchedFieldCount >= 2) return true;
    return (cardData !== null || this.hasOwnKey(rootData, "data")) && matchedFieldCount >= 1;
  }

  /**
   * Converts SillyTavern PNG card metadata to a TomoriBot preset data shape.
   *
   * @param metadata - Parsed SillyTavern card metadata including parsedJson
   * @returns SillyTavernConversionResult with preset data or error
   */
  convertSillyTavernMetadataToPresetData(metadata: SillyTavernCardMetadata): SillyTavernConversionResult {
    return this.convertSillyTavernJsonToPresetData(metadata.parsedJson);
  }

  /**
   * Converts a raw SillyTavern JSON object to a TomoriBot preset data shape.
   *
   * @param input - Raw SillyTavern card JSON (parsed from PNG tEXt chunk)
   * @returns SillyTavernConversionResult with preset data or error
   */
  convertSillyTavernJsonToPresetData(input: unknown): SillyTavernConversionResult {
    const rootData = this.asObject(input);
    if (!rootData) {
      return { success: false, error: "Decoded SillyTavern card data is not a JSON object." };
    }

    if (!this.looksLikeSillyTavernCardJson(rootData)) {
      return { success: false, error: "JSON payload does not look like a SillyTavern character card." };
    }

    const cardData = this.asObject(rootData.data);
    const limits = getMemoryLimits();
    const maxAttributeLength = limits.maxAttributeLength;
    const maxDialogueLength = limits.maxSampleDialogueLength;
    const maxDialoguePairs = Math.max(limits.maxSampleDialogues, 1);
    const maxTriggerWords = Math.max(limits.maxTriggerWords, 1);

    const name =
      this.pickStringFromCard(cardData, rootData, "name") ??
      this.pickStringFromCard(cardData, rootData, "char_name") ??
      "Imported Persona";
    const normalizedName = this.capitalizeFirstLetter(name);

    const sections: ContentSection[] = [];

    const description = this.pickStringFromCard(cardData, rootData, "description");
    if (description) sections.push({ content: description });

    const personality = this.pickStringFromCard(cardData, rootData, "personality");
    if (personality) sections.push({ heading: "Personality", content: personality });

    const scenario = this.pickStringFromCard(cardData, rootData, "scenario");
    if (scenario) sections.push({ heading: "Scenario", content: scenario });

    const systemPrompt = this.pickStringFromCard(cardData, rootData, "system_prompt");
    if (systemPrompt) sections.push({ heading: "System Prompt", content: systemPrompt });

    const postHistoryInstructions = this.pickStringFromCard(cardData, rootData, "post_history_instructions");
    if (postHistoryInstructions) {
      sections.push({ heading: "Post-History Instructions", content: postHistoryInstructions });
    }

    const extensions = this.pickObjectFromCard(cardData, rootData, "extensions");
    const depthPrompt = this.getStringField(this.asObject(extensions?.depth_prompt), "prompt");
    if (depthPrompt) sections.push({ heading: "Depth Prompt", content: depthPrompt });

    const characterBook = this.pickObjectFromCard(cardData, rootData, "character_book");
    sections.push(...this.collectCharacterBookSections(characterBook));

    const attributeList = sections
      .flatMap((section) => this.buildAttributeSectionChunks(section.heading, section.content, maxAttributeLength))
      .slice(0, PRESET_MAX_ATTRIBUTES);

    const mesExample = this.pickStringFromCard(cardData, rootData, "mes_example");
    const firstMessage = this.pickStringFromCard(cardData, rootData, "first_mes");
    const alternateGreetings = this.pickStringArrayFromCard(cardData, rootData, "alternate_greetings");

    const dialoguePairs: DialoguePair[] = [];
    dialoguePairs.push(...this.parseMesExamplePairs(mesExample, maxDialogueLength));
    dialoguePairs.push(...this.buildGreetingPairs(firstMessage, alternateGreetings, maxDialogueLength));

    const cappedDialoguePairs = dialoguePairs.slice(0, maxDialoguePairs);
    const triggerWords = this.generateDefaultTriggerWords(normalizedName, maxTriggerWords);

    return {
      success: true,
      data: {
        tomori_nickname: normalizedName,
        attribute_list: attributeList,
        sample_dialogues_in: cappedDialoguePairs.map((pair) => pair.input),
        sample_dialogues_out: cappedDialoguePairs.map((pair) => pair.output),
        trigger_words: triggerWords,
      },
    };
  }
}

export const presetRepository = new PresetRepository();

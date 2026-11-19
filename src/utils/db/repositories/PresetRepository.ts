import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { convertCharacterBook, extractCharacterBook } from "@/modules/lorebooks/imports";
import { LOREBOOK_ENTRIES_PER_SCOPE_MAX, lorebookEntryToInput } from "@/modules/lorebooks/db/types";
import { sanitizeSillyTavernText } from "@/utils/text/sillyTavernText";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { sql } from "@/utils/db/client";
import type { StPresetRow, StPresetNodeRow, TomoriPresetRow } from "@/types/db/schema";
import {
  PRESET_EXPORT_VERSION,
  PRESET_MAX_ATTRIBUTES,
  UNPAIRED_SAMPLE_DIALOGUE_SENTINEL,
  buildPrivateAttributePublicFlags,
  presetExportSchema,
  presetExportDataSchema,
  type PresetExport,
  type ExportResult,
  type ImportResult,
  type ValidationResult,
  type PresetExportData,
  type PresetImportMode,
} from "@/types/preset/presetExport";
import { PERSONA_NICKNAME_MAX_LENGTH } from "@/types/personaNaming";
import { getDiscordTextLength } from "@/utils/text/discordTextLimits";
import { log } from "@/utils/misc/logger";
import { invalidateStPresetCache } from "@/utils/cache/stPresetCache";
import { validatePersonaConfigFields } from "@/utils/db/sqlSecurity";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import type { SillyTavernCardMetadata } from "@/utils/image/pngMetadata";
import { dedupeTriggerWords, normalizeTriggerWord, stripSurroundingTriggerQuotes } from "@/utils/text/triggerWords";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { getBaseTriggerWords } from "@/utils/text/localizer";
import { EMPTY_PERSONA_NAMING_CONFIG } from "@/types/personaNaming";
import { userNamingRepository } from "@/utils/db/repositories/UserNamingRepository";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  DEFAULT_NATURAL_NUDGE_TALKATIVENESS,
  personaAuthoredIdleNudgesSchema,
  sameNaturalNudgeInterests,
  type PersonaAuthoredIdleNudge,
} from "@/modules/natural-nudges/db/types";

export type StPresetsReadResult = { status: "fresh"; presets: StPresetRow[] } | { status: "unavailable"; presets: [] };

export interface StPresetNodeCounts {
  total: number;
  enabled: number;
}

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

type SillyTavernConversionResult =
  | {
      success: true;
      data: PresetExportData;
    }
  | {
      success: false;
      error: string;
    };

const CONTINUATION_MARKER = " [truncated]";

function normalizeLineageId(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Field-by-field comparison is required because Postgres JSONB reorders object keys, which would make raw JSON
// comparison report false customizations.
function samePersonaAuthoredIdleNudges(cardList: readonly PersonaAuthoredIdleNudge[], stored: unknown): boolean {
  const card = personaAuthoredIdleNudgesSchema.safeParse(cardList);
  const preset = personaAuthoredIdleNudgesSchema.safeParse(stored);
  if (!card.success || !preset.success) return false;
  const key = (list: readonly PersonaAuthoredIdleNudge[]) =>
    JSON.stringify(
      list.map((nudge) => [
        nudge.id,
        nudge.category,
        nudge.title,
        nudge.brief,
        nudge.agenda_hint,
        nudge.prerequisites,
        nudge.recommended_tools,
      ]),
    );
  return key(card.data) === key(preset.data);
}

function normalizePresetPublicFlags(preset: TomoriPresetRow): boolean[] {
  return preset.preset_attribute_list.map(
    (_attribute, index) => preset.preset_attribute_public_flags?.[index] ?? false,
  );
}

function resolveOfficialPresetTriggerWords(preset: TomoriPresetRow): string[] {
  const presetTriggerWords = dedupeTriggerWords(preset.preset_trigger_words ?? [], { lowercase: false });
  if (presetTriggerWords.length > 0) {
    return presetTriggerWords;
  }
  return dedupeTriggerWords(getBaseTriggerWords(preset.preset_language), { lowercase: false });
}

function resolveOfficialPresetPrompt(preset: TomoriPresetRow): string | null {
  const trimmed = preset.persona_preset_desc.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

class PresetRepository {
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
    const sanitized = sanitizeSillyTavernText(content);
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
        content: sanitizeSillyTavernText(rawContent),
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
    const cleaned = sanitizeSillyTavernText(mesExample);
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
      .map((text) => sanitizeSillyTavernText(text))
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
      const normalized = normalizeTriggerWord(value);
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

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505"
    );
  }

  async findMatchingOfficialPresetForImport(data: PresetExportData): Promise<TomoriPresetRow | null> {
    const presetLineageId = normalizeLineageId(data.preset_lineage_id);
    if (presetLineageId === null) {
      return null;
    }

    if (
      (data.lorebook_entries?.length ?? 0) > 0 ||
      (data.physical_appearance_tags?.length ?? 0) > 0 ||
      data.char_ref_url ||
      data.nai_attg_author ||
      data.nai_attg_title ||
      data.nai_attg_tags ||
      data.nai_attg_genre ||
      data.nai_attg_stars
    ) {
      return null;
    }

    const presets = await sql<TomoriPresetRow[]>`
      SELECT *
      FROM persona_presets
      WHERE preset_lineage_id = ${presetLineageId}
      ORDER BY preset_language ASC, persona_preset_id ASC
    `;

    const expectedPublicFlags = data.attribute_public_flags ?? buildPrivateAttributePublicFlags(data.attribute_list);
    const expectedPrompt = normalizeNullableText(data.persona_prompt);
    const expectedTriggers = dedupeTriggerWords(data.trigger_words, { lowercase: false });
    const expectedNamingConfig = data.naming_config ?? EMPTY_PERSONA_NAMING_CONFIG;

    return (
      presets.find((preset) => {
        return (
          arraysEqual(preset.preset_attribute_list, data.attribute_list) &&
          arraysEqual(normalizePresetPublicFlags(preset), expectedPublicFlags) &&
          arraysEqual(preset.preset_sample_dialogues_in, data.sample_dialogues_in) &&
          arraysEqual(preset.preset_sample_dialogues_out, data.sample_dialogues_out) &&
          arraysEqual(resolveOfficialPresetTriggerWords(preset), expectedTriggers) &&
          resolveOfficialPresetPrompt(preset) === expectedPrompt &&
          JSON.stringify(preset.preset_naming_config) === JSON.stringify(expectedNamingConfig) &&
          // Cards from before Natural Nudges carry none of these fields, so their absence still matches.
          (data.natural_nudge_talkativeness === undefined ||
            data.natural_nudge_talkativeness === preset.natural_nudge_talkativeness) &&
          (data.natural_nudge_interests === undefined ||
            sameNaturalNudgeInterests(data.natural_nudge_interests, preset.natural_nudge_interests)) &&
          (data.natural_nudge_idle_nudges === undefined ||
            samePersonaAuthoredIdleNudges(data.natural_nudge_idle_nudges, preset.natural_nudge_idle_nudges))
        );
      }) ?? null
    );
  }

  private async allocatePersonaLineageId(): Promise<number> {
    const [row] = await sql<Array<{ lineage_id: number | string | bigint }>>`
      SELECT nextval('persona_lineage_id_seq') AS lineage_id
    `;

    return Number(row.lineage_id);
  }

  private async loadPointerPresetForPersonaRow(personaRow: Record<string, unknown>): Promise<TomoriPresetRow | null> {
    if (personaRow.is_pointer !== true) {
      return null;
    }

    const presetLineageId = normalizeLineageId(personaRow.preset_lineage_id);
    const presetLanguage = typeof personaRow.preset_language === "string" ? personaRow.preset_language : null;
    if (presetLineageId === null || !presetLanguage) {
      return null;
    }

    const [preset] = await sql<TomoriPresetRow[]>`
      SELECT *
      FROM persona_presets
      WHERE preset_lineage_id = ${presetLineageId}
        AND preset_language = ${presetLanguage}
      LIMIT 1
    `;

    return preset ?? null;
  }

  async insertPresetWithNodes(
    serverId: number,
    presetName: string,
    rawJson: unknown,
    nodes: Omit<StPresetNodeRow, "node_id" | "preset_id">[],
    description?: string | null,
  ): Promise<StPresetRow | null> {
    try {
      // Use a transaction to ensure atomicity (preset + all nodes or nothing)
      const result = await sql.begin(async (tx) => {
        // Deleting the old preset first is safe because its nodes are covered by
        // the st_preset_nodes foreign-key cascade.
        await tx`
          DELETE FROM st_presets
          WHERE server_id = ${serverId} AND preset_name = ${presetName}
        `;

        // Insert the preset metadata + raw JSON
        const [preset] = await tx`
          INSERT INTO st_presets (server_id, preset_name, raw_json, description)
          VALUES (${serverId}, ${presetName}, ${JSON.stringify(rawJson)}, ${description ?? null})
          RETURNING *
        `;

        // Insert each node with a reference to the new preset_id
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

  async loadPresetsForServerResult(serverId: number): Promise<StPresetsReadResult> {
    try {
      const rows = await sql`
        SELECT preset_id, server_id, preset_name, is_active, description, created_at, updated_at
        FROM st_presets
        WHERE server_id = ${serverId}
        ORDER BY created_at ASC
      `;
      return { status: "fresh", presets: rows as StPresetRow[] };
    } catch (error) {
      log.error(`[PresetRepository] Failed to load presets for server ${serverId}`, error);
      return { status: "unavailable", presets: [] };
    }
  }

  async loadPresetsForServer(serverId: number): Promise<StPresetRow[]> {
    const result = await this.loadPresetsForServerResult(serverId);
    return result.presets;
  }

  async loadPresetByIdForServer(presetId: number, serverId: number): Promise<StPresetRow | null> {
    try {
      const [row] = await sql`
        SELECT * FROM st_presets
        WHERE preset_id = ${presetId} AND server_id = ${serverId}
      `;
      return (row as StPresetRow) ?? null;
    } catch (error) {
      log.error(`[PresetRepository] Failed to load preset ${presetId} for server ${serverId}`, error);
      return null;
    }
  }

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

  async countToggleableNodesForServer(presetId: number, serverId: number): Promise<StPresetNodeCounts> {
    try {
      const [row] = await sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(CASE WHEN n.is_enabled = true THEN 1 END)::int AS enabled
        FROM st_preset_nodes n
        JOIN st_presets p ON p.preset_id = n.preset_id
        WHERE n.preset_id = ${presetId}
          AND p.server_id = ${serverId}
          AND n.is_marker = false
      `;
      return {
        total: Number(row?.total ?? 0),
        enabled: Number(row?.enabled ?? 0),
      };
    } catch (error) {
      log.error(
        `[PresetRepository] Failed to count toggleable nodes for preset ${presetId} on server ${serverId}`,
        error,
      );
      return { total: 0, enabled: 0 };
    }
  }

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

  async updateNodeEnabledStates(
    presetId: number,
    enabledMap: Map<string, boolean>,
    serverId: number,
  ): Promise<boolean> {
    try {
      const success = await sql.begin(async (tx) => {
        const [preset] = await tx<Array<{ preset_id: number }>>`
          SELECT preset_id FROM st_presets
          WHERE preset_id = ${presetId} AND server_id = ${serverId}
        `;
        if (!preset) {
          return false;
        }

        for (const [identifier, isEnabled] of enabledMap) {
          await tx`
            UPDATE st_preset_nodes
            SET is_enabled = ${isEnabled}
            WHERE preset_id = ${presetId} AND identifier = ${identifier}
          `;
        }
        return true;
      });

      if (success) {
        log.info(`[PresetRepository] Updated ${enabledMap.size} node states for preset ${presetId}`);
        invalidateStPresetCache(serverId);
      }
      return success;
    } catch (error) {
      log.error(`[PresetRepository] Failed to update node states for preset ${presetId}`, error);
      return false;
    }
  }

  async deletePreset(presetId: number, serverId: number): Promise<boolean> {
    try {
      const rows = await sql<Array<{ preset_id: number }>>`
        DELETE FROM st_presets
        WHERE preset_id = ${presetId} AND server_id = ${serverId}
        RETURNING preset_id
      `;
      const deleted = rows.length > 0;
      if (deleted) {
        log.success(`[PresetRepository] Deleted preset ${presetId} for server ${serverId}`);
        invalidateStPresetCache(serverId);
      }
      return deleted;
    } catch (error) {
      log.error(`[PresetRepository] Failed to delete preset ${presetId} for server ${serverId}`, error);
      return false;
    }
  }

  async setActivePreset(serverId: number, presetId: number): Promise<boolean> {
    try {
      const success = await sql.begin(async (tx) => {
        const [target] = await tx<Array<{ preset_id: number }>>`
          SELECT preset_id FROM st_presets
          WHERE preset_id = ${presetId} AND server_id = ${serverId}
        `;
        if (!target) {
          return false;
        }

        await tx`
          UPDATE st_presets SET is_active = false
          WHERE server_id = ${serverId}
        `;
        await tx`
          UPDATE st_presets SET is_active = true
          WHERE preset_id = ${presetId} AND server_id = ${serverId}
        `;
        return true;
      });

      if (success) {
        log.success(`[PresetRepository] Activated preset ${presetId} for server ${serverId}`);
        invalidateStPresetCache(serverId);
      }
      return success;
    } catch (error) {
      log.error(`[PresetRepository] Failed to activate preset ${presetId} for server ${serverId}`, error);
      return false;
    }
  }

  async deactivateAllPresets(serverId: number): Promise<boolean> {
    try {
      await sql`
        UPDATE st_presets SET is_active = false
        WHERE server_id = ${serverId}
      `;
      log.success(`[PresetRepository] Deactivated all presets for server ${serverId}`);
      invalidateStPresetCache(serverId);
      return true;
    } catch (error) {
      log.error(`[PresetRepository] Failed to deactivate all presets for server ${serverId}`, error);
      return false;
    }
  }

  async exportPresetData(serverDiscId: string, targetPersonaId?: number): Promise<ExportResult> {
    try {
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

      // Query target persona row (explicit selection) or default main persona
      const personaRows =
        typeof targetPersonaId === "number"
          ? await sql`
              SELECT
                p.persona_id, p.persona_nickname, p.persona_lineage_id,
                p.attribute_list, p.sample_dialogues_in, p.sample_dialogues_out,
                p.is_alter, p.is_pointer, p.preset_lineage_id, p.preset_language, p.is_nsfw,
                pvc.speech_voice_design_prompt, pvc.voice_source_priority,
                pic.physical_appearance_tags, pic.char_ref_url,
                ptc.nai_attg_author, ptc.nai_attg_title, ptc.nai_attg_tags, ptc.nai_attg_genre, ptc.nai_attg_stars
              FROM personas p
              LEFT JOIN persona_voice_configs pvc ON pvc.persona_id = p.persona_id
              LEFT JOIN persona_imagegen_configs pic ON pic.persona_id = p.persona_id
              LEFT JOIN persona_textgen_configs ptc ON ptc.persona_id = p.persona_id
              WHERE p.server_id = ${serverId}
                AND p.persona_id = ${targetPersonaId}
              LIMIT 1
            `
          : await sql`
              SELECT
                p.persona_id, p.persona_nickname, p.persona_lineage_id,
                p.attribute_list, p.sample_dialogues_in, p.sample_dialogues_out,
                p.is_alter, p.is_pointer, p.preset_lineage_id, p.preset_language, p.is_nsfw,
                pvc.speech_voice_design_prompt, pvc.voice_source_priority,
                pic.physical_appearance_tags, pic.char_ref_url,
                ptc.nai_attg_author, ptc.nai_attg_title, ptc.nai_attg_tags, ptc.nai_attg_genre, ptc.nai_attg_stars
              FROM personas p
              LEFT JOIN persona_voice_configs pvc ON pvc.persona_id = p.persona_id
              LEFT JOIN persona_imagegen_configs pic ON pic.persona_id = p.persona_id
              LEFT JOIN persona_textgen_configs ptc ON ptc.persona_id = p.persona_id
              WHERE p.server_id = ${serverId}
                AND p.is_alter = false
              ORDER BY p.updated_at DESC NULLS LAST, p.persona_id DESC
              LIMIT 1
            `;

      if (!personaRows.length) {
        return { success: false, error: "commands.persona.export.error_no_preset_data" };
      }

      const presetData = personaRows[0];
      const pointerPreset = await this.loadPointerPresetForPersonaRow(presetData as Record<string, unknown>);
      const nudgeConfig = (await naturalNudgeRepository.loadPersonaConfigs([presetData.persona_id as number])).get(
        presetData.persona_id as number,
      );
      if (typeof targetPersonaId !== "number") {
        const mainCountRows = await sql`
          SELECT COUNT(*)::int AS count
          FROM personas
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

      let triggerWords: string[] | null = null;
      let personaPrompt: string | null = null;
      const personaConfigRows = await sql`
        SELECT trigger_words, persona_prompt, preserve_preset_identity
        FROM persona_configs
        WHERE persona_id = ${presetData.persona_id}
        LIMIT 1
      `;
      if (personaConfigRows.length) {
        triggerWords = personaConfigRows[0].trigger_words ?? null;
        personaPrompt = personaConfigRows[0].persona_prompt ?? null;
      }

      const preserveIdentity = personaConfigRows[0]?.preserve_preset_identity === true;
      if (pointerPreset) {
        if (!preserveIdentity) triggerWords = resolveOfficialPresetTriggerWords(pointerPreset);
        personaPrompt = resolveOfficialPresetPrompt(pointerPreset);
      }

      const attributeRows = await sql<Array<{ attribute_text: string; is_public: boolean }>>`
        SELECT attribute_text, is_public
        FROM persona_attributes
        WHERE persona_id = ${presetData.persona_id}
        ORDER BY attribute_order
      `;
      const exportedAttributes = pointerPreset
        ? pointerPreset.preset_attribute_list
        : attributeRows.length > 0
          ? attributeRows.map((row) => row.attribute_text)
          : ((presetData.attribute_list as string[] | undefined) ?? []);
      const exportedPublicFlags = pointerPreset
        ? normalizePresetPublicFlags(pointerPreset)
        : attributeRows.length > 0
          ? attributeRows.map((row) => row.is_public)
          : exportedAttributes.map(() => false);
      const exportedSampleDialoguesIn = [
        ...(pointerPreset
          ? pointerPreset.preset_sample_dialogues_in
          : ((presetData.sample_dialogues_in as string[] | undefined) ?? [])),
      ];
      const exportedSampleDialoguesOut = pointerPreset
        ? pointerPreset.preset_sample_dialogues_out
        : ((presetData.sample_dialogues_out as string[] | undefined) ?? []);
      while (exportedSampleDialoguesIn.length < exportedSampleDialoguesOut.length) {
        exportedSampleDialoguesIn.push(UNPAIRED_SAMPLE_DIALOGUE_SENTINEL);
      }
      const exportedPresetLineageId = pointerPreset
        ? normalizeLineageId(pointerPreset.preset_lineage_id)
        : normalizeLineageId(presetData.preset_lineage_id);
      const namingConfigs =
        pointerPreset && !preserveIdentity
          ? null
          : await userNamingRepository.loadPersonaConfigs([presetData.persona_id as number]);
      const exportedNamingConfig =
        pointerPreset && !preserveIdentity
          ? pointerPreset.preset_naming_config
          : (namingConfigs?.get(presetData.persona_id as number) ?? EMPTY_PERSONA_NAMING_CONFIG);

      const lore = await lorebookRepository.listScope(serverId, lineageId);
      if (lore.status !== "fresh") return { success: false, error: "commands.persona.export.error_export_failed" };

      // Build export object with metadata (includes NovelAI persona fields)
      const exportData: PresetExport = {
        version: PRESET_EXPORT_VERSION,
        type: "preset",
        exported_at: new Date().toISOString(),
        data: {
          lorebook_entries: lore.entries.map(lorebookEntryToInput),
          tomori_nickname: presetData.persona_nickname,
          attribute_list: exportedAttributes,
          attribute_public_flags: exportedPublicFlags,
          sample_dialogues_in: exportedSampleDialoguesIn,
          sample_dialogues_out: exportedSampleDialoguesOut,
          trigger_words: triggerWords || [],
          persona_prompt: personaPrompt,
          speech_voice_design_prompt: presetData.speech_voice_design_prompt ?? null,
          voice_source_priority: presetData.voice_source_priority ?? "design",
          naming_config: exportedNamingConfig,
          persona_lineage_id: lineageId,
          ...(exportedPresetLineageId !== null ? { preset_lineage_id: exportedPresetLineageId } : {}),
          physical_appearance_tags: presetData.physical_appearance_tags || [],
          char_ref_url: presetData.char_ref_url ?? null,
          nai_attg_author: presetData.nai_attg_author ?? null,
          nai_attg_title: presetData.nai_attg_title ?? null,
          nai_attg_tags: presetData.nai_attg_tags ?? null,
          nai_attg_genre: presetData.nai_attg_genre ?? null,
          nai_attg_stars: presetData.nai_attg_stars ?? null,
          is_nsfw: pointerPreset ? pointerPreset.is_nsfw : presetData.is_nsfw === true,
          ...(nudgeConfig
            ? {
                natural_nudge_interests: nudgeConfig.interests,
                natural_nudge_talkativeness: nudgeConfig.talkativeness,
                natural_nudge_idle_nudges: nudgeConfig.idle_nudges,
              }
            : {}),
        },
      };

      const validated = this.validatePresetFile(exportData);
      if (!validated.valid || !validated.data) {
        log.error(`Preset export validation failed for server ${serverDiscId}:`, validated.error);
        return { success: false, error: "commands.persona.export.error_validation_failed" };
      }

      log.success(
        `Successfully exported preset for server ${serverDiscId}, persona ${presetData.persona_id}: ${presetData.persona_nickname}`,
      );

      return { success: true, data: { ...exportData, data: validated.data } };
    } catch (error) {
      log.error(`Error exporting preset data for server ${serverDiscId}:`, error);
      return { success: false, error: "commands.persona.export.error_export_failed" };
    }
  }

  async importPresetData(
    serverDiscId: string,
    importData: PresetExportData,
    identityMode: "preserve" | "fork" = "preserve",
    importMode: PresetImportMode = "card",
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
      const matchingOfficialPreset =
        importMode === "bundle" ? null : await this.findMatchingOfficialPresetForImport(validatedImportData);

      try {
        validatePersonaConfigFields(["trigger_words", "persona_prompt"]);
      } catch (error) {
        log.error("Persona config field validation failed during preset import:", error);
        return { success: false, error: "commands.persona.import.error_invalid_config" };
      }

      // Get internal server ID and tomori ID (main persona only)
      const serverRows = await sql`
        SELECT s.server_id, t.persona_id, t.persona_lineage_id
        FROM servers s
        JOIN personas t ON s.server_id = t.server_id
        WHERE s.server_disc_id = ${serverDiscId}
        AND t.is_alter = false
        LIMIT 1
      `;

      if (!serverRows.length) {
        return { success: false, error: "commands.persona.import.error_no_server_data" };
      }

      const serverId = serverRows[0].server_id;
      const mainTomoriId = serverRows[0].persona_id;
      const importedLineageId = validatedImportData.persona_lineage_id ?? null;
      const importedPresetLineageId = normalizeLineageId(validatedImportData.preset_lineage_id);

      // Enforce persona nickname uniqueness within this server (excluding current main persona)
      const conflictingNameRows = await sql<Array<{ persona_id: number }>>`
        SELECT persona_id
        FROM personas
        WHERE server_id = ${serverId}
          AND persona_id <> ${mainTomoriId}
          AND lower(btrim(persona_nickname)) = lower(btrim(${validatedImportData.tomori_nickname}))
        LIMIT 1
      `;
      if (conflictingNameRows.length > 0) {
        return {
          success: false,
          error: `commands.persona.import.error_name_conflict|${validatedImportData.tomori_nickname}`,
        };
      }

      if (matchingOfficialPreset) {
        const pointerLineageId = normalizeLineageId(matchingOfficialPreset.preset_lineage_id);
        if (pointerLineageId === null) {
          return { success: false, error: "commands.persona.import.error_import_failed" };
        }

        const targetPersonaLineageId =
          identityMode === "fork"
            ? await this.allocatePersonaLineageId()
            : (normalizeLineageId(importedLineageId) ?? pointerLineageId);
        const pointerRow = await personaRepository.applyPresetPointerToPersona({
          personaId: mainTomoriId,
          nickname: validatedImportData.tomori_nickname,
          preset: matchingOfficialPreset,
          personaLineageId: targetPersonaLineageId,
          triggerWords: resolveOfficialPresetTriggerWords(matchingOfficialPreset),
          personaPrompt: resolveOfficialPresetPrompt(matchingOfficialPreset),
        });

        if (!pointerRow) {
          return { success: false, error: "commands.persona.import.error_import_failed" };
        }
        if (
          validatedImportData.lorebook_entries !== undefined &&
          (await lorebookRepository.replaceLineageEntries(
            serverId,
            targetPersonaLineageId,
            validatedImportData.lorebook_entries,
          )) !== "replaced"
        ) {
          return { success: false, error: "commands.persona.import.error_import_failed" };
        }

        if (
          !(await personaRepository.setVoiceConfig(
            mainTomoriId,
            {
              speech_voice_design_prompt: validatedImportData.speech_voice_design_prompt ?? null,
              voice_source_priority: validatedImportData.voice_source_priority ?? "design",
              speech_voice_sample_id: null,
              speech_voice_id: null,
              speech_voice_name: null,
            },
            { materialize: Boolean(validatedImportData.speech_voice_design_prompt) },
          ))
        )
          return { success: false, error: "commands.persona.import.error_import_failed" };
        invalidateTomoriStateCache(serverDiscId);
        await sql`UPDATE speech_voice_bindings SET pending_delete = true WHERE persona_id = ${mainTomoriId}`;
        log.success(
          `Successfully imported preset pointer for server ${serverDiscId}: ${validatedImportData.tomori_nickname}`,
        );

        return {
          success: true,
          itemsImported: {
            nickname: validatedImportData.tomori_nickname,
            attributeCount: validatedImportData.attribute_list.length,
            dialogueCount: validatedImportData.sample_dialogues_in.length,
            triggerWordCount: validatedImportData.trigger_words.length,
          },
          mainPersonaIsPointer: !validatedImportData.speech_voice_design_prompt,
        };
      }

      // Format arrays as PostgreSQL array literals for safe insertion
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

      let resolvedLineageId: number | null = null;
      try {
        const [updated] = await sql`
          UPDATE personas
          SET
            persona_nickname = ${validatedImportData.tomori_nickname},
            attribute_list = ${attributeArrayLiteral}::text[],
            sample_dialogues_in = ${dialoguesInArrayLiteral}::text[],
            sample_dialogues_out = ${dialoguesOutArrayLiteral}::text[],
            persona_lineage_id = CASE
              WHEN ${identityMode} = 'fork' THEN nextval('persona_lineage_id_seq')
              WHEN ${shouldUseImportedLineage} THEN ${importedLineageId}::bigint
              ELSE persona_lineage_id
            END,
            is_pointer = false,
            preset_lineage_id = ${importedPresetLineageId},
            preset_language = NULL,
            is_nsfw = ${validatedImportData.is_nsfw === true}
          WHERE persona_id = ${mainTomoriId}
          RETURNING persona_lineage_id
        `;
        resolvedLineageId = normalizeLineageId(updated?.persona_lineage_id);
        invalidateTomoriStateCache(serverDiscId);
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          return {
            success: false,
            error: `commands.persona.import.error_name_conflict|${validatedImportData.tomori_nickname}`,
          };
        }
        throw error;
      }

      const imageTagsUpdated = await personaRepository.setPhysicalAppearanceTags(
        mainTomoriId,
        validatedImportData.physical_appearance_tags ?? [],
      );
      const charRefUpdated = await personaRepository.setCharRef(mainTomoriId, validatedImportData.char_ref_url ?? null);
      const attgUpdated = await personaRepository.setNaiAttg(mainTomoriId, {
        nai_attg_author: validatedImportData.nai_attg_author ?? null,
        nai_attg_title: validatedImportData.nai_attg_title ?? null,
        nai_attg_tags: validatedImportData.nai_attg_tags ?? null,
        nai_attg_genre: validatedImportData.nai_attg_genre ?? null,
        nai_attg_stars: validatedImportData.nai_attg_stars ?? null,
      });

      if (!imageTagsUpdated || !charRefUpdated || !attgUpdated) {
        return { success: false, error: "commands.persona.import.error_import_failed" };
      }

      const attributesUpdated = await personaRepository.replaceAttributes(
        mainTomoriId,
        validatedImportData.attribute_list,
        validatedImportData.attribute_public_flags,
      );
      if (!attributesUpdated) {
        return { success: false, error: "commands.persona.import.error_import_failed" };
      }

      const importedPersonaPrompt =
        typeof validatedImportData.persona_prompt === "string" ? validatedImportData.persona_prompt : null;

      await sql`
        INSERT INTO persona_configs (persona_id, trigger_words, persona_prompt)
        VALUES (
          ${mainTomoriId},
          ${triggerWordsArrayLiteral}::text[],
          ${importedPersonaPrompt}
        )
        ON CONFLICT (persona_id) DO UPDATE
        SET
          trigger_words = EXCLUDED.trigger_words,
          persona_prompt = EXCLUDED.persona_prompt
      `;
      await userNamingRepository.savePersonaConfig(
        mainTomoriId,
        validatedImportData.naming_config ?? EMPTY_PERSONA_NAMING_CONFIG,
      );
      if (
        !(await naturalNudgeRepository.savePersonaConfig(mainTomoriId, {
          talkativeness: validatedImportData.natural_nudge_talkativeness ?? DEFAULT_NATURAL_NUDGE_TALKATIVENESS,
          interests: validatedImportData.natural_nudge_interests ?? [],
        }))
      )
        return { success: false, error: "commands.persona.import.error_import_failed" };

      if (
        (await naturalNudgeRepository.replacePersonaIdleNudges(
          mainTomoriId,
          validatedImportData.natural_nudge_idle_nudges ?? [],
        )) !== "success"
      )
        return { success: false, error: "commands.persona.import.error_import_failed" };

      if (
        !(await personaRepository.setVoiceConfig(mainTomoriId, {
          speech_voice_design_prompt: validatedImportData.speech_voice_design_prompt ?? null,
          voice_source_priority: validatedImportData.voice_source_priority ?? "design",
          speech_voice_sample_id: null,
          speech_voice_id: null,
          speech_voice_name: null,
        }))
      )
        return { success: false, error: "commands.persona.import.error_import_failed" };
      if (
        validatedImportData.lorebook_entries !== undefined &&
        (resolvedLineageId === null ||
          (await lorebookRepository.replaceLineageEntries(
            serverId,
            resolvedLineageId,
            validatedImportData.lorebook_entries,
          )) !== "replaced")
      ) {
        return { success: false, error: "commands.persona.import.error_import_failed" };
      }
      invalidateTomoriStateCache(serverDiscId);
      await sql`UPDATE speech_voice_bindings SET pending_delete = true WHERE persona_id = ${mainTomoriId}`;
      log.success(`Successfully imported preset for server ${serverDiscId}: ${validatedImportData.tomori_nickname}`);

      return {
        success: true,
        itemsImported: {
          nickname: validatedImportData.tomori_nickname,
          attributeCount: validatedImportData.attribute_list.length,
          dialogueCount: validatedImportData.sample_dialogues_in.length,
          triggerWordCount: validatedImportData.trigger_words.length,
        },
        mainPersonaIsPointer: false,
      };
    } catch (error) {
      log.error(`Error importing preset data for server ${serverDiscId}:`, error);
      return { success: false, error: "commands.persona.import.error_import_failed" };
    }
  }

  // Runtime memory env limits are intentionally omitted here because converted imports and command-added trigger
  // words use schema safety limits.
  validatePresetData(data: unknown): ValidationResult {
    const validated = presetExportDataSchema.safeParse(data);
    if (!validated.success) {
      log.error("Preset import data validation failed:", validated.error);
      return { valid: false, error: "commands.persona.import.error_invalid_format" };
    }

    const normalizedData: PresetExportData = {
      ...validated.data,
      trigger_words: dedupeTriggerWords(validated.data.trigger_words, { lowercase: false }),
      attribute_public_flags:
        validated.data.attribute_public_flags ?? buildPrivateAttributePublicFlags(validated.data.attribute_list),
    };

    if (normalizedData.attribute_public_flags?.length !== normalizedData.attribute_list.length) {
      return { valid: false, error: "commands.persona.import.error_attribute_flags_mismatch" };
    }

    if (normalizedData.sample_dialogues_in.length !== normalizedData.sample_dialogues_out.length) {
      return { valid: false, error: "commands.persona.import.error_dialogue_mismatch" };
    }

    if (getDiscordTextLength(normalizedData.tomori_nickname) > PERSONA_NICKNAME_MAX_LENGTH) {
      return {
        valid: false,
        error: `commands.persona.import.error_nickname_too_long|${PERSONA_NICKNAME_MAX_LENGTH}`,
      };
    }

    return { valid: true, data: normalizedData };
  }

  validatePresetFile(jsonData: unknown): ValidationResult {
    if (typeof jsonData !== "object" || jsonData === null) {
      return { valid: false, error: "commands.persona.import.error_not_json" };
    }

    // Check version compatibility
    const version = (jsonData as { version?: string }).version;
    if (version !== PRESET_EXPORT_VERSION) {
      return {
        valid: false,
        error: `commands.persona.import.error_incompatible_version|${PRESET_EXPORT_VERSION}|${version || "unknown"}`,
      };
    }

    const type = (jsonData as { type?: string }).type;
    if (type !== "preset") {
      return { valid: false, error: `commands.persona.import.error_invalid_type|${type}` };
    }

    const validated = presetExportSchema.safeParse(jsonData);
    if (!validated.success) {
      log.error("Preset import validation failed:", validated.error);
      return { valid: false, error: "commands.persona.import.error_invalid_format" };
    }

    return this.validatePresetData(validated.data.data);
  }

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

  convertSillyTavernMetadataToPresetData(metadata: SillyTavernCardMetadata): SillyTavernConversionResult {
    return this.convertSillyTavernJsonToPresetData(metadata.parsedJson);
  }

  convertPresetDataToSillyTavernCard(preset: PresetExportData) {
    const convertMacros = (text: string): string =>
      text.replace(/\{\{(user|bot|char)\}\}|(?<!\{)\{(user|bot|char)\}(?!\})/g, (_match, double, single) =>
        (double ?? single) === "user" ? "{{user}}" : "{{char}}",
      );

    return {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: preset.tomori_nickname,
        description: preset.attribute_list.map(convertMacros).join("\n\n"),
        personality: "",
        scenario: "",
        first_mes: "",
        mes_example: preset.sample_dialogues_out
          .map((output, index) => {
            const input = preset.sample_dialogues_in[index];
            const userTurn =
              input && input !== UNPAIRED_SAMPLE_DIALOGUE_SENTINEL ? `{{user}}: ${convertMacros(input)}\n` : "";
            return `<START>\n${userTurn}{{char}}: ${convertMacros(output)}`;
          })
          .join("\n\n"),
        creator_notes: "",
        system_prompt: convertMacros(preset.persona_prompt ?? ""),
        post_history_instructions: "",
        alternate_greetings: [],
        tags: [],
        creator: "",
        character_version: "",
        extensions: {},
        ...(preset.lorebook_entries !== undefined
          ? {
              character_book: {
                name: preset.tomori_nickname,
                extensions: {},
                entries: preset.lorebook_entries.map((entry, index) => ({
                  id: index,
                  keys: entry.keys,
                  secondary_keys: entry.secondary_keys,
                  content: convertMacros(entry.content),
                  comment: entry.title,
                  enabled: entry.enabled,
                  insertion_order: entry.insertion_order,
                  constant: entry.constant,
                  selective: entry.secondary_keys.length > 0,
                  position: entry.placement === 1 ? "after_char" : "before_char",
                  extensions: {
                    selectiveLogic: entry.selective_logic,
                    probability: entry.trigger_chance,
                    useProbability: true,
                    scan_depth: entry.scan_depth,
                    position: entry.placement,
                  },
                })),
              },
            }
          : {}),
      },
    };
  }

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
    const normalizedName = this.capitalizeFirstLetter(stripSurroundingTriggerQuotes(name));

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

    const characterBook = extractCharacterBook(rootData);
    const lorebookConversion = characterBook ? convertCharacterBook(characterBook) : null;
    const lorebookReport = lorebookConversion?.report;
    if (lorebookReport && (lorebookReport.unsupportedKeys || lorebookReport.skippedEntries)) {
      log.warn("Character Book import has unsupported activations", undefined, {
        metadata: {
          unsupportedKeys: lorebookReport.unsupportedKeys,
          skippedEntries: lorebookReport.skippedEntries,
        },
      });
    }
    const lorebookEntries = lorebookConversion?.entries.slice(0, LOREBOOK_ENTRIES_PER_SCOPE_MAX);

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
        ...(lorebookEntries !== undefined ? { lorebook_entries: lorebookEntries } : {}),
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

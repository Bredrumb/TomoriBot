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
import {
  apiKeyRotationSchema,
  naiPresetSchema,
  personaConfigSchema,
  tomoriConfigSchema,
  tomoriStateSchema,
  tomoriSchema,
  type ApiKeyRotationRow,
  type ErrorContext,
  type FallbackEntry,
  type FallbackModelRef,
  type LlmRow,
  type NaiPresetRow,
  type PersonaConfigRow,
  type TomoriConfigRow,
  type TomoriRow,
  type TomoriState,
} from "@/types/db/schema";
import type { SqlParameterArray } from "@/types/db/sqlOperations";
import { DatabaseUnavailableError } from "@/types/errors";
import { getCachedLLM } from "@/utils/cache/llmCache";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCacheStore";
import { sql, withCachedPlanRetry } from "@/utils/db/client";
import { validateTomoriFields } from "@/utils/db/sqlSecurity";
import { llmModelRepo } from "@/utils/db/repositories/LlmModelRepository";
import { llmProviderRepo } from "@/utils/db/repositories/LlmProviderRepository";
import { type MemoryValidationResult, getMemoryLimits } from "@/utils/misc/memoryLimits";
import { getUnconfiguredLlm } from "@/utils/provider/unconfiguredLlm";
import { log } from "@/utils/misc/logger";
import type { IRepository } from "./IRepository";

// ── persona config table row shapes ─────────────────────────────────

/** Row shape for persona_context_note_configs (Phase 6). */
export type PersonaContextNoteConfigsRow = {
  tomori_id: number;
  context_note: string | null;
  context_note_depth: number;
};

/** Row shape for persona_voice_configs (Phase 6). */
export type PersonaVoiceConfigsRow = {
  tomori_id: number;
  speech_voice_sample_id: number | null;
  speech_voice_id: string | null;
  speech_voice_name: string | null;
  speech_voice_design_prompt: string | null;
  elevenlabs_voice_id: string | null;
  elevenlabs_voice_name: string | null;
};

/** Row shape for persona_imagegen_configs (Phase 6). */
export type PersonaImagegenConfigsRow = {
  tomori_id: number;
  nai_tags: string[];
  nai_char_ref_url: string | null;
};

/** Row shape for persona_textgen_configs (Phase 6). */
export type PersonaTextgenConfigsRow = {
  tomori_id: number;
  nai_attg_author: string | null;
  nai_attg_title: string | null;
  nai_attg_tags: string | null;
  nai_attg_genre: string | null;
  nai_attg_stars: number | null;
};

/** Per-persona config bundle (Stage A). */
export type PersonaConfigBundle = {
  tomori_id: number;
  tomori_nickname: string;
  persona_lineage_id: number | null;
  context_note_configs: PersonaContextNoteConfigsRow | null;
  voice_configs: PersonaVoiceConfigsRow | null;
  imagegen_configs: PersonaImagegenConfigsRow | null;
  textgen_configs: PersonaTextgenConfigsRow | null;
};

/**
 * Export shape for PersonaRepository.
 * Contains all personas and their Phase 6 config bundles for a server.
 */
export type PersonaExportShape = {
  personas: PersonaConfigBundle[];
};

type TomoriConfigJsonResult = {
  config: unknown;
};

export class PersonaRepository implements IRepository<PersonaExportShape> {
  private static readonly FALLBACK_DEBUG_ENABLED = new Set(["1", "true", "yes", "on"]).has(
    (process.env.FALLBACK_DEBUG_ENABLED ?? "").trim().toLowerCase(),
  );

  // ── reads ──────────────────────────────────────────────────────────────────

  /**
   * Loads the full composite TomoriState for a server's main persona.
   * Returns null if the server has no registered persona.
   *
   * @param serverDiscId - Discord server snowflake
   */
  async loadState(serverDiscId: string): Promise<TomoriState | null> {
    return this.loadTomoriState(serverDiscId);
  }

  /**
   * Loads TomoriState for every persona registered in the server.
   *
   * @param serverDiscId - Discord server snowflake
   */
  async loadAllForServer(serverDiscId: string): Promise<TomoriState[]> {
    return this.loadAllPersonasForServer(serverDiscId);
  }

  /**
   * Loads the PersonaConfigRow for a specific tomori by internal ID.
   *
   * @param tomoriId - Internal tomori DB ID
   */
  async loadPersonaConfig(tomoriId: number) {
    return this.loadPersonaConfigRow(tomoriId);
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
    const row = await this.updateTomori(tomoriId, tomoriData);
    if (row && serverDiscId) invalidateTomoriStateCache(serverDiscId);
    return row;
  }

  // ── persona operations ─────────────────────────────────────────────────────

  async addAttributes(tomoriId: number, attributes: string[]): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE tomoris
        SET attribute_list = array_cat(attribute_list, ${sql.array(attributes)})
        WHERE tomori_id = ${tomoriId}
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error adding attributes for persona ${tomoriId}:`, e);
      return false;
    }
  }

  async editAttributeAt(tomoriId: number, index1Based: number, newAttribute: string): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE tomoris
        SET attribute_list[${index1Based}] = ${newAttribute}
        WHERE tomori_id = ${tomoriId}
        RETURNING tomori_id
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error editing attribute at index ${index1Based} for persona ${tomoriId}:`, e);
      return false;
    }
  }

  async removeAttribute(tomoriId: number, attributeToRemove: string): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE tomoris
        SET attribute_list = array_remove(attribute_list, ${attributeToRemove})
        WHERE tomori_id = ${tomoriId}
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error removing attribute for persona ${tomoriId}:`, e);
      return false;
    }
  }

  async setPrompt(tomoriId: number, prompt: string): Promise<boolean> {
    try {
      const result = await sql`
        INSERT INTO persona_configs (tomori_id, persona_prompt)
        VALUES (${tomoriId}, ${prompt})
        ON CONFLICT (tomori_id) DO UPDATE
        SET persona_prompt = EXCLUDED.persona_prompt
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error setting prompt for persona ${tomoriId}:`, e);
      return false;
    }
  }

  async removePrompt(tomoriId: number): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE persona_configs
        SET persona_prompt = NULL
        WHERE tomori_id = ${tomoriId}
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error removing prompt for persona ${tomoriId}:`, e);
      return false;
    }
  }

  /**
   * Set the context note (and depth) for a persona. Writes to both the new
   * `persona_context_note_configs` table and the legacy `tomoris` columns
   * (dual-write expand-then-contract pattern, mirrors fromExportShape).
   *
   * @param tomoriId - Internal persona DB ID
   * @param contextNote - Note text, or null to clear
   * @param contextNoteDepth - Injection depth (0 disables)
   */
  async setContextNote(tomoriId: number, contextNote: string | null, contextNoteDepth: number): Promise<boolean> {
    try {
      const row: PersonaContextNoteConfigsRow = {
        tomori_id: tomoriId,
        context_note: contextNote,
        context_note_depth: contextNoteDepth,
      };
      await Promise.all([this.sqlUpsertPersonaContextNoteConfigs(row), this.sqlDualWriteContextNoteToTomoris(row)]);
      return true;
    } catch (e) {
      log.error(`Error setting context note for persona ${tomoriId}:`, e);
      return false;
    }
  }

  /**
   * Set the NovelAI ATTG (Author/Title/Tags/Genre/Stars) metadata for a persona.
   * Writes to both the new `persona_textgen_configs` table and the legacy
   * `tomoris` columns (dual-write expand-then-contract pattern).
   *
   * @param tomoriId - Internal persona DB ID
   * @param attg     - ATTG fields; any subset may be null to clear that field
   */
  async setNaiAttg(
    tomoriId: number,
    attg: {
      nai_attg_author: string | null;
      nai_attg_title: string | null;
      nai_attg_tags: string | null;
      nai_attg_genre: string | null;
      nai_attg_stars: number | null;
    },
  ): Promise<boolean> {
    try {
      const row: PersonaTextgenConfigsRow = { tomori_id: tomoriId, ...attg };
      await Promise.all([this.sqlUpsertPersonaTextgenConfigs(row), this.sqlDualWriteTextgenToTomoris(row)]);
      return true;
    } catch (e) {
      log.error(`Error setting NAI ATTG for persona ${tomoriId}:`, e);
      return false;
    }
  }

  /**
   * Replace the persona's NovelAI character tags (imageboard-style).
   * Writes only `nai_tags` to both the new `persona_imagegen_configs` table
   * and the legacy `tomoris.nai_tags` column — preserves `nai_char_ref_url`.
   *
   * @param tomoriId - Internal persona DB ID
   * @param tags     - Full replacement tag array (use [] to clear)
   */
  async setNaiTags(tomoriId: number, tags: string[]): Promise<boolean> {
    try {
      await Promise.all([
        sql`
          INSERT INTO persona_imagegen_configs (tomori_id, nai_tags)
          VALUES (${tomoriId}, ${sql.array(tags)})
          ON CONFLICT (tomori_id) DO UPDATE SET
            nai_tags   = EXCLUDED.nai_tags,
            updated_at = NOW()
        `,
        sql`
          UPDATE tomoris
          SET nai_tags = ${sql.array(tags)}, updated_at = NOW()
          WHERE tomori_id = ${tomoriId}
        `,
      ]);
      return true;
    } catch (e) {
      log.error(`Error setting NAI tags for persona ${tomoriId}:`, e);
      return false;
    }
  }

  async addSampleDialoguePair(tomoriId: number, inputs: string[], outputs: string[]): Promise<boolean> {
    if (inputs.length !== outputs.length) {
      log.error(`addSampleDialoguePair input/output length mismatch for persona ${tomoriId}`);
      return false;
    }
    if (inputs.length === 0) return true;

    try {
      const result = await sql`
        UPDATE tomoris
        SET sample_dialogues_in = array_cat(sample_dialogues_in, ${sql.array(inputs)}),
            sample_dialogues_out = array_cat(sample_dialogues_out, ${sql.array(outputs)})
        WHERE tomori_id = ${tomoriId}
        RETURNING tomori_id
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error adding sample dialogue pair(s) for persona ${tomoriId}:`, e);
      return false;
    }
  }

  async editSampleDialoguePairAt(
    tomoriId: number,
    index1Based: number,
    newInput: string,
    newOutput: string,
  ): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE tomoris
        SET sample_dialogues_in[${index1Based}] = ${newInput},
            sample_dialogues_out[${index1Based}] = ${newOutput}
        WHERE tomori_id = ${tomoriId}
        RETURNING tomori_id
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error editing sample dialogue at index ${index1Based} for persona ${tomoriId}:`, e);
      return false;
    }
  }

  async removeSampleDialoguePairAt(tomoriId: number, index1Based: number): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE tomoris
        SET
          sample_dialogues_in = (
            SELECT COALESCE(array_agg(elem ORDER BY ord), '{}')
            FROM unnest(sample_dialogues_in) WITH ORDINALITY AS t(elem, ord)
            WHERE ord != ${index1Based}
          ),
          sample_dialogues_out = (
            SELECT COALESCE(array_agg(elem ORDER BY ord), '{}')
            FROM unnest(sample_dialogues_out) WITH ORDINALITY AS t(elem, ord)
            WHERE ord != ${index1Based}
          )
        WHERE tomori_id = ${tomoriId}
        RETURNING tomori_id
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error removing sample dialogue at index ${index1Based} for persona ${tomoriId}:`, e);
      return false;
    }
  }

  /**
   * Repairs mismatched sample-dialogue arrays by truncating both to a safe pair count.
   *
   * @param tomoriId    - Internal persona DB ID
   * @param safeLength  - Length to truncate both dialogue arrays to
   * @returns The repaired dialogue arrays, or null when no row was updated
   */
  async repairSampleDialogues(
    tomoriId: number,
    safeLength: number,
  ): Promise<{ repairedIn: string[]; repairedOut: string[] } | null> {
    const [updatedRow] = await sql`
      UPDATE tomoris
      SET
        sample_dialogues_in = sample_dialogues_in[1:${safeLength}],
        sample_dialogues_out = sample_dialogues_out[1:${safeLength}]
      WHERE tomori_id = ${tomoriId}
      RETURNING sample_dialogues_in, sample_dialogues_out
    `;

    return updatedRow
      ? {
          repairedIn: (updatedRow.sample_dialogues_in as string[]) ?? [],
          repairedOut: (updatedRow.sample_dialogues_out as string[]) ?? [],
        }
      : null;
  }

  async removePersona(tomoriId: number): Promise<boolean> {
    try {
      const result = await sql`
        DELETE FROM tomoris
        WHERE tomori_id = ${tomoriId}
        RETURNING tomori_id
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error removing persona ${tomoriId}:`, e);
      return false;
    }
  }

  async renamePersona(tomoriId: number, newName: string): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE tomoris
        SET tomori_nickname = ${newName}
        WHERE tomori_id = ${tomoriId}
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error renaming persona ${tomoriId}:`, e);
      return false;
    }
  }

  async swapPersona(tomoriId1: number, tomoriId2: number): Promise<boolean> {
    try {
      await sql.transaction(async (tx) => {
        await tx`
          UPDATE tomoris 
          SET is_alter = true 
          WHERE tomori_id = ${tomoriId2}
        `;
        await tx`
          UPDATE tomoris 
          SET is_alter = false 
          WHERE tomori_id = ${tomoriId1}
        `;
      });
      return true;
    } catch (e) {
      log.error(`Error swapping personas ${tomoriId1} and ${tomoriId2}:`, e);
      return false;
    }
  }

  async setAvatar(tomoriId: number, avatarUrl: string | null): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE tomoris
        SET webhook_avatar_url = ${avatarUrl}
        WHERE tomori_id = ${tomoriId}
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error setting avatar for persona ${tomoriId}:`, e);
      return false;
    }
  }

  /**
   * Creates an alter persona row and returns the inserted row.
   * Intentionally does not catch DB errors so callers can preserve
   * unique-violation handling for user-facing name-conflict replies.
   *
   * @param params - Alter persona fields to insert
   */
  async createAlterPersona(params: {
    serverId: number;
    nickname: string;
    attributes: string[];
    sampleDialoguesIn: string[];
    sampleDialoguesOut: string[];
    personaLineageId?: number | null;
    naiTags?: string[];
    naiCharRefUrl?: string | null;
    naiAttgAuthor?: string | null;
    naiAttgTitle?: string | null;
    naiAttgTags?: string | null;
    naiAttgGenre?: string | null;
    naiAttgStars?: number | null;
  }): Promise<TomoriRow | null> {
    const [row] = await sql`
      INSERT INTO tomoris (
        server_id,
        tomori_nickname,
        attribute_list,
        sample_dialogues_in,
        sample_dialogues_out,
        is_alter,
        persona_lineage_id,
        nai_tags,
        nai_char_ref_url,
        nai_attg_author,
        nai_attg_title,
        nai_attg_tags,
        nai_attg_genre,
        nai_attg_stars
      )
      VALUES (
        ${params.serverId},
        ${params.nickname},
        ${sql.array(params.attributes)},
        ${sql.array(params.sampleDialoguesIn)},
        ${sql.array(params.sampleDialoguesOut)},
        true,
        ${params.personaLineageId ?? 0},
        ${sql.array(params.naiTags ?? [])},
        ${params.naiCharRefUrl ?? null},
        ${params.naiAttgAuthor ?? null},
        ${params.naiAttgTitle ?? null},
        ${params.naiAttgTags ?? null},
        ${params.naiAttgGenre ?? null},
        ${params.naiAttgStars ?? null}
      )
      RETURNING *
    `;
    return row ? (row as unknown as TomoriRow) : null;
  }

  async addTrigger(tomoriId: number, triggers: string[]): Promise<boolean> {
    try {
      const result = await sql`
        INSERT INTO persona_configs (tomori_id, trigger_words)
        VALUES (${tomoriId}, ${sql.array(triggers)})
        ON CONFLICT (tomori_id) DO UPDATE
        SET trigger_words = array_cat(persona_configs.trigger_words, EXCLUDED.trigger_words)
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error adding triggers for persona ${tomoriId}:`, e);
      return false;
    }
  }

  /**
   * Replace the persona's trigger_words list with the given remaining set.
   * Upserts into `persona_configs` — if no row exists yet, one is created
   * (matches addTrigger's behavior; the caller no longer needs a guarantor INSERT).
   *
   * @param tomoriId          - Internal persona DB ID
   * @param triggersRemaining - The full replacement list (NOT a delta)
   */
  async removeTrigger(tomoriId: number, triggersRemaining: string[]): Promise<boolean> {
    try {
      const result = await sql`
        INSERT INTO persona_configs (tomori_id, trigger_words)
        VALUES (${tomoriId}, ${sql.array(triggersRemaining)})
        ON CONFLICT (tomori_id) DO UPDATE
        SET trigger_words = EXCLUDED.trigger_words
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error removing triggers for persona ${tomoriId}:`, e);
      return false;
    }
  }

  /**
   * Atomically upserts both trigger_words and persona_prompt in persona_configs.
   * Mirrors the INSERT … ON CONFLICT DO UPDATE pattern used by preset-apply flows.
   *
   * @param tomoriId - Internal persona DB ID
   * @param triggers - Full replacement trigger word list (use [] to clear)
   * @param prompt   - Persona prompt text, or null to clear
   */
  async setPersonaConfig(tomoriId: number, triggers: string[], prompt: string | null): Promise<boolean> {
    try {
      await sql`
        INSERT INTO persona_configs (tomori_id, trigger_words, persona_prompt)
        VALUES (${tomoriId}, ${sql.array(triggers)}, ${prompt})
        ON CONFLICT (tomori_id) DO UPDATE
        SET trigger_words  = EXCLUDED.trigger_words,
            persona_prompt = EXCLUDED.persona_prompt
      `;
      return true;
    } catch (e) {
      log.error(`Error setting persona config for persona ${tomoriId}:`, e);
      return false;
    }
  }

  // ── limit checks ───────────────────────────────────────────────────────────

  /**
   * Check if a server has reached its trigger word limit.
   *
   * @param serverId  - Internal server DB ID
   * @param tomoriId  - Optional tomori ID for persona-scoped trigger words
   * @returns MemoryValidationResult indicating whether the limit is exceeded
   */
  async checkTriggerWordLimit(serverId: number, tomoriId?: number): Promise<MemoryValidationResult> {
    const limits = getMemoryLimits();

    try {
      const [configResult] = tomoriId
        ? await sql`
            SELECT array_length(trigger_words, 1) as trigger_count
            FROM persona_configs
            WHERE tomori_id = ${tomoriId}
          `
        : await sql`
            SELECT array_length(trigger_words, 1) as trigger_count
            FROM tomori_configs
            WHERE server_id = ${serverId}
          `;

      const currentCount = configResult?.trigger_count || 0;

      if (currentCount >= limits.maxTriggerWords) {
        return {
          isValid: false,
          error: "TRIGGER_WORD_LIMIT_EXCEEDED",
          currentCount,
          maxAllowed: limits.maxTriggerWords,
        };
      }

      return { isValid: true, currentCount, maxAllowed: limits.maxTriggerWords };
    } catch (error) {
      log.error(`Error checking trigger word limit for server ${serverId}:`, error);
      return { isValid: false, error: "TRIGGER_WORD_LIMIT_EXCEEDED" };
    }
  }

  /**
   * Check if a tomori has reached its sample dialogue limit.
   *
   * @param tomoriId - Internal tomori DB ID
   * @returns MemoryValidationResult indicating whether the limit is exceeded
   */
  async checkSampleDialogueLimit(tomoriId: number): Promise<MemoryValidationResult> {
    const limits = getMemoryLimits();

    try {
      const [tomoriResult] = await sql`
        SELECT array_length(sample_dialogues_in, 1) as dialogue_count
        FROM tomoris
        WHERE tomori_id = ${tomoriId}
      `;

      const currentCount = tomoriResult?.dialogue_count || 0;

      if (currentCount >= limits.maxSampleDialogues) {
        return {
          isValid: false,
          error: "SAMPLE_DIALOGUE_LIMIT_EXCEEDED",
          currentCount,
          maxAllowed: limits.maxSampleDialogues,
        };
      }

      return { isValid: true, currentCount, maxAllowed: limits.maxSampleDialogues };
    } catch (error) {
      log.error(`Error checking sample dialogue limit for tomori ${tomoriId}:`, error);
      return { isValid: false, error: "SAMPLE_DIALOGUE_LIMIT_EXCEEDED" };
    }
  }

  /**
   * Check if a tomori has reached its attribute limit.
   *
   * @param tomoriId - Internal tomori DB ID
   * @returns MemoryValidationResult indicating whether the limit is exceeded
   */
  async checkAttributeLimit(tomoriId: number): Promise<MemoryValidationResult> {
    const limits = getMemoryLimits();

    try {
      const [tomoriResult] = await sql`
        SELECT array_length(attribute_list, 1) as attribute_count
        FROM tomoris
        WHERE tomori_id = ${tomoriId}
      `;

      const currentCount = tomoriResult?.attribute_count || 0;

      if (currentCount >= limits.maxAttributes) {
        return {
          isValid: false,
          error: "ATTRIBUTE_LIMIT_EXCEEDED",
          currentCount,
          maxAllowed: limits.maxAttributes,
        };
      }

      return { isValid: true, currentCount, maxAllowed: limits.maxAttributes };
    } catch (error) {
      log.error(`Error checking attribute limit for tomori ${tomoriId}:`, error);
      return { isValid: false, error: "ATTRIBUTE_LIMIT_EXCEEDED" };
    }
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Exports all personas and their Phase 6 config bundles for a server.
   *
   * @param ownerId - Discord server snowflake
   */
  async toExportShape(ownerId: string | number): Promise<PersonaExportShape | null> {
    const serverDiscId = String(ownerId);
    const serverId = await this.resolveServerInternalId(serverDiscId);
    if (!serverId) return null;

    const tomoriRows = await this.sqlLoadAllTomoriIds(serverId);
    if (!tomoriRows.length) return null;

    const bundles = await Promise.all(
      tomoriRows.map(async (t) => {
        const [contextNote, voice, imagegen, textgen] = await Promise.all([
          this.sqlLoadPersonaContextNoteConfigs(t.tomori_id),
          this.sqlLoadPersonaVoiceConfigs(t.tomori_id),
          this.sqlLoadPersonaImagegenConfigs(t.tomori_id),
          this.sqlLoadPersonaTextgenConfigs(t.tomori_id),
        ]);
        return {
          tomori_id: t.tomori_id,
          tomori_nickname: t.tomori_nickname,
          persona_lineage_id: t.persona_lineage_id ?? null,
          context_note_configs: contextNote,
          voice_configs: voice,
          imagegen_configs: imagegen,
          textgen_configs: textgen,
        } satisfies PersonaConfigBundle;
      }),
    );

    return { personas: bundles };
  }

  /**
   * Restores persona config table rows for all personas in a server.
   * Dual-writes: upserts into each new config table AND back into tomoris.
   *
   * @param ownerId - Discord server snowflake
   * @param data    - Previously exported PersonaExportShape
   */
  async fromExportShape(ownerId: string | number, data: PersonaExportShape): Promise<boolean> {
    const serverDiscId = String(ownerId);

    try {
      for (const bundle of data.personas) {
        const ops: Promise<void>[] = [];

        if (bundle.context_note_configs) {
          ops.push(this.sqlUpsertPersonaContextNoteConfigs(bundle.context_note_configs));
          ops.push(this.sqlDualWriteContextNoteToTomoris(bundle.context_note_configs));
        }
        if (bundle.voice_configs) {
          ops.push(this.sqlUpsertPersonaVoiceConfigs(bundle.voice_configs));
          ops.push(this.sqlDualWriteVoiceToTomoris(bundle.voice_configs));
        }
        if (bundle.imagegen_configs) {
          ops.push(this.sqlUpsertPersonaImagegenConfigs(bundle.imagegen_configs));
          ops.push(this.sqlDualWriteImagegenToTomoris(bundle.imagegen_configs));
        }
        if (bundle.textgen_configs) {
          ops.push(this.sqlUpsertPersonaTextgenConfigs(bundle.textgen_configs));
          ops.push(this.sqlDualWriteTextgenToTomoris(bundle.textgen_configs));
        }

        await Promise.all(ops);
      }
      return true;
    } catch (error) {
      log.error(`PersonaRepository.fromExportShape: write failed for server ${serverDiscId}:`, error);
      return false;
    }
  }

  // ── resolve internal server ID ──────────────────────────────────

  private async resolveServerInternalId(serverDiscId: string): Promise<number | null> {
    const [row] = await sql`
      SELECT server_id FROM servers WHERE server_disc_id = ${serverDiscId} LIMIT 1
    `;
    return (row?.server_id as number | undefined) ?? null;
  }

  private async sqlLoadAllTomoriIds(
    serverId: number,
  ): Promise<Array<{ tomori_id: number; tomori_nickname: string; persona_lineage_id: number | null }>> {
    try {
      const rows = await sql`
        SELECT tomori_id, tomori_nickname, persona_lineage_id FROM tomoris WHERE server_id = ${serverId}
      `;
      return rows as unknown as Array<{
        tomori_id: number;
        tomori_nickname: string;
        persona_lineage_id: number | null;
      }>;
    } catch (error) {
      log.error(`Error loading tomori IDs for server ${serverId}:`, error);
      return [];
    }
  }

  // ── persona config table reads ──────────────────────────────────

  private async sqlLoadPersonaContextNoteConfigs(tomoriId: number): Promise<PersonaContextNoteConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT tomori_id, context_note, context_note_depth
        FROM persona_context_note_configs WHERE tomori_id = ${tomoriId}
      `;
      return row ? (row as unknown as PersonaContextNoteConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading persona_context_note_configs for tomori ${tomoriId}:`, error);
      return null;
    }
  }

  private async sqlLoadPersonaVoiceConfigs(tomoriId: number): Promise<PersonaVoiceConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT tomori_id, speech_voice_sample_id, speech_voice_id, speech_voice_name,
               speech_voice_design_prompt, elevenlabs_voice_id, elevenlabs_voice_name
        FROM persona_voice_configs WHERE tomori_id = ${tomoriId}
      `;
      return row ? (row as unknown as PersonaVoiceConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading persona_voice_configs for tomori ${tomoriId}:`, error);
      return null;
    }
  }

  private async sqlLoadPersonaImagegenConfigs(tomoriId: number): Promise<PersonaImagegenConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT tomori_id, nai_tags, nai_char_ref_url
        FROM persona_imagegen_configs WHERE tomori_id = ${tomoriId}
      `;
      return row ? (row as unknown as PersonaImagegenConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading persona_imagegen_configs for tomori ${tomoriId}:`, error);
      return null;
    }
  }

  private async sqlLoadPersonaTextgenConfigs(tomoriId: number): Promise<PersonaTextgenConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT tomori_id, nai_attg_author, nai_attg_title, nai_attg_tags, nai_attg_genre, nai_attg_stars
        FROM persona_textgen_configs WHERE tomori_id = ${tomoriId}
      `;
      return row ? (row as unknown as PersonaTextgenConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading persona_textgen_configs for tomori ${tomoriId}:`, error);
      return null;
    }
  }

  // ── persona config table upserts (new tables) ───────────────────

  private async sqlUpsertPersonaContextNoteConfigs(row: PersonaContextNoteConfigsRow): Promise<void> {
    await sql`
      INSERT INTO persona_context_note_configs (tomori_id, context_note, context_note_depth)
      VALUES (${row.tomori_id}, ${row.context_note}, ${row.context_note_depth})
      ON CONFLICT (tomori_id) DO UPDATE SET
        context_note       = EXCLUDED.context_note,
        context_note_depth = EXCLUDED.context_note_depth,
        updated_at         = NOW()
    `;
  }

  private async sqlUpsertPersonaVoiceConfigs(row: PersonaVoiceConfigsRow): Promise<void> {
    await sql`
      INSERT INTO persona_voice_configs (
        tomori_id, speech_voice_sample_id, speech_voice_id, speech_voice_name,
        speech_voice_design_prompt, elevenlabs_voice_id, elevenlabs_voice_name
      ) VALUES (
        ${row.tomori_id}, ${row.speech_voice_sample_id}, ${row.speech_voice_id},
        ${row.speech_voice_name}, ${row.speech_voice_design_prompt},
        ${row.elevenlabs_voice_id}, ${row.elevenlabs_voice_name}
      )
      ON CONFLICT (tomori_id) DO UPDATE SET
        speech_voice_sample_id    = EXCLUDED.speech_voice_sample_id,
        speech_voice_id           = EXCLUDED.speech_voice_id,
        speech_voice_name         = EXCLUDED.speech_voice_name,
        speech_voice_design_prompt = EXCLUDED.speech_voice_design_prompt,
        elevenlabs_voice_id       = EXCLUDED.elevenlabs_voice_id,
        elevenlabs_voice_name     = EXCLUDED.elevenlabs_voice_name,
        updated_at                = NOW()
    `;
  }

  private async sqlUpsertPersonaImagegenConfigs(row: PersonaImagegenConfigsRow): Promise<void> {
    await sql`
      INSERT INTO persona_imagegen_configs (tomori_id, nai_tags, nai_char_ref_url)
      VALUES (${row.tomori_id}, ${sql.array(row.nai_tags)}, ${row.nai_char_ref_url})
      ON CONFLICT (tomori_id) DO UPDATE SET
        nai_tags       = EXCLUDED.nai_tags,
        nai_char_ref_url = EXCLUDED.nai_char_ref_url,
        updated_at     = NOW()
    `;
  }

  private async sqlUpsertPersonaTextgenConfigs(row: PersonaTextgenConfigsRow): Promise<void> {
    await sql`
      INSERT INTO persona_textgen_configs (
        tomori_id, nai_attg_author, nai_attg_title, nai_attg_tags, nai_attg_genre, nai_attg_stars
      ) VALUES (
        ${row.tomori_id}, ${row.nai_attg_author}, ${row.nai_attg_title},
        ${row.nai_attg_tags}, ${row.nai_attg_genre}, ${row.nai_attg_stars}
      )
      ON CONFLICT (tomori_id) DO UPDATE SET
        nai_attg_author = EXCLUDED.nai_attg_author,
        nai_attg_title  = EXCLUDED.nai_attg_title,
        nai_attg_tags   = EXCLUDED.nai_attg_tags,
        nai_attg_genre  = EXCLUDED.nai_attg_genre,
        nai_attg_stars  = EXCLUDED.nai_attg_stars,
        updated_at      = NOW()
    `;
  }

  // ── dual-write back to tomoris ──────────────────────────────────

  private async sqlDualWriteContextNoteToTomoris(row: PersonaContextNoteConfigsRow): Promise<void> {
    await sql`
      UPDATE tomoris SET
        context_note       = ${row.context_note},
        context_note_depth = ${row.context_note_depth},
        updated_at         = NOW()
      WHERE tomori_id = ${row.tomori_id}
    `;
  }

  private async sqlDualWriteVoiceToTomoris(row: PersonaVoiceConfigsRow): Promise<void> {
    await sql`
      UPDATE tomoris SET
        speech_voice_sample_id    = ${row.speech_voice_sample_id},
        speech_voice_id           = ${row.speech_voice_id},
        speech_voice_name         = ${row.speech_voice_name},
        speech_voice_design_prompt = ${row.speech_voice_design_prompt},
        elevenlabs_voice_id       = ${row.elevenlabs_voice_id},
        elevenlabs_voice_name     = ${row.elevenlabs_voice_name},
        updated_at                = NOW()
      WHERE tomori_id = ${row.tomori_id}
    `;
  }

  private async sqlDualWriteImagegenToTomoris(row: PersonaImagegenConfigsRow): Promise<void> {
    await sql`
      UPDATE tomoris SET
        nai_tags         = ${sql.array(row.nai_tags)},
        nai_char_ref_url = ${row.nai_char_ref_url},
        updated_at       = NOW()
      WHERE tomori_id = ${row.tomori_id}
    `;
  }

  private async sqlDualWriteTextgenToTomoris(row: PersonaTextgenConfigsRow): Promise<void> {
    await sql`
      UPDATE tomoris SET
        nai_attg_author = ${row.nai_attg_author},
        nai_attg_title  = ${row.nai_attg_title},
        nai_attg_tags   = ${row.nai_attg_tags},
        nai_attg_genre  = ${row.nai_attg_genre},
        nai_attg_stars  = ${row.nai_attg_stars},
        updated_at      = NOW()
      WHERE tomori_id = ${row.tomori_id}
    `;
  }

  // ── private helpers: JSON normalization ───────────────────────────────────

  /**
   * Converts a Postgres bytea JSON representation (e.g., "\\xDEADBEEF") to Buffer.
   * Returns null when the input is malformed or cannot be parsed.
   */
  private parseJsonBytea(value: unknown): Buffer | null {
    if (value === null || value === undefined) return null;
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (typeof value !== "string") return null;

    const normalized = value.startsWith("\\x") ? value.slice(2) : value.startsWith("0x") ? value.slice(2) : value;

    if (!/^[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0) {
      return null;
    }

    return Buffer.from(normalized, "hex");
  }

  /**
   * Normalizes JSON-projected tomori_configs data into runtime-compatible types.
   * Avoids Bun/Postgres INT[] binary decoding issues while preserving schema shape.
   */
  private normalizeTomoriConfigFromJson(rawConfig: unknown): unknown {
    if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
      return rawConfig;
    }

    const normalizedConfig = {
      ...(rawConfig as Record<string, unknown>),
    };

    // Convert JSON bytea string back to Buffer for decryption codepaths.
    normalizedConfig.api_key = this.parseJsonBytea(normalizedConfig.api_key);

    // Backward compatibility: older rows only stored a single auto-chat threshold.
    const threshold = Number(normalizedConfig.autoch_threshold ?? 0);
    const thresholdMax = Number(normalizedConfig.autoch_threshold_max ?? 0);
    if (Number.isFinite(threshold) && threshold > 0 && thresholdMax <= 0) {
      normalizedConfig.autoch_threshold_max = threshold;
    }

    // Normalize timestamps from JSON strings to Date objects expected by schemas.
    for (const key of ["created_at", "updated_at"] as const) {
      const value = normalizedConfig[key];
      if (typeof value === "string" || typeof value === "number") {
        const parsedDate = new Date(value);
        normalizedConfig[key] = Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
      }
    }

    return normalizedConfig;
  }

  // ── private SQL: config loading ───────────────────────────────────────────

  private async sqlLoadTomoriConfigByServerId(serverId: number): Promise<TomoriConfigRow | null> {
    const configRows = await sql<TomoriConfigJsonResult[]>`
      SELECT to_jsonb(tc) AS config
      FROM tomori_configs tc
      WHERE tc.server_id = ${serverId}
      LIMIT 1
    `;

    if (!configRows.length) {
      return null;
    }

    // biome-ignore lint/style/noNonNullAssertion: length checked above
    const normalized = this.normalizeTomoriConfigFromJson(configRows[0]!.config);
    const parsedConfig = tomoriConfigSchema.safeParse(normalized);
    if (!parsedConfig.success) {
      log.error(`Invalid server-scoped tomori config for server_id ${serverId}:`, parsedConfig.error.flatten());
      return null;
    }

    return parsedConfig.data;
  }

  private async sqlLoadTomoriConfigByTomoriId(tomoriId: number): Promise<TomoriConfigRow | null> {
    const configRows = await sql<TomoriConfigJsonResult[]>`
      SELECT to_jsonb(tc) AS config
      FROM tomori_configs tc
      WHERE tc.tomori_id = ${tomoriId}
      LIMIT 1
    `;

    if (!configRows.length) {
      return null;
    }

    // biome-ignore lint/style/noNonNullAssertion: length checked above
    const normalized = this.normalizeTomoriConfigFromJson(configRows[0]!.config);
    const parsedConfig = tomoriConfigSchema.safeParse(normalized);
    if (!parsedConfig.success) {
      log.error(`Invalid legacy tomori config for tomori_id ${tomoriId}:`, parsedConfig.error.flatten());
      return null;
    }

    return parsedConfig.data;
  }

  // ── private SQL: persona reads ────────────────────────────────────────────

  private async loadTomoriState(serverDiscId: string): Promise<TomoriState | null> {
    try {
      // 1. Load main persona row using server Discord ID
      const tomoriRows = await sql`
        SELECT t.*
        FROM tomoris t
        JOIN servers s ON t.server_id = s.server_id
        WHERE s.server_disc_id = ${serverDiscId}
        ORDER BY t.is_alter ASC, t.updated_at DESC NULLS LAST, t.tomori_id DESC
        LIMIT 1
      `;

      if (!tomoriRows.length) {
        log.warn(`No Tomori instance found for server ${serverDiscId}`);
        return null;
      }
      const tomoriData = tomoriRows[0];

      // 2. Load associated config using server_id (server-scoped config)
      // biome-ignore lint/style/noNonNullAssertion: Row existence checked above, ID is guaranteed by DB schema.
      const tomoriId = tomoriData.tomori_id!;
      const serverId = tomoriData.server_id;
      let configData = await this.sqlLoadTomoriConfigByServerId(serverId);

      // Backward compatibility: fall back to tomori_id if server_id config missing
      if (!configData) {
        log.warn(`No server-scoped config found for server ${serverDiscId}; falling back to tomori_id ${tomoriId}`);
        configData = await this.sqlLoadTomoriConfigByTomoriId(tomoriId);
      }

      if (!configData) {
        log.error(`Found Tomori (${tomoriId}) but no config for server ${serverDiscId}`);
        return null;
      }

      // 3. Load LLM data using the llm_id from the config (with cache fallback).
      // BYOK-only servers may intentionally leave llm_id NULL until a personal provider is overlaid.
      let llmData: LlmRow;
      if (!configData.llm_id) {
        llmData = getUnconfiguredLlm();
      } else {
        const cachedLlm = getCachedLLM(configData.llm_id);

        // Fallback to database if cache miss (cache not initialized or LLM not found)
        if (!cachedLlm) {
          log.info(`Cache miss for LLM ID ${configData.llm_id}, querying database`);
          const llmRows = await sql`
            SELECT * FROM llms
            WHERE llm_id = ${configData.llm_id}
            LIMIT 1
          `;

          if (!llmRows.length) {
            log.error(`Found Tomori config but no LLM data for server ${serverDiscId}, llm_id: ${configData.llm_id}`);
            return null;
          }
          llmData = llmRows[0] as LlmRow;
        } else {
          llmData = cachedLlm as LlmRow;
        }
      }

      // 4. Load persona-scoped trigger words + optional persona prompt
      const personaConfigRows = await sql`
        SELECT *
        FROM persona_configs
        WHERE tomori_id = ${tomoriId}
        LIMIT 1
      `;
      let personaConfig: PersonaConfigRow | null = null;
      if (personaConfigRows.length > 0) {
        const parsedPersonaConfig = personaConfigSchema.safeParse(personaConfigRows[0]);
        if (parsedPersonaConfig.success) {
          personaConfig = parsedPersonaConfig.data;
        } else {
          log.warn(`Invalid persona config row for tomori ${tomoriId}:`, parsedPersonaConfig.error.flatten());
        }
      }

      // 5. Load server memories scoped by persona lineage.
      const rawLineageId = tomoriData.persona_lineage_id;
      const parsedPersonaLineageId =
        typeof rawLineageId === "bigint"
          ? Number(rawLineageId)
          : typeof rawLineageId === "string"
            ? Number(rawLineageId)
            : (rawLineageId ?? 0);
      const personaLineageId = Number.isFinite(parsedPersonaLineageId) ? parsedPersonaLineageId : 0;
      const serverMemoriesRows = await sql`
        SELECT content
        FROM server_memories
        WHERE server_id = ${tomoriData.server_id}
          AND persona_lineage_id = ${personaLineageId}
        ORDER BY created_at DESC
      `;

      // Extract memory content strings into an array
      const serverMemories = serverMemoriesRows.map((row: { content: string }) => row.content);

      // 6. Load API key rotation pool for this server (if any)
      const rotationKeysRows = await sql`
        SELECT * FROM api_key_rotation
        WHERE server_id = ${tomoriData.server_id}
        ORDER BY usage_count ASC, rotation_key_id ASC
      `;

      // Validate rotation keys
      const rotationKeys: ApiKeyRotationRow[] = [];
      for (const row of rotationKeysRows) {
        const parsed = apiKeyRotationSchema.safeParse(row);
        if (parsed.success) {
          rotationKeys.push(parsed.data);
        } else {
          const errorDetails = JSON.stringify(parsed.error.flatten(), null, 2);
          log.warn(`Invalid rotation key row for server ${serverDiscId}:\n${errorDetails}`);
        }
      }

      // 7. Load active NAI preset if one is configured for this server
      let naiPreset: NaiPresetRow | undefined;
      const presetName = configData.nai_preset_name;
      if (presetName) {
        const presetRows = await sql`
          SELECT * FROM nai_presets
          WHERE preset_name = ${presetName}
          LIMIT 1
        `;
        if (presetRows.length > 0) {
          const parsedPreset = naiPresetSchema.safeParse(presetRows[0]);
          if (parsedPreset.success) {
            naiPreset = parsedPreset.data;
          } else {
            log.warn(`Invalid nai_preset row for preset "${presetName}":`, parsedPreset.error.flatten());
          }
        }
      }

      // 8. Resolve fallback model chain — prefer fallback_model_refs (new), fall back to fallback_llm_ids (legacy)
      const rawFallbackIds = configData.fallback_llm_ids;
      const fallbackLlmIds = configData.fallback_llm_ids;
      const fallbackLlms = fallbackLlmIds.length > 0 ? await llmModelRepo.getLlmsByIds(fallbackLlmIds) : [];
      if (PersonaRepository.FALLBACK_DEBUG_ENABLED) {
        log.info(
          `[FallbackDebug][loadTomoriState] server_disc_id=${serverDiscId} server_id=${serverId} raw_fallback_ids=${JSON.stringify(rawFallbackIds)} parsed_fallback_ids=[${fallbackLlmIds.join(", ")}] resolved_fallbacks=[${fallbackLlms.map((llm) => `${llm.llm_id}:${llm.llm_codename}`).join(", ")}]`,
        );
      }

      // 8b. Build typed fallback_chain from fallback_model_refs (supports both llm and custom_endpoint refs)
      const modelRefs = configData.fallback_model_refs ?? [];
      let fallbackChain: FallbackEntry[] | undefined;
      if (modelRefs.length > 0) {
        const llmRefIds = modelRefs
          .filter((r: FallbackModelRef) => r.type === "llm")
          .map((r: FallbackModelRef) => r.id);
        const epRefIds = modelRefs
          .filter((r: FallbackModelRef) => r.type === "custom_endpoint")
          .map((r: FallbackModelRef) => r.id);
        const [refLlms, refEndpoints] = await Promise.all([
          llmRefIds.length > 0 ? llmModelRepo.getLlmsByIds(llmRefIds) : Promise.resolve([]),
          epRefIds.length > 0 ? llmProviderRepo.loadCustomEndpointsByIds(epRefIds) : Promise.resolve([]),
        ]);
        const llmMap = new Map(refLlms.map((m) => [m.llm_id as number, m]));
        const epMap = new Map(refEndpoints.map((e) => [e.custom_endpoint_id as number, e]));
        const resolved = modelRefs
          .map((ref: FallbackModelRef) => {
            if (ref.type === "llm") {
              const model = llmMap.get(ref.id);
              return model ? ({ kind: "llm", model } as FallbackEntry) : null;
            }
            const endpoint = epMap.get(ref.id);
            return endpoint ? ({ kind: "custom_endpoint", endpoint } as FallbackEntry) : null;
          })
          .filter((e): e is FallbackEntry => e !== null);
        if (resolved.length > 0) fallbackChain = resolved;
      }

      // 9. Load vision model if configured (for non-vision chat model image analysis delegation)
      let visionLlm: LlmRow | undefined;
      if (configData.vision_llm_id) {
        visionLlm = getCachedLLM(configData.vision_llm_id) as LlmRow | undefined;
        if (!visionLlm) {
          const visionLlmRows = await sql`
            SELECT * FROM llms WHERE llm_id = ${configData.vision_llm_id} LIMIT 1
          `;
          if (visionLlmRows.length) {
            visionLlm = visionLlmRows[0] as LlmRow;
          }
        }
      }

      // 10. Combine and validate the full state
      const combinedState = {
        ...tomoriData,
        config: configData,
        llm: llmData,
        trigger_words: personaConfig?.trigger_words ?? [],
        persona_prompt: personaConfig?.persona_prompt ?? null,
        reward_conditioning_enabled: personaConfig?.reward_conditioning_enabled ?? true,
        punish_conditioning_enabled: personaConfig?.punish_conditioning_enabled ?? true,
        server_memories: serverMemories,
        rotation_keys: rotationKeys.length > 0 ? rotationKeys : undefined,
        vision_llm: visionLlm,
        nai_preset: naiPreset,
        fallback_llms: fallbackLlms.length > 0 ? fallbackLlms : undefined,
        fallback_chain: fallbackChain,
      };

      const parsedState = tomoriStateSchema.safeParse(combinedState);

      if (!parsedState.success) {
        log.error(`Failed to validate combined Tomori state for server ${serverDiscId}:`, parsedState.error.flatten());
        return null;
      }

      return parsedState.data;
    } catch (error) {
      log.error(`Error loading tomori state for server ${serverDiscId}:`, error);
      return null;
    }
  }

  private async loadAllPersonasForServer(serverDiscId: string): Promise<TomoriState[]> {
    return (
      (await withCachedPlanRetry(async () => {
        try {
          // 1. Load all Tomori persona rows for this server (main first, then alters)
          const tomoriRows = await sql`
            SELECT t.*
            FROM tomoris t
            JOIN servers s ON t.server_id = s.server_id
            WHERE s.server_disc_id = ${serverDiscId}
            ORDER BY t.is_alter ASC, t.updated_at DESC NULLS LAST, t.tomori_id DESC
          `;

          if (!tomoriRows.length) {
            log.warn(`No personas found for server ${serverDiscId}`);
            return [];
          }

          const serverId = tomoriRows[0].server_id;

          // 2. Load server-scoped config once (fallback to main persona config)
          let configData = await this.sqlLoadTomoriConfigByServerId(serverId);

          if (!configData) {
            const mainTomoriRow = tomoriRows.find((row: TomoriRow) => row.is_alter === false) ?? tomoriRows[0];
            const fallbackTomoriId = mainTomoriRow?.tomori_id;
            if (fallbackTomoriId) {
              log.warn(
                `No server-scoped config found for server ${serverDiscId}; falling back to tomori_id ${fallbackTomoriId}`,
              );
              configData = await this.sqlLoadTomoriConfigByTomoriId(fallbackTomoriId);
            }
          }

          if (!configData) {
            log.error(`No config found for server ${serverDiscId}; cannot build persona states`);
            return [];
          }

          // 3. Resolve server-scoped fallback chain once (shared across all personas for this server).
          const rawFallbackIds = configData.fallback_llm_ids;
          const fallbackLlmIds = configData.fallback_llm_ids;
          const fallbackLlms = fallbackLlmIds.length > 0 ? await llmModelRepo.getLlmsByIds(fallbackLlmIds) : [];
          if (PersonaRepository.FALLBACK_DEBUG_ENABLED) {
            log.info(
              `[FallbackDebug][loadAllPersonasForServer] server_disc_id=${serverDiscId} server_id=${serverId} raw_fallback_ids=${JSON.stringify(rawFallbackIds)} parsed_fallback_ids=[${fallbackLlmIds.join(", ")}] resolved_fallbacks=[${fallbackLlms.map((llm) => `${llm.llm_id}:${llm.llm_codename}`).join(", ")}]`,
            );
          }

          // 3b. Build typed fallback_chain from fallback_model_refs
          const modelRefs = configData.fallback_model_refs ?? [];
          let fallbackChain: FallbackEntry[] | undefined;
          if (modelRefs.length > 0) {
            const llmRefIds = modelRefs
              .filter((r: FallbackModelRef) => r.type === "llm")
              .map((r: FallbackModelRef) => r.id);
            const epRefIds = modelRefs
              .filter((r: FallbackModelRef) => r.type === "custom_endpoint")
              .map((r: FallbackModelRef) => r.id);
            const [refLlms, refEndpoints] = await Promise.all([
              llmRefIds.length > 0 ? llmModelRepo.getLlmsByIds(llmRefIds) : Promise.resolve([]),
              epRefIds.length > 0 ? llmProviderRepo.loadCustomEndpointsByIds(epRefIds) : Promise.resolve([]),
            ]);
            const llmMap = new Map(refLlms.map((m) => [m.llm_id as number, m]));
            const epMap = new Map(refEndpoints.map((e) => [e.custom_endpoint_id as number, e]));
            const resolved = modelRefs
              .map((ref: FallbackModelRef) => {
                if (ref.type === "llm") {
                  const model = llmMap.get(ref.id);
                  return model ? ({ kind: "llm", model } as FallbackEntry) : null;
                }
                const endpoint = epMap.get(ref.id);
                return endpoint ? ({ kind: "custom_endpoint", endpoint } as FallbackEntry) : null;
              })
              .filter((e): e is FallbackEntry => e !== null);
            if (resolved.length > 0) fallbackChain = resolved;
          }

          // 4. Load LLM data once (with cache fallback). BYOK-only servers may intentionally
          // omit the server text model until a member overlays a personal provider.
          let llmData: LlmRow;
          if (!configData.llm_id) {
            llmData = getUnconfiguredLlm();
          } else {
            const cachedLlm = getCachedLLM(configData.llm_id);
            if (!cachedLlm) {
              log.info(`Cache miss for LLM ID ${configData.llm_id}, querying database`);
              const llmRows = await sql`
                SELECT * FROM llms
                WHERE llm_id = ${configData.llm_id}
                LIMIT 1
              `;

              if (!llmRows.length) {
                log.error(
                  `Found persona config but no LLM data for server ${serverDiscId}, llm_id: ${configData.llm_id}`,
                );
                return [];
              }
              llmData = llmRows[0] as LlmRow;
            } else {
              llmData = cachedLlm as LlmRow;
            }
          }

          // 5. Load rotation keys once (server-scoped)
          const rotationKeysRows = await sql`
            SELECT * FROM api_key_rotation
            WHERE server_id = ${serverId}
            ORDER BY usage_count ASC, rotation_key_id ASC
          `;

          const rotationKeys: ApiKeyRotationRow[] = [];
          for (const row of rotationKeysRows) {
            const parsed = apiKeyRotationSchema.safeParse(row);
            if (parsed.success) {
              rotationKeys.push(parsed.data);
            } else {
              const errorDetails = JSON.stringify(parsed.error.flatten(), null, 2);
              log.warn(`Invalid rotation key row for server ${serverDiscId}:\n${errorDetails}`);
            }
          }

          // 6. Load persona configs for all personas in this server
          const personaConfigRows = await sql`
            SELECT pc.*
            FROM persona_configs pc
            JOIN tomoris t ON t.tomori_id = pc.tomori_id
            WHERE t.server_id = ${serverId}
          `;
          const personaConfigMap = new Map<number, PersonaConfigRow>();
          for (const row of personaConfigRows) {
            const parsed = personaConfigSchema.safeParse(row);
            if (parsed.success) {
              personaConfigMap.set(parsed.data.tomori_id, parsed.data);
            } else {
              log.warn(`Invalid persona config row for server ${serverDiscId}:`, parsed.error.flatten());
            }
          }

          // 7. Load server memories once, grouped by persona_lineage_id
          const memoryRows = await sql<
            Array<{
              persona_lineage_id: number | string | bigint | null;
              content: string;
            }>
          >`
            SELECT persona_lineage_id, content
            FROM server_memories
            WHERE server_id = ${serverId}
            ORDER BY created_at DESC
          `;
          const memoriesByLineage = new Map<number, string[]>();
          for (const row of memoryRows) {
            const lineageId =
              typeof row.persona_lineage_id === "bigint"
                ? Number(row.persona_lineage_id)
                : typeof row.persona_lineage_id === "string"
                  ? Number(row.persona_lineage_id)
                  : row.persona_lineage_id;
            if (typeof lineageId !== "number" || !Number.isFinite(lineageId) || lineageId < 0) {
              log.warn(`Skipping server memory with invalid persona_lineage_id for server ${serverDiscId}`);
              continue;
            }
            const existing = memoriesByLineage.get(lineageId) ?? [];
            existing.push(row.content);
            memoriesByLineage.set(lineageId, existing);
          }

          // 8. Load vision model if configured (server-scoped, loaded once for all personas)
          let visionLlm: LlmRow | undefined;
          if (configData.vision_llm_id) {
            visionLlm = getCachedLLM(configData.vision_llm_id) as LlmRow | undefined;
            if (!visionLlm) {
              const visionLlmRows = await sql`
                SELECT * FROM llms WHERE llm_id = ${configData.vision_llm_id} LIMIT 1
              `;
              if (visionLlmRows.length) {
                visionLlm = visionLlmRows[0] as LlmRow;
              }
            }
          }

          // 9. Build persona states
          const personas: TomoriState[] = [];
          for (const tomoriRow of tomoriRows) {
            const tomoriId = tomoriRow.tomori_id;
            if (!tomoriId) {
              log.warn(`Skipping persona with missing tomori_id for server ${serverDiscId}`);
              continue;
            }

            const personaConfig = personaConfigMap.get(tomoriId);

            // Resolve persona-specific LLM override if set (cache first, DB fallback)
            let personaLlm: LlmRow | undefined;
            if (personaConfig?.llm_id) {
              personaLlm = getCachedLLM(personaConfig.llm_id) as LlmRow | undefined;
              if (!personaLlm) {
                const personaLlmRows = await sql`
                  SELECT * FROM llms WHERE llm_id = ${personaConfig.llm_id} LIMIT 1
                `;
                if (personaLlmRows.length) {
                  personaLlm = personaLlmRows[0] as LlmRow;
                }
              }
            }

            const rawPersonaLineageId = tomoriRow.persona_lineage_id;
            const parsedPersonaLineageId =
              typeof rawPersonaLineageId === "bigint"
                ? Number(rawPersonaLineageId)
                : typeof rawPersonaLineageId === "string"
                  ? Number(rawPersonaLineageId)
                  : (rawPersonaLineageId ?? 0);
            const personaLineageId = Number.isFinite(parsedPersonaLineageId) ? parsedPersonaLineageId : 0;
            // Personas sharing lineage intentionally share server memories.
            const serverMemories = memoriesByLineage.get(personaLineageId) ?? [];

            const combinedState = {
              ...tomoriRow,
              config: configData,
              llm: llmData,
              trigger_words: personaConfig?.trigger_words ?? [],
              persona_prompt: personaConfig?.persona_prompt ?? null,
              reward_conditioning_enabled: personaConfig?.reward_conditioning_enabled ?? true,
              punish_conditioning_enabled: personaConfig?.punish_conditioning_enabled ?? true,
              server_memories: serverMemories,
              rotation_keys: rotationKeys.length > 0 ? rotationKeys : undefined,
              vision_llm: visionLlm,
              fallback_llms: fallbackLlms.length > 0 ? fallbackLlms : undefined,
              fallback_chain: fallbackChain,
              persona_llm: personaLlm,
            };

            const parsedState = tomoriStateSchema.safeParse(combinedState);
            if (!parsedState.success) {
              log.error(
                `Failed to validate persona state for server ${serverDiscId}, tomori_id ${tomoriId}:`,
                parsedState.error.flatten(),
              );
              continue;
            }

            personas.push(parsedState.data);
          }

          if (personas.length === 0) {
            log.warn(`No valid personas found for server ${serverDiscId}`);
            return [];
          }

          return personas;
        } catch (error) {
          log.error(`Error loading all personas for server ${serverDiscId}:`, error);
          // Throw a typed error so the cache layer can distinguish
          // "DB unreachable" from "server genuinely has no data" (which returns [])
          throw new DatabaseUnavailableError(
            `Failed to load personas for server ${serverDiscId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }, `load all personas for server ${serverDiscId}`)) ?? []
    );
  }

  private async loadPersonaConfigRow(tomoriId: number): Promise<PersonaConfigRow | null> {
    try {
      const rows = await sql`
        SELECT *
        FROM persona_configs
        WHERE tomori_id = ${tomoriId}
        LIMIT 1
      `;

      if (!rows.length) {
        return null;
      }

      const parsed = personaConfigSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.warn(`Failed to validate persona config for tomori ${tomoriId}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading persona config for tomori ${tomoriId}:`, error);
      return null;
    }
  }

  // ── private SQL: tomori writes ────────────────────────────────────────────

  private async updateTomori(tomoriId: number, tomoriData: Partial<TomoriRow>): Promise<TomoriRow | null> {
    try {
      // Validate the partial data with Zod (Rule #7)
      const validTomoriData = tomoriSchema.partial().parse(tomoriData);

      // Extract field names and values for the SQL query.
      // Filter to only keys present in the original input — Zod injects defaults
      // for all schema fields with .default(), which would incorrectly expand the
      // SET clause (e.g. attribute_list: [] would overwrite existing data).
      const fields = Object.keys(validTomoriData).filter((key) => key !== "tomori_id" && key in tomoriData);

      if (fields.length === 0) {
        log.warn(`No fields provided to update for tomori_id: ${tomoriId}`);
        return null;
      }

      // Security validation: Ensure all field names are whitelisted to prevent SQL injection
      validateTomoriFields(fields);

      // 1. Prepare arrays for placeholders and values
      const setParts: string[] = [];
      const values: SqlParameterArray = [];

      // 2. Iterate through fields to build SET clause parts and collect values.
      // sql.unsafe() cannot infer PostgreSQL column types, so JavaScript arrays
      // must be manually serialized to PostgreSQL array literals (e.g. {"a","b"}).
      fields.forEach((field, index) => {
        setParts.push(`${field} = $${index + 1}`);
        const rawValue = validTomoriData[field as keyof typeof validTomoriData];
        if (Array.isArray(rawValue)) {
          // Serialize to PostgreSQL array literal: {"val1","val2"} or {}
          const escaped = rawValue.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`);
          values.push(`{${escaped.join(",")}}`);
        } else {
          values.push(rawValue);
        }
      });

      // 3. Join the SET parts
      const setClause = setParts.join(", ");

      // 4. Add the tomoriId as the last parameter for the WHERE clause
      const finalPlaceholderIndex = values.length + 1;
      values.push(tomoriId);

      // 5. Execute the UPDATE using sql.unsafe() with the values array (not spread —
      // Bun SQL expects a single array argument, not individual arguments).
      const result = await sql.unsafe(
        `
          UPDATE tomoris
          SET ${setClause}
          WHERE tomori_id = $${finalPlaceholderIndex}
          RETURNING *
        `,
        values,
      );

      if (!result.length) {
        const context: ErrorContext = {
          tomoriId,
          errorType: "DatabaseUpdateError",
          metadata: {
            operation: "updateTomori",
            fields,
          },
        };
        await log.error(`No tomori found with id: ${tomoriId}`, new Error("Tomori not found"), context);
        return null;
      }

      // Validate the returned data for type safety
      const updatedTomori = tomoriSchema.safeParse(result[0]);
      if (!updatedTomori.success) {
        const context: ErrorContext = {
          tomoriId,
          errorType: "SchemaValidationError",
          metadata: {
            operation: "updateTomori",
            validationErrors: updatedTomori.error.flatten(),
          },
        };
        await log.error(`Failed to validate updated tomori for id: ${tomoriId}`, updatedTomori.error, context);
        return null;
      }

      return updatedTomori.data;
    } catch (error) {
      const context: ErrorContext = {
        tomoriId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "updateTomori",
        },
      };
      await log.error(`Error updating tomori for id: ${tomoriId}`, error, context);
      return null;
    }
  }
}

/** Singleton instance — import this in callers. */
export const personaRepository = new PersonaRepository();

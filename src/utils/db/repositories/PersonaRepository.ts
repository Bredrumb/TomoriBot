/**
 * PersonaRepository — manages the `personas` and persona resolution tables.
 *
 * Owns TomoriState loading (composite persona + config + memories read) and
 * all writes to the `personas` table. Configuration writes live in
 * ConfigRepository; the split mirrors the planned #14 DB partition.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 */
import {
  apiKeyRotationSchema,
  naiPresetSchema,
  personaConfigSchema,
  assembledServerConfigSchema,
  tomoriStateSchema,
  tomoriSchema,
  type ApiKeyRotationRow,
  type ErrorContext,
  type FallbackEntry,
  type FallbackModelRef,
  type LlmRow,
  type NaiPresetRow,
  type PersonaConfigRow,
  type AssembledServerConfig,
  type TomoriRow,
  type TomoriState,
} from "@/types/db/schema";
import type { PersonaAutochRuntimeStateRow } from "@/types/db/schema";
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
  persona_id: number;
  context_note: string | null;
  context_note_depth: number;
};

/** Row shape for persona_voice_configs (Phase 6). */
export type PersonaVoiceConfigsRow = {
  persona_id: number;
  speech_voice_sample_id: number | null;
  speech_voice_id: string | null;
  speech_voice_name: string | null;
  speech_voice_design_prompt: string | null;
};

/** Row shape for persona_imagegen_configs (Phase 6). */
export type PersonaImagegenConfigsRow = {
  persona_id: number;
  nai_tags: string[];
  nai_char_ref_url: string | null;
};

/** Row shape for persona_textgen_configs (Phase 6). */
export type PersonaTextgenConfigsRow = {
  persona_id: number;
  nai_attg_author: string | null;
  nai_attg_title: string | null;
  nai_attg_tags: string | null;
  nai_attg_genre: string | null;
  nai_attg_stars: number | null;
};

/** Per-persona config bundle (Stage A). */
export type PersonaConfigBundle = {
  persona_id: number;
  persona_nickname: string;
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

/** Fields where SQL NULL carries semantic meaning ("not configured") and must not be coerced to undefined. */
const MEANINGFULLY_NULLABLE_CONFIG_FIELDS = new Set([
  "llm_id",
  "embedding_model_id",
  "diffusion_model_id",
  "video_model_id",
  "vision_llm_id",
  "api_key",
  "system_prompt",
  "context_note",
  "llm_max_output_tokens",
  "custom_endpoint_url",
  "custom_model_name",
  "custom_num_ctx",
  "nai_preset_name",
  "nai_sampler",
  "nai_steps",
  "nai_scale",
  "nai_noise_schedule",
  "nai_cfg_rescale",
  "nai_diffusion_model_id",
  "other_model_codename",
  "other_model_capabilities",
  "other_model_capabilities_fetched_at",
  "welcome_channel_disc_id",
  "welcome_prompt",
  "welcome_persona_id",
  "thought_log_channel_disc_id",
]);

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
   * @param personaId - Internal tomori DB ID
   */
  async loadPersonaConfig(personaId: number) {
    return this.loadPersonaConfigRow(personaId);
  }

  /**
   * Loads persona summaries for modal selector and context overrides.
   * Includes fields needed for context builder persona identity without loading full TomoriState.
   * Returns main persona first (is_alter=false), then alters ordered by recency.
   *
   * @param serverId - Numeric DB server ID
   * @returns Array of persona summaries with identity/override fields
   */
  async loadServerPersonaSummaries(serverId: number): Promise<
    Array<{
      persona_id: number;
      persona_nickname: string;
      webhook_avatar_url: string | null;
      is_alter: boolean;
      attribute_list: string[];
      persona_lineage_id: number | null;
      persona_prompt: string | null;
    }>
  > {
    try {
      const rows = await sql`
        SELECT
          t.persona_id,
          t.persona_nickname,
          t.webhook_avatar_url,
          t.is_alter,
          t.attribute_list,
          t.persona_lineage_id,
          pc.persona_prompt
        FROM personas t
        LEFT JOIN persona_configs pc ON pc.persona_id = t.persona_id
        WHERE t.server_id = ${serverId}
        ORDER BY t.is_alter ASC, t.updated_at DESC NULLS LAST, t.persona_id DESC
      `;
      return rows ?? [];
    } catch (error) {
      log.error(`Error loading persona summaries for server ${serverId}:`, error);
      return [];
    }
  }

  /**
   * Returns true when a main persona (is_alter=false) exists for the given server.
   * Used by setup to distinguish "no main persona" from "main persona exists but broken state".
   *
   * @param serverId - Internal server DB ID
   */
  async hasMainPersona(serverId: number): Promise<boolean> {
    try {
      const [row] = await sql`
        SELECT 1
        FROM personas
        WHERE server_id = ${serverId}
          AND is_alter = false
        LIMIT 1
      `;
      return row !== undefined;
    } catch (error) {
      log.error(`Error checking main persona existence for server ${serverId}:`, error);
      return false;
    }
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /**
   * Updates arbitrary fields on a Tomori row.
   * Invalidates the server's tomori state cache after write.
   *
   * @param personaId      - Internal tomori DB ID
   * @param tomoriData    - Partial TomoriRow with fields to update
   * @param serverDiscId  - Discord server snowflake (required for cache invalidation)
   * @returns Updated TomoriRow or null on failure
   */
  async update(personaId: number, tomoriData: Partial<TomoriRow>, serverDiscId?: string): Promise<TomoriRow | null> {
    const row = await this.updateTomori(personaId, tomoriData);
    if (row && serverDiscId) invalidateTomoriStateCache(serverDiscId);
    return row;
  }

  // ── persona operations ─────────────────────────────────────────────────────

  async addAttributes(personaId: number, attributes: string[]): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE personas
        SET attribute_list = array_cat(attribute_list, ${sql.array(attributes)})
        WHERE persona_id = ${personaId}
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error adding attributes for persona ${personaId}:`, e);
      return false;
    }
  }

  async editAttributeAt(personaId: number, index1Based: number, newAttribute: string): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE personas
        SET attribute_list[${index1Based}] = ${newAttribute}
        WHERE persona_id = ${personaId}
        RETURNING persona_id
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error editing attribute at index ${index1Based} for persona ${personaId}:`, e);
      return false;
    }
  }

  async removeAttribute(personaId: number, attributeToRemove: string): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE personas
        SET attribute_list = array_remove(attribute_list, ${attributeToRemove})
        WHERE persona_id = ${personaId}
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error removing attribute for persona ${personaId}:`, e);
      return false;
    }
  }

  async setPrompt(personaId: number, prompt: string): Promise<boolean> {
    try {
      const result = await sql`
        INSERT INTO persona_configs (persona_id, persona_prompt)
        VALUES (${personaId}, ${prompt})
        ON CONFLICT (persona_id) DO UPDATE
        SET persona_prompt = EXCLUDED.persona_prompt
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error setting prompt for persona ${personaId}:`, e);
      return false;
    }
  }

  async removePrompt(personaId: number): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE persona_configs
        SET persona_prompt = NULL
        WHERE persona_id = ${personaId}
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error removing prompt for persona ${personaId}:`, e);
      return false;
    }
  }

  /**
   * Set the context note (and depth) for a persona. Writes to both the new
   * `persona_context_note_configs` table and the persona mirror columns
   * (dual-write expand-then-contract pattern, mirrors fromExportShape).
   *
   * @param personaId - Internal persona DB ID
   * @param contextNote - Note text, or null to clear
   * @param contextNoteDepth - Injection depth (0 disables)
   */
  async setContextNote(personaId: number, contextNote: string | null, contextNoteDepth: number): Promise<boolean> {
    try {
      const row: PersonaContextNoteConfigsRow = {
        persona_id: personaId,
        context_note: contextNote,
        context_note_depth: contextNoteDepth,
      };
      await Promise.all([this.sqlUpsertPersonaContextNoteConfigs(row), this.sqlDualWriteContextNoteToTomoris(row)]);
      return true;
    } catch (e) {
      log.error(`Error setting context note for persona ${personaId}:`, e);
      return false;
    }
  }

  /**
   * Set the NovelAI ATTG (Author/Title/Tags/Genre/Stars) metadata for a persona.
   * Writes to both the new `persona_textgen_configs` table and the legacy
   * `personas` columns (dual-write expand-then-contract pattern).
   *
   * @param personaId - Internal persona DB ID
   * @param attg     - ATTG fields; any subset may be null to clear that field
   */
  async setNaiAttg(
    personaId: number,
    attg: {
      nai_attg_author: string | null;
      nai_attg_title: string | null;
      nai_attg_tags: string | null;
      nai_attg_genre: string | null;
      nai_attg_stars: number | null;
    },
  ): Promise<boolean> {
    try {
      const row: PersonaTextgenConfigsRow = { persona_id: personaId, ...attg };
      await Promise.all([this.sqlUpsertPersonaTextgenConfigs(row), this.sqlDualWriteTextgenToTomoris(row)]);
      return true;
    } catch (e) {
      log.error(`Error setting NAI ATTG for persona ${personaId}:`, e);
      return false;
    }
  }

  /**
   * Replace the persona's NovelAI character tags (imageboard-style).
   * Writes only `nai_tags` to both the new `persona_imagegen_configs` table
   * and the `personas.nai_tags` column — preserves `nai_char_ref_url`.
   *
   * @param personaId - Internal persona DB ID
   * @param tags     - Full replacement tag array (use [] to clear)
   */
  async setNaiTags(personaId: number, tags: string[]): Promise<boolean> {
    try {
      await Promise.all([
        sql`
          INSERT INTO persona_imagegen_configs (persona_id, nai_tags)
          VALUES (${personaId}, ${sql.array(tags)})
          ON CONFLICT (persona_id) DO UPDATE SET
            nai_tags   = EXCLUDED.nai_tags,
            updated_at = NOW()
        `,
        sql`
          UPDATE personas
          SET nai_tags = ${sql.array(tags)}, updated_at = NOW()
          WHERE persona_id = ${personaId}
        `,
      ]);
      return true;
    } catch (e) {
      log.error(`Error setting NAI tags for persona ${personaId}:`, e);
      return false;
    }
  }

  async addSampleDialoguePair(personaId: number, inputs: string[], outputs: string[]): Promise<boolean> {
    if (inputs.length !== outputs.length) {
      log.error(`addSampleDialoguePair input/output length mismatch for persona ${personaId}`);
      return false;
    }
    if (inputs.length === 0) return true;

    try {
      const result = await sql`
        UPDATE personas
        SET sample_dialogues_in = array_cat(sample_dialogues_in, ${sql.array(inputs)}),
            sample_dialogues_out = array_cat(sample_dialogues_out, ${sql.array(outputs)})
        WHERE persona_id = ${personaId}
        RETURNING persona_id
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error adding sample dialogue pair(s) for persona ${personaId}:`, e);
      return false;
    }
  }

  async editSampleDialoguePairAt(
    personaId: number,
    index1Based: number,
    newInput: string,
    newOutput: string,
  ): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE personas
        SET sample_dialogues_in[${index1Based}] = ${newInput},
            sample_dialogues_out[${index1Based}] = ${newOutput}
        WHERE persona_id = ${personaId}
        RETURNING persona_id
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error editing sample dialogue at index ${index1Based} for persona ${personaId}:`, e);
      return false;
    }
  }

  async removeSampleDialoguePairAt(personaId: number, index1Based: number): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE personas
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
        WHERE persona_id = ${personaId}
        RETURNING persona_id
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error removing sample dialogue at index ${index1Based} for persona ${personaId}:`, e);
      return false;
    }
  }

  /**
   * Repairs mismatched sample-dialogue arrays by truncating both to a safe pair count.
   *
   * @param personaId    - Internal persona DB ID
   * @param safeLength  - Length to truncate both dialogue arrays to
   * @returns The repaired dialogue arrays, or null when no row was updated
   */
  async repairSampleDialogues(
    personaId: number,
    safeLength: number,
  ): Promise<{ repairedIn: string[]; repairedOut: string[] } | null> {
    const [updatedRow] = await sql`
      UPDATE personas
      SET
        sample_dialogues_in = sample_dialogues_in[1:${safeLength}],
        sample_dialogues_out = sample_dialogues_out[1:${safeLength}]
      WHERE persona_id = ${personaId}
      RETURNING sample_dialogues_in, sample_dialogues_out
    `;

    return updatedRow
      ? {
          repairedIn: (updatedRow.sample_dialogues_in as string[]) ?? [],
          repairedOut: (updatedRow.sample_dialogues_out as string[]) ?? [],
        }
      : null;
  }

  async removePersona(personaId: number): Promise<boolean> {
    try {
      const result = await sql`
        DELETE FROM personas
        WHERE persona_id = ${personaId}
        RETURNING persona_id
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error removing persona ${personaId}:`, e);
      return false;
    }
  }

  async renamePersona(personaId: number, newName: string): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE personas
        SET persona_nickname = ${newName}
        WHERE persona_id = ${personaId}
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error renaming persona ${personaId}:`, e);
      return false;
    }
  }

  async swapPersona(mainPersonaId: number, alterPersonaId: number): Promise<boolean> {
    try {
      await sql.transaction(async (tx) => {
        const rows = await tx<Array<{ persona_id: number; server_id: number; is_alter: boolean }>>`
          SELECT persona_id, server_id, is_alter
          FROM personas
          WHERE persona_id IN (${mainPersonaId}, ${alterPersonaId})
          FOR UPDATE
        `;

        const mainPersona = rows.find((row) => row.persona_id === mainPersonaId);
        const alterPersona = rows.find((row) => row.persona_id === alterPersonaId);

        if (!mainPersona || !alterPersona || mainPersona.server_id !== alterPersona.server_id) {
          throw new Error("Persona swap requires two personas from the same server.");
        }

        if (mainPersona.is_alter || !alterPersona.is_alter) {
          throw new Error("Persona swap requires the first persona to be main and the second persona to be an alter.");
        }

        await tx`
          UPDATE personas
          SET is_alter = true
          WHERE persona_id = ${mainPersonaId}
        `;
        await tx`
          UPDATE personas
          SET is_alter = false
          WHERE persona_id = ${alterPersonaId}
        `;
      });
      return true;
    } catch (e) {
      log.error(`Error swapping personas ${mainPersonaId} and ${alterPersonaId}:`, e);
      return false;
    }
  }

  async setAvatar(personaId: number, avatarUrl: string | null): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE personas
        SET webhook_avatar_url = ${avatarUrl}
        WHERE persona_id = ${personaId}
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error setting avatar for persona ${personaId}:`, e);
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
      INSERT INTO personas (
        server_id,
        persona_nickname,
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

  async addTrigger(personaId: number, triggers: string[]): Promise<boolean> {
    try {
      const result = await sql`
        INSERT INTO persona_configs (persona_id, trigger_words)
        VALUES (${personaId}, ${sql.array(triggers)})
        ON CONFLICT (persona_id) DO UPDATE
        SET trigger_words = array_cat(persona_configs.trigger_words, EXCLUDED.trigger_words)
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error adding triggers for persona ${personaId}:`, e);
      return false;
    }
  }

  /**
   * Replace the persona's trigger_words list with the given remaining set.
   * Upserts into `persona_configs` — if no row exists yet, one is created
   * (matches addTrigger's behavior; the caller no longer needs a guarantor INSERT).
   *
   * @param personaId          - Internal persona DB ID
   * @param triggersRemaining - The full replacement list (NOT a delta)
   */
  async removeTrigger(personaId: number, triggersRemaining: string[]): Promise<boolean> {
    try {
      const result = await sql`
        INSERT INTO persona_configs (persona_id, trigger_words)
        VALUES (${personaId}, ${sql.array(triggersRemaining)})
        ON CONFLICT (persona_id) DO UPDATE
        SET trigger_words = EXCLUDED.trigger_words
        RETURNING *
      `;
      return result.length > 0;
    } catch (e) {
      log.error(`Error removing triggers for persona ${personaId}:`, e);
      return false;
    }
  }

  /**
   * Atomically upserts both trigger_words and persona_prompt in persona_configs.
   * Mirrors the INSERT … ON CONFLICT DO UPDATE pattern used by preset-apply flows.
   *
   * @param personaId - Internal persona DB ID
   * @param triggers - Full replacement trigger word list (use [] to clear)
   * @param prompt   - Persona prompt text, or null to clear
   */
  async setPersonaConfig(personaId: number, triggers: string[], prompt: string | null): Promise<boolean> {
    try {
      await sql`
        INSERT INTO persona_configs (persona_id, trigger_words, persona_prompt)
        VALUES (${personaId}, ${sql.array(triggers)}, ${prompt})
        ON CONFLICT (persona_id) DO UPDATE
        SET trigger_words  = EXCLUDED.trigger_words,
            persona_prompt = EXCLUDED.persona_prompt
      `;
      return true;
    } catch (e) {
      log.error(`Error setting persona config for persona ${personaId}:`, e);
      return false;
    }
  }

  // ── limit checks ───────────────────────────────────────────────────────────

  /**
   * Check if a server has reached its trigger word limit.
   *
   * @param serverId  - Internal server DB ID
   * @param personaId  - Optional tomori ID for persona-scoped trigger words
   * @returns MemoryValidationResult indicating whether the limit is exceeded
   */
  async checkTriggerWordLimit(serverId: number, personaId?: number): Promise<MemoryValidationResult> {
    const limits = getMemoryLimits();

    try {
      const [configResult] = personaId
        ? await sql`
            SELECT array_length(trigger_words, 1) as trigger_count
            FROM persona_configs
            WHERE persona_id = ${personaId}
          `
        : await sql`
            SELECT array_length(pc.trigger_words, 1) as trigger_count
            FROM persona_configs pc
            JOIN personas t ON t.persona_id = pc.persona_id
            WHERE t.server_id = ${serverId}
              AND t.is_alter = false
            LIMIT 1
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
   * @param personaId - Internal tomori DB ID
   * @returns MemoryValidationResult indicating whether the limit is exceeded
   */
  async checkSampleDialogueLimit(personaId: number): Promise<MemoryValidationResult> {
    const limits = getMemoryLimits();

    try {
      const [tomoriResult] = await sql`
        SELECT array_length(sample_dialogues_in, 1) as dialogue_count
        FROM personas
        WHERE persona_id = ${personaId}
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
      log.error(`Error checking sample dialogue limit for tomori ${personaId}:`, error);
      return { isValid: false, error: "SAMPLE_DIALOGUE_LIMIT_EXCEEDED" };
    }
  }

  /**
   * Check if a tomori has reached its attribute limit.
   *
   * @param personaId - Internal tomori DB ID
   * @returns MemoryValidationResult indicating whether the limit is exceeded
   */
  async checkAttributeLimit(personaId: number): Promise<MemoryValidationResult> {
    const limits = getMemoryLimits();

    try {
      const [tomoriResult] = await sql`
        SELECT array_length(attribute_list, 1) as attribute_count
        FROM personas
        WHERE persona_id = ${personaId}
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
      log.error(`Error checking attribute limit for tomori ${personaId}:`, error);
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
          this.sqlLoadPersonaContextNoteConfigs(t.persona_id),
          this.sqlLoadPersonaVoiceConfigs(t.persona_id),
          this.sqlLoadPersonaImagegenConfigs(t.persona_id),
          this.sqlLoadPersonaTextgenConfigs(t.persona_id),
        ]);
        return {
          persona_id: t.persona_id,
          persona_nickname: t.persona_nickname,
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
   * Dual-writes: upserts into each config table AND back into personas.
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
  ): Promise<Array<{ persona_id: number; persona_nickname: string; persona_lineage_id: number | null }>> {
    try {
      const rows = await sql`
        SELECT persona_id, persona_nickname, persona_lineage_id FROM personas WHERE server_id = ${serverId}
      `;
      return rows as unknown as Array<{
        persona_id: number;
        persona_nickname: string;
        persona_lineage_id: number | null;
      }>;
    } catch (error) {
      log.error(`Error loading tomori IDs for server ${serverId}:`, error);
      return [];
    }
  }

  // ── persona config table reads ──────────────────────────────────

  private async sqlLoadPersonaContextNoteConfigs(personaId: number): Promise<PersonaContextNoteConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT persona_id, context_note, context_note_depth
        FROM persona_context_note_configs WHERE persona_id = ${personaId}
      `;
      return row ? (row as unknown as PersonaContextNoteConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading persona_context_note_configs for tomori ${personaId}:`, error);
      return null;
    }
  }

  private async sqlLoadPersonaVoiceConfigs(personaId: number): Promise<PersonaVoiceConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT persona_id, speech_voice_sample_id, speech_voice_id, speech_voice_name,
               speech_voice_design_prompt
        FROM persona_voice_configs WHERE persona_id = ${personaId}
      `;
      return row ? (row as unknown as PersonaVoiceConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading persona_voice_configs for tomori ${personaId}:`, error);
      return null;
    }
  }

  private async sqlLoadPersonaImagegenConfigs(personaId: number): Promise<PersonaImagegenConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT persona_id, nai_tags, nai_char_ref_url
        FROM persona_imagegen_configs WHERE persona_id = ${personaId}
      `;
      return row ? (row as unknown as PersonaImagegenConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading persona_imagegen_configs for tomori ${personaId}:`, error);
      return null;
    }
  }

  private async sqlLoadPersonaTextgenConfigs(personaId: number): Promise<PersonaTextgenConfigsRow | null> {
    try {
      const [row] = await sql`
        SELECT persona_id, nai_attg_author, nai_attg_title, nai_attg_tags, nai_attg_genre, nai_attg_stars
        FROM persona_textgen_configs WHERE persona_id = ${personaId}
      `;
      return row ? (row as unknown as PersonaTextgenConfigsRow) : null;
    } catch (error) {
      log.error(`Error loading persona_textgen_configs for tomori ${personaId}:`, error);
      return null;
    }
  }

  // ── persona config table upserts (new tables) ───────────────────

  private async sqlUpsertPersonaContextNoteConfigs(row: PersonaContextNoteConfigsRow): Promise<void> {
    await sql`
      INSERT INTO persona_context_note_configs (persona_id, context_note, context_note_depth)
      VALUES (${row.persona_id}, ${row.context_note}, ${row.context_note_depth})
      ON CONFLICT (persona_id) DO UPDATE SET
        context_note       = EXCLUDED.context_note,
        context_note_depth = EXCLUDED.context_note_depth,
        updated_at         = NOW()
    `;
  }

  private async sqlUpsertPersonaVoiceConfigs(row: PersonaVoiceConfigsRow): Promise<void> {
    await sql`
      INSERT INTO persona_voice_configs (
        persona_id, speech_voice_sample_id, speech_voice_id, speech_voice_name,
        speech_voice_design_prompt
      ) VALUES (
        ${row.persona_id}, ${row.speech_voice_sample_id}, ${row.speech_voice_id},
        ${row.speech_voice_name}, ${row.speech_voice_design_prompt}
      )
      ON CONFLICT (persona_id) DO UPDATE SET
        speech_voice_sample_id    = EXCLUDED.speech_voice_sample_id,
        speech_voice_id           = EXCLUDED.speech_voice_id,
        speech_voice_name         = EXCLUDED.speech_voice_name,
        speech_voice_design_prompt = EXCLUDED.speech_voice_design_prompt,
        updated_at                = NOW()
    `;
  }

  private async sqlUpsertPersonaImagegenConfigs(row: PersonaImagegenConfigsRow): Promise<void> {
    await sql`
      INSERT INTO persona_imagegen_configs (persona_id, nai_tags, nai_char_ref_url)
      VALUES (${row.persona_id}, ${sql.array(row.nai_tags)}, ${row.nai_char_ref_url})
      ON CONFLICT (persona_id) DO UPDATE SET
        nai_tags       = EXCLUDED.nai_tags,
        nai_char_ref_url = EXCLUDED.nai_char_ref_url,
        updated_at     = NOW()
    `;
  }

  private async sqlUpsertPersonaTextgenConfigs(row: PersonaTextgenConfigsRow): Promise<void> {
    await sql`
      INSERT INTO persona_textgen_configs (
        persona_id, nai_attg_author, nai_attg_title, nai_attg_tags, nai_attg_genre, nai_attg_stars
      ) VALUES (
        ${row.persona_id}, ${row.nai_attg_author}, ${row.nai_attg_title},
        ${row.nai_attg_tags}, ${row.nai_attg_genre}, ${row.nai_attg_stars}
      )
      ON CONFLICT (persona_id) DO UPDATE SET
        nai_attg_author = EXCLUDED.nai_attg_author,
        nai_attg_title  = EXCLUDED.nai_attg_title,
        nai_attg_tags   = EXCLUDED.nai_attg_tags,
        nai_attg_genre  = EXCLUDED.nai_attg_genre,
        nai_attg_stars  = EXCLUDED.nai_attg_stars,
        updated_at      = NOW()
    `;
  }

  // ── dual-write back to personas ─────────────────────────────────

  private async sqlDualWriteContextNoteToTomoris(row: PersonaContextNoteConfigsRow): Promise<void> {
    await sql`
      UPDATE personas SET
        context_note       = ${row.context_note},
        context_note_depth = ${row.context_note_depth},
        updated_at         = NOW()
      WHERE persona_id = ${row.persona_id}
    `;
  }

  private async sqlDualWriteVoiceToTomoris(row: PersonaVoiceConfigsRow): Promise<void> {
    await sql`
      UPDATE personas SET
        speech_voice_sample_id    = ${row.speech_voice_sample_id},
        speech_voice_id           = ${row.speech_voice_id},
        speech_voice_name         = ${row.speech_voice_name},
        speech_voice_design_prompt = ${row.speech_voice_design_prompt},
        updated_at                = NOW()
      WHERE persona_id = ${row.persona_id}
    `;
  }

  private async sqlDualWriteImagegenToTomoris(row: PersonaImagegenConfigsRow): Promise<void> {
    await sql`
      UPDATE personas SET
        nai_tags         = ${sql.array(row.nai_tags)},
        nai_char_ref_url = ${row.nai_char_ref_url},
        updated_at       = NOW()
      WHERE persona_id = ${row.persona_id}
    `;
  }

  private async sqlDualWriteTextgenToTomoris(row: PersonaTextgenConfigsRow): Promise<void> {
    await sql`
      UPDATE personas SET
        nai_attg_author = ${row.nai_attg_author},
        nai_attg_title  = ${row.nai_attg_title},
        nai_attg_tags   = ${row.nai_attg_tags},
        nai_attg_genre  = ${row.nai_attg_genre},
        nai_attg_stars  = ${row.nai_attg_stars},
        updated_at      = NOW()
      WHERE persona_id = ${row.persona_id}
    `;
  }

  // ── private helpers: row normalization ────────────────────────────────────

  /**
   * Converts a Postgres bytea hex-string representation (e.g., "\\xDEADBEEF") to Buffer.
   * Returns null when the input is malformed or cannot be parsed as hex.
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
   * Converts SQL NULL to undefined for fields that use Zod .default(), letting
   * defaults fire on a LEFT JOIN miss. Skips fields in MEANINGFULLY_NULLABLE_CONFIG_FIELDS
   * where null encodes "not configured" and must be preserved.
   */
  private coerceNullsForZod(rawRow: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawRow)) {
      result[key] = value === null && !MEANINGFULLY_NULLABLE_CONFIG_FIELDS.has(key) ? undefined : value;
    }
    return result;
  }

  /**
   * Normalizes a flat split-table join row into runtime-compatible types.
   * - Hydrates api_key: Uint8Array (direct DB read) → Buffer; hex string (legacy) → Buffer.
   * - Applies backward-compat autoch_threshold_max backfill for older rows.
   * - Guards timestamps against edge-case string values (Bun SQL normally returns Date).
   */
  private normalizeTomoriConfigFromJson(rawRow: unknown): unknown {
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
      return rawRow;
    }

    const row = { ...(rawRow as Record<string, unknown>) };

    // Hydrate api_key: direct DB reads yield Uint8Array or Buffer; legacy JSON path yields hex string.
    const rawKey = row.api_key;
    if (rawKey instanceof Uint8Array && !Buffer.isBuffer(rawKey)) {
      row.api_key = Buffer.from(rawKey);
    } else if (typeof rawKey === "string") {
      row.api_key = this.parseJsonBytea(rawKey);
    }
    // null stays null; Buffer stays Buffer.

    // Backward compat: older rows only stored a single auto-chat threshold.
    const threshold = Number(row.autoch_threshold ?? 0);
    const thresholdMax = Number(row.autoch_threshold_max ?? 0);
    if (Number.isFinite(threshold) && threshold > 0 && thresholdMax <= 0) {
      row.autoch_threshold_max = threshold;
    }

    // Guard timestamps: Bun SQL returns Date for TIMESTAMPTZ, but handle string edge cases.
    for (const key of ["created_at", "updated_at"] as const) {
      const value = row[key];
      if (typeof value === "string" || typeof value === "number") {
        const parsedDate = new Date(value);
        row[key] = Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
      }
    }

    return row;
  }

  // ── private SQL: config loading ───────────────────────────────────────────

  /**
   * Shared SELECT column list for all split-table config joins.
   * Referenced by both sqlLoadTomoriConfigByServerId and sqlLoadTomoriConfigByTomoriId.
   *
   * Table aliases:
   *   s    = servers
   *   smc  = server_model_configs          (1)
   *   scc  = server_chat_configs           (2)
   *   smpc = server_member_permissions_configs (3)
   *   scaps = server_capabilities_configs  (4)
   *   snec = server_notice_embeds_configs  (5)
   *   snsfw = server_nsfw_configs          (6)
   *   sspeech = server_speech_configs      (7)
   *   satc = server_auto_trigger_configs   (8)
   *   scsc = server_channel_scope_configs  (9)
   *   stbc = server_trigger_behavior_configs (10)
   *   snaic = server_novelai_imagegen_configs (11)
   *   sbyok = server_byok_configs          (12)
   *   smem = server_memory_configs         (13)
   *   swc  = server_welcome_configs        (not in composition schema; kept for backward compat)
   */

  private async sqlLoadTomoriConfigByServerId(serverId: number): Promise<AssembledServerConfig | null> {
    const [rawRow] = await sql`
      SELECT
        s.server_id,
        smc.created_at, smc.updated_at,
        -- 1. server_model_configs
        smc.llm_id, smc.embedding_model_id, smc.diffusion_model_id, smc.video_model_id,
        smc.vision_llm_id, smc.api_key, smc.key_version, smc.llm_temperature,
        smc.thinking_level, smc.llm_disabled_params, smc.custom_endpoint_url,
        smc.custom_model_name, smc.custom_num_ctx, smc.fallback_llm_ids,
        smc.other_model_codename, smc.other_model_capabilities,
        smc.other_model_capabilities_fetched_at, smc.hide_respond_embed,
        -- 2. server_chat_configs
        scc.humanizer_degree, scc.message_fetch_limit, scc.send_message_limit,
        scc.match_limit, scc.cascade_limit, scc.timezone_offset, scc.self_debug_enabled,
        scc.system_prompt, scc.context_note, scc.context_note_depth,
        scc.llm_stop_strings, scc.llm_stop_speaker_pattern_enabled,
        scc.llm_max_output_tokens, scc.llm_top_p, scc.llm_top_k,
        scc.llm_frequency_penalty, scc.llm_presence_penalty, scc.llm_min_p,
        scc.llm_logit_biases, scc.fallback_model_refs,
        -- 3. server_member_permissions_configs
        smpc.server_memteaching_enabled, smpc.attribute_memteaching_enabled,
        smpc.sampledialogue_memteaching_enabled, smpc.self_teaching_enabled,
        smpc.personal_memories_enabled, smpc.hide_impersonation_embeds,
        smpc.prompt_snapshot_enabled,
        -- 4. server_capabilities_configs
        scaps.emoji_usage_enabled, scaps.sticker_usage_enabled, scaps.web_search_enabled,
        scaps.manage_message_enabled, scaps.thread_creation_enabled, scaps.imagegen_enabled,
        scaps.videogen_enabled, scaps.voice_message_enabled, scaps.tool_use_enabled,
        -- 5. server_notice_embeds_configs
        snec.tool_notice_hidden_keys,
        -- 6. server_nsfw_configs
        snsfw.uncensor_injection_enabled, snsfw.uncensor_unicode_space_enabled,
        snsfw.uncensor_sanitize_enabled,
        -- 7. server_speech_configs
        sspeech.voice_transcript_chat_mode, sspeech.chatterbox_turbo_enabled,
        sspeech.chatterbox_cfg_weight, sspeech.chatterbox_exaggeration,
        -- 8. server_auto_trigger_configs (persona overrides aggregated from junction table)
        satc.autoch_disc_ids,
        (
          SELECT COALESCE(
            JSON_AGG(JSON_BUILD_OBJECT('channel_disc_id', o.channel_disc_id, 'persona_id', o.persona_id)),
            '[]'::JSON
          )
          FROM server_auto_trigger_persona_overrides o
          WHERE o.server_id = s.server_id
        ) AS autoch_persona_overrides,
        satc.autoch_threshold, satc.autoch_threshold_max,
        -- 9. server_channel_scope_configs
        scsc.rp_channel_ids, scsc.private_channel_ids, scsc.crosschannel_blocklist_ids,
        scsc.stm_privacy_bypass, scsc.thought_log_channel_disc_id,
        -- 10. server_trigger_behavior_configs
        stbc.always_reply_enabled, stbc.deliberate_trigger_mode,
        stbc.cooldown_type, stbc.cooldown_length,
        -- 11. server_novelai_imagegen_configs
        snaic.nai_preset_name, snaic.nai_style_tags, snaic.nai_negative_tags,
        snaic.nai_sampler, snaic.nai_steps, snaic.nai_scale,
        snaic.nai_noise_schedule, snaic.nai_cfg_rescale, snaic.nai_diffusion_model_id,
        -- 12. server_byok_configs
        sbyok.user_byok_mode,
        -- 13. server_memory_configs
        smem.memory_tagging_enabled,
        -- server_welcome_configs (backward compat; not part of the 13-schema composition)
        swc.welcome_channel_disc_id, swc.welcome_prompt, swc.welcome_persona_id
      FROM servers s
      LEFT JOIN server_model_configs smc ON smc.server_id = s.server_id
      LEFT JOIN server_chat_configs scc ON scc.server_id = s.server_id
      LEFT JOIN server_member_permissions_configs smpc ON smpc.server_id = s.server_id
      LEFT JOIN server_capabilities_configs scaps ON scaps.server_id = s.server_id
      LEFT JOIN server_notice_embeds_configs snec ON snec.server_id = s.server_id
      LEFT JOIN server_nsfw_configs snsfw ON snsfw.server_id = s.server_id
      LEFT JOIN server_speech_configs sspeech ON sspeech.server_id = s.server_id
      LEFT JOIN server_auto_trigger_configs satc ON satc.server_id = s.server_id
      LEFT JOIN server_channel_scope_configs scsc ON scsc.server_id = s.server_id
      LEFT JOIN server_trigger_behavior_configs stbc ON stbc.server_id = s.server_id
      LEFT JOIN server_novelai_imagegen_configs snaic ON snaic.server_id = s.server_id
      LEFT JOIN server_byok_configs sbyok ON sbyok.server_id = s.server_id
      LEFT JOIN server_memory_configs smem ON smem.server_id = s.server_id
      LEFT JOIN server_welcome_configs swc ON swc.server_id = s.server_id
      WHERE s.server_id = ${serverId}
    `;

    if (!rawRow) return null;

    const coerced = this.coerceNullsForZod(rawRow as Record<string, unknown>);
    const normalized = this.normalizeTomoriConfigFromJson(coerced);
    const parsedConfig = assembledServerConfigSchema.safeParse(normalized);
    if (!parsedConfig.success) {
      log.error(`Invalid server-scoped tomori config for server_id ${serverId}:`, parsedConfig.error.flatten());
      return null;
    }

    return parsedConfig.data;
  }

  /**
   * Loads config anchored on a persona_id by joining through personas → servers across split tables.
   * tomori_configs was dropped in Task F2 (migration 008); this method now reads exclusively from the 13 split tables.
   */
  private async sqlLoadTomoriConfigByTomoriId(personaId: number): Promise<AssembledServerConfig | null> {
    const [rawRow] = await sql`
      SELECT
        s.server_id,
        smc.created_at, smc.updated_at,
        -- 1. server_model_configs
        smc.llm_id, smc.embedding_model_id, smc.diffusion_model_id, smc.video_model_id,
        smc.vision_llm_id, smc.api_key, smc.key_version, smc.llm_temperature,
        smc.thinking_level, smc.llm_disabled_params, smc.custom_endpoint_url,
        smc.custom_model_name, smc.custom_num_ctx, smc.fallback_llm_ids,
        smc.other_model_codename, smc.other_model_capabilities,
        smc.other_model_capabilities_fetched_at, smc.hide_respond_embed,
        -- 2. server_chat_configs
        scc.humanizer_degree, scc.message_fetch_limit, scc.send_message_limit,
        scc.match_limit, scc.cascade_limit, scc.timezone_offset, scc.self_debug_enabled,
        scc.system_prompt, scc.context_note, scc.context_note_depth,
        scc.llm_stop_strings, scc.llm_stop_speaker_pattern_enabled,
        scc.llm_max_output_tokens, scc.llm_top_p, scc.llm_top_k,
        scc.llm_frequency_penalty, scc.llm_presence_penalty, scc.llm_min_p,
        scc.llm_logit_biases, scc.fallback_model_refs,
        -- 3. server_member_permissions_configs
        smpc.server_memteaching_enabled, smpc.attribute_memteaching_enabled,
        smpc.sampledialogue_memteaching_enabled, smpc.self_teaching_enabled,
        smpc.personal_memories_enabled, smpc.hide_impersonation_embeds,
        smpc.prompt_snapshot_enabled,
        -- 4. server_capabilities_configs
        scaps.emoji_usage_enabled, scaps.sticker_usage_enabled, scaps.web_search_enabled,
        scaps.manage_message_enabled, scaps.thread_creation_enabled, scaps.imagegen_enabled,
        scaps.videogen_enabled, scaps.voice_message_enabled, scaps.tool_use_enabled,
        -- 5. server_notice_embeds_configs
        snec.tool_notice_hidden_keys,
        -- 6. server_nsfw_configs
        snsfw.uncensor_injection_enabled, snsfw.uncensor_unicode_space_enabled,
        snsfw.uncensor_sanitize_enabled,
        -- 7. server_speech_configs
        sspeech.voice_transcript_chat_mode, sspeech.chatterbox_turbo_enabled,
        sspeech.chatterbox_cfg_weight, sspeech.chatterbox_exaggeration,
        -- 8. server_auto_trigger_configs (persona overrides aggregated from junction table)
        satc.autoch_disc_ids,
        (
          SELECT COALESCE(
            JSON_AGG(JSON_BUILD_OBJECT('channel_disc_id', o.channel_disc_id, 'persona_id', o.persona_id)),
            '[]'::JSON
          )
          FROM server_auto_trigger_persona_overrides o
          WHERE o.server_id = s.server_id
        ) AS autoch_persona_overrides,
        satc.autoch_threshold, satc.autoch_threshold_max,
        -- 9. server_channel_scope_configs
        scsc.rp_channel_ids, scsc.private_channel_ids, scsc.crosschannel_blocklist_ids,
        scsc.stm_privacy_bypass, scsc.thought_log_channel_disc_id,
        -- 10. server_trigger_behavior_configs
        stbc.always_reply_enabled, stbc.deliberate_trigger_mode,
        stbc.cooldown_type, stbc.cooldown_length,
        -- 11. server_novelai_imagegen_configs
        snaic.nai_preset_name, snaic.nai_style_tags, snaic.nai_negative_tags,
        snaic.nai_sampler, snaic.nai_steps, snaic.nai_scale,
        snaic.nai_noise_schedule, snaic.nai_cfg_rescale, snaic.nai_diffusion_model_id,
        -- 12. server_byok_configs
        sbyok.user_byok_mode,
        -- 13. server_memory_configs
        smem.memory_tagging_enabled,
        -- server_welcome_configs (backward compat; not part of the 13-schema composition)
        swc.welcome_channel_disc_id, swc.welcome_prompt, swc.welcome_persona_id
      FROM personas t
      JOIN servers s ON s.server_id = t.server_id
      LEFT JOIN server_model_configs smc ON smc.server_id = s.server_id
      LEFT JOIN server_chat_configs scc ON scc.server_id = s.server_id
      LEFT JOIN server_member_permissions_configs smpc ON smpc.server_id = s.server_id
      LEFT JOIN server_capabilities_configs scaps ON scaps.server_id = s.server_id
      LEFT JOIN server_notice_embeds_configs snec ON snec.server_id = s.server_id
      LEFT JOIN server_nsfw_configs snsfw ON snsfw.server_id = s.server_id
      LEFT JOIN server_speech_configs sspeech ON sspeech.server_id = s.server_id
      LEFT JOIN server_auto_trigger_configs satc ON satc.server_id = s.server_id
      LEFT JOIN server_channel_scope_configs scsc ON scsc.server_id = s.server_id
      LEFT JOIN server_trigger_behavior_configs stbc ON stbc.server_id = s.server_id
      LEFT JOIN server_novelai_imagegen_configs snaic ON snaic.server_id = s.server_id
      LEFT JOIN server_byok_configs sbyok ON sbyok.server_id = s.server_id
      LEFT JOIN server_memory_configs smem ON smem.server_id = s.server_id
      LEFT JOIN server_welcome_configs swc ON swc.server_id = s.server_id
      WHERE t.persona_id = ${personaId}
      LIMIT 1
    `;

    if (!rawRow) return null;

    const coerced = this.coerceNullsForZod(rawRow as Record<string, unknown>);
    const normalized = this.normalizeTomoriConfigFromJson(coerced);
    const parsedConfig = assembledServerConfigSchema.safeParse(normalized);
    if (!parsedConfig.success) {
      log.error(`Invalid legacy tomori config for persona_id ${personaId}:`, parsedConfig.error.flatten());
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
        FROM personas t
        JOIN servers s ON t.server_id = s.server_id
        WHERE s.server_disc_id = ${serverDiscId}
        ORDER BY t.is_alter ASC, t.updated_at DESC NULLS LAST, t.persona_id DESC
        LIMIT 1
      `;

      if (!tomoriRows.length) {
        log.warn(`No Tomori instance found for server ${serverDiscId}`);
        return null;
      }
      const tomoriData = tomoriRows[0];

      // 2. Load associated config using server_id (server-scoped config)
      // biome-ignore lint/style/noNonNullAssertion: Row existence checked above, ID is guaranteed by DB schema.
      const personaId = tomoriData.persona_id!;
      const serverId = tomoriData.server_id;
      let configData = await this.sqlLoadTomoriConfigByServerId(serverId);

      // Backward compatibility: fall back to persona_id if server_id config missing
      if (!configData) {
        log.warn(`No server-scoped config found for server ${serverDiscId}; falling back to persona_id ${personaId}`);
        configData = await this.sqlLoadTomoriConfigByTomoriId(personaId);
      }

      if (!configData) {
        log.error(`Found Tomori (${personaId}) but no config for server ${serverDiscId}`);
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
        WHERE persona_id = ${personaId}
        LIMIT 1
      `;
      let personaConfig: PersonaConfigRow | null = null;
      if (personaConfigRows.length > 0) {
        const parsedPersonaConfig = personaConfigSchema.safeParse(personaConfigRows[0]);
        if (parsedPersonaConfig.success) {
          personaConfig = parsedPersonaConfig.data;
        } else {
          log.warn(`Invalid persona config row for tomori ${personaId}:`, parsedPersonaConfig.error.flatten());
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

      // 6. Load autochat runtime counters for this persona (default to 0 if row not yet created).
      const autochRuntimeRows = await sql`
        SELECT autoch_counter, autoch_next_target
        FROM persona_autoch_runtime_state
        WHERE persona_id = ${personaId}
        LIMIT 1
      `;
      const autochRuntime: Pick<PersonaAutochRuntimeStateRow, "autoch_counter" | "autoch_next_target"> =
        autochRuntimeRows.length > 0
          ? {
              autoch_counter: (autochRuntimeRows[0].autoch_counter as number) ?? 0,
              autoch_next_target: (autochRuntimeRows[0].autoch_next_target as number) ?? 0,
            }
          : { autoch_counter: 0, autoch_next_target: 0 };

      // 7. Load API key rotation pool for this server (if any)
      const rotationKeysRows = await sql`
        SELECT
          akr.rotation_key_id, akr.server_id, akr.provider, akr.api_key, akr.key_version,
          akr.is_main_key_pointer, akr.is_enabled, akr.created_at, akr.updated_at,
          COALESCE(rs.usage_count, 0) AS usage_count,
          COALESCE(rs.error_count, 0) AS error_count,
          rs.last_used_at, rs.last_error_at, rs.last_error_type, rs.last_error_message
        FROM api_key_rotation akr
        LEFT JOIN api_key_rotation_runtime_state rs USING (rotation_key_id)
        WHERE akr.server_id = ${tomoriData.server_id}
        ORDER BY COALESCE(rs.usage_count, 0) ASC, akr.rotation_key_id ASC
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

      // 8. Load active NAI preset if one is configured for this server
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

      // 9. Resolve fallback model chain — prefer fallback_model_refs (new), fall back to fallback_llm_ids (legacy)
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

      // 10. Load vision model if configured (for non-vision chat model image analysis delegation)
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

      // 11. Combine and validate the full state
      const combinedState = {
        ...tomoriData,
        config: configData,
        llm: llmData,
        trigger_words: personaConfig?.trigger_words ?? [],
        persona_prompt: personaConfig?.persona_prompt ?? null,
        reward_conditioning_enabled: personaConfig?.reward_conditioning_enabled ?? true,
        punish_conditioning_enabled: personaConfig?.punish_conditioning_enabled ?? true,
        ...autochRuntime,
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
            FROM personas t
            JOIN servers s ON t.server_id = s.server_id
            WHERE s.server_disc_id = ${serverDiscId}
            ORDER BY t.is_alter ASC, t.updated_at DESC NULLS LAST, t.persona_id DESC
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
            const fallbackTomoriId = mainTomoriRow?.persona_id;
            if (fallbackTomoriId) {
              log.warn(
                `No server-scoped config found for server ${serverDiscId}; falling back to persona_id ${fallbackTomoriId}`,
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
            SELECT
              akr.rotation_key_id, akr.server_id, akr.provider, akr.api_key, akr.key_version,
              akr.is_main_key_pointer, akr.is_enabled, akr.created_at, akr.updated_at,
              COALESCE(rs.usage_count, 0) AS usage_count,
              COALESCE(rs.error_count, 0) AS error_count,
              rs.last_used_at, rs.last_error_at, rs.last_error_type, rs.last_error_message
            FROM api_key_rotation akr
            LEFT JOIN api_key_rotation_runtime_state rs USING (rotation_key_id)
            WHERE akr.server_id = ${serverId}
            ORDER BY COALESCE(rs.usage_count, 0) ASC, akr.rotation_key_id ASC
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
            JOIN personas t ON t.persona_id = pc.persona_id
            WHERE t.server_id = ${serverId}
          `;
          const personaConfigMap = new Map<number, PersonaConfigRow>();
          for (const row of personaConfigRows) {
            const parsed = personaConfigSchema.safeParse(row);
            if (parsed.success) {
              personaConfigMap.set(parsed.data.persona_id, parsed.data);
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

          // 8. Batch-load autochat runtime counters for all personas in this server.
          const personaIds: number[] = (tomoriRows as TomoriRow[])
            .map((r) => r.persona_id)
            .filter((id): id is number => typeof id === "number");
          const autochRuntimeRows =
            personaIds.length > 0
              ? await sql`
                SELECT persona_id, autoch_counter, autoch_next_target
                FROM persona_autoch_runtime_state
                WHERE persona_id = ANY(${sql.array(personaIds, "int4")})
              `
              : [];
          const autochRuntimeByPersonaId = new Map<
            number,
            Pick<PersonaAutochRuntimeStateRow, "autoch_counter" | "autoch_next_target">
          >();
          for (const row of autochRuntimeRows) {
            autochRuntimeByPersonaId.set(row.persona_id as number, {
              autoch_counter: (row.autoch_counter as number) ?? 0,
              autoch_next_target: (row.autoch_next_target as number) ?? 0,
            });
          }

          // 9. Load vision model if configured (server-scoped, loaded once for all personas)
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

          // 10. Build persona states
          const personas: TomoriState[] = [];
          for (const tomoriRow of tomoriRows) {
            const personaId = tomoriRow.persona_id;
            if (!personaId) {
              log.warn(`Skipping persona with missing persona_id for server ${serverDiscId}`);
              continue;
            }

            const personaConfig = personaConfigMap.get(personaId);

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

            const autochRuntime = autochRuntimeByPersonaId.get(personaId) ?? {
              autoch_counter: 0,
              autoch_next_target: 0,
            };

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
              ...autochRuntime,
              vision_llm: visionLlm,
              fallback_llms: fallbackLlms.length > 0 ? fallbackLlms : undefined,
              fallback_chain: fallbackChain,
              persona_llm: personaLlm,
            };

            const parsedState = tomoriStateSchema.safeParse(combinedState);
            if (!parsedState.success) {
              log.error(
                `Failed to validate persona state for server ${serverDiscId}, persona_id ${personaId}:`,
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

  private async loadPersonaConfigRow(personaId: number): Promise<PersonaConfigRow | null> {
    try {
      const rows = await sql`
        SELECT *
        FROM persona_configs
        WHERE persona_id = ${personaId}
        LIMIT 1
      `;

      if (!rows.length) {
        return null;
      }

      const parsed = personaConfigSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.warn(`Failed to validate persona config for tomori ${personaId}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading persona config for tomori ${personaId}:`, error);
      return null;
    }
  }

  // ── private SQL: tomori writes ────────────────────────────────────────────

  private async updateTomori(personaId: number, tomoriData: Partial<TomoriRow>): Promise<TomoriRow | null> {
    try {
      // Validate the partial data with Zod (Rule #7)
      const validTomoriData = tomoriSchema.partial().parse(tomoriData);

      // Extract field names and values for the SQL query.
      // Filter to only keys present in the original input — Zod injects defaults
      // for all schema fields with .default(), which would incorrectly expand the
      // SET clause (e.g. attribute_list: [] would overwrite existing data).
      const fields = Object.keys(validTomoriData).filter((key) => key !== "persona_id" && key in tomoriData);

      if (fields.length === 0) {
        log.warn(`No fields provided to update for persona_id: ${personaId}`);
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

      // 4. Add the personaId as the last parameter for the WHERE clause
      const finalPlaceholderIndex = values.length + 1;
      values.push(personaId);

      // 5. Execute the UPDATE using sql.unsafe() with the values array (not spread —
      // Bun SQL expects a single array argument, not individual arguments).
      const result = await sql.unsafe(
        `
          UPDATE personas
          SET ${setClause}
          WHERE persona_id = $${finalPlaceholderIndex}
          RETURNING *
        `,
        values,
      );

      if (!result.length) {
        const context: ErrorContext = {
          personaId,
          errorType: "DatabaseUpdateError",
          metadata: {
            operation: "updateTomori",
            fields,
          },
        };
        await log.error(`No tomori found with id: ${personaId}`, new Error("Tomori not found"), context);
        return null;
      }

      // Validate the returned data for type safety
      const updatedTomori = tomoriSchema.safeParse(result[0]);
      if (!updatedTomori.success) {
        const context: ErrorContext = {
          personaId,
          errorType: "SchemaValidationError",
          metadata: {
            operation: "updateTomori",
            validationErrors: updatedTomori.error.flatten(),
          },
        };
        await log.error(`Failed to validate updated tomori for id: ${personaId}`, updatedTomori.error, context);
        return null;
      }

      return updatedTomori.data;
    } catch (error) {
      const context: ErrorContext = {
        personaId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "updateTomori",
        },
      };
      await log.error(`Error updating tomori for id: ${personaId}`, error, context);
      return null;
    }
  }
}

/** Singleton instance — import this in callers. */
export const personaRepository = new PersonaRepository();

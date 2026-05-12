import { sql, withCachedPlanRetry } from "@/utils/db/client";
import { getUnconfiguredLlm } from "@/utils/provider/unconfiguredLlm";
import {
  tomoriStateSchema,
  userSchema,
  serverEmojiSchema,
  personalMemorySchema,
  personaConfigSchema,
  type TomoriState,
  type TomoriRow,
  tomoriConfigSchema,
  type TomoriConfigRow,
  type UserRow,
  type ServerEmojiRow,
  type LlmRow,
  type PersonalMemoryRow,
  type PersonaConfigRow,
  llmSchema,
  diffusionModelSchema,
  type DiffusionModelRow,
  type EmbeddingModelRow,
  embeddingModelSchema,
  videoGenerationModelSchema,
  type VideoGenerationModelRow,
  type ServerStickerRow,
  serverStickerSchema,
  reminderSchema,
  type ReminderRow,
  customEndpointSchema,
  type CustomEndpointCapability,
  type CustomEndpointRow,
  openRouterEmbeddingModelRegistrationSchema,
  type OpenRouterEmbeddingModelRegistrationRow,
  openRouterImageModelRegistrationSchema,
  openRouterModelRegistrationSchema,
  type OpenRouterModelRegistrationRow,
  openRouterVideoModelRegistrationSchema,
  type OpenRouterImageModelRegistrationRow,
  type OpenRouterVideoModelRegistrationRow,
  type TomoriPresetRow,
  type SystemPromptPresetRow,
  type ApiKeyRotationRow,
  apiKeyRotationSchema,
  randomTriggerSchema,
  type RandomTriggerRow,
  naiPresetSchema,
  savedProviderConfigSchema,
  type SavedProviderConfigRow,
  userSavedProviderConfigSchema,
  type UserSavedProviderConfigRow,
  type NaiPresetRow,
  type FallbackEntry,
  type FallbackModelRef,
} from "../../types/db/schema"; // Import base schemas and types
import { log } from "../misc/logger";
import { getCachedLLM } from "../cache/llmCache";
import { DatabaseUnavailableError } from "@/types/errors";
import { emitScheduledWorkNudge } from "@/timers/scheduledWorkSignals";

type TomoriConfigJsonResult = {
  config: unknown;
};

const FALLBACK_DEBUG_ENABLED = new Set(["1", "true", "yes", "on"]).has(
  (process.env.FALLBACK_DEBUG_ENABLED ?? "").trim().toLowerCase(),
);

/**
 * Converts a Postgres bytea JSON representation (e.g., "\\xDEADBEEF") to Buffer.
 * Returns null when the input is malformed or cannot be parsed.
 */
function parseJsonBytea(value: unknown): Buffer | null {
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
 * This avoids Bun/Postgres INT[] binary decoding issues while preserving schema shape.
 */
function normalizeTomoriConfigFromJson(rawConfig: unknown): unknown {
  if (!rawConfig || typeof rawConfig !== "object" || Array.isArray(rawConfig)) {
    return rawConfig;
  }

  const normalizedConfig = {
    ...(rawConfig as Record<string, unknown>),
  };

  // Convert JSON bytea string back to Buffer for decryption codepaths.
  normalizedConfig.api_key = parseJsonBytea(normalizedConfig.api_key);

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

/**
 * Loads and validates a server config row through JSON projection to avoid
 * Bun/Postgres INT[] binary decoding failures.
 */
async function loadTomoriConfigRowByServerId(serverId: number): Promise<TomoriConfigRow | null> {
  const configRows = await sql<TomoriConfigJsonResult[]>`
		SELECT to_jsonb(tc) AS config
		FROM tomori_configs tc
		WHERE tc.server_id = ${serverId}
		LIMIT 1
	`;

  if (!configRows.length) {
    return null;
  }

  const normalized = normalizeTomoriConfigFromJson(configRows[0].config);
  const parsedConfig = tomoriConfigSchema.safeParse(normalized);
  if (!parsedConfig.success) {
    log.error(`Invalid server-scoped tomori config for server_id ${serverId}:`, parsedConfig.error.flatten());
    return null;
  }

  return parsedConfig.data;
}

/**
 * Loads and validates a legacy tomori config row by tomori_id through JSON projection.
 */
async function loadTomoriConfigRowByTomoriId(tomoriId: number): Promise<TomoriConfigRow | null> {
  const configRows = await sql<TomoriConfigJsonResult[]>`
		SELECT to_jsonb(tc) AS config
		FROM tomori_configs tc
		WHERE tc.tomori_id = ${tomoriId}
		LIMIT 1
	`;

  if (!configRows.length) {
    return null;
  }

  const normalized = normalizeTomoriConfigFromJson(configRows[0].config);
  const parsedConfig = tomoriConfigSchema.safeParse(normalized);
  if (!parsedConfig.success) {
    log.error(`Invalid legacy tomori config for tomori_id ${tomoriId}:`, parsedConfig.error.flatten());
    return null;
  }

  return parsedConfig.data;
}

/**
 * Loads multiple LLM rows by their IDs, returning results in the same order as the input array.
 * Invalid rows are skipped with a warning log. Returns empty array immediately for empty input.
 *
 * @param ids - Array of llm_id values to fetch
 * @returns Ordered array of validated LlmRow objects (preserves input order, skips missing/invalid rows)
 */
export async function getLlmsByIds(ids: number[]): Promise<LlmRow[]> {
  if (ids.length === 0) return [];

  try {
    // 1. Fetch all matching rows in a single query using an IN (...) list.
    //    Avoid ANY($1) array binding here - Bun SQL can intermittently fail on
    //    integer-array parameters with protocol error 08P01.
    const distinctIds = Array.from(new Set(ids));
    const placeholders = distinctIds.map((_, index) => `$${index + 1}`).join(", ");
    const rows = await sql.unsafe(
      `
			SELECT * FROM llms
			WHERE llm_id IN (${placeholders})
		`,
      distinctIds,
    );

    // 2. Validate each row and index by ID for order-preserving lookup
    const rowMap = new Map<number, LlmRow>();
    for (const row of rows) {
      const parsed = llmSchema.safeParse(row);
      if (parsed.success && parsed.data.llm_id !== undefined) {
        rowMap.set(parsed.data.llm_id, parsed.data);
      } else if (!parsed.success) {
        log.warn(`Invalid LLM row for id ${row.llm_id}:`, parsed.error.flatten());
      }
    }

    // 3. Return in the same order as the input ids, skipping any missing entries
    return ids.flatMap((id) => {
      const llm = rowMap.get(id);
      return llm ? [llm] : [];
    });
  } catch (error) {
    log.error(`Error loading LLMs by ids [${ids.join(", ")}]:`, error);
    return [];
  }
}

/**
 * Loads all NovelAI sampling presets for a given model target.
 * Results are ordered: defaults first, then alphabetically by preset_name.
 *
 * @param target - The model target: "kayra" or "erato"
 * @returns Array of validated NaiPresetRow objects, or empty array on error
 */
export async function loadNaiPresetsForModel(target: "kayra" | "erato"): Promise<NaiPresetRow[]> {
  try {
    const rows = await sql`
			SELECT * FROM nai_presets
			WHERE model_target = ${target}
			ORDER BY is_default DESC, preset_name ASC
		`;

    const presets: NaiPresetRow[] = [];
    for (const row of rows) {
      const parsed = naiPresetSchema.safeParse(row);
      if (parsed.success) {
        presets.push(parsed.data);
      } else {
        log.warn(`Invalid nai_preset row for target ${target}:`, parsed.error.flatten());
      }
    }
    return presets;
  } catch (error) {
    log.error(`Error loading NAI presets for model target ${target}:`, error);
    return [];
  }
}

/**
 * Loads the complete Tomori state (base row + config + server memories) for a given server.
 * Validates the combined state using Zod.
 * @param serverDiscId - The Discord ID of the server.
 * @returns The validated TomoriState object, or null if not found or invalid.
 */
export async function loadTomoriState(serverDiscId: string): Promise<TomoriState | null> {
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
    let configData = await loadTomoriConfigRowByServerId(serverId);

    // Backward compatibility: fall back to tomori_id if server_id config missing
    if (!configData) {
      log.warn(`No server-scoped config found for server ${serverDiscId}; falling back to tomori_id ${tomoriId}`);
      configData = await loadTomoriConfigRowByTomoriId(tomoriId);
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
    const fallbackLlms = fallbackLlmIds.length > 0 ? await getLlmsByIds(fallbackLlmIds) : [];
    if (FALLBACK_DEBUG_ENABLED) {
      log.info(
        `[FallbackDebug][loadTomoriState] server_disc_id=${serverDiscId} server_id=${serverId} raw_fallback_ids=${JSON.stringify(rawFallbackIds)} parsed_fallback_ids=[${fallbackLlmIds.join(", ")}] resolved_fallbacks=[${fallbackLlms.map((llm) => `${llm.llm_id}:${llm.llm_codename}`).join(", ")}]`,
      );
    }

    // 8b. Build typed fallback_chain from fallback_model_refs (supports both llm and custom_endpoint refs)
    const modelRefs = configData.fallback_model_refs ?? [];
    let fallbackChain: FallbackEntry[] | undefined;
    if (modelRefs.length > 0) {
      const llmRefIds = modelRefs.filter((r: FallbackModelRef) => r.type === "llm").map((r: FallbackModelRef) => r.id);
      const epRefIds = modelRefs
        .filter((r: FallbackModelRef) => r.type === "custom_endpoint")
        .map((r: FallbackModelRef) => r.id);
      const [refLlms, refEndpoints] = await Promise.all([
        llmRefIds.length > 0 ? getLlmsByIds(llmRefIds) : Promise.resolve([]),
        epRefIds.length > 0 ? loadCustomEndpointsByIds(epRefIds) : Promise.resolve([]),
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
    const fallbackTriggerWords =
      tomoriData.is_alter === true ? (tomoriData.alter_triggers ?? []) : (configData.trigger_words ?? []);
    const combinedState = {
      ...tomoriData,
      config: configData,
      llm: llmData, // Add the LLM data to match schema
      // Use persona-scoped trigger_words only when non-empty; an empty array (Zod default when
      // the persona_configs row exists but the column is NULL/unset) should fall back to the
      // legacy alter_triggers / config trigger_words so existing alters aren't silently broken.
      trigger_words: personaConfig?.trigger_words?.length ? personaConfig.trigger_words : fallbackTriggerWords,
      persona_prompt: personaConfig?.persona_prompt ?? null,
      reward_conditioning_enabled: personaConfig?.reward_conditioning_enabled ?? true,
      punish_conditioning_enabled: personaConfig?.punish_conditioning_enabled ?? true,
      server_memories: serverMemories, // Add server memories to the state
      rotation_keys: rotationKeys.length > 0 ? rotationKeys : undefined, // Add rotation keys if any
      vision_llm: visionLlm, // Dedicated vision model (undefined when not configured)
      nai_preset: naiPreset, // Active NAI sampling preset (undefined when not configured)
      fallback_llms: fallbackLlms.length > 0 ? fallbackLlms : undefined, // Resolved fallback model chain (legacy)
      fallback_chain: fallbackChain, // Resolved typed fallback chain (llm + custom_endpoint)
    };

    // Use Zod to parse and validate the combined structure
    const parsedState = tomoriStateSchema.safeParse(combinedState);

    if (!parsedState.success) {
      log.error(`Failed to validate combined Tomori state for server ${serverDiscId}:`, parsedState.error.flatten());
      return null;
    }

    // Return the validated, combined state object
    return parsedState.data;
  } catch (error) {
    log.error(`Error loading tomori state for server ${serverDiscId}:`, error);
    return null;
  }
}

/**
 * Loads ALL personas (main + alters) for a server.
 * Returns array of TomoriState objects, with main persona first (is_alter=false).
 * Used for trigger matching to check all personas.
 *
 * @param serverDiscId - The Discord ID of the server.
 * @returns Array of validated TomoriState objects (main first, then alters), or empty array if error/not found.
 */
export async function loadAllPersonasForServer(serverDiscId: string): Promise<TomoriState[]> {
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
        let configData = await loadTomoriConfigRowByServerId(serverId);

        if (!configData) {
          const mainTomoriRow = tomoriRows.find((row: TomoriRow) => row.is_alter === false) ?? tomoriRows[0];
          const fallbackTomoriId = mainTomoriRow?.tomori_id;
          if (fallbackTomoriId) {
            log.warn(
              `No server-scoped config found for server ${serverDiscId}; falling back to tomori_id ${fallbackTomoriId}`,
            );
            configData = await loadTomoriConfigRowByTomoriId(fallbackTomoriId);
          }
        }

        if (!configData) {
          log.error(`No config found for server ${serverDiscId}; cannot build persona states`);
          return [];
        }

        // 3. Resolve server-scoped fallback chain once (shared across all personas for this server).
        const rawFallbackIds = configData.fallback_llm_ids;
        const fallbackLlmIds = configData.fallback_llm_ids;
        const fallbackLlms = fallbackLlmIds.length > 0 ? await getLlmsByIds(fallbackLlmIds) : [];
        if (FALLBACK_DEBUG_ENABLED) {
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
            llmRefIds.length > 0 ? getLlmsByIds(llmRefIds) : Promise.resolve([]),
            epRefIds.length > 0 ? loadCustomEndpointsByIds(epRefIds) : Promise.resolve([]),
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

          const fallbackTriggerWords =
            tomoriRow.is_alter === true ? (tomoriRow.alter_triggers ?? []) : (configData.trigger_words ?? []);
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
            // Use persona-scoped trigger_words only when non-empty; an empty array (Zod default when
            // the persona_configs row exists but the column is NULL/unset) should fall back to the
            // legacy alter_triggers / config trigger_words so existing alters aren't silently broken.
            trigger_words: personaConfig?.trigger_words?.length ? personaConfig.trigger_words : fallbackTriggerWords,
            persona_prompt: personaConfig?.persona_prompt ?? null,
            reward_conditioning_enabled: personaConfig?.reward_conditioning_enabled ?? true,
            punish_conditioning_enabled: personaConfig?.punish_conditioning_enabled ?? true,
            server_memories: serverMemories,
            rotation_keys: rotationKeys.length > 0 ? rotationKeys : undefined,
            vision_llm: visionLlm, // Dedicated vision model (undefined when not configured)
            fallback_llms: fallbackLlms.length > 0 ? fallbackLlms : undefined, // legacy
            fallback_chain: fallbackChain,
            persona_llm: personaLlm, // undefined if no override set
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

/**
 * Loads a user's state (UserRow) from the database.
 * @param userDiscId - Discord user ID.
 * @returns UserRow object or null if not found or invalid.
 */
export async function loadUserRow(userDiscId: string): Promise<UserRow | null> {
  return await withCachedPlanRetry(async () => {
    try {
      const rows = await sql`
				SELECT * FROM users
				WHERE user_disc_id = ${userDiscId}
				LIMIT 1
			`;

      if (!rows.length) {
        return null;
      }

      // Validate the row against the schema
      const parsedUser = userSchema.safeParse(rows[0]);
      if (!parsedUser.success) {
        log.error(`Failed to validate user data for ID ${userDiscId}:`, parsedUser.error.flatten());
        return null;
      }

      return parsedUser.data;
    } catch (error) {
      log.error(`Error loading user row for ID ${userDiscId}:`, error);
      return null;
    }
  }, `load user row for ID ${userDiscId}`);
}

/**
 * Loads user rows whose saved nickname exactly matches the provided normalized nickname.
 * Matching is case-insensitive, trims leading/trailing whitespace, and collapses repeated whitespace.
 * @param normalizedNickname - Pre-normalized nickname to match against
 * @returns Array of validated UserRow objects
 */
export async function loadUserRowsByNormalizedNickname(normalizedNickname: string): Promise<UserRow[]> {
  return (
    (await withCachedPlanRetry(async () => {
      try {
        const nickname = normalizedNickname.trim().toLowerCase().replace(/\s+/g, " ");
        if (!nickname) {
          return [];
        }

        const rows = await sql`
				SELECT *
				FROM users
				WHERE regexp_replace(lower(trim(user_nickname)), '[[:space:]]+', ' ', 'g') = ${nickname}
			`;

        const parsedUsers: UserRow[] = [];
        for (const row of rows) {
          const parsedUser = userSchema.safeParse(row);
          if (!parsedUser.success) {
            log.error(
              `Failed to validate user data while matching nickname "${normalizedNickname}":`,
              parsedUser.error.flatten(),
            );
            continue;
          }
          parsedUsers.push(parsedUser.data);
        }

        return parsedUsers;
      } catch (error) {
        log.error(`Error loading user rows for nickname "${normalizedNickname}":`, error);
        return [];
      }
    }, `load user rows for nickname ${normalizedNickname}`)) ?? []
  );
}

/**
 * Loads persona-scoped config row for a specific persona.
 * @param tomoriId - Internal persona ID.
 * @returns PersonaConfigRow or null if not found/invalid.
 */
export async function loadPersonaConfigRow(tomoriId: number): Promise<PersonaConfigRow | null> {
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

/**
 * Loads lineage-scoped personal memories for a user.
 * Lineage 0 is the global personal memory namespace shared across personas/servers.
 *
 * @param userId - Internal user ID.
 * @param personaLineageId - Current persona lineage ID.
 * @param includeGlobalMemories - Include lineage 0 global memories alongside lineage memories.
 * @returns Array of validated personal memory rows, newest first.
 */
export async function loadPersonalMemoriesForUserLineage(
  userId: number,
  personaLineageId: number,
  includeGlobalMemories = true,
): Promise<PersonalMemoryRow[]> {
  try {
    const rows =
      includeGlobalMemories && personaLineageId !== 0
        ? await sql`
					SELECT *
					FROM personal_memories
					WHERE user_id = ${userId}
					  AND (
						persona_lineage_id = ${personaLineageId}
						OR persona_lineage_id = 0
					  )
					ORDER BY created_at DESC, personal_memory_id DESC
				`
        : await sql`
					SELECT *
					FROM personal_memories
					WHERE user_id = ${userId}
					  AND persona_lineage_id = ${personaLineageId}
					ORDER BY created_at DESC, personal_memory_id DESC
				`;

    const parsedRows: PersonalMemoryRow[] = [];
    for (const row of rows) {
      const parsed = personalMemorySchema.safeParse(row);
      if (parsed.success) {
        parsedRows.push(parsed.data);
      } else {
        log.warn(`Skipping invalid personal memory row for user ${userId}:`, parsed.error.flatten());
      }
    }

    return parsedRows;
  } catch (error) {
    log.error(`Error loading personal memories for user ${userId} and lineage ${personaLineageId}:`, error);
    return [];
  }
}

/**
 * Checks if a user is blacklisted from personalization in a server.
 * @param serverDiscId - Discord server ID.
 * @param userDiscId - Discord user ID.
 * @returns true if user is blacklisted, false otherwise.
 */
export async function isBlacklisted(serverDiscId: string, userDiscId: string): Promise<boolean> {
  try {
    // Use EXISTS for efficiency - now using user_disc_id directly
    const result = await sql`
			SELECT EXISTS (
				SELECT 1
				FROM personalization_blacklist pb
				JOIN servers s ON pb.server_id = s.server_id
				WHERE s.server_disc_id = ${serverDiscId}
				AND pb.user_disc_id = ${userDiscId}
			) as "exists";
		`;

    // Bun's sql returns [{ exists: true }] or [{ exists: false }]
    // biome-ignore lint/style/noNonNullAssertion: Query guarantees result[0] exists
    return result[0]!.exists;
  } catch (error) {
    log.error(`Error checking blacklist for user ${userDiscId} in server ${serverDiscId}:`, error);
    return false; // Default to false on error to avoid blocking personalization unintentionally
  }
}

/**
 * Gets the privacy level for a user globally.
 * This determines what personalization features are available to the user.
 *
 * Privacy levels:
 * - Level 0 (MINIMAL): Full personalization, all features enabled
 * - Level 1 (PARTIAL): Messages visible but no personal memory access by LLM
 * - Level 2 (FULL): Completely invisible, cannot trigger bot
 *
 * @param userDiscId - The Discord ID of the user to check
 * @returns The user's privacy level (0, 1, or 2), defaults to 0 (MINIMAL) if user not found
 */
export async function getPrivacyLevel(userDiscId: string): Promise<import("@/types/db/schema").PrivacyLevel> {
  const { PrivacyLevel } = await import("@/types/db/schema");

  try {
    // 1. Query user's privacy level
    const result = await sql`
			SELECT privacy_level
			FROM users
			WHERE user_disc_id = ${userDiscId}
			LIMIT 1
		`;

    // 2. If user doesn't exist, return MINIMAL (default - most permissive)
    if (!result.length) {
      return PrivacyLevel.MINIMAL;
    }

    // 3. Validate and return the privacy level
    // biome-ignore lint/style/noNonNullAssertion: Query guarantees result[0] exists when length > 0
    const level = result[0]!.privacy_level;
    if (![0, 1, 2].includes(level)) {
      log.warn(`Invalid privacy level ${level} for user ${userDiscId}, defaulting to MINIMAL`);
      return PrivacyLevel.MINIMAL;
    }

    return level as import("@/types/db/schema").PrivacyLevel;
  } catch (error) {
    log.error(`Error checking privacy level for user ${userDiscId}:`, error);
    return PrivacyLevel.MINIMAL; // Default to most permissive on error
  }
}

/**
 * Backward compatibility helper: checks if user has opted out (Level 2 = FULL privacy)
 * @deprecated Use getPrivacyLevel() instead for granular privacy checking
 * @param userDiscId - The Discord ID of the user to check
 * @returns True if user is at Level 2 (FULL privacy), false otherwise
 */
export async function isPrivacyOptedOut(userDiscId: string): Promise<boolean> {
  const { PrivacyLevel } = await import("@/types/db/schema");
  const level = await getPrivacyLevel(userDiscId);
  return level === PrivacyLevel.FULL;
}

/**
 * Get user's cross-server short-term memory sharing preference
 *
 * Phase 4: User Controls & Privacy
 *
 * @param userDiscId - Discord user ID
 * @returns True if user has opted in to cross-server sharing, false otherwise
 */
export async function getCrossServerShortTermMemoryOptIn(userDiscId: string): Promise<boolean> {
  try {
    // 1. Try to get from user cache
    const { getCachedUserRow } = await import("@/utils/cache/userCache");
    const cached = await getCachedUserRow(userDiscId);
    if (cached) {
      return cached.shortterm_cache_crossserver_opt_in;
    }

    // 2. Query database if not in cache
    const [user] = await sql`
			SELECT shortterm_cache_crossserver_opt_in
			FROM users
			WHERE user_disc_id = ${userDiscId}
		`;

    return user?.shortterm_cache_crossserver_opt_in ?? false;
  } catch (error) {
    log.error(`Error checking cross-server short-term memory opt-in for user ${userDiscId}:`, error);
    return false; // Default to disabled on error
  }
}

/**
 * Loads all custom emojis for a given server.
 * @param internalServerId - The internal database ID of the server.
 * @returns An array of validated ServerEmojiRow objects, or null if none found or error.
 */
export async function loadServerEmojis(internalServerId: number): Promise<ServerEmojiRow[] | null> {
  try {
    const emojiRows = await sql`
			SELECT *
			FROM server_emojis
			WHERE server_id = ${internalServerId}
		`;

    if (!emojiRows || emojiRows.length === 0) {
      return null;
    }

    const parsedEmojis = serverEmojiSchema.array().safeParse(emojiRows);

    if (!parsedEmojis.success) {
      log.error(`Failed to validate emojis for server ID ${internalServerId}:`, parsedEmojis.error.flatten());
      return null;
    }

    return parsedEmojis.data;
  } catch (error) {
    log.error(`Error loading emojis for server ID ${internalServerId}:`, error);
    return null;
  }
}

/**
 * Loads all available LLM models from the database.
 * @param includeDeprecated - Whether to include deprecated models in the results (default: false).
 * @returns An array of validated LlmRow objects, or null if none found or error.
 */
export async function loadAvailableLlms(includeDeprecated = false): Promise<LlmRow[] | null> {
  try {
    // 1. Fetch rows from the llms table, filtering deprecated models unless explicitly included
    const llmRows = includeDeprecated
      ? await sql`
				SELECT * FROM llms
				ORDER BY llm_id ASC
			`
      : await sql`
				SELECT * FROM llms
				WHERE is_deprecated = false
				ORDER BY llm_id ASC
			`;

    // 2. Check if any rows were returned
    if (!llmRows || llmRows.length === 0) {
      log.warn("No LLM models found in the database.");
      return null;
    }

    // 3. Validate the array of LLM rows against the schema (Rule 5, Rule 6)
    const parsedLlms = llmSchema.array().safeParse(llmRows);

    // 4. Handle validation failure
    if (!parsedLlms.success) {
      log.error("Failed to validate LLM data from database:", parsedLlms.error.flatten());
      return null;
    }

    // 5. Return the validated array of LLM rows
    return parsedLlms.data;
  } catch (error) {
    // 6. Log any unexpected errors during the database query (Rule 22)
    log.error("Error loading available LLMs from database:", error);
    return null;
  }
}

/**
 * Loads available models for a specific LLM provider with deprecation filtering.
 * @param providerName - The name of the LLM provider (e.g., 'google', 'openai').
 * @param includeDeprecated - Whether to include deprecated models (default: false).
 * @returns An array of validated LlmRow objects for the provider, or null if none found.
 */
type OpenRouterModelScope =
  | {
      kind: "server";
      ownerId: number;
    }
  | {
      kind: "personal";
      ownerId: number;
    };

async function loadScopedOpenRouterModelRows(
  scope: OpenRouterModelScope,
  includeDeprecated: boolean,
): Promise<unknown[]> {
  if (scope.kind === "server") {
    return includeDeprecated
      ? await sql`
          SELECT l.*
          FROM llms l
          WHERE l.llm_provider = 'openrouter'
            AND (
              COALESCE(l.is_scoped_registration, false) = false
              OR (
                COALESCE(l.is_scoped_registration, false) = true
                AND EXISTS (
                  SELECT 1
                  FROM openrouter_model_registrations omr
                  WHERE omr.llm_id = l.llm_id
                    AND omr.server_id = ${scope.ownerId}
                    AND omr.user_id IS NULL
                )
              )
            )
          ORDER BY l.is_scoped_registration ASC NULLS FIRST, l.llm_id ASC
        `
      : await sql`
          SELECT l.*
          FROM llms l
          WHERE l.llm_provider = 'openrouter'
            AND l.is_deprecated = false
            AND (
              COALESCE(l.is_scoped_registration, false) = false
              OR (
                COALESCE(l.is_scoped_registration, false) = true
                AND EXISTS (
                  SELECT 1
                  FROM openrouter_model_registrations omr
                  WHERE omr.llm_id = l.llm_id
                    AND omr.server_id = ${scope.ownerId}
                    AND omr.user_id IS NULL
                )
              )
            )
          ORDER BY l.is_scoped_registration ASC NULLS FIRST, l.llm_id ASC
        `;
  }

  return includeDeprecated
    ? await sql`
        SELECT l.*
        FROM llms l
        WHERE l.llm_provider = 'openrouter'
          AND (
            COALESCE(l.is_scoped_registration, false) = false
            OR (
              COALESCE(l.is_scoped_registration, false) = true
              AND EXISTS (
                SELECT 1
                FROM openrouter_model_registrations omr
                WHERE omr.llm_id = l.llm_id
                  AND omr.user_id = ${scope.ownerId}
                  AND omr.server_id IS NULL
              )
            )
          )
        ORDER BY l.is_scoped_registration ASC NULLS FIRST, l.llm_id ASC
      `
    : await sql`
        SELECT l.*
        FROM llms l
        WHERE l.llm_provider = 'openrouter'
          AND l.is_deprecated = false
          AND (
            COALESCE(l.is_scoped_registration, false) = false
            OR (
              COALESCE(l.is_scoped_registration, false) = true
              AND EXISTS (
                SELECT 1
                FROM openrouter_model_registrations omr
                WHERE omr.llm_id = l.llm_id
                  AND omr.user_id = ${scope.ownerId}
                  AND omr.server_id IS NULL
              )
            )
          )
        ORDER BY l.is_scoped_registration ASC NULLS FIRST, l.llm_id ASC
      `;
}

async function loadScopedOpenRouterEmbeddingModelRows(
  scope: OpenRouterModelScope,
  includeDeprecated: boolean,
): Promise<unknown[]> {
  if (scope.kind === "server") {
    return includeDeprecated
      ? await sql`
          SELECT em.*
          FROM embedding_models em
          WHERE em.provider = 'openrouter'
            AND (
              COALESCE(em.is_scoped_registration, false) = false
              OR (
                COALESCE(em.is_scoped_registration, false) = true
                AND EXISTS (
                  SELECT 1
                  FROM openrouter_embedding_model_registrations oemr
                  WHERE oemr.embedding_model_id = em.embedding_model_id
                    AND oemr.server_id = ${scope.ownerId}
                    AND oemr.user_id IS NULL
                )
              )
            )
          ORDER BY em.is_scoped_registration ASC NULLS FIRST, em.embedding_model_id ASC
        `
      : await sql`
          SELECT em.*
          FROM embedding_models em
          WHERE em.provider = 'openrouter'
            AND em.is_deprecated = false
            AND (
              COALESCE(em.is_scoped_registration, false) = false
              OR (
                COALESCE(em.is_scoped_registration, false) = true
                AND EXISTS (
                  SELECT 1
                  FROM openrouter_embedding_model_registrations oemr
                  WHERE oemr.embedding_model_id = em.embedding_model_id
                    AND oemr.server_id = ${scope.ownerId}
                    AND oemr.user_id IS NULL
                )
              )
            )
          ORDER BY em.is_scoped_registration ASC NULLS FIRST, em.embedding_model_id ASC
        `;
  }

  return includeDeprecated
    ? await sql`
        SELECT em.*
        FROM embedding_models em
        WHERE em.provider = 'openrouter'
          AND (
            COALESCE(em.is_scoped_registration, false) = false
            OR (
              COALESCE(em.is_scoped_registration, false) = true
              AND EXISTS (
                SELECT 1
                FROM openrouter_embedding_model_registrations oemr
                WHERE oemr.embedding_model_id = em.embedding_model_id
                  AND oemr.user_id = ${scope.ownerId}
                  AND oemr.server_id IS NULL
              )
            )
          )
        ORDER BY em.is_scoped_registration ASC NULLS FIRST, em.embedding_model_id ASC
      `
    : await sql`
        SELECT em.*
        FROM embedding_models em
        WHERE em.provider = 'openrouter'
          AND em.is_deprecated = false
          AND (
            COALESCE(em.is_scoped_registration, false) = false
            OR (
              COALESCE(em.is_scoped_registration, false) = true
              AND EXISTS (
                SELECT 1
                FROM openrouter_embedding_model_registrations oemr
                WHERE oemr.embedding_model_id = em.embedding_model_id
                  AND oemr.user_id = ${scope.ownerId}
                  AND oemr.server_id IS NULL
              )
            )
          )
        ORDER BY em.is_scoped_registration ASC NULLS FIRST, em.embedding_model_id ASC
      `;
}

async function loadScopedOpenRouterDiffusionModelRows(
  scope: OpenRouterModelScope,
  includeDeprecated: boolean,
): Promise<unknown[]> {
  if (scope.kind === "server") {
    return includeDeprecated
      ? await sql`
          SELECT dm.*
          FROM image_diffusion_models dm
          WHERE dm.provider = 'openrouter'
            AND (
              COALESCE(dm.is_scoped_registration, false) = false
              OR (
                COALESCE(dm.is_scoped_registration, false) = true
                AND EXISTS (
                  SELECT 1
                  FROM openrouter_image_model_registrations oimr
                  WHERE oimr.diffusion_model_id = dm.diffusion_model_id
                    AND oimr.server_id = ${scope.ownerId}
                    AND oimr.user_id IS NULL
                )
              )
            )
          ORDER BY dm.is_scoped_registration ASC NULLS FIRST, dm.diffusion_model_id ASC
        `
      : await sql`
          SELECT dm.*
          FROM image_diffusion_models dm
          WHERE dm.provider = 'openrouter'
            AND dm.is_deprecated = false
            AND (
              COALESCE(dm.is_scoped_registration, false) = false
              OR (
                COALESCE(dm.is_scoped_registration, false) = true
                AND EXISTS (
                  SELECT 1
                  FROM openrouter_image_model_registrations oimr
                  WHERE oimr.diffusion_model_id = dm.diffusion_model_id
                    AND oimr.server_id = ${scope.ownerId}
                    AND oimr.user_id IS NULL
                )
              )
            )
          ORDER BY dm.is_scoped_registration ASC NULLS FIRST, dm.diffusion_model_id ASC
        `;
  }

  return includeDeprecated
    ? await sql`
        SELECT dm.*
        FROM image_diffusion_models dm
        WHERE dm.provider = 'openrouter'
          AND (
            COALESCE(dm.is_scoped_registration, false) = false
            OR (
              COALESCE(dm.is_scoped_registration, false) = true
              AND EXISTS (
                SELECT 1
                FROM openrouter_image_model_registrations oimr
                WHERE oimr.diffusion_model_id = dm.diffusion_model_id
                  AND oimr.user_id = ${scope.ownerId}
                  AND oimr.server_id IS NULL
              )
            )
          )
        ORDER BY dm.is_scoped_registration ASC NULLS FIRST, dm.diffusion_model_id ASC
      `
    : await sql`
        SELECT dm.*
        FROM image_diffusion_models dm
        WHERE dm.provider = 'openrouter'
          AND dm.is_deprecated = false
          AND (
            COALESCE(dm.is_scoped_registration, false) = false
            OR (
              COALESCE(dm.is_scoped_registration, false) = true
              AND EXISTS (
                SELECT 1
                FROM openrouter_image_model_registrations oimr
                WHERE oimr.diffusion_model_id = dm.diffusion_model_id
                  AND oimr.user_id = ${scope.ownerId}
                  AND oimr.server_id IS NULL
              )
            )
          )
        ORDER BY dm.is_scoped_registration ASC NULLS FIRST, dm.diffusion_model_id ASC
      `;
}

async function loadScopedOpenRouterVideoGenerationModelRows(
  scope: OpenRouterModelScope,
  includeDeprecated: boolean,
): Promise<unknown[]> {
  if (scope.kind === "server") {
    return includeDeprecated
      ? await sql`
          SELECT vm.*
          FROM video_generation_models vm
          WHERE vm.provider = 'openrouter'
            AND (
              COALESCE(vm.is_scoped_registration, false) = false
              OR (
                COALESCE(vm.is_scoped_registration, false) = true
                AND EXISTS (
                  SELECT 1
                  FROM openrouter_video_model_registrations ovmr
                  WHERE ovmr.video_model_id = vm.video_model_id
                    AND ovmr.server_id = ${scope.ownerId}
                    AND ovmr.user_id IS NULL
                )
              )
            )
          ORDER BY vm.is_scoped_registration ASC NULLS FIRST, vm.video_model_id ASC
        `
      : await sql`
          SELECT vm.*
          FROM video_generation_models vm
          WHERE vm.provider = 'openrouter'
            AND vm.is_deprecated = false
            AND (
              COALESCE(vm.is_scoped_registration, false) = false
              OR (
                COALESCE(vm.is_scoped_registration, false) = true
                AND EXISTS (
                  SELECT 1
                  FROM openrouter_video_model_registrations ovmr
                  WHERE ovmr.video_model_id = vm.video_model_id
                    AND ovmr.server_id = ${scope.ownerId}
                    AND ovmr.user_id IS NULL
                )
              )
            )
          ORDER BY vm.is_scoped_registration ASC NULLS FIRST, vm.video_model_id ASC
        `;
  }

  return includeDeprecated
    ? await sql`
        SELECT vm.*
        FROM video_generation_models vm
        WHERE vm.provider = 'openrouter'
          AND (
            COALESCE(vm.is_scoped_registration, false) = false
            OR (
              COALESCE(vm.is_scoped_registration, false) = true
              AND EXISTS (
                SELECT 1
                FROM openrouter_video_model_registrations ovmr
                WHERE ovmr.video_model_id = vm.video_model_id
                  AND ovmr.user_id = ${scope.ownerId}
                  AND ovmr.server_id IS NULL
              )
            )
          )
        ORDER BY vm.is_scoped_registration ASC NULLS FIRST, vm.video_model_id ASC
      `
    : await sql`
        SELECT vm.*
        FROM video_generation_models vm
        WHERE vm.provider = 'openrouter'
          AND vm.is_deprecated = false
          AND (
            COALESCE(vm.is_scoped_registration, false) = false
            OR (
              COALESCE(vm.is_scoped_registration, false) = true
              AND EXISTS (
                SELECT 1
                FROM openrouter_video_model_registrations ovmr
                WHERE ovmr.video_model_id = vm.video_model_id
                  AND ovmr.user_id = ${scope.ownerId}
                  AND ovmr.server_id IS NULL
              )
            )
          )
        ORDER BY vm.is_scoped_registration ASC NULLS FIRST, vm.video_model_id ASC
      `;
}

export async function loadAvailableModelsForProvider(
  providerName: string,
  includeDeprecated = false,
  scope?: OpenRouterModelScope,
): Promise<LlmRow[] | null> {
  // Input validation
  if (!providerName || providerName.trim().length === 0) {
    log.error("Provider name cannot be empty");
    return null;
  }

  // Validate provider name format (alphanumeric, hyphens, and underscores only)
  if (!/^[a-zA-Z0-9:_-]+$/.test(providerName.trim())) {
    log.error(`Invalid provider name format: ${providerName}`);
    return null;
  }

  // Normalize provider name to lowercase to match database storage (all providers stored as lowercase)
  const normalizedProviderName = providerName.trim().toLowerCase();

  try {
    // 1. Query for models for the specific provider, filtering deprecated unless explicitly included
    const modelRows = includeDeprecated
      ? normalizedProviderName === "openrouter" && scope
        ? await loadScopedOpenRouterModelRows(scope, true)
        : await sql`
				    SELECT * FROM llms
				    WHERE llm_provider = ${normalizedProviderName}
              AND COALESCE(is_scoped_registration, false) = false
				    ORDER BY llm_id ASC
			    `
      : normalizedProviderName === "openrouter" && scope
        ? await loadScopedOpenRouterModelRows(scope, false)
        : await sql`
				    SELECT * FROM llms
				    WHERE llm_provider = ${normalizedProviderName}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
				    ORDER BY llm_id ASC
			    `;

    // 2. Check if any rows were returned
    if (!modelRows || modelRows.length === 0) {
      log.warn(`No available models found for provider: ${normalizedProviderName}`);
      return null;
    }

    // 3. Validate the array of LLM rows against the schema
    const parsedModels = llmSchema.array().safeParse(modelRows);

    // 4. Handle validation failure
    if (!parsedModels.success) {
      log.error(`Failed to validate model data for provider ${normalizedProviderName}:`, parsedModels.error.flatten());
      return null;
    }

    // 5. Return the validated array of LLM rows
    log.info(`Found ${parsedModels.data.length} available models for ${normalizedProviderName}`);
    return parsedModels.data;
  } catch (error) {
    // 6. Log any unexpected errors during the database query
    log.error(`Error loading available models for provider ${normalizedProviderName}:`, error);
    return null;
  }
}

/**
 * Loads a single LLM row by ID with cache-first lookup.
 * @param llmId - Database llm_id
 * @returns Validated LlmRow, or null if not found/invalid
 */
export async function loadLlmById(llmId: number): Promise<LlmRow | null> {
  if (!Number.isInteger(llmId) || llmId <= 0) {
    log.error(`Invalid llm_id: ${llmId}`);
    return null;
  }

  const cached = getCachedLLM(llmId);
  if (cached) {
    return cached as LlmRow;
  }

  try {
    const llmRows = await sql`
			SELECT * FROM llms
			WHERE llm_id = ${llmId}
			LIMIT 1
		`;

    if (!llmRows.length) {
      log.warn(`No LLM found for llm_id ${llmId}`);
      return null;
    }

    const parsed = llmSchema.safeParse(llmRows[0]);
    if (!parsed.success) {
      log.error(`Failed to validate model data for llm_id ${llmId}:`, parsed.error.flatten());
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(`Error loading LLM for llm_id ${llmId}:`, error);
    return null;
  }
}

/**
 * Loads a single LLM row by provider + codename.
 * @param providerName - Provider name (stored lowercase)
 * @param modelCodename - Exact model codename
 * @returns Validated LlmRow, or null if not found/invalid
 */
export async function loadLlmByProviderAndCodename(
  providerName: string,
  modelCodename: string,
): Promise<LlmRow | null> {
  const normalizedProviderName = providerName.trim().toLowerCase();
  const normalizedCodename = modelCodename.trim();

  if (!normalizedProviderName || !normalizedCodename) {
    return null;
  }

  try {
    const llmRows = await sql`
			SELECT * FROM llms
			WHERE llm_provider = ${normalizedProviderName}
			  AND llm_codename = ${normalizedCodename}
			LIMIT 1
		`;

    if (!llmRows.length) {
      return null;
    }

    const parsed = llmSchema.safeParse(llmRows[0]);
    if (!parsed.success) {
      log.error(
        `Failed to validate model data for ${normalizedProviderName}/${normalizedCodename}:`,
        parsed.error.flatten(),
      );
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(`Error loading LLM for ${normalizedProviderName}/${normalizedCodename}:`, error);
    return null;
  }
}

/**
 * Loads the default model for a specific LLM provider, with fallback logic.
 * 1. Tries to find the model marked as is_default=true
 * 2. Falls back to the first available model for the provider
 * 3. Always excludes deprecated models unless explicitly included
 * @param providerName - The name of the LLM provider (e.g., 'google', 'openai').
 * @param includeDeprecated - Whether to include deprecated models in fallback search (default: false).
 * @returns The default or first available LlmRow for the provider, or null if none found.
 */
export async function loadDefaultModelForProvider(
  providerName: string,
  includeDeprecated = false,
): Promise<LlmRow | null> {
  // Input validation
  if (!providerName || providerName.trim().length === 0) {
    log.error("Provider name cannot be empty");
    return null;
  }

  // Validate provider name format (alphanumeric, hyphens, and underscores only)
  if (!/^[a-zA-Z0-9:_-]+$/.test(providerName.trim())) {
    log.error(`Invalid provider name format: ${providerName}`);
    return null;
  }

  // Normalize provider name to lowercase to match database storage (all providers stored as lowercase)
  const normalizedProviderName = providerName.trim().toLowerCase();

  try {
    // 1. Single optimized query: prioritize default models, then fallback to any available model
    // Uses CASE to create a priority column: default models get priority 1, others get priority 2
    const modelQuery = includeDeprecated
      ? sql`
				SELECT *, 
					CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
				FROM llms
				WHERE llm_provider = ${normalizedProviderName}
				ORDER BY priority ASC, llm_id ASC
				LIMIT 1
			`
      : sql`
				SELECT *, 
					CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
				FROM llms
				WHERE llm_provider = ${normalizedProviderName} AND is_deprecated = false
				ORDER BY priority ASC, llm_id ASC
				LIMIT 1
			`;

    const modelRows = await modelQuery;

    // 2. Check if any model was found
    if (!modelRows || modelRows.length === 0) {
      log.error(`No available models found for provider: ${normalizedProviderName}`);
      return null;
    }

    // 3. Validate the selected model
    const selectedModel = modelRows[0];
    const parsedModel = llmSchema.safeParse(selectedModel);

    if (!parsedModel.success) {
      log.error(`Failed to validate model data for provider ${normalizedProviderName}:`, parsedModel.error.flatten());
      return null;
    }

    // 4. Log appropriate message based on whether we got the default or a fallback
    const isDefaultModel = selectedModel.is_default === true;
    if (isDefaultModel) {
      log.info(`Found default model for ${normalizedProviderName}: ${parsedModel.data.llm_codename}`);
    } else {
      log.warn(
        `No default model found for provider ${normalizedProviderName}, using fallback: ${parsedModel.data.llm_codename}`,
      );
    }

    return parsedModel.data;
  } catch (error) {
    // 5. Log any unexpected errors during the database query
    log.error(`Error loading default model for provider ${normalizedProviderName}:`, error);
    return null;
  }
}

/**
 * Loads available embedding models for a specific provider with deprecation filtering.
 * @param providerName - The name of the embedding provider (e.g., 'google', 'openrouter').
 * @param includeDeprecated - Whether to include deprecated models (default: false).
 * @returns An array of validated EmbeddingModelRow objects for the provider, or null if none found.
 */
export async function loadAvailableEmbeddingModelsForProvider(
  providerName: string,
  includeDeprecated = false,
  scope?: OpenRouterModelScope,
): Promise<EmbeddingModelRow[] | null> {
  if (!providerName || providerName.trim().length === 0) {
    log.error("Provider name cannot be empty");
    return null;
  }

  if (!/^[a-zA-Z0-9:_-]+$/.test(providerName.trim())) {
    log.error(`Invalid provider name format: ${providerName}`);
    return null;
  }

  const normalizedProviderName = providerName.trim().toLowerCase();

  try {
    const modelRows = includeDeprecated
      ? normalizedProviderName === "openrouter" && scope
        ? await loadScopedOpenRouterEmbeddingModelRows(scope, true)
        : await sql`
				    SELECT * FROM embedding_models
				    WHERE provider = ${normalizedProviderName}
              AND COALESCE(is_scoped_registration, false) = false
				    ORDER BY embedding_model_id ASC
			    `
      : normalizedProviderName === "openrouter" && scope
        ? await loadScopedOpenRouterEmbeddingModelRows(scope, false)
        : await sql`
				    SELECT * FROM embedding_models
				    WHERE provider = ${normalizedProviderName}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
				    ORDER BY embedding_model_id ASC
			    `;

    if (!modelRows || modelRows.length === 0) {
      log.warn(`No available embedding models found for provider: ${normalizedProviderName}`);
      return null;
    }

    const parsedModels = embeddingModelSchema.array().safeParse(modelRows);
    if (!parsedModels.success) {
      log.error(
        `Failed to validate embedding model data for provider ${normalizedProviderName}:`,
        parsedModels.error.flatten(),
      );
      return null;
    }

    log.info(`Found ${parsedModels.data.length} embedding models for ${normalizedProviderName}`);
    return parsedModels.data;
  } catch (error) {
    log.error(`Error loading embedding models for provider ${normalizedProviderName}:`, error);
    return null;
  }
}

/**
 * Loads the default embedding model for a provider, with fallback logic.
 * @param providerName - The name of the embedding provider (e.g., 'google', 'openrouter').
 * @param includeDeprecated - Whether to include deprecated models in fallback (default: false).
 * @returns The default or first available EmbeddingModelRow for the provider, or null if none found.
 */
export async function loadDefaultEmbeddingModelForProvider(
  providerName: string,
  includeDeprecated = false,
): Promise<EmbeddingModelRow | null> {
  if (!providerName || providerName.trim().length === 0) {
    log.error("Provider name cannot be empty");
    return null;
  }

  if (!/^[a-zA-Z0-9:_-]+$/.test(providerName.trim())) {
    log.error(`Invalid provider name format: ${providerName}`);
    return null;
  }

  const normalizedProviderName = providerName.trim().toLowerCase();

  try {
    const modelQuery = includeDeprecated
      ? sql`
				SELECT *,
					CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
				FROM embedding_models
				WHERE provider = ${normalizedProviderName}
				ORDER BY priority ASC, embedding_model_id ASC
				LIMIT 1
			`
      : sql`
				SELECT *,
					CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
				FROM embedding_models
				WHERE provider = ${normalizedProviderName} AND is_deprecated = false
				ORDER BY priority ASC, embedding_model_id ASC
				LIMIT 1
			`;

    const modelRows = await modelQuery;
    if (!modelRows || modelRows.length === 0) {
      log.error(`No available embedding models found for provider: ${normalizedProviderName}`);
      return null;
    }

    const selectedModel = modelRows[0];
    const parsedModel = embeddingModelSchema.safeParse(selectedModel);
    if (!parsedModel.success) {
      log.error(
        `Failed to validate embedding model data for provider ${normalizedProviderName}:`,
        parsedModel.error.flatten(),
      );
      return null;
    }

    const isDefaultModel = selectedModel.is_default === true;
    if (isDefaultModel) {
      log.info(`Found default embedding model for ${normalizedProviderName}: ${parsedModel.data.codename}`);
    } else {
      log.warn(
        `No default embedding model found for provider ${normalizedProviderName}, using fallback: ${parsedModel.data.codename}`,
      );
    }

    return parsedModel.data;
  } catch (error) {
    log.error(`Error loading default embedding model for provider ${normalizedProviderName}:`, error);
    return null;
  }
}

/**
 * Loads available image diffusion models for a specific provider.
 */
export async function loadAvailableDiffusionModelsForProvider(
  providerName: string,
  includeDeprecated = false,
  scope?: OpenRouterModelScope,
): Promise<DiffusionModelRow[] | null> {
  if (!providerName || providerName.trim().length === 0) {
    log.error("Provider name cannot be empty");
    return null;
  }

  if (!/^[a-zA-Z0-9:_-]+$/.test(providerName.trim())) {
    log.error(`Invalid provider name format: ${providerName}`);
    return null;
  }

  const normalizedProviderName = providerName.trim().toLowerCase();

  try {
    const modelRows = includeDeprecated
      ? normalizedProviderName === "openrouter" && scope
        ? await loadScopedOpenRouterDiffusionModelRows(scope, true)
        : await sql`
				    SELECT * FROM image_diffusion_models
				    WHERE provider = ${normalizedProviderName}
              AND COALESCE(is_scoped_registration, false) = false
				    ORDER BY diffusion_model_id ASC
			    `
      : normalizedProviderName === "openrouter" && scope
        ? await loadScopedOpenRouterDiffusionModelRows(scope, false)
        : await sql`
				    SELECT * FROM image_diffusion_models
				    WHERE provider = ${normalizedProviderName}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
				    ORDER BY diffusion_model_id ASC
			    `;

    if (!modelRows || modelRows.length === 0) {
      log.warn(`No available diffusion models found for provider: ${normalizedProviderName}`);
      return null;
    }

    const parsedModels = diffusionModelSchema.array().safeParse(modelRows);
    if (!parsedModels.success) {
      log.error(
        `Failed to validate diffusion model data for provider ${normalizedProviderName}:`,
        parsedModels.error.flatten(),
      );
      return null;
    }

    log.info(`Found ${parsedModels.data.length} diffusion models for ${normalizedProviderName}`);
    return parsedModels.data;
  } catch (error) {
    log.error(`Error loading diffusion models for provider ${normalizedProviderName}:`, error);
    return null;
  }
}

/**
 * Loads the default image diffusion model for a provider, with fallback logic.
 */
export async function loadDefaultDiffusionModelForProvider(
  providerName: string,
  includeDeprecated = false,
): Promise<DiffusionModelRow | null> {
  if (!providerName || providerName.trim().length === 0) {
    log.error("Provider name cannot be empty");
    return null;
  }

  if (!/^[a-zA-Z0-9:_-]+$/.test(providerName.trim())) {
    log.error(`Invalid provider name format: ${providerName}`);
    return null;
  }

  const normalizedProviderName = providerName.trim().toLowerCase();

  try {
    const modelRows = includeDeprecated
      ? await sql`
				SELECT *,
					CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
				FROM image_diffusion_models
				WHERE provider = ${normalizedProviderName}
				ORDER BY priority ASC, diffusion_model_id ASC
				LIMIT 1
			`
      : await sql`
				SELECT *,
					CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
				FROM image_diffusion_models
				WHERE provider = ${normalizedProviderName} AND is_deprecated = false
				ORDER BY priority ASC, diffusion_model_id ASC
				LIMIT 1
			`;

    if (!modelRows || modelRows.length === 0) {
      log.warn(`No available diffusion models found for provider: ${normalizedProviderName}`);
      return null;
    }

    const parsedModel = diffusionModelSchema.safeParse(modelRows[0]);
    if (!parsedModel.success) {
      log.error(
        `Failed to validate default diffusion model for provider ${normalizedProviderName}:`,
        parsedModel.error.flatten(),
      );
      return null;
    }

    return parsedModel.data;
  } catch (error) {
    log.error(`Error loading default diffusion model for provider ${normalizedProviderName}:`, error);
    return null;
  }
}

/**
 * Loads available video generation models for a specific provider.
 */
export async function loadAvailableVideoGenerationModelsForProvider(
  providerName: string,
  includeDeprecated = false,
  scope?: OpenRouterModelScope,
): Promise<VideoGenerationModelRow[] | null> {
  if (!providerName || providerName.trim().length === 0) {
    log.error("Provider name cannot be empty");
    return null;
  }

  if (!/^[a-zA-Z0-9:_-]+$/.test(providerName.trim())) {
    log.error(`Invalid provider name format: ${providerName}`);
    return null;
  }

  const normalizedProviderName = providerName.trim().toLowerCase();

  try {
    const modelRows = includeDeprecated
      ? normalizedProviderName === "openrouter" && scope
        ? await loadScopedOpenRouterVideoGenerationModelRows(scope, true)
        : await sql`
				    SELECT * FROM video_generation_models
				    WHERE provider = ${normalizedProviderName}
              AND COALESCE(is_scoped_registration, false) = false
				    ORDER BY video_model_id ASC
			    `
      : normalizedProviderName === "openrouter" && scope
        ? await loadScopedOpenRouterVideoGenerationModelRows(scope, false)
        : await sql`
				    SELECT * FROM video_generation_models
				    WHERE provider = ${normalizedProviderName}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
				    ORDER BY video_model_id ASC
			    `;

    if (!modelRows || modelRows.length === 0) {
      log.warn(`No available video generation models found for provider: ${normalizedProviderName}`);
      return null;
    }

    const parsedModels = videoGenerationModelSchema.array().safeParse(modelRows);
    if (!parsedModels.success) {
      log.error(
        `Failed to validate video generation model data for provider ${normalizedProviderName}:`,
        parsedModels.error.flatten(),
      );
      return null;
    }

    log.info(`Found ${parsedModels.data.length} video generation models for ${normalizedProviderName}`);
    return parsedModels.data;
  } catch (error) {
    log.error(`Error loading video generation models for provider ${normalizedProviderName}:`, error);
    return null;
  }
}

/**
 * Loads the default video generation model for a provider, with fallback logic.
 */
export async function loadDefaultVideoGenerationModelForProvider(
  providerName: string,
  includeDeprecated = false,
): Promise<VideoGenerationModelRow | null> {
  if (!providerName || providerName.trim().length === 0) {
    log.error("Provider name cannot be empty");
    return null;
  }

  if (!/^[a-zA-Z0-9:_-]+$/.test(providerName.trim())) {
    log.error(`Invalid provider name format: ${providerName}`);
    return null;
  }

  const normalizedProviderName = providerName.trim().toLowerCase();

  try {
    const modelRows = includeDeprecated
      ? await sql`
				SELECT *,
					CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
				FROM video_generation_models
				WHERE provider = ${normalizedProviderName}
				ORDER BY priority ASC, video_model_id ASC
				LIMIT 1
			`
      : await sql`
				SELECT *,
					CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
				FROM video_generation_models
				WHERE provider = ${normalizedProviderName} AND is_deprecated = false
				ORDER BY priority ASC, video_model_id ASC
				LIMIT 1
			`;

    if (!modelRows || modelRows.length === 0) {
      log.warn(`No available video generation models found for provider: ${normalizedProviderName}`);
      return null;
    }

    const parsedModel = videoGenerationModelSchema.safeParse(modelRows[0]);
    if (!parsedModel.success) {
      log.error(
        `Failed to validate default video generation model for provider ${normalizedProviderName}:`,
        parsedModel.error.flatten(),
      );
      return null;
    }

    return parsedModel.data;
  } catch (error) {
    log.error(`Error loading default video generation model for provider ${normalizedProviderName}:`, error);
    return null;
  }
}

/**
 * Loads the default vision-capable LLM for a provider, with fallback logic.
 */
export async function loadDefaultVisionModelForProvider(
  providerName: string,
  includeDeprecated = false,
): Promise<LlmRow | null> {
  if (!providerName || providerName.trim().length === 0) {
    log.error("Provider name cannot be empty");
    return null;
  }

  if (!/^[a-zA-Z0-9:_-]+$/.test(providerName.trim())) {
    log.error(`Invalid provider name format: ${providerName}`);
    return null;
  }

  const normalizedProviderName = providerName.trim().toLowerCase();

  try {
    const modelRows = includeDeprecated
      ? await sql`
				SELECT *,
					CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
				FROM llms
				WHERE llm_provider = ${normalizedProviderName}
				  AND sees_images = true
				ORDER BY priority ASC, llm_id ASC
				LIMIT 1
			`
      : await sql`
				SELECT *,
					CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
				FROM llms
				WHERE llm_provider = ${normalizedProviderName}
				  AND sees_images = true
				  AND is_deprecated = false
				ORDER BY priority ASC, llm_id ASC
				LIMIT 1
			`;

    if (!modelRows || modelRows.length === 0) {
      log.warn(`No available vision models found for provider: ${normalizedProviderName}`);
      return null;
    }

    const parsedModel = llmSchema.safeParse(modelRows[0]);
    if (!parsedModel.success) {
      log.error(
        `Failed to validate default vision model for provider ${normalizedProviderName}:`,
        parsedModel.error.flatten(),
      );
      return null;
    }

    return parsedModel.data;
  } catch (error) {
    log.error(`Error loading default vision model for provider ${normalizedProviderName}:`, error);
    return null;
  }
}

/**
 * Load a specific embedding model by ID.
 * @param embeddingModelId - The embedding model ID to load.
 * @returns The EmbeddingModelRow if found and valid, otherwise null.
 */
export async function loadEmbeddingModelById(embeddingModelId: number): Promise<EmbeddingModelRow | null> {
  try {
    const rows = await sql`
			SELECT * FROM embedding_models
			WHERE embedding_model_id = ${embeddingModelId}
			LIMIT 1
		`;

    if (!rows || rows.length === 0) {
      log.warn(`No embedding model found with ID: ${embeddingModelId}`);
      return null;
    }

    const parsed = embeddingModelSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.error(`Failed to validate embedding model data for ID ${embeddingModelId}:`, parsed.error.flatten());
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(`Error loading embedding model ${embeddingModelId}:`, error);
    return null;
  }
}

export async function loadEmbeddingModelByProviderAndCodename(
  providerName: string,
  modelCodename: string,
): Promise<EmbeddingModelRow | null> {
  const normalizedProviderName = providerName.trim().toLowerCase();
  const normalizedCodename = modelCodename.trim();

  if (!normalizedProviderName || !normalizedCodename) {
    return null;
  }

  try {
    const rows = await sql`
			SELECT * FROM embedding_models
			WHERE provider = ${normalizedProviderName}
			  AND codename = ${normalizedCodename}
			LIMIT 1
		`;

    if (!rows.length) {
      return null;
    }

    const parsed = embeddingModelSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.error(
        `Failed to validate embedding model data for ${normalizedProviderName}/${normalizedCodename}:`,
        parsed.error.flatten(),
      );
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(`Error loading embedding model for ${normalizedProviderName}/${normalizedCodename}:`, error);
    return null;
  }
}

export async function loadDiffusionModelByProviderAndCodename(
  providerName: string,
  modelCodename: string,
): Promise<DiffusionModelRow | null> {
  const normalizedProviderName = providerName.trim().toLowerCase();
  const normalizedCodename = modelCodename.trim();

  if (!normalizedProviderName || !normalizedCodename) {
    return null;
  }

  try {
    const rows = await sql`
			SELECT * FROM image_diffusion_models
			WHERE provider = ${normalizedProviderName}
			  AND codename = ${normalizedCodename}
			LIMIT 1
		`;

    if (!rows.length) {
      return null;
    }

    const parsed = diffusionModelSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.error(
        `Failed to validate diffusion model data for ${normalizedProviderName}/${normalizedCodename}:`,
        parsed.error.flatten(),
      );
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(`Error loading diffusion model for ${normalizedProviderName}/${normalizedCodename}:`, error);
    return null;
  }
}

export async function loadVideoGenerationModelByProviderAndCodename(
  providerName: string,
  modelCodename: string,
): Promise<VideoGenerationModelRow | null> {
  const normalizedProviderName = providerName.trim().toLowerCase();
  const normalizedCodename = modelCodename.trim();

  if (!normalizedProviderName || !normalizedCodename) {
    return null;
  }

  try {
    const rows = await sql`
			SELECT * FROM video_generation_models
			WHERE provider = ${normalizedProviderName}
			  AND codename = ${normalizedCodename}
			LIMIT 1
		`;

    if (!rows.length) {
      return null;
    }

    const parsed = videoGenerationModelSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.error(
        `Failed to validate video generation model data for ${normalizedProviderName}/${normalizedCodename}:`,
        parsed.error.flatten(),
      );
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(`Error loading video generation model for ${normalizedProviderName}/${normalizedCodename}:`, error);
    return null;
  }
}

/**
 * Loads the smartest (reasoning) model for a specific LLM provider from the database.
 * @param providerName - The name of the LLM provider (e.g., 'google', 'openai').
 * @param includeDeprecated - Whether to include deprecated models (default: false).
 * @returns A promise that resolves to the first smartest LlmRow found, or null if none found.
 */
export async function loadSmartestModel(providerName: string, includeDeprecated = false): Promise<LlmRow | null> {
  // Input validation
  if (!providerName || providerName.trim().length === 0) {
    log.error("Provider name cannot be empty");
    return null;
  }

  // Validate provider name format (alphanumeric, hyphens, and underscores only)
  if (!/^[a-zA-Z0-9:_-]+$/.test(providerName.trim())) {
    log.error(`Invalid provider name format: ${providerName}`);
    return null;
  }

  // Normalize provider name to lowercase to match database storage (all providers stored as lowercase)
  const normalizedProviderName = providerName.trim().toLowerCase();

  try {
    // 1. Query for smartest model for the specific provider, filtering deprecated unless explicitly included
    const smartModelQuery = includeDeprecated
      ? sql`
				SELECT * FROM llms
				WHERE llm_provider = ${normalizedProviderName} AND is_smartest = true
				ORDER BY llm_id ASC
				LIMIT 1
			`
      : sql`
				SELECT * FROM llms
				WHERE llm_provider = ${normalizedProviderName} AND is_smartest = true AND is_deprecated = false
				ORDER BY llm_id ASC
				LIMIT 1
			`;

    const smartModelRows = await smartModelQuery;

    // 2. Check if any row was returned
    if (!smartModelRows || smartModelRows.length === 0) {
      log.warn(`No smartest model found for provider: ${normalizedProviderName}`);
      return null;
    }

    // 3. Validate the single LLM row against the schema
    const parsedModel = llmSchema.safeParse(smartModelRows[0]);

    // 4. Handle validation failure
    if (!parsedModel.success) {
      log.error(
        `Failed to validate smartest model data for provider ${normalizedProviderName}:`,
        parsedModel.error.flatten(),
      );
      return null;
    }

    // 5. Return the validated LLM row
    log.info(`Found smartest model for ${normalizedProviderName}: ${parsedModel.data.llm_codename}`);
    return parsedModel.data;
  } catch (error) {
    // 6. Log any unexpected errors during the database query
    log.error(`Error loading smartest model for provider ${normalizedProviderName}:`, error);
    return null;
  }
}

/**
 * Loads unique LLM providers from the database for dynamic select menus.
 * Only returns providers that have at least one non-deprecated model available.
 * Case-insensitive deduplication with consistent capitalization.
 * @param includeDeprecated - Whether to include providers that only have deprecated models (default: false).
 * @returns An array of unique provider names, or null if error or none found.
 */
export async function loadUniqueProviders(includeDeprecated = false): Promise<string[] | null> {
  try {
    // 1. Query for providers that have at least one available model (filtering deprecated unless explicitly included)
    const providerQuery = includeDeprecated
      ? sql`
				SELECT DISTINCT llm_provider
				FROM llms
				ORDER BY llm_provider ASC
			`
      : sql`
				SELECT DISTINCT llm_provider
				FROM llms
				WHERE is_deprecated = false
				ORDER BY llm_provider ASC
			`;

    const providerRows = await providerQuery;

    // 2. Check if any rows were returned
    if (!providerRows || providerRows.length === 0) {
      log.warn("No LLM providers with available models found in the database.");
      return null;
    }

    // 3. Extract provider names and perform case-insensitive deduplication
    const providerMap = new Map<string, string>();

    for (const row of providerRows) {
      const provider = row.llm_provider as string;
      const lowerKey = provider.toLowerCase();

      // Keep the first occurrence (which will be alphabetically sorted)
      // This ensures consistent capitalization (e.g., "Google" over "google")
      if (!providerMap.has(lowerKey)) {
        providerMap.set(lowerKey, provider);
      }
    }

    // 4. Convert back to array, sorted by the normalized keys
    const providers = Array.from(providerMap.values()).sort();

    log.info(`Found ${providers.length} unique LLM providers with available models: ${providers.join(", ")}`);
    return providers;
  } catch (error) {
    // 5. Log any unexpected errors during the database query
    log.error("Error loading unique LLM providers from database:", error);
    return null;
  }
}

/**
 * Loads personality presets with truncated descriptions for dynamic select menus.
 * @param maxDescriptionLength - Maximum length for preset descriptions (default: 100)
 * @returns An array of preset options with truncated descriptions, or null if error or none found.
 */
export async function loadPresetOptions(
  maxDescriptionLength = 100,
): Promise<Array<{ name: string; description: string }> | null> {
  try {
    // 1. Query for all presets with descriptions
    const presetRows = await sql`
			SELECT tomori_preset_name, tomori_preset_desc
			FROM tomori_presets
			ORDER BY tomori_preset_name ASC
		`;

    // 2. Check if any rows were returned
    if (!presetRows || presetRows.length === 0) {
      log.warn("No personality presets found in the database.");
      return null;
    }

    // 3. Process and truncate descriptions
    const presetOptions = presetRows.map((row: Record<string, unknown>) => {
      const description = row.tomori_preset_desc as string;
      const truncatedDescription =
        description.length > maxDescriptionLength
          ? `${description.substring(0, maxDescriptionLength - 3)}...`
          : description;

      return {
        name: row.tomori_preset_name as string,
        description: truncatedDescription,
      };
    });

    log.info(`Found ${presetOptions.length} personality presets for selection menu.`);
    return presetOptions;
  } catch (error) {
    // 4. Log any unexpected errors during the database query
    log.error("Error loading preset options from database:", error);
    return null;
  }
}

/**
 * Loads personality presets filtered by locale with truncated descriptions for dynamic select menus.
 * Implements fallback logic: tries exact locale match → base language → 'en-US' fallback.
 * @param locale - The locale code to filter by (e.g., 'en-US', 'ja')
 * @param maxDescriptionLength - Maximum length for preset descriptions (default: 100)
 * @returns An array of preset options with truncated descriptions, or null if error or none found.
 */
export async function loadPresetOptionsByLocale(
  locale: string,
  maxDescriptionLength = 100,
): Promise<Array<{ name: string; description: string }> | null> {
  try {
    // 1. Try exact locale match (e.g., 'ja')
    let presetRows = await sql`
			SELECT tomori_preset_name, tomori_preset_desc
			FROM tomori_presets
			WHERE preset_language = ${locale}
			ORDER BY tomori_preset_name ASC
		`;

    // 2. If no exact match, try base language (e.g., 'ja' from 'ja-JP')
    if (presetRows.length === 0) {
      const baseLanguage = locale.split("-")[0];
      presetRows = await sql`
				SELECT tomori_preset_name, tomori_preset_desc
				FROM tomori_presets
				WHERE preset_language = ${baseLanguage}
				ORDER BY tomori_preset_name ASC
			`;

      if (presetRows.length > 0) {
        log.info(`No presets found for locale '${locale}', using base language '${baseLanguage}' instead.`);
      }
    }

    // 3. If still no presets, fall back to 'en-US'
    if (presetRows.length === 0 && locale !== "en-US") {
      presetRows = await sql`
				SELECT tomori_preset_name, tomori_preset_desc
				FROM tomori_presets
				WHERE preset_language = 'en-US'
				ORDER BY tomori_preset_name ASC
			`;

      if (presetRows.length > 0) {
        log.info(`No presets found for locale '${locale}', falling back to English presets.`);
      }
    }

    // 4. Check if any rows were returned after all fallback attempts
    if (!presetRows || presetRows.length === 0) {
      log.warn(`No personality presets found for locale '${locale}' or any fallback language.`);
      return null;
    }

    // 5. Process and truncate descriptions
    const presetOptions = presetRows.map((row: Record<string, unknown>) => {
      const description = row.tomori_preset_desc as string;
      const truncatedDescription =
        description.length > maxDescriptionLength
          ? `${description.substring(0, maxDescriptionLength - 3)}...`
          : description;

      return {
        name: row.tomori_preset_name as string,
        description: truncatedDescription,
      };
    });

    log.info(`Found ${presetOptions.length} personality presets for locale '${locale}' (selection menu).`);
    return presetOptions;
  } catch (error) {
    // 6. Log any unexpected errors during the database query
    log.error(`Error loading preset options for locale '${locale}' from database:`, error);
    return null;
  }
}

/**
 * Loads full personality preset rows filtered by locale.
 * Implements fallback logic: tries exact locale match → base language → 'en-US' fallback.
 * Returns complete TomoriPresetRow objects with all fields (attributes, sample dialogues, etc.).
 * @param locale - The locale code to filter by (e.g., 'en-US', 'ja')
 * @returns An array of TomoriPresetRow objects, or null if error or none found.
 */
export async function loadPresetRowsByLocale(locale: string): Promise<TomoriPresetRow[] | null> {
  try {
    // 1. Try exact locale match (e.g., 'ja')
    let presets = await sql`
			SELECT * FROM tomori_presets
			WHERE preset_language = ${locale}
			ORDER BY tomori_preset_name ASC
		`;

    // 2. If no exact match, try base language (e.g., 'ja' from 'ja-JP')
    if (presets.length === 0) {
      const baseLanguage = locale.split("-")[0];
      presets = await sql`
				SELECT * FROM tomori_presets
				WHERE preset_language = ${baseLanguage}
				ORDER BY tomori_preset_name ASC
			`;

      if (presets.length > 0) {
        log.info(`No presets found for locale '${locale}', using base language '${baseLanguage}' instead.`);
      }
    }

    // 3. If still no presets, fall back to 'en-US'
    if (presets.length === 0 && locale !== "en-US") {
      presets = await sql`
				SELECT * FROM tomori_presets
				WHERE preset_language = 'en-US'
				ORDER BY tomori_preset_name ASC
			`;

      if (presets.length > 0) {
        log.info(`No presets found for locale '${locale}', falling back to English presets.`);
      }
    }

    // 4. Check if any rows were returned after all fallback attempts
    if (!presets || presets.length === 0) {
      log.warn(`No personality presets found for locale '${locale}' or any fallback language.`);
      return null;
    }

    log.info(`Found ${presets.length} personality preset rows for locale '${locale}'.`);
    return presets as TomoriPresetRow[];
  } catch (error) {
    // 5. Log any unexpected errors during the database query
    log.error(`Error loading preset rows for locale '${locale}' from database:`, error);
    return null;
  }
}

/**
 * Loads all preset rows from the database (all locales)
 * Used for initializing preset avatar cache at startup
 * @returns Promise that resolves to array of all preset rows or null on error
 */
export async function loadAllPresets(): Promise<TomoriPresetRow[] | null> {
  try {
    const presets = await sql`
			SELECT * FROM tomori_presets
			ORDER BY tomori_preset_name ASC
		`;

    if (!presets || presets.length === 0) {
      log.warn("No personality presets found in database.");
      return null;
    }

    log.info(`Loaded ${presets.length} personality presets from database.`);
    return presets as TomoriPresetRow[];
  } catch (error) {
    log.error("Error loading all presets from database:", error);
    return null;
  }
}

/**
 * Loads all system prompt presets from the database
 * @returns Promise that resolves to array of SystemPromptPresetRow or null on error
 */
export async function loadSystemPromptPresets(): Promise<SystemPromptPresetRow[] | null> {
  try {
    // 1. Query all system prompt presets ordered by ID
    const presets = await sql`
			SELECT * FROM system_prompt_presets
			ORDER BY system_prompt_preset_id ASC
		`;

    // 2. Check if any presets were found
    if (!presets || presets.length === 0) {
      log.warn("No system prompt presets found in database.");
      return null;
    }

    // 3. Log successful load
    log.info(`Loaded ${presets.length} system prompt presets from database.`);

    // 4. Return the presets
    return presets as SystemPromptPresetRow[];
  } catch (error) {
    // 5. Log any errors during the database query
    log.error("Error loading system prompt presets from database:", error);
    return null;
  }
}

/**
 * Loads all stickers for a given server's Discord ID from the database.
 * @param serverDiscId - The Discord ID of the server.
 * @returns A promise that resolves to an array of ServerStickerRow or null if server not found/error.
 *          Returns an empty array if the server is found but has no stickers.
 */
export async function loadServerStickers(serverDiscId: string): Promise<ServerStickerRow[] | null> {
  try {
    // 1. Get the internal server_id from server_disc_id
    const [server] = await sql`
            SELECT server_id FROM servers WHERE server_disc_id = ${serverDiscId} LIMIT 1
        `;

    if (!server?.server_id) {
      log.warn(`Server not found in DB with Discord ID: ${serverDiscId} when trying to load stickers.`);
      return null; // Server itself not found
    }
    // biome-ignore lint/style/noNonNullAssertion: server check guarantees server_id (Rule 8)
    const serverId = server.server_id!;

    // 2. Fetch all stickers for that server_id, selecting only necessary fields
    const stickersData = await sql`
            SELECT sticker_id, server_id, sticker_disc_id, sticker_name, sticker_desc, emotion_key, format_type, is_global, created_at, updated_at
            FROM server_stickers
            WHERE server_id = ${serverId}
        `; // Rule 16: Explicit columns

    if (!stickersData) {
      // This case should ideally not happen with current bun-postgres; an empty array is more likely.
      log.warn(`Stickers data was unexpectedly null for server ID: ${serverId} (Discord ID: ${serverDiscId})`);
      return []; // Treat as no stickers found
    }
    if (stickersData.length === 0) {
      log.info(`No stickers found in DB for server ID: ${serverId} (Discord ID: ${serverDiscId})`);
      return []; // Explicitly return empty array if no stickers
    }

    // 3. Validate each sticker row (Rule 6, Rule 5 - data integrity for function calling)
    const validatedStickers: ServerStickerRow[] = [];
    for (const sticker of stickersData) {
      const parsed = serverStickerSchema.safeParse(sticker);
      if (parsed.success) {
        validatedStickers.push(parsed.data);
      } else {
        log.warn(
          `Invalid sticker data found in DB for server ${serverId}, sticker_disc_id ${sticker.sticker_disc_id}: ${JSON.stringify(sticker)}. Errors: ${parsed.error.flatten()}`,
        );
        // Optionally skip adding invalid stickers
      }
    }
    log.info(`Loaded ${validatedStickers.length} stickers for server ID ${serverId}.`);
    return validatedStickers;
  } catch (error) {
    log.error(`Error loading stickers for server Discord ID ${serverDiscId}:`, error);
    return null; // Error during DB operation
  }
}

/**
 * Loads all reminders that are due for execution (reminder_time <= current time)
 * @returns Array of due ReminderRow objects, or null if error
 */
export async function getDueReminders(): Promise<ReminderRow[] | null> {
  return await withCachedPlanRetry(async () => {
    try {
      // Query for reminders that are due (reminder_time <= now)
      const reminderData = await sql`
				SELECT * FROM reminders
				WHERE reminder_time <= CURRENT_TIMESTAMP
				ORDER BY reminder_time ASC
			`;

      if (!reminderData) {
        log.warn("Reminders data was unexpectedly null when fetching due reminders");
        return [];
      }

      if (reminderData.length === 0) {
        // log.info("No due reminders found");
        return [];
      }

      // Validate each reminder row
      const validatedReminders: ReminderRow[] = [];
      for (const reminder of reminderData) {
        const parsed = reminderSchema.safeParse(reminder);
        if (parsed.success) {
          validatedReminders.push(parsed.data);
        } else {
          log.warn(
            `Invalid reminder data found in DB for reminder_id ${reminder.reminder_id}: ${JSON.stringify(reminder)}. Errors: ${parsed.error.flatten()}`,
          );
        }
      }

      log.info(`Found ${validatedReminders.length} due reminders`);
      return validatedReminders;
    } catch (error) {
      log.error("Error loading due reminders from database:", error);
      return null;
    }
  }, "load due reminders");
}

export async function getNextReminderTime(): Promise<Date | null> {
  return await withCachedPlanRetry(async () => {
    try {
      const [result] = await sql<{ next_reminder_time: Date | string | null }[]>`
				SELECT reminder_time AS next_reminder_time
				FROM reminders
				ORDER BY reminder_time ASC
				LIMIT 1
			`;

      const nextReminderTime = result?.next_reminder_time;
      if (!nextReminderTime) {
        return null;
      }

      if (nextReminderTime instanceof Date) {
        return nextReminderTime;
      }

      const parsedReminderTime = new Date(nextReminderTime);
      return Number.isNaN(parsedReminderTime.getTime()) ? null : parsedReminderTime;
    } catch (error) {
      log.error("Error loading next reminder time from database:", error);
      return null;
    }
  }, "load next reminder time");
}

/**
 * Loads a specific reminder by its ID
 * @param reminderId - The ID of the reminder to load
 * @returns The ReminderRow object if found, null otherwise
 */
export async function getReminderById(reminderId: number): Promise<ReminderRow | null> {
  try {
    const [reminderData] = await sql`
			SELECT * FROM reminders
			WHERE reminder_id = ${reminderId}
			LIMIT 1
		`;

    if (!reminderData) {
      log.info(`Reminder not found with ID: ${reminderId}`);
      return null;
    }

    // Validate the reminder data
    const parsed = reminderSchema.safeParse(reminderData);
    if (!parsed.success) {
      log.warn(
        `Invalid reminder data found in DB for reminder_id ${reminderId}: ${JSON.stringify(reminderData)}. Errors: ${parsed.error.flatten()}`,
      );
      return null;
    }

    log.info(`Loaded reminder with ID: ${reminderId}`);
    return parsed.data;
  } catch (error) {
    log.error(`Error loading reminder with ID ${reminderId}:`, error);
    return null;
  }
}

/**
 * Gets the count of active reminders for a specific user
 * @param userDiscordId - The Discord ID of the user
 * @returns The count of active reminders for the user, or 0 if error
 */
export async function getUserReminderCount(userDiscordId: string): Promise<number> {
  try {
    const [result] = await sql`
			SELECT COUNT(*) as reminder_count
			FROM reminders
			WHERE user_discord_id = ${userDiscordId}
		`;

    return Number(result?.reminder_count || 0);
  } catch (error) {
    log.error(`Error counting reminders for user ${userDiscordId}:`, error);
    return 0;
  }
}

/**
 * Deletes a reminder from the database by its ID
 * @param reminderId - The ID of the reminder to delete
 * @returns True if reminder was deleted, false otherwise
 */
export async function deleteReminderById(reminderId: number): Promise<boolean> {
  try {
    const result = await sql`
			DELETE FROM reminders
			WHERE reminder_id = ${reminderId}
			RETURNING reminder_id
		`;

    if (result && result.length > 0) {
      log.success(`Reminder deleted successfully (ID: ${reminderId})`);
      emitScheduledWorkNudge(`reminder-delete:${reminderId}`);
      return true;
    } else {
      log.warn(`No reminder found to delete with ID: ${reminderId}`);
      return false;
    }
  } catch (error) {
    log.error(`Error deleting reminder with ID ${reminderId}:`, error);
    return false;
  }
}

/**
 * Loads pending reminders for a specific user (reminders that haven't been triggered yet)
 * @param userDiscordId - The Discord ID of the user
 * @param serverDiscId - The Discord ID of the server (optional, to filter by server)
 * @returns Array of pending ReminderRow objects, or null if error
 */
export async function getPendingRemindersForUser(
  userDiscordId: string,
  serverDiscId?: string,
): Promise<ReminderRow[] | null> {
  try {
    // 1. Query for pending reminders (reminder_time > now) for the user
    // If serverDiscId is provided, filter by that server as well
    let reminderData: unknown[];
    if (serverDiscId) {
      // Join with servers table to filter by server_disc_id
      reminderData = await sql`
				SELECT r.* FROM reminders r
				JOIN servers s ON r.server_id = s.server_id
				WHERE r.user_discord_id = ${userDiscordId}
				AND s.server_disc_id = ${serverDiscId}
				AND r.reminder_time > CURRENT_TIMESTAMP
				ORDER BY r.reminder_time ASC
			`;
    } else {
      // Get all pending reminders for user across all servers
      reminderData = await sql`
				SELECT * FROM reminders
				WHERE user_discord_id = ${userDiscordId}
				AND reminder_time > CURRENT_TIMESTAMP
				ORDER BY reminder_time ASC
			`;
    }

    if (!reminderData) {
      log.warn(`Reminders data was unexpectedly null when fetching pending reminders for user ${userDiscordId}`);
      return [];
    }

    if (reminderData.length === 0) {
      return [];
    }

    // 2. Validate each reminder row
    const validatedReminders: ReminderRow[] = [];
    for (const reminder of reminderData) {
      const parsed = reminderSchema.safeParse(reminder);
      if (parsed.success) {
        validatedReminders.push(parsed.data);
      } else {
        log.warn(
          `Invalid reminder data found in DB for reminder_id ${(reminder as Record<string, unknown>).reminder_id}: ${JSON.stringify(reminder)}. Errors: ${parsed.error.flatten()}`,
        );
      }
    }

    log.info(`Found ${validatedReminders.length} pending reminders for user ${userDiscordId}`);
    return validatedReminders;
  } catch (error) {
    log.error(`Error loading pending reminders for user ${userDiscordId}:`, error);
    return null;
  }
}

/**
 * Checks if a Brave Search API key is set for the server.
 * @param serverId - The internal server ID (from servers table)
 * @returns True if Brave API key exists, false otherwise
 */
export async function getBraveApiKeyStatus(serverId: number): Promise<boolean> {
  try {
    // 1. Query opt_api_keys table for Brave Search API key
    const result = await sql`
			SELECT api_key FROM opt_api_keys
			WHERE server_id = ${serverId}
			AND service_name = 'brave-search'
			LIMIT 1
		`;

    // 2. Return true if key exists (even if encrypted), false otherwise
    return result && result.length > 0;
  } catch (error) {
    log.error(`Error checking Brave API key status for server ${serverId}:`, error);
    return false;
  }
}

/**
 * Gets the list of blacklisted member Discord IDs for a server.
 * @param serverId - The internal server ID (from servers table)
 * @returns Array of Discord user IDs, or empty array if none or error
 */
export async function getBlacklistedMemberIds(serverId: number): Promise<string[]> {
  try {
    // 1. Query personalization_blacklist table for blacklisted members
    const result = await sql`
			SELECT user_disc_id FROM personalization_blacklist
			WHERE server_id = ${serverId}
			ORDER BY user_disc_id ASC
		`;

    // 2. Extract user_disc_id values from result
    if (!result || result.length === 0) {
      return [];
    }

    // 3. Map to array of Discord IDs
    const memberIds = result.map((row: unknown) => (row as { user_disc_id: string }).user_disc_id);
    log.info(`Found ${memberIds.length} blacklisted members for server ${serverId}`);
    return memberIds;
  } catch (error) {
    log.error(`Error loading blacklisted members for server ${serverId}:`, error);
    return [];
  }
}

// ─── Random Trigger Functions ────────────────────────────────────────────────

/**
 * Fetches all random triggers whose next_trigger_at has passed (due for execution).
 * Called by the shared scheduled work coordinator when due work is processed.
 *
 * @returns Array of due RandomTriggerRow records, or empty array on error.
 */
export async function getDueRandomTriggers(): Promise<RandomTriggerRow[]> {
  try {
    // 1. Fetch all triggers scheduled at or before now
    const rows = await sql`
			SELECT * FROM random_triggers
			WHERE next_trigger_at <= NOW()
			ORDER BY next_trigger_at ASC
		`;

    if (!rows.length) return [];

    // 2. Validate and return each row
    const validated: RandomTriggerRow[] = [];
    for (const row of rows) {
      const parsed = randomTriggerSchema.safeParse(row);
      if (parsed.success) {
        validated.push(parsed.data);
      } else {
        log.warn(`Skipping invalid random trigger row (id=${row.trigger_id}):`, parsed.error);
      }
    }
    return validated;
  } catch (error) {
    log.error("Error fetching due random triggers:", error);
    return [];
  }
}

export async function getNextRandomTriggerTime(): Promise<Date | null> {
  try {
    const [result] = await sql<{ next_trigger_time: Date | string | null }[]>`
			SELECT next_trigger_at AS next_trigger_time
			FROM random_triggers
			ORDER BY next_trigger_at ASC
			LIMIT 1
		`;

    const nextTriggerTime = result?.next_trigger_time;
    if (!nextTriggerTime) {
      return null;
    }

    if (nextTriggerTime instanceof Date) {
      return nextTriggerTime;
    }

    const parsedTriggerTime = new Date(nextTriggerTime);
    return Number.isNaN(parsedTriggerTime.getTime()) ? null : parsedTriggerTime;
  } catch (error) {
    log.error("Error fetching next random trigger time:", error);
    return null;
  }
}

/**
 * Fetches all random triggers configured for a given server.
 * Used by the remove command to build the selection list.
 *
 * @param serverId - The database server_id.
 * @returns Array of RandomTriggerRow records, or empty array on error.
 */
export async function getServerRandomTriggers(serverId: number): Promise<RandomTriggerRow[]> {
  try {
    // 1. Fetch all triggers for this server ordered by creation date
    const rows = await sql`
			SELECT * FROM random_triggers
			WHERE server_id = ${serverId}
			ORDER BY created_at ASC
		`;

    if (!rows.length) return [];

    // 2. Validate and return
    const validated: RandomTriggerRow[] = [];
    for (const row of rows) {
      const parsed = randomTriggerSchema.safeParse(row);
      if (parsed.success) {
        validated.push(parsed.data);
      } else {
        log.warn(`Skipping invalid random trigger row (id=${row.trigger_id}):`, parsed.error);
      }
    }
    return validated;
  } catch (error) {
    log.error(`Error fetching random triggers for server ${serverId}:`, error);
    return [];
  }
}

/**
 * Returns the count of random triggers for a server.
 * Used to enforce the per-server cap before inserting a new trigger.
 *
 * @param serverId - The database server_id.
 * @returns The count of triggers, or 0 on error.
 */
export async function getServerRandomTriggerCount(serverId: number): Promise<number> {
  try {
    // 1. Count triggers for this server
    const [row] = await sql<Array<{ count: string | number }>>`
			SELECT COUNT(*) AS count FROM random_triggers
			WHERE server_id = ${serverId}
		`;
    return Number(row?.count ?? 0);
  } catch (error) {
    log.error(`Error counting random triggers for server ${serverId}:`, error);
    return 0;
  }
}

/**
 * Looks up an existing trigger by the (server, channel, persona) triple.
 * Used to detect override cases in the add command.
 *
 * @param serverId - The database server_id.
 * @param channelDiscId - The Discord channel ID.
 * @param tomoriId - The persona's tomori_id (non-null; Random uses INSERT always).
 * @returns The existing RandomTriggerRow, or null if not found.
 */
export async function getRandomTriggerByPersonaAndChannel(
  serverId: number,
  channelDiscId: string,
  tomoriId: number,
): Promise<RandomTriggerRow | null> {
  try {
    // 1. Find matching trigger for the specific named persona in this channel
    const [row] = await sql`
			SELECT * FROM random_triggers
			WHERE server_id = ${serverId}
			  AND channel_disc_id = ${channelDiscId}
			  AND tomori_id = ${tomoriId}
			LIMIT 1
		`;

    if (!row) return null;

    // 2. Validate and return
    const parsed = randomTriggerSchema.safeParse(row);
    if (!parsed.success) {
      log.warn(`Invalid random trigger row for persona ${tomoriId} in channel ${channelDiscId}:`, parsed.error);
      return null;
    }
    return parsed.data;
  } catch (error) {
    log.error(
      `Error fetching random trigger for server ${serverId}, channel ${channelDiscId}, persona ${tomoriId}:`,
      error,
    );
    return null;
  }
}

/**
 * Fetches the channel-level LLM override for a specific server channel.
 * Returns null if no override is configured.
 *
 * @param serverId - Database server ID (integer)
 * @param channelDiscId - Discord channel ID (snowflake string)
 * @returns Resolved LlmRow for the override, or null if not set
 */
export async function getChannelLlmOverride(serverId: number, channelDiscId: string): Promise<LlmRow | null> {
  try {
    // 1. Query channel override row
    const overrideRows = await sql`
			SELECT llm_id
			FROM channel_llm_overrides
			WHERE server_id = ${serverId}
			  AND channel_disc_id = ${channelDiscId}
			LIMIT 1
		`;
    if (!overrideRows.length) return null;

    const llmId = overrideRows[0].llm_id as number;

    // 2. Resolve LlmRow — check cache first, then fall back to DB
    const cached = getCachedLLM(llmId);
    if (cached) return cached as LlmRow;

    const llmRows = await sql`SELECT * FROM llms WHERE llm_id = ${llmId} LIMIT 1`;
    if (!llmRows.length) return null;

    return llmRows[0] as LlmRow;
  } catch (error) {
    log.error(`Error fetching channel LLM override for server ${serverId} channel ${channelDiscId}:`, error);
    return null;
  }
}

/**
 * Fetches all channel-level LLM overrides for a server, paired with their resolved LlmRow.
 * Used by the status command to display per-channel model overrides.
 *
 * @param serverId - Database server ID (integer)
 * @returns Array of objects containing channelDiscId and the resolved LlmRow
 */
export async function getAllChannelLlmOverridesForServer(
  serverId: number,
): Promise<{ channelDiscId: string; llm: LlmRow }[]> {
  try {
    // 1. Fetch all override rows for this server
    const overrideRows = await sql`
			SELECT channel_disc_id, llm_id
			FROM channel_llm_overrides
			WHERE server_id = ${serverId}
			ORDER BY channel_disc_id
		`;
    if (!overrideRows.length) return [];

    // 2. Resolve each override to a full LlmRow (cache-first)
    const results: { channelDiscId: string; llm: LlmRow }[] = [];
    for (const row of overrideRows) {
      const llmId = row.llm_id as number;
      const cached = getCachedLLM(llmId);
      if (cached) {
        results.push({
          channelDiscId: row.channel_disc_id as string,
          llm: cached as LlmRow,
        });
        continue;
      }
      const llmRows = await sql`SELECT * FROM llms WHERE llm_id = ${llmId} LIMIT 1`;
      if (llmRows.length) {
        results.push({
          channelDiscId: row.channel_disc_id as string,
          llm: llmRows[0] as LlmRow,
        });
      }
    }
    return results;
  } catch (error) {
    log.error(`Error fetching all channel LLM overrides for server ${serverId}:`, error);
    return [];
  }
}

/**
 * Loads all persona LLM overrides for a server as raw {tomori_id, llm_id} pairs.
 * Only returns personas that have a non-null llm_id override set.
 * Used for snapshotting overrides during provider switch.
 *
 * @param serverId - The database server_id (numeric)
 * @returns Array of {tomori_id, llm_id} pairs
 */
export async function loadPersonaLlmOverridesForServer(
  serverId: number,
): Promise<{ tomori_id: number; llm_id: number }[]> {
  try {
    const rows = await sql`
			SELECT pc.tomori_id, pc.llm_id
			FROM persona_configs pc
			JOIN tomoris t ON t.tomori_id = pc.tomori_id
			WHERE t.server_id = ${serverId}
			  AND pc.llm_id IS NOT NULL
		`;
    return rows.map((row: { tomori_id: number; llm_id: number }) => ({
      tomori_id: row.tomori_id,
      llm_id: row.llm_id,
    }));
  } catch (error) {
    log.error(`Error loading persona LLM overrides for server ${serverId}:`, error);
    return [];
  }
}

/**
 * Loads all saved provider configs for a server.
 * Returns an array of validated SavedProviderConfigRow objects.
 * @param serverId - The database server_id (numeric)
 * @returns Array of saved provider configs, or empty array on error/no results
 */
export async function loadSavedProviderConfigs(serverId: number): Promise<SavedProviderConfigRow[]> {
  try {
    const rows = await sql`
			SELECT * FROM saved_provider_configs
			WHERE server_id = ${serverId}
			ORDER BY provider ASC
		`;

    if (!rows || rows.length === 0) {
      return [];
    }

    // Validate each row with Zod schema
    const validated: SavedProviderConfigRow[] = [];
    for (const row of rows) {
      const parsed = savedProviderConfigSchema.safeParse(row);
      if (parsed.success) {
        validated.push(parsed.data);
      } else {
        log.warn(
          `Invalid saved provider config row for server ${serverId}, provider ${row.provider}: ${parsed.error.message}`,
        );
      }
    }
    return validated;
  } catch (error) {
    log.error(`Error loading saved provider configs for server ${serverId}:`, error);
    return [];
  }
}

/**
 * Loads a specific saved provider config for a server+provider pair.
 * @param serverId - The database server_id (numeric)
 * @param provider - The provider name (lowercase)
 * @returns The saved config row, or null if not found/error
 */
export async function loadSavedProviderConfig(
  serverId: number,
  provider: string,
): Promise<SavedProviderConfigRow | null> {
  try {
    const rows = await sql`
			SELECT * FROM saved_provider_configs
			WHERE server_id = ${serverId}
			  AND provider = ${provider.toLowerCase()}
			LIMIT 1
		`;

    if (!rows || rows.length === 0) {
      return null;
    }

    const parsed = savedProviderConfigSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.warn(`Invalid saved provider config for server ${serverId}, provider ${provider}: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  } catch (error) {
    log.error(`Error loading saved provider config for server ${serverId}, provider ${provider}:`, error);
    return null;
  }
}

/**
 * Loads all saved personal provider configs for a user.
 * @param userId - Internal users.user_id
 * @returns Array of validated personal provider configs, or empty array on error/no results
 */
export async function loadUserSavedProviderConfigs(userId: number): Promise<UserSavedProviderConfigRow[]> {
  try {
    const rows = await sql`
			SELECT * FROM user_saved_provider_configs
			WHERE user_id = ${userId}
			ORDER BY provider ASC
		`;

    if (!rows || rows.length === 0) {
      return [];
    }

    const validated: UserSavedProviderConfigRow[] = [];
    for (const row of rows) {
      const parsed = userSavedProviderConfigSchema.safeParse(row);
      if (parsed.success) {
        validated.push(parsed.data);
      } else {
        log.warn(
          `Invalid user saved provider config row for user ${userId}, provider ${row.provider}: ${parsed.error.message}`,
        );
      }
    }

    return validated;
  } catch (error) {
    log.error(`Error loading user saved provider configs for user ${userId}:`, error);
    return [];
  }
}

/**
 * Loads a specific saved personal provider config for a user+provider pair.
 * @param userId - Internal users.user_id
 * @param provider - Provider name (lowercase)
 * @returns The saved config row, or null if not found/error
 */
export async function loadUserSavedProviderConfig(
  userId: number,
  provider: string,
): Promise<UserSavedProviderConfigRow | null> {
  try {
    const rows = await sql`
			SELECT * FROM user_saved_provider_configs
			WHERE user_id = ${userId}
			  AND provider = ${provider.toLowerCase()}
			LIMIT 1
		`;

    if (!rows || rows.length === 0) {
      return null;
    }

    const parsed = userSavedProviderConfigSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.warn(`Invalid user saved provider config for user ${userId}, provider ${provider}: ${parsed.error.message}`);
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(`Error loading user saved provider config for user ${userId}, provider ${provider}:`, error);
    return null;
  }
}

export async function loadOpenRouterModelRegistrationsForServer(
  serverId: number,
): Promise<OpenRouterModelRegistrationRow[]> {
  try {
    const rows = await sql<unknown[]>`
			SELECT *
			FROM openrouter_model_registrations
			WHERE server_id = ${serverId}
			  AND user_id IS NULL
			ORDER BY llm_id ASC
		`;

    return rows
      .map((row: unknown) => openRouterModelRegistrationSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  } catch (error) {
    log.error(`Error loading OpenRouter model registrations for server ${serverId}:`, error);
    return [];
  }
}

export async function loadOpenRouterModelRegistrationsForUser(
  userId: number,
): Promise<OpenRouterModelRegistrationRow[]> {
  try {
    const rows = await sql<unknown[]>`
			SELECT *
			FROM openrouter_model_registrations
			WHERE user_id = ${userId}
			  AND server_id IS NULL
			ORDER BY llm_id ASC
		`;

    return rows
      .map((row: unknown) => openRouterModelRegistrationSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  } catch (error) {
    log.error(`Error loading OpenRouter model registrations for user ${userId}:`, error);
    return [];
  }
}

export async function loadOpenRouterEmbeddingModelRegistrationsForServer(
  serverId: number,
): Promise<OpenRouterEmbeddingModelRegistrationRow[]> {
  try {
    const rows = await sql<unknown[]>`
			SELECT *
			FROM openrouter_embedding_model_registrations
			WHERE server_id = ${serverId}
			  AND user_id IS NULL
			ORDER BY embedding_model_id ASC
		`;

    return rows
      .map((row: unknown) => openRouterEmbeddingModelRegistrationSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  } catch (error) {
    log.error(`Error loading OpenRouter embedding model registrations for server ${serverId}:`, error);
    return [];
  }
}

export async function loadOpenRouterEmbeddingModelRegistrationsForUser(
  userId: number,
): Promise<OpenRouterEmbeddingModelRegistrationRow[]> {
  try {
    const rows = await sql<unknown[]>`
			SELECT *
			FROM openrouter_embedding_model_registrations
			WHERE user_id = ${userId}
			  AND server_id IS NULL
			ORDER BY embedding_model_id ASC
		`;

    return rows
      .map((row: unknown) => openRouterEmbeddingModelRegistrationSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  } catch (error) {
    log.error(`Error loading OpenRouter embedding model registrations for user ${userId}:`, error);
    return [];
  }
}

export async function loadOpenRouterImageModelRegistrationsForServer(
  serverId: number,
): Promise<OpenRouterImageModelRegistrationRow[]> {
  try {
    const rows = await sql<unknown[]>`
			SELECT *
			FROM openrouter_image_model_registrations
			WHERE server_id = ${serverId}
			  AND user_id IS NULL
			ORDER BY diffusion_model_id ASC
		`;

    return rows
      .map((row: unknown) => openRouterImageModelRegistrationSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  } catch (error) {
    log.error(`Error loading OpenRouter image model registrations for server ${serverId}:`, error);
    return [];
  }
}

export async function loadOpenRouterImageModelRegistrationsForUser(
  userId: number,
): Promise<OpenRouterImageModelRegistrationRow[]> {
  try {
    const rows = await sql<unknown[]>`
			SELECT *
			FROM openrouter_image_model_registrations
			WHERE user_id = ${userId}
			  AND server_id IS NULL
			ORDER BY diffusion_model_id ASC
		`;

    return rows
      .map((row: unknown) => openRouterImageModelRegistrationSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  } catch (error) {
    log.error(`Error loading OpenRouter image model registrations for user ${userId}:`, error);
    return [];
  }
}

export async function loadOpenRouterVideoModelRegistrationsForServer(
  serverId: number,
): Promise<OpenRouterVideoModelRegistrationRow[]> {
  try {
    const rows = await sql<unknown[]>`
			SELECT *
			FROM openrouter_video_model_registrations
			WHERE server_id = ${serverId}
			  AND user_id IS NULL
			ORDER BY video_model_id ASC
		`;

    return rows
      .map((row: unknown) => openRouterVideoModelRegistrationSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  } catch (error) {
    log.error(`Error loading OpenRouter video model registrations for server ${serverId}:`, error);
    return [];
  }
}

export async function loadOpenRouterVideoModelRegistrationsForUser(
  userId: number,
): Promise<OpenRouterVideoModelRegistrationRow[]> {
  try {
    const rows = await sql<unknown[]>`
			SELECT *
			FROM openrouter_video_model_registrations
			WHERE user_id = ${userId}
			  AND server_id IS NULL
			ORDER BY video_model_id ASC
		`;

    return rows
      .map((row: unknown) => openRouterVideoModelRegistrationSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  } catch (error) {
    log.error(`Error loading OpenRouter video model registrations for user ${userId}:`, error);
    return [];
  }
}

export async function loadScopedOpenRouterModels(
  scope: OpenRouterModelScope,
  includeDeprecated = false,
): Promise<LlmRow[]> {
  try {
    const rows = await loadScopedOpenRouterModelRows(scope, includeDeprecated);
    const parsed = llmSchema.array().safeParse(rows);
    if (!parsed.success) {
      log.error(
        `Failed to validate scoped OpenRouter model data for ${scope.kind} ${scope.ownerId}:`,
        parsed.error.flatten(),
      );
      return [];
    }

    return parsed.data;
  } catch (error) {
    log.error(`Error loading scoped OpenRouter models for ${scope.kind} ${scope.ownerId}:`, error);
    return [];
  }
}

export async function loadScopedOpenRouterEmbeddingModels(
  scope: OpenRouterModelScope,
  includeDeprecated = false,
): Promise<EmbeddingModelRow[]> {
  try {
    const rows = await loadScopedOpenRouterEmbeddingModelRows(scope, includeDeprecated);
    const parsed = embeddingModelSchema.array().safeParse(rows);
    if (!parsed.success) {
      log.error(
        `Failed to validate scoped OpenRouter embedding model data for ${scope.kind} ${scope.ownerId}:`,
        parsed.error.flatten(),
      );
      return [];
    }

    return parsed.data;
  } catch (error) {
    log.error(`Error loading scoped OpenRouter embedding models for ${scope.kind} ${scope.ownerId}:`, error);
    return [];
  }
}

export async function loadScopedOpenRouterDiffusionModels(
  scope: OpenRouterModelScope,
  includeDeprecated = false,
): Promise<DiffusionModelRow[]> {
  try {
    const rows = await loadScopedOpenRouterDiffusionModelRows(scope, includeDeprecated);
    const parsed = diffusionModelSchema.array().safeParse(rows);
    if (!parsed.success) {
      log.error(
        `Failed to validate scoped OpenRouter diffusion model data for ${scope.kind} ${scope.ownerId}:`,
        parsed.error.flatten(),
      );
      return [];
    }

    return parsed.data;
  } catch (error) {
    log.error(`Error loading scoped OpenRouter diffusion models for ${scope.kind} ${scope.ownerId}:`, error);
    return [];
  }
}

export async function loadScopedOpenRouterVideoGenerationModels(
  scope: OpenRouterModelScope,
  includeDeprecated = false,
): Promise<VideoGenerationModelRow[]> {
  try {
    const rows = await loadScopedOpenRouterVideoGenerationModelRows(scope, includeDeprecated);
    const parsed = videoGenerationModelSchema.array().safeParse(rows);
    if (!parsed.success) {
      log.error(
        `Failed to validate scoped OpenRouter video model data for ${scope.kind} ${scope.ownerId}:`,
        parsed.error.flatten(),
      );
      return [];
    }

    return parsed.data;
  } catch (error) {
    log.error(`Error loading scoped OpenRouter video models for ${scope.kind} ${scope.ownerId}:`, error);
    return [];
  }
}

export async function loadCustomEndpointsForServer(serverId: number): Promise<CustomEndpointRow[]> {
  try {
    const rows = await sql<unknown[]>`
			SELECT DISTINCT ON (label, capability) *
			FROM custom_endpoints
			WHERE server_id = ${serverId}
			  AND user_id IS NULL
			ORDER BY label ASC, capability ASC, updated_at DESC, custom_endpoint_id DESC
		`;

    return rows
      .map((row: unknown) => customEndpointSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  } catch (error) {
    log.error(`Error loading custom endpoints for server ${serverId}:`, error);
    return [];
  }
}

export async function loadCustomEndpointsForUser(userId: number): Promise<CustomEndpointRow[]> {
  try {
    const rows = await sql<unknown[]>`
			SELECT DISTINCT ON (label, capability) *
			FROM custom_endpoints
			WHERE user_id = ${userId}
			  AND server_id IS NULL
			ORDER BY label ASC, capability ASC, updated_at DESC, custom_endpoint_id DESC
		`;

    return rows
      .map((row: unknown) => customEndpointSchema.safeParse(row))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  } catch (error) {
    log.error(`Error loading custom endpoints for user ${userId}:`, error);
    return [];
  }
}

/**
 * Fetches custom endpoint rows by their IDs in a single query.
 * Returns results in the same order as the input ids array.
 * Uses unsafe SQL with IN list to avoid Bun SQL integer-array protocol issues (same pattern as getLlmsByIds).
 *
 * @param ids - Array of custom_endpoint_id values to fetch
 * @returns Ordered array of validated CustomEndpointRow objects (preserves input order, skips missing/invalid rows)
 */
export async function loadCustomEndpointsByIds(ids: number[]): Promise<CustomEndpointRow[]> {
  if (ids.length === 0) return [];

  try {
    // 1. Fetch all matching rows in a single query; avoid ANY($1) array binding (protocol error 08P01)
    const distinctIds = Array.from(new Set(ids));
    const placeholders = distinctIds.map((_, index) => `$${index + 1}`).join(", ");
    const rows = await sql.unsafe(
      `SELECT * FROM custom_endpoints WHERE custom_endpoint_id IN (${placeholders})`,
      distinctIds,
    );

    // 2. Validate each row and index by ID for order-preserving lookup
    const rowMap = new Map<number, CustomEndpointRow>();
    for (const row of rows) {
      const parsed = customEndpointSchema.safeParse(row);
      if (parsed.success && parsed.data.custom_endpoint_id !== undefined) {
        rowMap.set(parsed.data.custom_endpoint_id, parsed.data);
      } else if (!parsed.success) {
        log.warn(
          `Invalid custom endpoint row for id ${(row as Record<string, unknown>).custom_endpoint_id}:`,
          parsed.error.flatten(),
        );
      }
    }

    // 3. Return in the same order as the input ids, skipping missing entries
    return ids.flatMap((id) => {
      const ep = rowMap.get(id);
      return ep ? [ep] : [];
    });
  } catch (error) {
    log.error(`Error loading custom endpoints by ids [${ids.join(", ")}]:`, error);
    return [];
  }
}

export async function loadCustomEndpoint(params: {
  serverId?: number | null;
  userId?: number | null;
  label: string;
  capability: CustomEndpointCapability;
}): Promise<CustomEndpointRow | null> {
  const { serverId = null, userId = null, label, capability } = params;

  try {
    const rows =
      serverId !== null
        ? await sql`
            SELECT *
            FROM custom_endpoints
            WHERE server_id = ${serverId}
              AND user_id IS NULL
              AND label = ${label}
              AND capability = ${capability}
            ORDER BY updated_at DESC, custom_endpoint_id DESC
            LIMIT 1
          `
        : await sql`
            SELECT *
            FROM custom_endpoints
            WHERE user_id = ${userId}
              AND server_id IS NULL
              AND label = ${label}
              AND capability = ${capability}
            ORDER BY updated_at DESC, custom_endpoint_id DESC
            LIMIT 1
          `;

    if (!rows.length) {
      return null;
    }

    const parsed = customEndpointSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.warn(
        `Invalid custom endpoint row for ${serverId !== null ? `server ${serverId}` : `user ${userId}`}, label ${label}, capability ${capability}: ${parsed.error.message}`,
      );
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(
      `Error loading custom endpoint for ${serverId !== null ? `server ${serverId}` : `user ${userId}`}, label ${label}, capability ${capability}:`,
      error,
    );
    return null;
  }
}

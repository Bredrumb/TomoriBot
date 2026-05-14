import {
  apiKeyRotationSchema,
  naiPresetSchema,
  personaConfigSchema,
  tomoriConfigSchema,
  tomoriStateSchema,
  type ApiKeyRotationRow,
  type FallbackEntry,
  type FallbackModelRef,
  type LlmRow,
  type NaiPresetRow,
  type PersonaConfigRow,
  type TomoriConfigRow,
  type TomoriRow,
  type TomoriState,
} from "@/types/db/schema";
import { DatabaseUnavailableError } from "@/types/errors";
import { getCachedLLM } from "@/utils/cache/llmCache";
import { sql, withCachedPlanRetry } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { getUnconfiguredLlm } from "@/utils/provider/unconfiguredLlm";
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
import { getLlmsByIds, loadCustomEndpointsByIds } from "@/utils/db/repositories/llmReadSql";
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

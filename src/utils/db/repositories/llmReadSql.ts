import {
  customEndpointSchema,
  diffusionModelSchema,
  embeddingModelSchema,
  llmSchema,
  openRouterEmbeddingModelRegistrationSchema,
  openRouterImageModelRegistrationSchema,
  openRouterModelRegistrationSchema,
  openRouterVideoModelRegistrationSchema,
  savedProviderConfigSchema,
  userSavedProviderConfigSchema,
  videoGenerationModelSchema,
  type CustomEndpointCapability,
  type CustomEndpointRow,
  type DiffusionModelRow,
  type EmbeddingModelRow,
  type LlmRow,
  type OpenRouterEmbeddingModelRegistrationRow,
  type OpenRouterImageModelRegistrationRow,
  type OpenRouterModelRegistrationRow,
  type OpenRouterVideoModelRegistrationRow,
  type SavedProviderConfigRow,
  type UserSavedProviderConfigRow,
  type VideoGenerationModelRow,
} from "@/types/db/schema";
import { getCachedLLM } from "@/utils/cache/llmCache";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
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

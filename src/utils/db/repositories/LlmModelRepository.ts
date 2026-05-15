import {
  diffusionModelSchema,
  embeddingModelSchema,
  llmSchema,
  videoGenerationModelSchema,
  type DiffusionModelRow,
  type EmbeddingModelRow,
  type LlmRow,
  type VideoGenerationModelRow,
} from "@/types/db/schema";
import { getCachedLLM } from "@/utils/cache/llmCache";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";

/** Canonical scope for OpenRouter model visibility filtering. */
export type OpenRouterModelScope = { kind: "server"; ownerId: number } | { kind: "personal"; ownerId: number };

const PROVIDER_NAME_PATTERN = /^[a-zA-Z0-9:_-]+$/;

function normalizeProviderName(providerName: string): string | null {
  const trimmed = providerName.trim();
  if (!trimmed || !PROVIDER_NAME_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

/**
 * LlmModelRepository — global model catalog for all LLM modalities.
 *
 * Owns tables: llms, embedding_models, image_diffusion_models, video_generation_models.
 * Read-only; model catalog is global seed data, not exportable per-server state.
 */
export class LlmModelRepository {
  // ── llm catalog ────────────────────────────────────────────────────────────

  /**
   * Returns all non-deprecated LLMs, or all LLMs when includeDeprecated is true.
   *
   * @param includeDeprecated - Include deprecated models in results
   */
  async loadAvailableLlms(includeDeprecated = false): Promise<LlmRow[] | null> {
    try {
      const rows = includeDeprecated
        ? await sql`SELECT * FROM llms ORDER BY llm_id ASC`
        : await sql`SELECT * FROM llms WHERE is_deprecated = false ORDER BY llm_id ASC`;

      if (!rows || rows.length === 0) {
        log.warn("No LLM models found in the database.");
        return null;
      }

      const parsed = llmSchema.array().safeParse(rows);
      if (!parsed.success) {
        log.error("Failed to validate LLM data from database:", parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error("Error loading available LLMs from database:", error);
      return null;
    }
  }

  /**
   * Returns LLMs by their internal IDs, preserving input order.
   *
   * @param ids - Array of internal LLM IDs
   */
  async getLlmsByIds(ids: number[]): Promise<LlmRow[]> {
    if (ids.length === 0) return [];

    try {
      // Avoid ANY($1) array binding — Bun SQL can intermittently fail on
      // integer-array parameters with protocol error 08P01.
      const distinctIds = Array.from(new Set(ids));
      const placeholders = distinctIds.map((_, i) => `$${i + 1}`).join(", ");
      const rows = await sql.unsafe(`SELECT * FROM llms WHERE llm_id IN (${placeholders})`, distinctIds);

      const rowMap = new Map<number, LlmRow>();
      for (const row of rows) {
        const parsed = llmSchema.safeParse(row);
        if (parsed.success && parsed.data.llm_id !== undefined) {
          rowMap.set(parsed.data.llm_id, parsed.data);
        } else if (!parsed.success) {
          log.warn(`Invalid LLM row for id ${row.llm_id}:`, parsed.error.flatten());
        }
      }

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
   * Returns a single LLM by its internal ID, cache-first.
   *
   * @param llmId - Internal LLM ID
   */
  async loadById(llmId: number): Promise<LlmRow | null> {
    if (!Number.isInteger(llmId) || llmId <= 0) {
      log.error(`Invalid llm_id: ${llmId}`);
      return null;
    }

    const cached = getCachedLLM(llmId);
    if (cached) return cached as LlmRow;

    try {
      const rows = await sql`SELECT * FROM llms WHERE llm_id = ${llmId} LIMIT 1`;
      if (!rows.length) {
        log.warn(`No LLM found for llm_id ${llmId}`);
        return null;
      }

      const parsed = llmSchema.safeParse(rows[0]);
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
   * Compatibility alias for loadById.
   *
   * @param llmId - Internal LLM ID
   */
  async loadLlmById(llmId: number): Promise<LlmRow | null> {
    return this.loadById(llmId);
  }

  /**
   * Returns the LLM matching a provider + codename pair, or null if not found.
   *
   * @param provider - Provider name (e.g. "google", "openrouter")
   * @param codename - Model codename (e.g. "gemini-2.0-flash")
   */
  async loadByProviderAndCodename(provider: string, codename: string): Promise<LlmRow | null> {
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedCodename = codename.trim();
    if (!normalizedProvider || !normalizedCodename) return null;

    try {
      const rows = await sql`
        SELECT * FROM llms
        WHERE llm_provider = ${normalizedProvider}
          AND llm_codename = ${normalizedCodename}
        LIMIT 1
      `;
      if (!rows.length) return null;

      const parsed = llmSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(
          `Failed to validate model data for ${normalizedProvider}/${normalizedCodename}:`,
          parsed.error.flatten(),
        );
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading LLM for ${normalizedProvider}/${normalizedCodename}:`, error);
      return null;
    }
  }

  /**
   * Returns available LLMs for a provider. For the openrouter provider with a scope,
   * delegates to LlmProviderRepository to filter by registration.
   *
   * @param providerName      - Provider name
   * @param includeDeprecated - Include deprecated models
   * @param scope             - Optional OpenRouter scope filter
   */
  async loadAvailableModelsForProvider(
    providerName: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<LlmRow[] | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      if (normalized === "openrouter" && scope) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterModels(scope, includeDeprecated);
      }

      const rows = includeDeprecated
        ? await sql`
            SELECT * FROM llms
            WHERE llm_provider = ${normalized}
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY llm_id ASC
          `
        : await sql`
            SELECT * FROM llms
            WHERE llm_provider = ${normalized}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY llm_id ASC
          `;

      if (!rows || rows.length === 0) {
        log.warn(`No available models found for provider: ${normalized}`);
        return null;
      }

      const parsed = llmSchema.array().safeParse(rows);
      if (!parsed.success) {
        log.error(`Failed to validate model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      log.info(`Found ${parsed.data.length} available models for ${normalized}`);
      return parsed.data;
    } catch (error) {
      log.error(`Error loading available models for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the default LLM for a provider (is_default=true, or first available as fallback).
   *
   * @param providerName - Provider name
   */
  async loadDefaultModel(providerName: string): Promise<LlmRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = await sql`
        SELECT *, CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
        FROM llms
        WHERE llm_provider = ${normalized} AND is_deprecated = false
        ORDER BY priority ASC, llm_id ASC
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        log.error(`No available models found for provider: ${normalized}`);
        return null;
      }

      const parsed = llmSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      if (rows[0].is_default === true) {
        log.info(`Found default model for ${normalized}: ${parsed.data.llm_codename}`);
      } else {
        log.warn(`No default model found for ${normalized}, using fallback: ${parsed.data.llm_codename}`);
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading default model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the highest-capability (smartest) LLM for a provider.
   *
   * @param providerName      - Provider name
   * @param includeDeprecated - Include deprecated models
   */
  async loadSmartestModel(providerName: string, includeDeprecated = false): Promise<LlmRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = includeDeprecated
        ? await sql`
            SELECT * FROM llms
            WHERE llm_provider = ${normalized} AND is_smartest = true
            ORDER BY llm_id ASC LIMIT 1
          `
        : await sql`
            SELECT * FROM llms
            WHERE llm_provider = ${normalized} AND is_smartest = true AND is_deprecated = false
            ORDER BY llm_id ASC LIMIT 1
          `;

      if (!rows || rows.length === 0) {
        log.warn(`No smartest model found for provider: ${normalized}`);
        return null;
      }

      const parsed = llmSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate smartest model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      log.info(`Found smartest model for ${normalized}: ${parsed.data.llm_codename}`);
      return parsed.data;
    } catch (error) {
      log.error(`Error loading smartest model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the default vision-capable LLM for a provider.
   *
   * @param providerName - Provider name
   */
  async loadDefaultVisionModel(providerName: string): Promise<LlmRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = await sql`
        SELECT *, CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
        FROM llms
        WHERE llm_provider = ${normalized}
          AND sees_images = true
          AND is_deprecated = false
        ORDER BY priority ASC, llm_id ASC
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        log.warn(`No available vision models found for provider: ${normalized}`);
        return null;
      }

      const parsed = llmSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate default vision model for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading default vision model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns all distinct provider names that have at least one non-deprecated model.
   *
   * @param includeDeprecated - Include providers only present on deprecated models
   */
  async loadUniqueProviders(includeDeprecated = false): Promise<string[] | null> {
    try {
      const rows = includeDeprecated
        ? await sql`SELECT DISTINCT llm_provider FROM llms ORDER BY llm_provider ASC`
        : await sql`SELECT DISTINCT llm_provider FROM llms WHERE is_deprecated = false ORDER BY llm_provider ASC`;

      if (!rows || rows.length === 0) {
        log.warn("No LLM providers with available models found in the database.");
        return null;
      }

      const providerMap = new Map<string, string>();
      for (const row of rows) {
        const provider = row.llm_provider as string;
        const lowerKey = provider.toLowerCase();
        if (!providerMap.has(lowerKey)) {
          providerMap.set(lowerKey, provider);
        }
      }

      const providers = Array.from(providerMap.values()).sort();
      log.info(`Found ${providers.length} unique LLM providers: ${providers.join(", ")}`);
      return providers;
    } catch (error) {
      log.error("Error loading unique LLM providers from database:", error);
      return null;
    }
  }

  // ── embedding model catalog ────────────────────────────────────────────────

  /**
   * Returns available embedding models for a provider. Delegates scoped OpenRouter
   * filtering to LlmProviderRepository.
   *
   * @param providerName      - Provider name
   * @param includeDeprecated - Include deprecated models
   * @param scope             - Optional OpenRouter scope filter
   */
  async loadAvailableEmbeddingModels(
    providerName: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<EmbeddingModelRow[] | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      if (normalized === "openrouter" && scope) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterEmbeddingModels(scope, includeDeprecated);
      }

      const rows = includeDeprecated
        ? await sql`
            SELECT * FROM embedding_models
            WHERE provider = ${normalized}
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY embedding_model_id ASC
          `
        : await sql`
            SELECT * FROM embedding_models
            WHERE provider = ${normalized}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY embedding_model_id ASC
          `;

      if (!rows || rows.length === 0) {
        log.warn(`No available embedding models found for provider: ${normalized}`);
        return null;
      }

      const parsed = embeddingModelSchema.array().safeParse(rows);
      if (!parsed.success) {
        log.error(`Failed to validate embedding model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      log.info(`Found ${parsed.data.length} embedding models for ${normalized}`);
      return parsed.data;
    } catch (error) {
      log.error(`Error loading embedding models for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the default embedding model for a provider.
   *
   * @param providerName - Provider name
   */
  async loadDefaultEmbeddingModel(providerName: string): Promise<EmbeddingModelRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = await sql`
        SELECT *, CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
        FROM embedding_models
        WHERE provider = ${normalized} AND is_deprecated = false
        ORDER BY priority ASC, embedding_model_id ASC
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        log.error(`No available embedding models found for provider: ${normalized}`);
        return null;
      }

      const parsed = embeddingModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate embedding model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      if (rows[0].is_default === true) {
        log.info(`Found default embedding model for ${normalized}: ${parsed.data.codename}`);
      } else {
        log.warn(`No default embedding model found for ${normalized}, using fallback: ${parsed.data.codename}`);
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading default embedding model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns an embedding model by its internal ID.
   *
   * @param embeddingModelId - Internal embedding model ID
   */
  async loadEmbeddingModelById(embeddingModelId: number): Promise<EmbeddingModelRow | null> {
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

  /**
   * Returns an embedding model by provider + codename, or null if not found.
   *
   * @param provider - Provider name
   * @param codename - Model codename
   */
  async loadEmbeddingModelByProviderAndCodename(provider: string, codename: string): Promise<EmbeddingModelRow | null> {
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedCodename = codename.trim();
    if (!normalizedProvider || !normalizedCodename) return null;

    try {
      const rows = await sql`
        SELECT * FROM embedding_models
        WHERE provider = ${normalizedProvider}
          AND codename = ${normalizedCodename}
        LIMIT 1
      `;
      if (!rows.length) return null;

      const parsed = embeddingModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(
          `Failed to validate embedding model data for ${normalizedProvider}/${normalizedCodename}:`,
          parsed.error.flatten(),
        );
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading embedding model for ${normalizedProvider}/${normalizedCodename}:`, error);
      return null;
    }
  }

  // ── diffusion model catalog ────────────────────────────────────────────────

  /**
   * Returns available image diffusion models for a provider. Delegates scoped
   * OpenRouter filtering to LlmProviderRepository.
   *
   * @param providerName      - Provider name
   * @param includeDeprecated - Include deprecated models
   * @param scope             - Optional OpenRouter scope filter
   */
  async loadAvailableDiffusionModels(
    providerName: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<DiffusionModelRow[] | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      if (normalized === "openrouter" && scope) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterDiffusionModels(scope, includeDeprecated);
      }

      const rows = includeDeprecated
        ? await sql`
            SELECT * FROM image_diffusion_models
            WHERE provider = ${normalized}
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY diffusion_model_id ASC
          `
        : await sql`
            SELECT * FROM image_diffusion_models
            WHERE provider = ${normalized}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY diffusion_model_id ASC
          `;

      if (!rows || rows.length === 0) {
        log.warn(`No available diffusion models found for provider: ${normalized}`);
        return null;
      }

      const parsed = diffusionModelSchema.array().safeParse(rows);
      if (!parsed.success) {
        log.error(`Failed to validate diffusion model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      log.info(`Found ${parsed.data.length} diffusion models for ${normalized}`);
      return parsed.data;
    } catch (error) {
      log.error(`Error loading diffusion models for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the default image diffusion model for a provider.
   *
   * @param providerName - Provider name
   */
  async loadDefaultDiffusionModel(providerName: string): Promise<DiffusionModelRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = await sql`
        SELECT *, CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
        FROM image_diffusion_models
        WHERE provider = ${normalized} AND is_deprecated = false
        ORDER BY priority ASC, diffusion_model_id ASC
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        log.warn(`No available diffusion models found for provider: ${normalized}`);
        return null;
      }

      const parsed = diffusionModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate default diffusion model for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading default diffusion model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns a diffusion model by provider + codename, or null if not found.
   *
   * @param provider - Provider name
   * @param codename - Model codename
   */
  async loadDiffusionModelByProviderAndCodename(provider: string, codename: string): Promise<DiffusionModelRow | null> {
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedCodename = codename.trim();
    if (!normalizedProvider || !normalizedCodename) return null;

    try {
      const rows = await sql`
        SELECT * FROM image_diffusion_models
        WHERE provider = ${normalizedProvider}
          AND codename = ${normalizedCodename}
        LIMIT 1
      `;
      if (!rows.length) return null;

      const parsed = diffusionModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(
          `Failed to validate diffusion model data for ${normalizedProvider}/${normalizedCodename}:`,
          parsed.error.flatten(),
        );
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading diffusion model for ${normalizedProvider}/${normalizedCodename}:`, error);
      return null;
    }
  }

  // ── video generation model catalog ─────────────────────────────────────────

  /**
   * Returns available video generation models for a provider. Delegates scoped
   * OpenRouter filtering to LlmProviderRepository.
   *
   * @param providerName      - Provider name
   * @param includeDeprecated - Include deprecated models
   * @param scope             - Optional OpenRouter scope filter
   */
  async loadAvailableVideoGenerationModels(
    providerName: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<VideoGenerationModelRow[] | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      if (normalized === "openrouter" && scope) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterVideoGenerationModels(scope, includeDeprecated);
      }

      const rows = includeDeprecated
        ? await sql`
            SELECT * FROM video_generation_models
            WHERE provider = ${normalized}
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY video_model_id ASC
          `
        : await sql`
            SELECT * FROM video_generation_models
            WHERE provider = ${normalized}
              AND is_deprecated = false
              AND COALESCE(is_scoped_registration, false) = false
            ORDER BY video_model_id ASC
          `;

      if (!rows || rows.length === 0) {
        log.warn(`No available video generation models found for provider: ${normalized}`);
        return null;
      }

      const parsed = videoGenerationModelSchema.array().safeParse(rows);
      if (!parsed.success) {
        log.error(`Failed to validate video generation model data for provider ${normalized}:`, parsed.error.flatten());
        return null;
      }

      log.info(`Found ${parsed.data.length} video generation models for ${normalized}`);
      return parsed.data;
    } catch (error) {
      log.error(`Error loading video generation models for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns the default video generation model for a provider.
   *
   * @param providerName - Provider name
   */
  async loadDefaultVideoGenerationModel(providerName: string): Promise<VideoGenerationModelRow | null> {
    const normalized = normalizeProviderName(providerName);
    if (!normalized) {
      log.error(`Invalid provider name format: ${providerName}`);
      return null;
    }

    try {
      const rows = await sql`
        SELECT *, CASE WHEN is_default = true THEN 1 ELSE 2 END as priority
        FROM video_generation_models
        WHERE provider = ${normalized} AND is_deprecated = false
        ORDER BY priority ASC, video_model_id ASC
        LIMIT 1
      `;

      if (!rows || rows.length === 0) {
        log.warn(`No available video generation models found for provider: ${normalized}`);
        return null;
      }

      const parsed = videoGenerationModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(
          `Failed to validate default video generation model for provider ${normalized}:`,
          parsed.error.flatten(),
        );
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading default video generation model for provider ${normalized}:`, error);
      return null;
    }
  }

  /**
   * Returns a video generation model by provider + codename, or null if not found.
   *
   * @param provider - Provider name
   * @param codename - Model codename
   */
  async loadVideoGenerationModelByProviderAndCodename(
    provider: string,
    codename: string,
  ): Promise<VideoGenerationModelRow | null> {
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedCodename = codename.trim();
    if (!normalizedProvider || !normalizedCodename) return null;

    try {
      const rows = await sql`
        SELECT * FROM video_generation_models
        WHERE provider = ${normalizedProvider}
          AND codename = ${normalizedCodename}
        LIMIT 1
      `;
      if (!rows.length) return null;

      const parsed = videoGenerationModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(
          `Failed to validate video generation model data for ${normalizedProvider}/${normalizedCodename}:`,
          parsed.error.flatten(),
        );
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading video generation model for ${normalizedProvider}/${normalizedCodename}:`, error);
      return null;
    }
  }
}

/** Singleton instance — import this in callers. */
export const llmModelRepo = new LlmModelRepository();

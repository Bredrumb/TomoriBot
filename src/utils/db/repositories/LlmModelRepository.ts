import {
  speechModelSchema,
  type SpeechModelRow,
  transcriptionModelSchema,
  type TranscriptionModelRow,
  decisionModelSchema,
  type DecisionModelRow,
  diffusionModelSchema,
  embeddingModelSchema,
  llmSchema,
  videoGenerationModelSchema,
  type DiffusionModelRow,
  type EmbeddingModelRow,
  type LlmRow,
  type CustomEndpointCapability,
  type VideoGenerationModelRow,
} from "@/types/db/schema";
import { getCachedLLM } from "@/utils/cache/llmCache";
import { sql, withTransientDbRetry } from "@/utils/db/client";
import { buildIntegerParameterList } from "@/utils/db/parameterBinding";
import { log } from "@/utils/misc/logger";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import type { ImageEndpointSupports } from "@/utils/provider/customImageEndpointSupport";
import type { DecisionModelOption } from "@/types/provider/featureInterfaces";

export type OpenRouterModelScope = { kind: "server"; ownerId: number } | { kind: "personal"; ownerId: number };

const PROVIDER_NAME_PATTERN = /^[a-zA-Z0-9:_-]+$/;

function normalizeProviderName(providerName: string): string | null {
  const trimmed = providerName.trim();
  if (!trimmed || !PROVIDER_NAME_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

// The driver passes a JS array as plain toString() output, which PostgreSQL rejects
// ("Array value must start with {"), so array parameters are formatted explicitly.
function toPgTextArrayLiteral(values: string[]): string {
  if (values.length === 0) return "{}";
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

function toPgNumericArrayLiteral(values: number[]): string {
  if (values.length === 0) return "{}";
  return `{${values.join(",")}}`;
}

class LlmModelRepository {
  async loadAvailableSpeechModels(provider: string, scope: OpenRouterModelScope): Promise<SpeechModelRow[]> {
    const rows = await withTransientDbRetry(
      () => sql`
        SELECT m.* FROM speech_models m
        WHERE m.provider = ${provider} AND NOT m.is_deprecated AND (
          NOT m.is_scoped_registration OR EXISTS (
            SELECT 1 FROM scoped_model_registrations r WHERE r.speech_model_id = m.speech_model_id
              AND ((${scope.kind} = 'server' AND r.server_id = ${scope.ownerId} AND r.user_id IS NULL)
                OR (${scope.kind} = 'personal' AND r.user_id = ${scope.ownerId} AND r.server_id IS NULL))
          )
        ) ORDER BY m.is_default DESC, m.speech_model_id
      `,
      "load available speech models",
    );
    return speechModelSchema.array().parse(rows);
  }

  async loadSpeechModelById(speechModelId: number): Promise<SpeechModelRow | null> {
    const rows = await withTransientDbRetry(
      () => sql`SELECT * FROM speech_models WHERE speech_model_id = ${speechModelId}`,
      "load speech model by id",
    );
    return rows.length ? speechModelSchema.parse(rows[0]) : null;
  }

  async loadAvailableTranscriptionModels(
    provider: string,
    scope: OpenRouterModelScope,
  ): Promise<TranscriptionModelRow[]> {
    const rows = await withTransientDbRetry(
      () => sql`
        SELECT m.* FROM transcription_models m
        WHERE m.provider = ${provider} AND NOT m.is_deprecated AND (
          NOT m.is_scoped_registration OR EXISTS (
            SELECT 1 FROM scoped_model_registrations r WHERE r.transcription_model_id = m.transcription_model_id
              AND ((${scope.kind} = 'server' AND r.server_id = ${scope.ownerId} AND r.user_id IS NULL)
                OR (${scope.kind} = 'personal' AND r.user_id = ${scope.ownerId} AND r.server_id IS NULL))
          )
        ) ORDER BY m.is_default DESC, m.transcription_model_id
      `,
      "load available transcription models",
    );
    return transcriptionModelSchema.array().parse(rows);
  }

  async loadTranscriptionModelById(transcriptionModelId: number): Promise<TranscriptionModelRow | null> {
    const rows = await withTransientDbRetry(
      () => sql`SELECT * FROM transcription_models WHERE transcription_model_id = ${transcriptionModelId}`,
      "load transcription model by id",
    );
    return rows.length ? transcriptionModelSchema.parse(rows[0]) : null;
  }

  // Conflicts leave is_scoped_registration untouched so registering a built-in codename never turns a seeded row into
  // a scoped one left behind by reseeds.
  async ensureTranscriptionModel(provider: string, codename: string): Promise<TranscriptionModelRow> {
    const [row] = await sql`
      INSERT INTO transcription_models (provider, codename, is_scoped_registration)
      VALUES (${provider}, ${codename}, true)
      ON CONFLICT (provider, codename) DO UPDATE SET is_deprecated = false, updated_at = CURRENT_TIMESTAMP
        WHERE transcription_models.is_scoped_registration
      RETURNING *
    `;
    if (row) return transcriptionModelSchema.parse(row);
    const [existing] = await sql`
      SELECT * FROM transcription_models WHERE provider = ${provider} AND codename = ${codename}
    `;
    return transcriptionModelSchema.parse(existing);
  }

  async deleteOrphanedTranscriptionModel(transcriptionModelId: number): Promise<void> {
    await sql`
      DELETE FROM transcription_models WHERE transcription_model_id = ${transcriptionModelId}
        AND is_scoped_registration
        AND NOT EXISTS (SELECT 1 FROM scoped_model_registrations WHERE transcription_model_id = ${transcriptionModelId})
    `;
  }

  async loadDecisionModelOptions(
    scope: OpenRouterModelScope,
    managedProviders: readonly string[] = [],
  ): Promise<DecisionModelOption[]> {
    const serverId = scope.kind === "server" ? scope.ownerId : null;
    const userId = scope.kind === "personal" ? scope.ownerId : null;
    const rows = await withTransientDbRetry(
      () => sql<
        Array<DecisionModelRow & { scoped_model_registration_id: number | null; custom_endpoint_id: number | null }>
      >`
      SELECT model.*, registration.scoped_model_registration_id, endpoint.custom_endpoint_id
      FROM decision_models model
      LEFT JOIN scoped_model_registrations registration
        ON registration.decision_model_id = model.decision_model_id
        AND registration.server_id IS NOT DISTINCT FROM ${serverId}::int
        AND registration.user_id IS NOT DISTINCT FROM ${userId}::int
      LEFT JOIN custom_endpoint_connections connection
        ON model.provider = 'custom:' || connection.connection_id AND connection.capability = 'decision'
        AND connection.server_id IS NOT DISTINCT FROM ${serverId}::int
        AND connection.user_id IS NOT DISTINCT FROM ${userId}::int
      LEFT JOIN custom_endpoints endpoint
        ON endpoint.connection_id = connection.connection_id AND endpoint.model_ref_id = model.decision_model_id
      WHERE model.is_deprecated = false
        AND (
          (model.provider = 'openrouter' AND (model.is_scoped_registration = false OR registration.scoped_model_registration_id IS NOT NULL))
          OR (model.provider = 'google' AND model.is_scoped_registration = false)
          OR endpoint.custom_endpoint_id IS NOT NULL
        )
        AND (
          EXISTS (SELECT 1 FROM saved_provider_configs saved WHERE saved.server_id = ${serverId} AND saved.provider = model.provider AND saved.api_key IS NOT NULL)
          OR EXISTS (SELECT 1 FROM user_saved_provider_configs saved WHERE saved.user_id = ${userId} AND saved.provider = model.provider AND saved.api_key IS NOT NULL)
          OR (endpoint.custom_endpoint_id IS NOT NULL AND NOT connection.requires_auth)
          OR model.provider = ANY(${sql.array([...managedProviders], "text")})
        )
      ORDER BY model.provider, model.decision_model_id
    `,
      "load owned decision model options",
    );
    return rows.map((row) => ({
      model: decisionModelSchema.parse(row),
      reference: {
        provider: row.provider,
        modelId: row.decision_model_id,
        registrationId:
          row.is_scoped_registration && row.provider === "openrouter" ? row.scoped_model_registration_id : null,
        customEndpointId: row.custom_endpoint_id ?? null,
      },
    }));
  }
  async loadAvailableDecisionModels(
    provider: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<DecisionModelRow[]> {
    const serverId = scope?.kind === "server" ? scope.ownerId : null;
    const userId = scope?.kind === "personal" ? scope.ownerId : null;
    const rows = await withTransientDbRetry(
      () => sql`
      SELECT model.* FROM decision_models model
      WHERE model.provider = ${provider.toLowerCase()}
        AND (${includeDeprecated} OR model.is_deprecated = false)
        AND (
          model.is_scoped_registration = false
          OR EXISTS (
            SELECT 1 FROM scoped_model_registrations registration
            WHERE registration.decision_model_id = model.decision_model_id
              AND registration.server_id IS NOT DISTINCT FROM ${serverId}::int
              AND registration.user_id IS NOT DISTINCT FROM ${userId}::int
          )
          OR EXISTS (
            SELECT 1 FROM custom_endpoints endpoint
            JOIN custom_endpoint_connections connection USING (connection_id)
            WHERE endpoint.model_ref_id = model.decision_model_id
              AND connection.capability = 'decision'
              AND model.provider = 'custom:' || connection.connection_id
              AND connection.server_id IS NOT DISTINCT FROM ${serverId}::int
              AND connection.user_id IS NOT DISTINCT FROM ${userId}::int
          )
        )
      ORDER BY model.is_scoped_registration, model.decision_model_id
    `,
      "load available decision models",
    );
    return decisionModelSchema.array().parse(rows);
  }

  async loadDecisionModelById(decisionModelId: number): Promise<DecisionModelRow | null> {
    const rows = await sql`SELECT * FROM decision_models WHERE decision_model_id = ${decisionModelId}`;
    return rows.length ? decisionModelSchema.parse(rows[0]) : null;
  }

  async loadDecisionModelByProviderAndCodename(provider: string, codename: string): Promise<DecisionModelRow | null> {
    const rows = await sql`SELECT * FROM decision_models WHERE provider = ${provider} AND codename = ${codename}`;
    return rows.length ? decisionModelSchema.parse(rows[0]) : null;
  }

  async upsertDecisionModel(params: {
    provider: string;
    codename: string;
    inputTokenLimit: number;
    seesImages?: boolean;
    inputPricePerMillion?: number | null;
    outputPricePerMillion?: number | null;
  }): Promise<number> {
    const validated = decisionModelSchema.omit({ decision_model_id: true }).parse({
      provider: params.provider,
      codename: params.codename,
      input_token_limit: params.inputTokenLimit,
      sees_images: params.seesImages ?? false,
      supported_primitives: ["predicate", "choice"],
      input_price_per_million: params.inputPricePerMillion,
      output_price_per_million: params.outputPricePerMillion,
    });
    const [row] = await sql<Array<{ decision_model_id: number }>>`
      INSERT INTO decision_models (
        provider, codename, input_token_limit, sees_images, input_price_per_million,
        output_price_per_million, is_scoped_registration
      ) VALUES (
        ${validated.provider}, ${validated.codename}, ${validated.input_token_limit}, ${validated.sees_images},
        ${validated.input_price_per_million ?? null}, ${validated.output_price_per_million ?? null}, true
      ) ON CONFLICT (provider, codename) DO UPDATE SET
        input_token_limit = EXCLUDED.input_token_limit, sees_images = EXCLUDED.sees_images,
        input_price_per_million = EXCLUDED.input_price_per_million,
        output_price_per_million = EXCLUDED.output_price_per_million,
        is_deprecated = false, updated_at = CURRENT_TIMESTAMP
      RETURNING decision_model_id
    `;
    return row.decision_model_id;
  }

  async deleteOrphanedDecisionModel(modelId: number): Promise<void> {
    await sql`
      DELETE FROM decision_models model WHERE decision_model_id = ${modelId}
        AND is_scoped_registration = true
        AND NOT EXISTS (SELECT 1 FROM scoped_model_registrations WHERE decision_model_id = ${modelId})
        AND NOT EXISTS (
          SELECT 1 FROM custom_endpoints endpoint
          JOIN custom_endpoint_connections connection USING (connection_id)
          WHERE connection.capability = 'decision' AND endpoint.model_ref_id = ${modelId}
        )
    `;
  }
  async loadAvailableLlms(includeDeprecated = false): Promise<LlmRow[] | null> {
    try {
      const rows = await withTransientDbRetry(
        async () =>
          includeDeprecated
            ? await sql`SELECT * FROM llms ORDER BY llm_id ASC`
            : await sql`SELECT * FROM llms WHERE is_deprecated = false ORDER BY llm_id ASC`,
        "load available LLMs",
      );

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

  async getLlmsByIds(ids: number[]): Promise<LlmRow[]> {
    if (ids.length === 0) return [];

    try {
      const { values, placeholders } = buildIntegerParameterList(ids);
      const rows = await withTransientDbRetry(
        () => sql.unsafe(`SELECT * FROM llms WHERE llm_id IN (${placeholders})`, values),
        "load LLMs by IDs",
      );

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

  async loadById(llmId: number): Promise<LlmRow | null> {
    if (!Number.isInteger(llmId) || llmId <= 0) {
      log.error(`Invalid llm_id: ${llmId}`);
      return null;
    }

    const cached = getCachedLLM(llmId);
    if (cached) return cached as LlmRow;

    try {
      const rows = await withTransientDbRetry(
        () => sql`SELECT * FROM llms WHERE llm_id = ${llmId} LIMIT 1`,
        "load LLM by ID",
      );
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

  async loadLlmById(llmId: number): Promise<LlmRow | null> {
    return this.loadById(llmId);
  }

  async loadByProviderAndCodename(provider: string, codename: string): Promise<LlmRow | null> {
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedCodename = codename.trim();
    if (!normalizedProvider || !normalizedCodename) return null;

    try {
      const rows = await withTransientDbRetry(
        () => sql`
        SELECT * FROM llms
        WHERE llm_provider = ${normalizedProvider}
          AND llm_codename = ${normalizedCodename}
        LIMIT 1
      `,
        "load LLM by provider and codename",
      );
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
      if (scope && !isCustomProvider(normalized)) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterModels(scope, includeDeprecated, normalized);
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

  async loadProvidersWithFreeModels(): Promise<Set<string>> {
    try {
      const rows = await sql`
        SELECT DISTINCT llm_provider FROM llms
        WHERE is_free = true AND is_deprecated = false
      `;
      return new Set(rows.map((row: { llm_provider: string }) => row.llm_provider.toLowerCase()));
    } catch (error) {
      log.error("Error loading providers with free models:", error);
      return new Set();
    }
  }

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
      if (scope && !isCustomProvider(normalized)) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterEmbeddingModels(scope, includeDeprecated, normalized);
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
        log.warn(`No available embedding models found for provider: ${normalized}`);
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
      if (scope && !isCustomProvider(normalized)) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterDiffusionModels(scope, includeDeprecated, normalized);
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
      if (scope && !isCustomProvider(normalized)) {
        const { llmProviderRepo } = await import("./LlmProviderRepository");
        return llmProviderRepo.loadScopedOpenRouterVideoGenerationModels(scope, includeDeprecated, normalized);
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

  async loadDiffusionModelById(diffusionModelId: number): Promise<DiffusionModelRow | null> {
    if (!Number.isInteger(diffusionModelId) || diffusionModelId <= 0) {
      log.error(`Invalid diffusion_model_id: ${diffusionModelId}`);
      return null;
    }

    try {
      const rows = await withTransientDbRetry(
        () => sql`SELECT * FROM image_diffusion_models WHERE diffusion_model_id = ${diffusionModelId} LIMIT 1`,
        `load diffusion model ${diffusionModelId}`,
      );
      if (!rows.length) {
        log.warn(`No diffusion model found for diffusion_model_id ${diffusionModelId}`);
        return null;
      }

      const parsed = diffusionModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate diffusion model data for id ${diffusionModelId}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading diffusion model for diffusion_model_id ${diffusionModelId}:`, error);
      return null;
    }
  }

  async loadVideoGenerationModelById(videoModelId: number): Promise<VideoGenerationModelRow | null> {
    if (!Number.isInteger(videoModelId) || videoModelId <= 0) {
      log.error(`Invalid video_model_id: ${videoModelId}`);
      return null;
    }

    try {
      const rows = await sql`SELECT * FROM video_generation_models WHERE video_model_id = ${videoModelId} LIMIT 1`;
      if (!rows.length) {
        log.warn(`No video model found for video_model_id ${videoModelId}`);
        return null;
      }

      const parsed = videoGenerationModelSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.error(`Failed to validate video model data for id ${videoModelId}:`, parsed.error.flatten());
        return null;
      }

      return parsed.data;
    } catch (error) {
      log.error(`Error loading video model for video_model_id ${videoModelId}:`, error);
      return null;
    }
  }

  // OpenRouter callers persist pricing here because SQL-only stat surfaces cannot read the in-memory pricing cache.
  async upsertScopedLlm(
    modelCodename: string,
    caps: {
      hasTools: boolean;
      seesImages: boolean;
      seesVideos: boolean;
      seesYoutube: boolean;
      supportsStructuredOutput: boolean;
      strictRoleAlternation?: boolean;
      supportsPrefixCompletion?: boolean;
      supportsAssistantPrefill?: boolean;
    },
    provider = "openrouter",
    pricing?: { inputPerMillion: number; outputPerMillion: number } | null,
  ): Promise<number | null> {
    const inputPrice = pricing?.inputPerMillion ?? null;
    const outputPrice = pricing?.outputPerMillion ?? null;

    try {
      const rows = await sql`
        INSERT INTO llms (
          llm_provider, llm_codename, is_scoped_registration, is_smartest,
          is_default, is_reasoning, is_deprecated, is_free, has_tools,
          sees_images, sees_videos, sees_youtube, is_uncensored,
          supports_structoutput, strict_role_alternation, supports_prefix_completion,
          supports_assistant_prefill, llm_description, descriptions,
          input_price_per_million, output_price_per_million
        ) VALUES (
          ${provider}, ${modelCodename}, true, false, false, false, false, false,
          ${caps.hasTools}, ${caps.seesImages}, ${caps.seesVideos}, ${caps.seesYoutube},
          false, ${caps.supportsStructuredOutput}, ${caps.strictRoleAlternation ?? false},
          ${caps.supportsPrefixCompletion ?? false}, ${caps.supportsAssistantPrefill ?? false}, ${modelCodename},
          ${{ "en-US": modelCodename }},
          ${inputPrice}, ${outputPrice}
        )
        ON CONFLICT (llm_provider, llm_codename) DO UPDATE SET
          is_scoped_registration  = true,
          is_deprecated           = false,
          has_tools               = EXCLUDED.has_tools,
          sees_images             = EXCLUDED.sees_images,
          sees_videos             = EXCLUDED.sees_videos,
          sees_youtube            = EXCLUDED.sees_youtube,
          supports_structoutput   = EXCLUDED.supports_structoutput,
          strict_role_alternation = EXCLUDED.strict_role_alternation,
          supports_prefix_completion = EXCLUDED.supports_prefix_completion,
          supports_assistant_prefill = EXCLUDED.supports_assistant_prefill,
          llm_description         = EXCLUDED.llm_description,
          descriptions            = COALESCE(llms.descriptions, EXCLUDED.descriptions),
          -- COALESCE, not EXCLUDED: a re-registration during an OpenRouter outage resolves no
          -- price, and overwriting a known rate with null would zero out historical cost rows.
          input_price_per_million  = COALESCE(EXCLUDED.input_price_per_million, llms.input_price_per_million),
          output_price_per_million = COALESCE(EXCLUDED.output_price_per_million, llms.output_price_per_million),
          updated_at              = CURRENT_TIMESTAMP
        RETURNING llm_id
      `;
      const id = Number(rows[0]?.llm_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertScopedLlm: failed for ${modelCodename}`, error);
      return null;
    }
  }

  // Live API rates are mirrored here because SQL cost stats would read null columns as $0, and unchanged rows are
  // skipped so updated_at and counts track drift.
  async syncOpenrouterPrices(
    prices: ReadonlyMap<string, { inputPerMillion: number; outputPerMillion: number }>,
  ): Promise<number | null> {
    if (prices.size === 0) {
      return 0;
    }

    const codenames: string[] = [];
    const inputPrices: number[] = [];
    const outputPrices: number[] = [];
    for (const [codename, price] of prices) {
      codenames.push(codename);
      inputPrices.push(price.inputPerMillion);
      outputPrices.push(price.outputPerMillion);
    }

    try {
      const rows = await sql`
        UPDATE llms l
        SET input_price_per_million  = v.input_price,
            output_price_per_million = v.output_price,
            updated_at               = CURRENT_TIMESTAMP
        FROM (
          SELECT * FROM unnest(
            ${toPgTextArrayLiteral(codenames)}::text[],
            ${toPgNumericArrayLiteral(inputPrices)}::numeric[],
            ${toPgNumericArrayLiteral(outputPrices)}::numeric[]
          ) AS t(codename, input_price, output_price)
        ) v
        WHERE l.llm_provider = 'openrouter'
          AND l.llm_codename = v.codename
          AND (
            l.input_price_per_million  IS DISTINCT FROM v.input_price
            OR l.output_price_per_million IS DISTINCT FROM v.output_price
          )
        RETURNING l.llm_id
      `;
      return rows.length;
    } catch (error) {
      log.error("LlmModelRepository.syncOpenrouterPrices: failed", error);
      return null;
    }
  }

  async upsertScopedEmbeddingModel(modelCodename: string, provider = "openrouter"): Promise<number | null> {
    const modelFamily = modelCodename.split("/").pop() ?? modelCodename;
    try {
      const rows = await sql`
        INSERT INTO embedding_models (
          provider, codename, model_family, is_scoped_registration,
          model_description, descriptions, is_default, is_deprecated
        ) VALUES (
          ${provider}, ${modelCodename}, ${modelFamily}, true,
          ${modelCodename}, ${{ "en-US": modelCodename }}, false, false
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          model_family            = EXCLUDED.model_family,
          is_scoped_registration  = true,
          model_description       = EXCLUDED.model_description,
          descriptions            = COALESCE(embedding_models.descriptions, EXCLUDED.descriptions),
          is_default              = false,
          is_deprecated           = false,
          updated_at              = CURRENT_TIMESTAMP
        RETURNING embedding_model_id
      `;
      const id = Number(rows[0]?.embedding_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertScopedEmbeddingModel: failed for ${modelCodename}`, error);
      return null;
    }
  }

  async upsertScopedDiffusionModel(
    modelCodename: string,
    provider = "openrouter",
    supports?: ImageEndpointSupports,
  ): Promise<number | null> {
    try {
      const declared = supports ?? null;
      const rows = await sql`
        INSERT INTO image_diffusion_models (
          provider, codename, is_scoped_registration,
          model_description, descriptions, is_default, is_deprecated, is_free, is_uncensored,
          supports_txt2img, supports_img2img, supports_inpaint, supports_negative_prompt
        ) VALUES (
          ${provider}, ${modelCodename}, true,
          ${modelCodename}, ${{ "en-US": modelCodename }}, false, false, false, false,
          ${declared?.txt2img ?? null}, ${declared?.img2img ?? null},
          ${declared?.inpaint ?? null}, ${declared?.negative_prompt ?? null}
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          is_scoped_registration  = true,
          model_description       = EXCLUDED.model_description,
          descriptions            = COALESCE(image_diffusion_models.descriptions, EXCLUDED.descriptions),
          is_default              = false,
          is_deprecated           = false,
          is_free                 = EXCLUDED.is_free,
          is_uncensored           = EXCLUDED.is_uncensored,
          -- A caller that declares nothing must not erase an existing declaration.
          supports_txt2img        = COALESCE(EXCLUDED.supports_txt2img, image_diffusion_models.supports_txt2img),
          supports_img2img        = COALESCE(EXCLUDED.supports_img2img, image_diffusion_models.supports_img2img),
          supports_inpaint        = COALESCE(EXCLUDED.supports_inpaint, image_diffusion_models.supports_inpaint),
          supports_negative_prompt = COALESCE(
            EXCLUDED.supports_negative_prompt,
            image_diffusion_models.supports_negative_prompt
          ),
          updated_at              = CURRENT_TIMESTAMP
        RETURNING diffusion_model_id
      `;
      const id = Number(rows[0]?.diffusion_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertScopedDiffusionModel: failed for ${modelCodename}`, error);
      return null;
    }
  }

  async upsertScopedVideoModel(modelCodename: string, provider = "openrouter"): Promise<number | null> {
    try {
      const rows = await sql`
        INSERT INTO video_generation_models (
          provider, codename, is_scoped_registration,
          model_description, descriptions, is_default, is_deprecated, is_free
        ) VALUES (
          ${provider}, ${modelCodename}, true,
          ${modelCodename}, ${{ "en-US": modelCodename }}, false, false, false
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          is_scoped_registration  = true,
          model_description       = EXCLUDED.model_description,
          descriptions            = COALESCE(video_generation_models.descriptions, EXCLUDED.descriptions),
          is_default              = false,
          is_deprecated           = false,
          is_free                 = EXCLUDED.is_free,
          updated_at              = CURRENT_TIMESTAMP
        RETURNING video_model_id
      `;
      const id = Number(rows[0]?.video_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertScopedVideoModel: failed for ${modelCodename}`, error);
      return null;
    }
  }

  async upsertSyntheticCustomLlm(params: {
    provider: string;
    codename: string;
    displayName: string;
    hasTools: boolean;
    seesImages: boolean;
    seesVideos: boolean;
    supportsStructOutput: boolean;
    strictRoleAlternation: boolean;
    supportsPrefixCompletion: boolean;
    supportsAssistantPrefill: boolean;
    verbatimToolCalling: boolean;
  }): Promise<number | null> {
    try {
      const rows = await sql`
        INSERT INTO llms (
          llm_provider, llm_codename, has_tools, sees_images, sees_videos,
          sees_youtube, supports_structoutput, strict_role_alternation, supports_prefix_completion,
          supports_assistant_prefill, verbatim_tool_calling,
          is_smartest, is_default, is_reasoning, is_deprecated, is_free, is_uncensored,
          llm_description, descriptions
        ) VALUES (
          ${params.provider}, ${params.codename}, ${params.hasTools}, ${params.seesImages}, ${params.seesVideos},
          false, ${params.supportsStructOutput}, ${params.strictRoleAlternation}, ${params.supportsPrefixCompletion},
          ${params.supportsAssistantPrefill}, ${params.verbatimToolCalling},
          false, true, false, false, false, false,
          ${params.displayName}, ${{ "en-US": params.displayName }}
        )
        ON CONFLICT (llm_provider, llm_codename) DO UPDATE SET
          has_tools = EXCLUDED.has_tools,
          sees_images = EXCLUDED.sees_images,
          sees_videos = EXCLUDED.sees_videos,
          supports_structoutput = EXCLUDED.supports_structoutput,
          strict_role_alternation = EXCLUDED.strict_role_alternation,
          supports_prefix_completion = EXCLUDED.supports_prefix_completion,
          supports_assistant_prefill = EXCLUDED.supports_assistant_prefill,
          verbatim_tool_calling = EXCLUDED.verbatim_tool_calling,
          llm_description = EXCLUDED.llm_description,
          descriptions = jsonb_set(COALESCE(llms.descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
          updated_at = CURRENT_TIMESTAMP
        RETURNING llm_id
      `;
      const id = Number(rows[0]?.llm_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertSyntheticCustomLlm: failed for ${params.provider}`, error);
      return null;
    }
  }

  // This delete has no write-side counterpart because inline custom/{serverId} creation was retired, so it stays only
  // to clean up rows in older databases.
  async deleteLegacyCustomLlm(codename: string): Promise<boolean> {
    const result = await sql`
      DELETE FROM llms
      WHERE llm_codename = ${codename}
      RETURNING llm_id
    `;
    return result.length > 0;
  }

  async upsertSyntheticCustomEmbeddingModel(params: {
    provider: string;
    codename: string;
    displayName: string;
  }): Promise<number | null> {
    try {
      const rows = await sql`
        INSERT INTO embedding_models (
          provider, codename, model_family, model_description,
          descriptions, is_default, is_deprecated
        ) VALUES (
          ${params.provider}, ${params.codename}, ${params.provider},
          ${params.displayName}, ${{ "en-US": params.displayName }}, true, false
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          provider = EXCLUDED.provider,
          model_family = EXCLUDED.model_family,
          model_description = EXCLUDED.model_description,
          descriptions = jsonb_set(COALESCE(embedding_models.descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
          is_default = EXCLUDED.is_default,
          is_deprecated = EXCLUDED.is_deprecated,
          updated_at = CURRENT_TIMESTAMP
        RETURNING embedding_model_id
      `;
      const id = Number(rows[0]?.embedding_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertSyntheticCustomEmbeddingModel: failed for ${params.provider}`, error);
      return null;
    }
  }

  async upsertSyntheticCustomDiffusionModel(params: {
    provider: string;
    codename: string;
    displayName: string;
  }): Promise<number | null> {
    try {
      const rows = await sql`
        INSERT INTO image_diffusion_models (
          provider, codename, model_description, descriptions,
          is_default, is_deprecated, is_free, is_uncensored
        ) VALUES (
          ${params.provider}, ${params.codename}, ${params.displayName},
          ${{ "en-US": params.displayName }},
          true, false, true, true
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          provider = EXCLUDED.provider,
          model_description = EXCLUDED.model_description,
          descriptions = jsonb_set(COALESCE(image_diffusion_models.descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
          is_default = EXCLUDED.is_default,
          is_deprecated = EXCLUDED.is_deprecated,
          is_free = EXCLUDED.is_free,
          is_uncensored = EXCLUDED.is_uncensored,
          updated_at = CURRENT_TIMESTAMP
        RETURNING diffusion_model_id
      `;
      const id = Number(rows[0]?.diffusion_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertSyntheticCustomDiffusionModel: failed for ${params.provider}`, error);
      return null;
    }
  }

  async upsertSyntheticCustomVideoModel(params: {
    provider: string;
    codename: string;
    displayName: string;
  }): Promise<number | null> {
    try {
      const rows = await sql`
        INSERT INTO video_generation_models (
          provider, codename, model_description, descriptions,
          is_default, is_deprecated, is_free
        ) VALUES (
          ${params.provider}, ${params.codename}, ${params.displayName},
          ${{ "en-US": params.displayName }},
          true, false, true
        )
        ON CONFLICT (provider, codename) DO UPDATE SET
          provider = EXCLUDED.provider,
          model_description = EXCLUDED.model_description,
          descriptions = jsonb_set(COALESCE(video_generation_models.descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
          is_default = EXCLUDED.is_default,
          is_deprecated = EXCLUDED.is_deprecated,
          is_free = EXCLUDED.is_free,
          updated_at = CURRENT_TIMESTAMP
        RETURNING video_model_id
      `;
      const id = Number(rows[0]?.video_model_id);
      return Number.isInteger(id) ? id : null;
    } catch (error) {
      log.error(`LlmModelRepository.upsertSyntheticCustomVideoModel: failed for ${params.provider}`, error);
      return null;
    }
  }

  async isLlmStillReferenced(llmId: number): Promise<boolean> {
    const [row] = await sql<Array<{ in_use: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM server_model_configs
        WHERE llm_id = ${llmId}
           OR vision_llm_id = ${llmId}
           OR COALESCE(fallback_llm_ids, '[]'::JSONB) @> jsonb_build_array(${llmId})
        UNION ALL
        SELECT 1 FROM server_chat_configs
        WHERE EXISTS (
              SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(COALESCE(server_chat_configs.fallback_model_refs, '[]'::JSONB)) = 'array'
                  THEN COALESCE(server_chat_configs.fallback_model_refs, '[]'::JSONB)
                  ELSE '[]'::JSONB END
              ) AS ref
              WHERE ref ->> 'type' = 'llm' AND ref ->> 'id' = ${String(llmId)}
           )
        UNION ALL
        SELECT 1 FROM persona_configs WHERE llm_id = ${llmId}
        UNION ALL
        SELECT 1 FROM channel_llm_overrides WHERE llm_id = ${llmId}
        UNION ALL
        SELECT 1 FROM saved_provider_configs
        WHERE llm_id = ${llmId}
           OR vision_llm_id = ${llmId}
           OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(COALESCE(saved_provider_configs.fallback_model_refs, '[]'::JSONB)) = 'array'
                  THEN COALESCE(saved_provider_configs.fallback_model_refs, '[]'::JSONB)
                  ELSE '[]'::JSONB END
              ) AS ref
              WHERE ref ->> 'type' = 'llm' AND ref ->> 'id' = ${String(llmId)}
           )
        UNION ALL
        SELECT 1 FROM user_saved_provider_configs
        WHERE llm_id = ${llmId}
           OR vision_llm_id = ${llmId}
        UNION ALL
        SELECT 1 FROM user_personalization_configs
        WHERE EXISTS (
              SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(user_personalization_configs.fallback_model_refs) = 'array'
                  THEN user_personalization_configs.fallback_model_refs
                  ELSE '[]'::JSONB END
              ) AS ref
              WHERE ref ->> 'type' = 'llm' AND ref ->> 'id' = ${String(llmId)}
           )
      ) AS in_use
    `;
    return Boolean(row?.in_use);
  }

  async isEmbeddingModelStillReferenced(embeddingModelId: number): Promise<boolean> {
    const [row] = await sql<Array<{ in_use: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM server_model_configs         WHERE embedding_model_id = ${embeddingModelId}
        UNION ALL
        SELECT 1 FROM saved_provider_configs WHERE embedding_model_id = ${embeddingModelId}
        UNION ALL
        SELECT 1 FROM user_saved_provider_configs WHERE embedding_model_id = ${embeddingModelId}
      ) AS in_use
    `;
    return Boolean(row?.in_use);
  }

  async isDiffusionModelStillReferenced(diffusionModelId: number): Promise<boolean> {
    const [row] = await sql<Array<{ in_use: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM server_model_configs
        WHERE diffusion_model_id = ${diffusionModelId}
        UNION ALL
        SELECT 1 FROM server_novelai_imagegen_configs
        WHERE nai_diffusion_model_id = ${diffusionModelId}
        UNION ALL
        SELECT 1 FROM saved_provider_configs
        WHERE diffusion_model_id = ${diffusionModelId} OR nai_diffusion_model_id = ${diffusionModelId}
        UNION ALL
        SELECT 1 FROM user_saved_provider_configs
        WHERE diffusion_model_id = ${diffusionModelId} OR nai_diffusion_model_id = ${diffusionModelId}
      ) AS in_use
    `;
    return Boolean(row?.in_use);
  }

  async isVideoModelStillReferenced(videoModelId: number): Promise<boolean> {
    const [row] = await sql<Array<{ in_use: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM server_model_configs              WHERE video_model_id = ${videoModelId}
        UNION ALL
        SELECT 1 FROM saved_provider_configs      WHERE video_model_id = ${videoModelId}
        UNION ALL
        SELECT 1 FROM user_saved_provider_configs WHERE video_model_id = ${videoModelId}
      ) AS in_use
    `;
    return Boolean(row?.in_use);
  }

  async countLlmRegistrations(llmId: number): Promise<number> {
    const [row] = await sql<Array<{ count: string | number }>>`
      SELECT COUNT(*) AS count FROM scoped_model_registrations WHERE llm_id = ${llmId}
    `;
    return Number(row?.count ?? 0);
  }

  async countEmbeddingModelRegistrations(embeddingModelId: number): Promise<number> {
    const [row] = await sql<Array<{ count: string | number }>>`
      SELECT COUNT(*) AS count FROM scoped_model_registrations
      WHERE embedding_model_id = ${embeddingModelId}
    `;
    return Number(row?.count ?? 0);
  }

  async countDiffusionModelRegistrations(diffusionModelId: number): Promise<number> {
    const [row] = await sql<Array<{ count: string | number }>>`
      SELECT COUNT(*) AS count FROM scoped_model_registrations
      WHERE diffusion_model_id = ${diffusionModelId}
    `;
    return Number(row?.count ?? 0);
  }

  async countVideoModelRegistrations(videoModelId: number): Promise<number> {
    const [row] = await sql<Array<{ count: string | number }>>`
      SELECT COUNT(*) AS count FROM scoped_model_registrations
      WHERE video_model_id = ${videoModelId}
    `;
    return Number(row?.count ?? 0);
  }

  async deleteOrphanedLlm(llmId: number): Promise<void> {
    await sql`
      DELETE FROM llms
      WHERE llm_id = ${llmId}
        AND COALESCE(is_scoped_registration, false) = true
    `;
  }

  async deleteOrphanedEmbeddingModel(embeddingModelId: number): Promise<void> {
    await sql`
      DELETE FROM embedding_models
      WHERE embedding_model_id = ${embeddingModelId}
        AND COALESCE(is_scoped_registration, false) = true
    `;
  }

  async deleteOrphanedDiffusionModel(diffusionModelId: number): Promise<void> {
    await sql`
      DELETE FROM image_diffusion_models
      WHERE diffusion_model_id = ${diffusionModelId}
        AND COALESCE(is_scoped_registration, false) = true
    `;
  }

  async deleteOrphanedVideoModel(videoModelId: number): Promise<void> {
    await sql`
      DELETE FROM video_generation_models
      WHERE video_model_id = ${videoModelId}
        AND COALESCE(is_scoped_registration, false) = true
    `;
  }

  async deleteSyntheticCustomCapabilityModel(
    provider: string,
    codename: string,
    capability: CustomEndpointCapability,
  ): Promise<void> {
    switch (capability) {
      case "text":
        await sql`
          DELETE FROM llms
          WHERE llm_provider = ${provider}
            AND llm_codename = ${codename}
        `;
        return;
      case "embedding":
        await sql`
          DELETE FROM embedding_models
          WHERE provider = ${provider}
            AND codename = ${codename}
        `;
        return;
      case "image":
        await sql`
          DELETE FROM image_diffusion_models
          WHERE provider = ${provider}
            AND codename = ${codename}
        `;
        return;
      case "video":
        await sql`
          DELETE FROM video_generation_models
          WHERE provider = ${provider}
            AND codename = ${codename}
        `;
        return;
      case "speech":
      case "transcription":
        return;
    }
  }

  // Deleting by id is preferred over codename deletion when removing one model under a label because the id is
  // unambiguous regardless of codename derivation.
  async deleteSyntheticCustomCapabilityModelById(
    modelRefId: number,
    capability: CustomEndpointCapability,
  ): Promise<void> {
    switch (capability) {
      case "text":
        await sql`DELETE FROM llms WHERE llm_id = ${modelRefId}`;
        return;
      case "embedding":
        await sql`DELETE FROM embedding_models WHERE embedding_model_id = ${modelRefId}`;
        return;
      case "image":
        await sql`DELETE FROM image_diffusion_models WHERE diffusion_model_id = ${modelRefId}`;
        return;
      case "video":
        await sql`DELETE FROM video_generation_models WHERE video_model_id = ${modelRefId}`;
        return;
      case "speech":
      case "transcription":
        return;
    }
  }

  // Edits update in place by primary key because config rows reference the model by id while renaming changes the
  // derived codename.
  async updateSyntheticCustomCapabilityModelById(params: {
    modelRefId: number;
    capability: CustomEndpointCapability;
    codename: string;
    displayName: string;
    hasTools: boolean;
    seesImages: boolean;
    seesVideos: boolean;
    supportsStructOutput: boolean;
    strictRoleAlternation: boolean;
    supportsPrefixCompletion: boolean;
    supportsAssistantPrefill: boolean;
    verbatimToolCalling: boolean;
    inputTokenLimit?: number | null;
  }): Promise<void> {
    switch (params.capability) {
      case "decision":
        await sql`
          UPDATE decision_models SET codename = ${params.codename},
            input_token_limit = ${params.inputTokenLimit ?? null}, updated_at = CURRENT_TIMESTAMP
          WHERE decision_model_id = ${params.modelRefId}
        `;
        return;
      case "text":
        await sql`
          UPDATE llms SET
            llm_codename = ${params.codename},
            has_tools = ${params.hasTools},
            sees_images = ${params.seesImages},
            sees_videos = ${params.seesVideos},
            supports_structoutput = ${params.supportsStructOutput},
            strict_role_alternation = ${params.strictRoleAlternation},
            supports_prefix_completion = ${params.supportsPrefixCompletion},
            supports_assistant_prefill = ${params.supportsAssistantPrefill},
            verbatim_tool_calling = ${params.verbatimToolCalling},
            llm_description = ${params.displayName},
            descriptions = jsonb_set(COALESCE(descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
            updated_at = CURRENT_TIMESTAMP
          WHERE llm_id = ${params.modelRefId}
        `;
        return;
      case "embedding":
        await sql`
          UPDATE embedding_models SET
            codename = ${params.codename},
            model_description = ${params.displayName},
            descriptions = jsonb_set(COALESCE(descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
            updated_at = CURRENT_TIMESTAMP
          WHERE embedding_model_id = ${params.modelRefId}
        `;
        return;
      case "image":
        await sql`
          UPDATE image_diffusion_models SET
            codename = ${params.codename},
            model_description = ${params.displayName},
            descriptions = jsonb_set(COALESCE(descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
            updated_at = CURRENT_TIMESTAMP
          WHERE diffusion_model_id = ${params.modelRefId}
        `;
        return;
      case "video":
        await sql`
          UPDATE video_generation_models SET
            codename = ${params.codename},
            model_description = ${params.displayName},
            descriptions = jsonb_set(COALESCE(descriptions, '{}'::jsonb), '{en-US}', to_jsonb(${params.displayName}::text)),
            updated_at = CURRENT_TIMESTAMP
          WHERE video_model_id = ${params.modelRefId}
        `;
        return;
      case "speech":
      case "transcription":
        return;
    }
  }

  async deleteAllSyntheticModelsForProvider(provider: string): Promise<void> {
    await sql`DELETE FROM llms WHERE llm_provider = ${provider}`;
    await sql`DELETE FROM embedding_models WHERE provider = ${provider}`;
    await sql`DELETE FROM image_diffusion_models WHERE provider = ${provider}`;
    await sql`DELETE FROM video_generation_models WHERE provider = ${provider}`;
    await sql`DELETE FROM decision_models WHERE provider = ${provider}`;
  }
}

export const llmModelRepo = new LlmModelRepository();

/**
 * LlmRepository — manages all LLM, embedding, diffusion, video, and provider config tables.
 *
 * Covered tables: llms, embedding_models, image_diffusion_models,
 * video_generation_models, channel_llm_overrides, saved_provider_configs,
 * user_saved_provider_configs, custom_endpoints, openrouter_*_model_registrations.
 *
 * The public boundary lives here and in repositories/index.ts.
 * Large SQL bodies remain in repository-owned helper modules until deeper domain cleanup.
 */
import type {
  LlmRow,
  EmbeddingModelRow,
  DiffusionModelRow,
  VideoGenerationModelRow,
  NaiPresetRow,
  SavedProviderConfigRow,
  UserSavedProviderConfigRow,
  CustomEndpointRow,
  FallbackModelRef,
  OpenRouterModelRegistrationRow,
  OpenRouterEmbeddingModelRegistrationRow,
  OpenRouterImageModelRegistrationRow,
  OpenRouterVideoModelRegistrationRow,
} from "@/types/db/schema";
import { invalidateAllChannelLlmCacheForServer, invalidateChannelLlmCache } from "@/utils/cache/channelLlmCacheStore";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { loadNaiPresetsForModel } from "@/utils/db/repositories/configReadSql";
import {
  getLlmsByIds,
  loadAvailableLlms,
  loadAvailableModelsForProvider,
  loadAvailableEmbeddingModelsForProvider,
  loadAvailableDiffusionModelsForProvider,
  loadAvailableVideoGenerationModelsForProvider,
  loadDefaultModelForProvider,
  loadDefaultEmbeddingModelForProvider,
  loadDefaultDiffusionModelForProvider,
  loadDefaultVideoGenerationModelForProvider,
  loadDefaultVisionModelForProvider,
  loadEmbeddingModelById,
  loadEmbeddingModelByProviderAndCodename,
  loadDiffusionModelByProviderAndCodename,
  loadVideoGenerationModelByProviderAndCodename,
  loadLlmById,
  loadLlmByProviderAndCodename,
  loadSmartestModel,
  loadUniqueProviders,
  getChannelLlmOverride,
  getAllChannelLlmOverridesForServer,
  loadPersonaLlmOverridesForServer,
  loadSavedProviderConfigs,
  loadSavedProviderConfig,
  loadUserSavedProviderConfigs,
  loadUserSavedProviderConfig,
  loadOpenRouterModelRegistrationsForServer,
  loadOpenRouterModelRegistrationsForUser,
  loadOpenRouterEmbeddingModelRegistrationsForServer,
  loadOpenRouterEmbeddingModelRegistrationsForUser,
  loadOpenRouterImageModelRegistrationsForServer,
  loadOpenRouterImageModelRegistrationsForUser,
  loadOpenRouterVideoModelRegistrationsForServer,
  loadOpenRouterVideoModelRegistrationsForUser,
  loadScopedOpenRouterModels,
  loadScopedOpenRouterEmbeddingModels,
  loadScopedOpenRouterDiffusionModels,
  loadScopedOpenRouterVideoGenerationModels,
  loadCustomEndpointsForServer,
  loadCustomEndpointsForUser,
  loadCustomEndpointsByIds,
  loadCustomEndpoint,
} from "@/utils/db/repositories/llmReadSql";
import {
  setChannelLlmOverride,
  setPersonaLlmOverride,
  setFallbackLlms,
  setFallbackModelRefs,
  deleteChannelLlmOverride,
  clearAllChannelLlmOverridesForServer,
  clearAllPersonaLlmOverridesForServer,
  upsertSavedProviderConfig,
  deleteSavedProviderConfig,
  upsertUserSavedProviderConfig,
  deleteUserSavedProviderConfig,
  upsertCustomEndpoint,
  deleteCustomEndpoint,
  upsertOpenRouterModelRegistration,
  deleteOpenRouterModelRegistration,
  upsertOpenRouterEmbeddingModelRegistration,
  deleteOpenRouterEmbeddingModelRegistration,
  upsertOpenRouterImageModelRegistration,
  deleteOpenRouterImageModelRegistration,
  upsertOpenRouterVideoModelRegistration,
  deleteOpenRouterVideoModelRegistration,
  restoreOverridesFromSnapshot,
  cleanupDeadChannelOverrides,
} from "@/utils/db/repositories/llmWriteSql";
import type { IRepository } from "./IRepository";

/**
 * Canonical scope for OpenRouter model visibility.
 */
export type OpenRouterModelScope = { kind: "server"; ownerId: number } | { kind: "personal"; ownerId: number };

/** Export shape for server-scoped provider configuration. */
export type LlmExportShape = {
  savedProviderConfigs: SavedProviderConfigRow[];
};

export type LlmCacheInvalidationOptions = {
  serverDiscId?: string;
};

export type ChannelLlmCacheInvalidationOptions = LlmCacheInvalidationOptions & {
  channelDiscId?: string;
};

export class LlmRepository implements IRepository<LlmExportShape> {
  // ── system catalog reads ───────────────────────────────────────────────────

  /**
   * Returns all non-deprecated LLMs, or all LLMs when includeDeprecated is true.
   *
   * @param includeDeprecated - Include deprecated models in results
   */
  async loadAvailableLlms(includeDeprecated = false): Promise<LlmRow[] | null> {
    return loadAvailableLlms(includeDeprecated);
  }

  /**
   * Returns LLMs by their internal IDs.
   *
   * @param ids - Array of internal LLM IDs
   */
  async getLlmsByIds(ids: number[]): Promise<LlmRow[]> {
    return getLlmsByIds(ids);
  }

  /**
   * Returns a single LLM by its internal ID, or null if not found.
   *
   * @param llmId - Internal LLM ID
   */
  async loadById(llmId: number): Promise<LlmRow | null> {
    return loadLlmById(llmId);
  }

  /**
   * Compatibility alias for the pre-repository function name.
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
    return loadLlmByProviderAndCodename(provider, codename);
  }

  /**
   * Returns available LLMs for a provider, optionally filtered by OpenRouter scope.
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
    return loadAvailableModelsForProvider(providerName, includeDeprecated, scope);
  }

  /**
   * Returns the default LLM for a provider, or null if none is configured.
   *
   * @param providerName - Provider name
   */
  async loadDefaultModel(providerName: string): Promise<LlmRow | null> {
    return loadDefaultModelForProvider(providerName);
  }

  /**
   * Returns the highest-capability (smartest) LLM for a provider.
   *
   * @param providerName      - Provider name
   * @param includeDeprecated - Include deprecated models
   */
  async loadSmartestModel(providerName: string, includeDeprecated = false): Promise<LlmRow | null> {
    return loadSmartestModel(providerName, includeDeprecated);
  }

  /**
   * Returns the default vision-capable LLM for a provider.
   *
   * @param providerName - Provider name
   */
  async loadDefaultVisionModel(providerName: string): Promise<LlmRow | null> {
    return loadDefaultVisionModelForProvider(providerName);
  }

  /**
   * Returns all distinct provider names present in the llms table.
   *
   * @param includeDeprecated - Include providers only present on deprecated models
   */
  async loadUniqueProviders(includeDeprecated = false): Promise<string[] | null> {
    return loadUniqueProviders(includeDeprecated);
  }

  // ── embedding model reads ──────────────────────────────────────────────────

  /**
   * Returns available embedding models for a provider.
   *
   * @param providerName      - Provider name
   * @param includeDeprecated - Include deprecated models
   */
  async loadAvailableEmbeddingModels(
    providerName: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<EmbeddingModelRow[] | null> {
    return loadAvailableEmbeddingModelsForProvider(providerName, includeDeprecated, scope);
  }

  /**
   * Returns the default embedding model for a provider.
   *
   * @param providerName - Provider name
   */
  async loadDefaultEmbeddingModel(providerName: string): Promise<EmbeddingModelRow | null> {
    return loadDefaultEmbeddingModelForProvider(providerName);
  }

  /**
   * Returns an embedding model by its internal ID.
   *
   * @param embeddingModelId - Internal embedding model ID
   */
  async loadEmbeddingModelById(embeddingModelId: number): Promise<EmbeddingModelRow | null> {
    return loadEmbeddingModelById(embeddingModelId);
  }

  /**
   * Returns an embedding model by provider + codename, or null if not found.
   *
   * @param provider - Provider name
   * @param codename - Model codename
   */
  async loadEmbeddingModelByProviderAndCodename(provider: string, codename: string): Promise<EmbeddingModelRow | null> {
    return loadEmbeddingModelByProviderAndCodename(provider, codename);
  }

  // ── diffusion model reads ──────────────────────────────────────────────────

  /**
   * Returns available image diffusion models for a provider.
   *
   * @param providerName      - Provider name
   * @param includeDeprecated - Include deprecated models
   */
  async loadAvailableDiffusionModels(
    providerName: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<DiffusionModelRow[] | null> {
    return loadAvailableDiffusionModelsForProvider(providerName, includeDeprecated, scope);
  }

  /**
   * Returns the default image diffusion model for a provider.
   *
   * @param providerName - Provider name
   */
  async loadDefaultDiffusionModel(providerName: string): Promise<DiffusionModelRow | null> {
    return loadDefaultDiffusionModelForProvider(providerName);
  }

  /**
   * Returns a diffusion model by provider + codename, or null if not found.
   *
   * @param provider - Provider name
   * @param codename - Model codename
   */
  async loadDiffusionModelByProviderAndCodename(provider: string, codename: string): Promise<DiffusionModelRow | null> {
    return loadDiffusionModelByProviderAndCodename(provider, codename);
  }

  // ── video generation model reads ───────────────────────────────────────────

  /**
   * Returns available video generation models for a provider.
   *
   * @param providerName      - Provider name
   * @param includeDeprecated - Include deprecated models
   */
  async loadAvailableVideoGenerationModels(
    providerName: string,
    includeDeprecated = false,
    scope?: OpenRouterModelScope,
  ): Promise<VideoGenerationModelRow[] | null> {
    return loadAvailableVideoGenerationModelsForProvider(providerName, includeDeprecated, scope);
  }

  /**
   * Returns the default video generation model for a provider.
   *
   * @param providerName - Provider name
   */
  async loadDefaultVideoGenerationModel(providerName: string): Promise<VideoGenerationModelRow | null> {
    return loadDefaultVideoGenerationModelForProvider(providerName);
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
    return loadVideoGenerationModelByProviderAndCodename(provider, codename);
  }

  // ── NAI presets ────────────────────────────────────────────────────────────

  /**
   * Returns NovelAI presets for the given model target.
   *
   * @param target - "kayra" or "erato"
   */
  async loadNaiPresets(target: "kayra" | "erato"): Promise<NaiPresetRow[]> {
    return loadNaiPresetsForModel(target);
  }

  // ── channel + persona LLM override reads ──────────────────────────────────

  /**
   * Returns the LLM override for a specific channel, or null if none is set.
   *
   * @param serverId      - Internal server DB ID
   * @param channelDiscId - Discord channel snowflake
   */
  async getChannelLlmOverride(serverId: number, channelDiscId: string): Promise<LlmRow | null> {
    return getChannelLlmOverride(serverId, channelDiscId);
  }

  /**
   * Returns all channel LLM overrides for a server.
   *
   * @param serverId - Internal server DB ID
   */
  async getAllChannelLlmOverrides(serverId: number) {
    return getAllChannelLlmOverridesForServer(serverId);
  }

  /**
   * Returns all persona LLM overrides for a server.
   *
   * @param serverId - Internal server DB ID
   */
  async loadPersonaLlmOverrides(serverId: number) {
    return loadPersonaLlmOverridesForServer(serverId);
  }

  // ── saved provider config reads ────────────────────────────────────────────

  /**
   * Returns all saved provider configs for a server.
   *
   * @param serverId - Internal server DB ID
   */
  async loadSavedProviderConfigs(serverId: number): Promise<SavedProviderConfigRow[]> {
    return loadSavedProviderConfigs(serverId);
  }

  /**
   * Returns the saved provider config for a server + provider pair, or null.
   *
   * @param serverId - Internal server DB ID
   * @param provider - Provider name
   */
  async loadSavedProviderConfig(serverId: number, provider: string): Promise<SavedProviderConfigRow | null> {
    return loadSavedProviderConfig(serverId, provider);
  }

  /**
   * Returns all saved provider configs for a user.
   *
   * @param userId - Internal user DB ID
   */
  async loadUserSavedProviderConfigs(userId: number): Promise<UserSavedProviderConfigRow[]> {
    return loadUserSavedProviderConfigs(userId);
  }

  /**
   * Returns the saved provider config for a user + provider pair, or null.
   *
   * @param userId   - Internal user DB ID
   * @param provider - Provider name
   */
  async loadUserSavedProviderConfig(userId: number, provider: string): Promise<UserSavedProviderConfigRow | null> {
    return loadUserSavedProviderConfig(userId, provider);
  }

  // ── OpenRouter model registration reads ───────────────────────────────────

  /** Returns LLM registrations for a server. @param serverId - Internal server DB ID */
  async loadOpenRouterModelRegistrationsForServer(serverId: number): Promise<OpenRouterModelRegistrationRow[]> {
    return loadOpenRouterModelRegistrationsForServer(serverId);
  }

  /** Returns LLM registrations for a user. @param userId - Internal user DB ID */
  async loadOpenRouterModelRegistrationsForUser(userId: number): Promise<OpenRouterModelRegistrationRow[]> {
    return loadOpenRouterModelRegistrationsForUser(userId);
  }

  /** Returns embedding registrations for a server. @param serverId - Internal server DB ID */
  async loadOpenRouterEmbeddingModelRegistrationsForServer(
    serverId: number,
  ): Promise<OpenRouterEmbeddingModelRegistrationRow[]> {
    return loadOpenRouterEmbeddingModelRegistrationsForServer(serverId);
  }

  /** Returns embedding registrations for a user. @param userId - Internal user DB ID */
  async loadOpenRouterEmbeddingModelRegistrationsForUser(
    userId: number,
  ): Promise<OpenRouterEmbeddingModelRegistrationRow[]> {
    return loadOpenRouterEmbeddingModelRegistrationsForUser(userId);
  }

  /** Returns image model registrations for a server. @param serverId - Internal server DB ID */
  async loadOpenRouterImageModelRegistrationsForServer(
    serverId: number,
  ): Promise<OpenRouterImageModelRegistrationRow[]> {
    return loadOpenRouterImageModelRegistrationsForServer(serverId);
  }

  /** Returns image model registrations for a user. @param userId - Internal user DB ID */
  async loadOpenRouterImageModelRegistrationsForUser(userId: number): Promise<OpenRouterImageModelRegistrationRow[]> {
    return loadOpenRouterImageModelRegistrationsForUser(userId);
  }

  /** Returns video model registrations for a server. @param serverId - Internal server DB ID */
  async loadOpenRouterVideoModelRegistrationsForServer(
    serverId: number,
  ): Promise<OpenRouterVideoModelRegistrationRow[]> {
    return loadOpenRouterVideoModelRegistrationsForServer(serverId);
  }

  /** Returns video model registrations for a user. @param userId - Internal user DB ID */
  async loadOpenRouterVideoModelRegistrationsForUser(userId: number): Promise<OpenRouterVideoModelRegistrationRow[]> {
    return loadOpenRouterVideoModelRegistrationsForUser(userId);
  }

  /**
   * Returns LLMs registered for a scope (server-scoped or personal).
   *
   * @param scope - {kind: "server"|"personal", ownerId: number}
   */
  async loadScopedOpenRouterModels(scope: OpenRouterModelScope, includeDeprecated = false): Promise<LlmRow[]> {
    return loadScopedOpenRouterModels(scope, includeDeprecated);
  }

  /**
   * Returns embedding models registered for a scope.
   *
   * @param scope - {kind: "server"|"personal", ownerId: number}
   */
  async loadScopedOpenRouterEmbeddingModels(
    scope: OpenRouterModelScope,
    includeDeprecated = false,
  ): Promise<EmbeddingModelRow[]> {
    return loadScopedOpenRouterEmbeddingModels(scope, includeDeprecated);
  }

  /**
   * Returns diffusion models registered for a scope.
   *
   * @param scope - {kind: "server"|"personal", ownerId: number}
   */
  async loadScopedOpenRouterDiffusionModels(
    scope: OpenRouterModelScope,
    includeDeprecated = false,
  ): Promise<DiffusionModelRow[]> {
    return loadScopedOpenRouterDiffusionModels(scope, includeDeprecated);
  }

  /**
   * Returns video generation models registered for a scope.
   *
   * @param scope - {kind: "server"|"personal", ownerId: number}
   */
  async loadScopedOpenRouterVideoGenerationModels(
    scope: OpenRouterModelScope,
    includeDeprecated = false,
  ): Promise<VideoGenerationModelRow[]> {
    return loadScopedOpenRouterVideoGenerationModels(scope, includeDeprecated);
  }

  // ── custom endpoint reads ──────────────────────────────────────────────────

  /**
   * Returns custom endpoints configured for a server.
   *
   * @param serverId - Internal server DB ID
   */
  async loadCustomEndpointsForServer(serverId: number): Promise<CustomEndpointRow[]> {
    return loadCustomEndpointsForServer(serverId);
  }

  /**
   * Returns custom endpoints configured for a user.
   *
   * @param userId - Internal user DB ID
   */
  async loadCustomEndpointsForUser(userId: number): Promise<CustomEndpointRow[]> {
    return loadCustomEndpointsForUser(userId);
  }

  /**
   * Returns custom endpoints by their internal IDs.
   *
   * @param ids - Array of internal custom endpoint IDs
   */
  async loadCustomEndpointsByIds(ids: number[]): Promise<CustomEndpointRow[]> {
    return loadCustomEndpointsByIds(ids);
  }

  /**
   * Returns a specific custom endpoint by lookup parameters.
   *
   * @param params - Custom endpoint lookup parameters
   */
  async loadCustomEndpoint(params: Parameters<typeof loadCustomEndpoint>[0]): Promise<CustomEndpointRow | null> {
    return loadCustomEndpoint(params);
  }

  // ── writes ─────────────────────────────────────────────────────────────────

  /** @see setChannelLlmOverride */
  async setChannelLlmOverride(
    serverId: number,
    channelDiscId: string,
    llmId: number,
    options: LlmCacheInvalidationOptions = {},
  ): Promise<boolean> {
    const ok = await setChannelLlmOverride(serverId, channelDiscId, llmId);
    if (ok) {
      invalidateChannelLlmCache(serverId, channelDiscId);
      if (options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    }
    return ok;
  }

  /** @see setPersonaLlmOverride */
  async setPersonaLlmOverride(
    tomoriId: number,
    llmId: number | null,
    options: LlmCacheInvalidationOptions = {},
  ): Promise<boolean> {
    const ok = await setPersonaLlmOverride(tomoriId, llmId);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  /** @see setFallbackLlms */
  async setFallbackLlms(
    serverId: number,
    llmIds: number[],
    options: LlmCacheInvalidationOptions = {},
  ): Promise<boolean> {
    const ok = await setFallbackLlms(serverId, llmIds);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  /** @see setFallbackModelRefs */
  async setFallbackModelRefs(
    serverId: number,
    refs: FallbackModelRef[],
    options: LlmCacheInvalidationOptions = {},
  ): Promise<boolean> {
    const ok = await setFallbackModelRefs(serverId, refs);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  /** @see deleteChannelLlmOverride */
  async deleteChannelLlmOverride(
    serverId: number,
    channelDiscId: string,
    options: LlmCacheInvalidationOptions = {},
  ): Promise<boolean> {
    const ok = await deleteChannelLlmOverride(serverId, channelDiscId);
    if (ok) {
      invalidateChannelLlmCache(serverId, channelDiscId);
      if (options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    }
    return ok;
  }

  /** @see clearAllChannelLlmOverridesForServer */
  async clearAllChannelLlmOverrides(serverId: number, options: LlmCacheInvalidationOptions = {}): Promise<boolean> {
    const ok = await clearAllChannelLlmOverridesForServer(serverId);
    if (ok) {
      invalidateAllChannelLlmCacheForServer(serverId);
      if (options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    }
    return ok;
  }

  /** @see clearAllPersonaLlmOverridesForServer */
  async clearAllPersonaLlmOverrides(serverId: number, options: LlmCacheInvalidationOptions = {}): Promise<boolean> {
    const ok = await clearAllPersonaLlmOverridesForServer(serverId);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  /** @see upsertSavedProviderConfig */
  async upsertSavedProviderConfig(
    serverId: number,
    config: Parameters<typeof upsertSavedProviderConfig>[1],
    options: LlmCacheInvalidationOptions = {},
  ): Promise<boolean> {
    const ok = await upsertSavedProviderConfig(serverId, config);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  /** @see deleteSavedProviderConfig */
  async deleteSavedProviderConfig(
    serverId: number,
    provider: string,
    options: LlmCacheInvalidationOptions = {},
  ): Promise<boolean> {
    const ok = await deleteSavedProviderConfig(serverId, provider);
    if (ok && options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    return ok;
  }

  /** @see upsertUserSavedProviderConfig */
  async upsertUserSavedProviderConfig(
    userId: number,
    config: Parameters<typeof upsertUserSavedProviderConfig>[1],
  ): Promise<boolean> {
    return upsertUserSavedProviderConfig(userId, config);
  }

  /** @see deleteUserSavedProviderConfig */
  async deleteUserSavedProviderConfig(userId: number, provider: string): Promise<boolean> {
    return deleteUserSavedProviderConfig(userId, provider);
  }

  /** @see upsertCustomEndpoint */
  async upsertCustomEndpoint(
    params: Parameters<typeof upsertCustomEndpoint>[0],
    options: LlmCacheInvalidationOptions = {},
  ): Promise<CustomEndpointRow | null> {
    const row = await upsertCustomEndpoint(params);
    if (row && params.serverId !== null && params.serverId !== undefined && options.serverDiscId) {
      invalidateTomoriStateCache(options.serverDiscId);
    }
    return row;
  }

  /** @see deleteCustomEndpoint */
  async deleteCustomEndpoint(
    params: Parameters<typeof deleteCustomEndpoint>[0],
    options: ChannelLlmCacheInvalidationOptions = {},
  ): Promise<boolean> {
    const ok = await deleteCustomEndpoint(params);
    if (ok && params.serverId !== null && params.serverId !== undefined) {
      if (options.channelDiscId) {
        invalidateChannelLlmCache(params.serverId, options.channelDiscId);
      } else {
        invalidateAllChannelLlmCacheForServer(params.serverId);
      }
      if (options.serverDiscId) invalidateTomoriStateCache(options.serverDiscId);
    }
    return ok;
  }

  /** @see upsertOpenRouterModelRegistration */
  async upsertOpenRouterModelRegistration(
    params: Parameters<typeof upsertOpenRouterModelRegistration>[0],
  ): Promise<OpenRouterModelRegistrationRow | null> {
    return upsertOpenRouterModelRegistration(params);
  }

  /** @see deleteOpenRouterModelRegistration */
  async deleteOpenRouterModelRegistration(
    params: Parameters<typeof deleteOpenRouterModelRegistration>[0],
  ): Promise<boolean> {
    return deleteOpenRouterModelRegistration(params);
  }

  /** @see upsertOpenRouterEmbeddingModelRegistration */
  async upsertOpenRouterEmbeddingModelRegistration(
    params: Parameters<typeof upsertOpenRouterEmbeddingModelRegistration>[0],
  ): Promise<OpenRouterEmbeddingModelRegistrationRow | null> {
    return upsertOpenRouterEmbeddingModelRegistration(params);
  }

  /** @see deleteOpenRouterEmbeddingModelRegistration */
  async deleteOpenRouterEmbeddingModelRegistration(
    params: Parameters<typeof deleteOpenRouterEmbeddingModelRegistration>[0],
  ): Promise<boolean> {
    return deleteOpenRouterEmbeddingModelRegistration(params);
  }

  /** @see upsertOpenRouterImageModelRegistration */
  async upsertOpenRouterImageModelRegistration(
    params: Parameters<typeof upsertOpenRouterImageModelRegistration>[0],
  ): Promise<OpenRouterImageModelRegistrationRow | null> {
    return upsertOpenRouterImageModelRegistration(params);
  }

  /** @see deleteOpenRouterImageModelRegistration */
  async deleteOpenRouterImageModelRegistration(
    params: Parameters<typeof deleteOpenRouterImageModelRegistration>[0],
  ): Promise<boolean> {
    return deleteOpenRouterImageModelRegistration(params);
  }

  /** @see upsertOpenRouterVideoModelRegistration */
  async upsertOpenRouterVideoModelRegistration(
    params: Parameters<typeof upsertOpenRouterVideoModelRegistration>[0],
  ): Promise<OpenRouterVideoModelRegistrationRow | null> {
    return upsertOpenRouterVideoModelRegistration(params);
  }

  /** @see deleteOpenRouterVideoModelRegistration */
  async deleteOpenRouterVideoModelRegistration(
    params: Parameters<typeof deleteOpenRouterVideoModelRegistration>[0],
  ): Promise<boolean> {
    return deleteOpenRouterVideoModelRegistration(params);
  }

  /** @see restoreOverridesFromSnapshot */
  async restoreOverridesFromSnapshot(
    serverId: number,
    channelOverrides: Parameters<typeof restoreOverridesFromSnapshot>[1],
    personaOverrides: Parameters<typeof restoreOverridesFromSnapshot>[2],
    validChannelIds: Set<string>,
  ): ReturnType<typeof restoreOverridesFromSnapshot> {
    return restoreOverridesFromSnapshot(serverId, channelOverrides, personaOverrides, validChannelIds);
  }

  /** @see cleanupDeadChannelOverrides */
  async cleanupDeadChannelOverrides(serverId: number, validChannelIds: Set<string>): Promise<number> {
    return cleanupDeadChannelOverrides(serverId, validChannelIds);
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Exports server-scoped provider configuration.
   * Stub — full composition with the unified export pipeline lands in Phase 6 (#16.7).
   *
   * @param ownerId - Internal server DB ID
   */
  async toExportShape(ownerId: string | number): Promise<LlmExportShape | null> {
    const serverId = Number(ownerId);
    if (Number.isNaN(serverId)) return null;
    const savedProviderConfigs = await loadSavedProviderConfigs(serverId);
    return { savedProviderConfigs };
  }

  /**
   * Restores server-scoped provider configuration from an export.
   * Stub — full implementation lands in Phase 6 (#16.7).
   */
  async fromExportShape(_ownerId: string | number, _data: LlmExportShape): Promise<boolean> {
    return false;
  }
}

/** Singleton instance — import this in callers. */
export const llmRepository = new LlmRepository();

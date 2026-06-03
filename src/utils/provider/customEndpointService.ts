import type {
  CustomEndpointApiStyle,
  CustomEndpointCapability,
  CustomEndpointRow,
  SavedProviderConfigUpsert,
  SavedProviderConfigRow,
  ServerModelConfigRow,
  ServerNovelaiImagegenConfigRow,
  AssembledServerConfig,
  UserSavedProviderConfigUpsert,
  UserSavedProviderConfigRow,
} from "@/types/db/schema";
import { configRepository, llmModelRepo, llmOverrideRepo, llmProviderRepo } from "@/utils/db/repositories";

import { CUSTOM_ENDPOINT_PLACEHOLDER_KEY } from "@/utils/discord/customProviderModal";
import {
  buildSavedProviderConfigFromExistingOrDefaults,
  buildUserSavedProviderConfigFromExistingOrDefaults,
} from "@/utils/provider/savedProviderConfig";
import {
  buildServerCustomProviderName,
  buildSyntheticCustomModelCodename,
  buildUserCustomProviderName,
  parseCustomProvider,
} from "@/utils/provider/customProviderUtils";
import { encryptApiKey } from "@/utils/security/crypto";
import { fetchUserRemoteUrl } from "@/utils/security/userRemoteFetch";

type RegistrationScope =
  | {
      kind: "server";
      ownerId: number;
      baseConfig: AssembledServerConfig;
      serverDiscId?: string;
    }
  | {
      kind: "personal";
      ownerId: number;
      baseConfig: AssembledServerConfig;
    };

export interface CustomEndpointRegistrationInput {
  scope: RegistrationScope;
  label: string;
  capability: CustomEndpointCapability;
  apiStyle: CustomEndpointApiStyle;
  endpointUrl: string;
  displayName: string;
  modelName?: string | null;
  authToken?: string | null;
  numCtx?: number | null;
  hasTools?: boolean;
  seesImages?: boolean;
  seesVideos?: boolean;
  supportsStructOutput?: boolean;
  extraConfig?: Record<string, unknown>;
  // When set, edit that exact endpoint row in place (update its model + row by id) instead of
  // registering a new model. Add flows omit it; the edit command supplies the selected row's id.
  editingEndpointId?: number;
}

export interface CustomEndpointRegistrationResult {
  provider: string;
  customEndpoint: CustomEndpointRow;
  modelId: number | null;
}

function getInternalProviderName(scope: RegistrationScope, label: string): string {
  return scope.kind === "server"
    ? buildServerCustomProviderName(scope.ownerId, label)
    : buildUserCustomProviderName(scope.ownerId, label);
}

async function getExistingSavedConfig(
  scope: RegistrationScope,
  provider: string,
): Promise<SavedProviderConfigRow | UserSavedProviderConfigRow | null> {
  return scope.kind === "server"
    ? await llmProviderRepo.loadSavedProviderConfig(scope.ownerId, provider)
    : await llmProviderRepo.loadUserSavedProviderConfig(scope.ownerId, provider);
}

async function upsertSyntheticTextModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
): Promise<number | null> {
  const codename = buildSyntheticCustomModelCodename(provider, "text", endpoint.modelName);
  const modelId = await llmModelRepo.upsertSyntheticCustomLlm({
    provider,
    codename,
    displayName: endpoint.displayName,
    hasTools: endpoint.hasTools ?? false,
    seesImages: endpoint.seesImages ?? false,
    seesVideos: endpoint.seesVideos ?? false,
    supportsStructOutput: endpoint.supportsStructOutput ?? false,
  });

  return modelId;
}

async function upsertSyntheticEmbeddingModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
): Promise<number | null> {
  const codename = buildSyntheticCustomModelCodename(provider, "embedding", endpoint.modelName);
  const modelId = await llmModelRepo.upsertSyntheticCustomEmbeddingModel({
    provider,
    codename,
    displayName: endpoint.displayName,
  });

  return modelId;
}

async function upsertSyntheticImageModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
): Promise<number | null> {
  const codename = buildSyntheticCustomModelCodename(provider, "image", endpoint.modelName);
  const modelId = await llmModelRepo.upsertSyntheticCustomDiffusionModel({
    provider,
    codename,
    displayName: endpoint.displayName,
  });

  return modelId;
}

async function upsertSyntheticVideoModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
): Promise<number | null> {
  const codename = buildSyntheticCustomModelCodename(provider, "video", endpoint.modelName);
  const modelId = await llmModelRepo.upsertSyntheticCustomVideoModel({
    provider,
    codename,
    displayName: endpoint.displayName,
  });

  return modelId;
}

async function upsertSyntheticCapabilityModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
): Promise<number | null> {
  switch (endpoint.capability) {
    case "text":
      return await upsertSyntheticTextModel(provider, endpoint);
    case "embedding":
      return await upsertSyntheticEmbeddingModel(provider, endpoint);
    case "image":
      return await upsertSyntheticImageModel(provider, endpoint);
    case "video":
      return await upsertSyntheticVideoModel(provider, endpoint);
    default:
      return null;
  }
}

/**
 * Writes the synthetic model row backing an endpoint and returns its id.
 *
 * On the add path (no existing model ref) it inserts a fresh synthetic model. On the edit path it
 * updates the existing model row in place by id, so a renamed model_name (which changes the derived
 * codename) does not orphan the row that live config still references by id.
 */
async function writeSyntheticCapabilityModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
  existingModelRefId: number | null,
): Promise<number | null> {
  if (existingModelRefId == null) {
    return await upsertSyntheticCapabilityModel(provider, endpoint);
  }

  if (endpoint.capability === "speech" || endpoint.capability === "transcription") {
    return null;
  }

  const codename = buildSyntheticCustomModelCodename(provider, endpoint.capability, endpoint.modelName);
  await llmModelRepo.updateSyntheticCustomCapabilityModelById({
    modelRefId: existingModelRefId,
    capability: endpoint.capability,
    codename,
    displayName: endpoint.displayName,
    hasTools: endpoint.hasTools ?? false,
    seesImages: endpoint.seesImages ?? false,
    seesVideos: endpoint.seesVideos ?? false,
    supportsStructOutput: endpoint.supportsStructOutput ?? false,
  });
  return existingModelRefId;
}

function getCapabilityModelId(
  config: SavedProviderConfigRow | UserSavedProviderConfigRow,
  capability: CustomEndpointCapability,
): number | null {
  switch (capability) {
    case "text":
      return config.llm_id ?? null;
    case "embedding":
      return config.embedding_model_id ?? null;
    case "image":
      return config.diffusion_model_id ?? null;
    case "video":
      return config.video_model_id ?? null;
    case "speech":
    case "transcription":
      return null;
  }
}

async function clearServerScopedLiveReferences(
  scope: Extract<RegistrationScope, { kind: "server" }>,
  capability: CustomEndpointCapability,
  modelId: number | null,
): Promise<void> {
  if (!modelId) {
    return;
  }

  const serverId = scope.ownerId;
  const modelPatch: Partial<ServerModelConfigRow> = {};
  const novelaiPatch: Partial<ServerNovelaiImagegenConfigRow> = {};

  switch (capability) {
    case "text":
      if (scope.baseConfig.llm_id === modelId) {
        modelPatch.llm_id = null;
        modelPatch.custom_endpoint_url = null;
        modelPatch.custom_model_name = null;
        modelPatch.custom_num_ctx = null;
      }
      if (scope.baseConfig.vision_llm_id === modelId) {
        modelPatch.vision_llm_id = null;
      }
      await Promise.all([
        updateModelConfigIfNeeded(serverId, modelPatch),
        llmOverrideRepo.deleteChannelLlmOverridesForModel(serverId, modelId, { serverDiscId: scope.serverDiscId }),
        llmOverrideRepo.clearPersonaLlmOverridesForModel(serverId, modelId, { serverDiscId: scope.serverDiscId }),
      ]);
      return;
    case "embedding":
      if (scope.baseConfig.embedding_model_id === modelId) {
        modelPatch.embedding_model_id = null;
      }
      await updateModelConfigIfNeeded(serverId, modelPatch);
      return;
    case "image":
      if (scope.baseConfig.diffusion_model_id === modelId) {
        modelPatch.diffusion_model_id = null;
      }
      if (scope.baseConfig.nai_diffusion_model_id === modelId) {
        novelaiPatch.nai_diffusion_model_id = null;
      }
      await Promise.all([
        updateModelConfigIfNeeded(serverId, modelPatch),
        updateNovelaiImagegenConfigIfNeeded(serverId, novelaiPatch),
      ]);
      return;
    case "video":
      if (scope.baseConfig.video_model_id === modelId) {
        modelPatch.video_model_id = null;
      }
      await updateModelConfigIfNeeded(serverId, modelPatch);
      return;
  }
}

async function updateModelConfigIfNeeded(serverId: number, patch: Partial<ServerModelConfigRow>): Promise<boolean> {
  return Object.keys(patch).length > 0 ? await configRepository.updateModelConfig(serverId, patch) : true;
}

async function updateNovelaiImagegenConfigIfNeeded(
  serverId: number,
  patch: Partial<ServerNovelaiImagegenConfigRow>,
): Promise<boolean> {
  return Object.keys(patch).length > 0 ? await configRepository.updateNovelaiImagegenConfig(serverId, patch) : true;
}

async function buildSavedConfigForCustomEndpoint(
  scope: RegistrationScope,
  provider: string,
  existingConfig: SavedProviderConfigRow | UserSavedProviderConfigRow | null,
  endpoint: CustomEndpointRegistrationInput,
  modelId: number | null,
) {
  const trimmedAuthToken = endpoint.authToken?.trim();
  const encryptionResult =
    trimmedAuthToken && trimmedAuthToken.length > 0
      ? await encryptApiKey(trimmedAuthToken)
      : existingConfig?.api_key
        ? {
            encrypted: existingConfig.api_key,
            version: existingConfig.key_version || 1,
          }
        : await encryptApiKey(CUSTOM_ENDPOINT_PLACEHOLDER_KEY);

  const textModelId = endpoint.capability === "text" ? modelId : undefined;

  return scope.kind === "server"
    ? await buildSavedProviderConfigFromExistingOrDefaults({
        serverId: scope.ownerId,
        provider,
        apiKey: encryptionResult.encrypted,
        keyVersion: encryptionResult.version,
        baseConfig: scope.baseConfig,
        existingConfig: existingConfig as SavedProviderConfigRow | null,
        llmId: textModelId,
      })
    : await buildUserSavedProviderConfigFromExistingOrDefaults({
        userId: scope.ownerId,
        provider,
        apiKey: encryptionResult.encrypted,
        keyVersion: encryptionResult.version,
        baseConfig: scope.baseConfig,
        existingConfig: existingConfig as UserSavedProviderConfigRow | null,
        llmId: textModelId,
        enabledCapabilities: (existingConfig as UserSavedProviderConfigRow | null)?.enabled_capabilities ?? [],
      }).then((config) => ({
        ...config,
        enabled_capabilities:
          endpoint.capability === "text"
            ? Array.from(
                new Set([...config.enabled_capabilities, "text", ...(endpoint.seesImages ? ["vision" as const] : [])]),
              )
            : endpoint.capability === "embedding"
              ? Array.from(new Set([...config.enabled_capabilities, "embedding"]))
              : endpoint.capability === "image"
                ? Array.from(new Set([...config.enabled_capabilities, "image"]))
                : Array.from(new Set([...config.enabled_capabilities, "video"])),
      }));
}

export async function registerCustomEndpoint(
  input: CustomEndpointRegistrationInput,
): Promise<CustomEndpointRegistrationResult | null> {
  const provider = getInternalProviderName(input.scope, input.label);
  const existingConfig = await getExistingSavedConfig(input.scope, provider);
  const isEdit = input.editingEndpointId != null;

  // 1. On the edit path, recover the row being edited (model link, prior auth/default flags).
  const editingRow = isEdit
    ? ((await llmProviderRepo.loadCustomEndpointsByIds([input.editingEndpointId as number]))[0] ?? null)
    : null;

  // 2. Determine whether this is the first model of its capability under the label. The first model
  //    auto-activates and becomes the default; later siblings are register-only (no active switch).
  const allEndpoints =
    input.scope.kind === "server"
      ? await llmProviderRepo.loadCustomEndpointsForServer(input.scope.ownerId)
      : await llmProviderRepo.loadCustomEndpointsForUser(input.scope.ownerId);
  const otherSiblings = allEndpoints.filter(
    (endpoint) =>
      endpoint.label === input.label &&
      endpoint.capability === input.capability &&
      endpoint.custom_endpoint_id !== input.editingEndpointId,
  );
  const shouldBeDefault = isEdit ? (editingRow?.is_default ?? false) : otherSiblings.length === 0;

  // 3. Insert (add) or update-in-place (edit) the synthetic model row.
  const modelId = await writeSyntheticCapabilityModel(provider, input, editingRow?.model_ref_id ?? null);

  // Auth is shared per label (one stored key). A new sibling inherits requires_auth from an existing
  // sibling/edited row when no fresh token is supplied, so the "one connection" model stays coherent.
  const authSibling = editingRow ?? otherSiblings[0] ?? null;
  const trimmedAuthToken = input.authToken?.trim();
  const requiresAuth = trimmedAuthToken && trimmedAuthToken.length > 0 ? true : (authSibling?.requires_auth ?? false);
  const serverScope = input.scope.kind === "server" ? input.scope : null;

  const customEndpoint = await llmProviderRepo.upsertCustomEndpoint(
    {
      serverId: input.scope.kind === "server" ? input.scope.ownerId : null,
      userId: input.scope.kind === "personal" ? input.scope.ownerId : null,
      label: input.label,
      capability: input.capability,
      apiStyle: input.apiStyle,
      endpointUrl: input.endpointUrl,
      modelName: input.modelName ?? null,
      modelRefId: modelId,
      displayName: input.displayName,
      numCtx: input.numCtx ?? null,
      requiresAuth,
      extraConfig: input.extraConfig ?? {},
      hasTools: input.hasTools ?? false,
      seesImages: input.seesImages ?? false,
      seesVideos: input.seesVideos ?? false,
      supportsStructOutput: input.supportsStructOutput ?? false,
      isDefault: shouldBeDefault,
      customEndpointId: isEdit ? input.editingEndpointId : null,
    },
    serverScope ? { serverDiscId: serverScope.serverDiscId } : {},
  );

  if (!customEndpoint) {
    return null;
  }

  // 4. Register-only active selection: keep whatever model is already active for this capability;
  //    only auto-activate when nothing is selected yet (the very first model under the label).
  const currentActive = existingConfig ? getCapabilityModelId(existingConfig, input.capability) : null;
  const activeId = currentActive ?? modelId;
  const currentVision = existingConfig?.vision_llm_id ?? null;
  const visionId = input.capability === "text" && input.seesImages ? (currentVision ?? modelId) : currentVision;

  const writeOk = serverScope
    ? await (async () => {
        const savedConfig = (await buildSavedConfigForCustomEndpoint(
          input.scope,
          provider,
          existingConfig,
          input,
          modelId,
        )) as SavedProviderConfigUpsert;

        return await llmProviderRepo.upsertSavedProviderConfig(
          serverScope.ownerId,
          {
            ...savedConfig,
            llm_id: input.capability === "text" ? activeId : savedConfig.llm_id,
            vision_llm_id: input.capability === "text" && input.seesImages ? visionId : savedConfig.vision_llm_id,
            embedding_model_id: input.capability === "embedding" ? activeId : savedConfig.embedding_model_id,
            diffusion_model_id: input.capability === "image" ? activeId : savedConfig.diffusion_model_id,
            video_model_id: input.capability === "video" ? activeId : savedConfig.video_model_id,
          },
          { serverDiscId: serverScope.serverDiscId },
        );
      })()
    : await (async () => {
        const savedConfig = (await buildSavedConfigForCustomEndpoint(
          input.scope,
          provider,
          existingConfig,
          input,
          modelId,
        )) as UserSavedProviderConfigUpsert;

        return await llmProviderRepo.upsertUserSavedProviderConfig(input.scope.ownerId, {
          ...savedConfig,
          llm_id: input.capability === "text" ? activeId : savedConfig.llm_id,
          vision_llm_id: input.capability === "text" && input.seesImages ? visionId : savedConfig.vision_llm_id,
          embedding_model_id: input.capability === "embedding" ? activeId : savedConfig.embedding_model_id,
          diffusion_model_id: input.capability === "image" ? activeId : savedConfig.diffusion_model_id,
          video_model_id: input.capability === "video" ? activeId : savedConfig.video_model_id,
        });
      })();

  if (!writeOk) {
    return null;
  }

  return {
    provider,
    customEndpoint,
    modelId,
  };
}

export async function setActiveCustomEndpoint(params: {
  serverId: number;
  capability: "speech" | "transcription";
  customEndpointId: number;
}): Promise<boolean> {
  return await llmProviderRepo.setActiveCustomEndpoint(params);
}

/**
 * Resolves the custom endpoint row backing a provider for a capability.
 *
 * When an active model id is supplied, the specific endpoint owning that synthetic model is
 * returned — this is how the runtime picks the right row when several models share a label+capability.
 * When omitted (or no match, e.g. legacy rows whose model_ref_id was not backfilled), it falls back
 * to the most-recently-updated endpoint for the label+capability. Speech/transcription always use
 * the fallback since they have no synthetic model.
 *
 * @param provider      - Internal custom provider name
 * @param capability    - Endpoint capability
 * @param activeModelId - Optional id of the currently-active synthetic model for this capability
 */
export async function resolveCustomEndpointForProvider(
  provider: string,
  capability: CustomEndpointCapability,
  activeModelId?: number | null,
): Promise<CustomEndpointRow | null> {
  const parsed = parseCustomProvider(provider);
  if (!parsed) {
    return null;
  }

  if (activeModelId != null) {
    const byModel = await llmProviderRepo.loadCustomEndpointByModelRef(
      parsed.scope === "server"
        ? { serverId: parsed.ownerId, capability, modelRefId: activeModelId }
        : { userId: parsed.ownerId, capability, modelRefId: activeModelId },
    );
    if (byModel) {
      return byModel;
    }
  }

  return parsed.scope === "server"
    ? await llmProviderRepo.loadCustomEndpoint({
        serverId: parsed.ownerId,
        label: parsed.label,
        capability,
      })
    : await llmProviderRepo.loadCustomEndpoint({
        userId: parsed.ownerId,
        label: parsed.label,
        capability,
      });
}

export async function removeCustomEndpointRegistration(params: {
  scope: RegistrationScope;
  customEndpointId: number;
  label: string;
  capability: CustomEndpointCapability;
  modelRefId: number | null;
}): Promise<boolean> {
  const provider = getInternalProviderName(params.scope, params.label);
  const existingConfig = await getExistingSavedConfig(params.scope, provider);

  // 1. Delete the specific endpoint row (one model among possibly several under this label+capability).
  const deleted =
    params.scope.kind === "server"
      ? await llmProviderRepo.deleteCustomEndpointById(params.customEndpointId, {
          serverId: params.scope.ownerId,
          serverDiscId: params.scope.serverDiscId,
        })
      : await llmProviderRepo.deleteCustomEndpointById(params.customEndpointId);

  if (!deleted) {
    return false;
  }

  // 2. Clear live server config + channel/persona overrides that pointed at this exact model.
  //    (No-op when the removed model was not the live-active one for its capability.)
  if (params.scope.kind === "server") {
    await clearServerScopedLiveReferences(params.scope, params.capability, params.modelRefId);
  }

  // 3. Delete the synthetic model row this endpoint owned.
  if (params.modelRefId != null) {
    await llmModelRepo.deleteSyntheticCustomCapabilityModelById(params.modelRefId, params.capability);
  }

  // 4. If no models remain for the whole label, drop the saved provider config entirely.
  const remaining =
    params.scope.kind === "server"
      ? await llmProviderRepo.loadCustomEndpointsForServer(params.scope.ownerId)
      : await llmProviderRepo.loadCustomEndpointsForUser(params.scope.ownerId);
  const sameLabelRemaining = remaining.filter((endpoint) => endpoint.label === params.label);

  if (sameLabelRemaining.length === 0) {
    if (params.scope.kind === "server") {
      await llmProviderRepo.deleteSavedProviderConfig(params.scope.ownerId, provider, {
        serverDiscId: params.scope.serverDiscId,
      });
    } else {
      await llmProviderRepo.deleteUserSavedProviderConfig(params.scope.ownerId, provider);
    }
    return true;
  }

  // 5. Otherwise, only clear the saved config's active slot for this capability if it pointed at the
  //    removed model. Sibling models stay registered; the user re-picks via /model.
  if (!existingConfig || params.modelRefId == null) {
    return true;
  }
  const activeForCapability = getCapabilityModelId(existingConfig, params.capability);
  const visionMatches = params.capability === "text" && existingConfig.vision_llm_id === params.modelRefId;
  if (activeForCapability !== params.modelRefId && !visionMatches) {
    return true;
  }

  const clearActive = activeForCapability === params.modelRefId;
  const nextConfig = {
    ...existingConfig,
    llm_id: params.capability === "text" && clearActive ? null : existingConfig.llm_id,
    vision_llm_id: visionMatches ? null : existingConfig.vision_llm_id,
    embedding_model_id: params.capability === "embedding" && clearActive ? null : existingConfig.embedding_model_id,
    diffusion_model_id: params.capability === "image" && clearActive ? null : existingConfig.diffusion_model_id,
    video_model_id: params.capability === "video" && clearActive ? null : existingConfig.video_model_id,
  };

  if (params.scope.kind === "server") {
    await llmProviderRepo.upsertSavedProviderConfig(params.scope.ownerId, nextConfig as SavedProviderConfigRow, {
      serverDiscId: params.scope.serverDiscId,
    });
  } else {
    await llmProviderRepo.upsertUserSavedProviderConfig(params.scope.ownerId, nextConfig as UserSavedProviderConfigRow);
  }

  return true;
}

export async function cleanupCustomProviderArtifacts(provider: string): Promise<void> {
  const parsed = parseCustomProvider(provider);
  if (!parsed || parsed.ownerId === null) {
    return;
  }

  const registeredEndpoints =
    parsed.scope === "server"
      ? await llmProviderRepo.loadCustomEndpointsForServer(parsed.ownerId)
      : await llmProviderRepo.loadCustomEndpointsForUser(parsed.ownerId);

  const matchingEndpoints = registeredEndpoints.filter((endpoint) => endpoint.label === parsed.label);

  // Delete each model row under the label (a label+capability may now own several).
  for (const endpoint of matchingEndpoints) {
    if (endpoint.custom_endpoint_id != null) {
      await llmProviderRepo.deleteCustomEndpointById(endpoint.custom_endpoint_id, {
        serverId: parsed.scope === "server" ? parsed.ownerId : null,
      });
    }
  }

  // Drop every synthetic model owned by this custom provider across all capability tables.
  await llmModelRepo.deleteAllSyntheticModelsForProvider(parsed.raw);
}

export async function validateCustomEndpointReachability(params: {
  apiStyle: CustomEndpointApiStyle;
  endpointUrl: string;
  apiKey?: string | null;
  strict?: boolean;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const headers: Record<string, string> = {};
  if (params.apiKey?.trim()) {
    headers.Authorization = `Bearer ${params.apiKey.trim()}`;
  }

  const fetchOptions = { strict: params.strict };

  try {
    const baseUrl = params.endpointUrl.replace(/\/+$/, "");

    if (params.apiStyle === "comfyui") {
      const response = await fetchUserRemoteUrl(`${baseUrl}/system_stats`, { headers }, fetchOptions);
      return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status} ${response.statusText}` };
    }

    // tts-clone servers implement GET /health per the TomoriBot TTS spec.
    if (params.apiStyle === "tts-clone") {
      const response = await fetchUserRemoteUrl(`${baseUrl}/health`, { headers }, fetchOptions);
      return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status} ${response.statusText}` };
    }

    // openai-compatible-transcription servers expose /v1/models (OpenAI-compatible) or /models.
    if (params.apiStyle === "openai-compatible-transcription") {
      const response = await fetchUserRemoteUrl(`${baseUrl}/v1/models`, { headers }, fetchOptions);
      if (response.ok) return { ok: true };
      // Fall back to the shorter /models path some servers expose.
      const fallback = await fetchUserRemoteUrl(`${baseUrl}/models`, { headers }, fetchOptions);
      return fallback.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status} ${response.statusText}` };
    }

    const response = await fetchUserRemoteUrl(`${baseUrl}/models`, { headers }, fetchOptions);
    return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status} ${response.statusText}` };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

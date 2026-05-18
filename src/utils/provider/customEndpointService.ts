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
  const codename = buildSyntheticCustomModelCodename(provider, "text");
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
  const codename = buildSyntheticCustomModelCodename(provider, "embedding");
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
  const codename = buildSyntheticCustomModelCodename(provider, "image");
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
  const codename = buildSyntheticCustomModelCodename(provider, "video");
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

async function deleteSyntheticCapabilityModel(provider: string, capability: CustomEndpointCapability): Promise<void> {
  const codename = buildSyntheticCustomModelCodename(provider, capability);

  await llmModelRepo.deleteSyntheticCustomCapabilityModel(provider, codename, capability);
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
  const existingEndpoint =
    input.scope.kind === "server"
      ? await llmProviderRepo.loadCustomEndpoint({
          serverId: input.scope.ownerId,
          label: input.label,
          capability: input.capability,
        })
      : await llmProviderRepo.loadCustomEndpoint({
          userId: input.scope.ownerId,
          label: input.label,
          capability: input.capability,
        });
  const siblingEndpoints =
    input.scope.kind === "server"
      ? (await llmProviderRepo.loadCustomEndpointsForServer(input.scope.ownerId)).filter(
          (endpoint) => endpoint.capability === input.capability,
        )
      : (await llmProviderRepo.loadCustomEndpointsForUser(input.scope.ownerId)).filter(
          (endpoint) => endpoint.capability === input.capability,
        );
  const shouldBeDefault = existingEndpoint?.is_default ?? !siblingEndpoints.some((endpoint) => endpoint.is_default);
  const modelId = await upsertSyntheticCapabilityModel(provider, input);
  const trimmedAuthToken = input.authToken?.trim();
  const requiresAuth =
    trimmedAuthToken && trimmedAuthToken.length > 0 ? true : (existingEndpoint?.requires_auth ?? false);
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
      displayName: input.displayName,
      numCtx: input.numCtx ?? null,
      requiresAuth,
      extraConfig: input.extraConfig ?? {},
      hasTools: input.hasTools ?? false,
      seesImages: input.seesImages ?? false,
      seesVideos: input.seesVideos ?? false,
      supportsStructOutput: input.supportsStructOutput ?? false,
      isDefault: shouldBeDefault,
    },
    serverScope ? { serverDiscId: serverScope.serverDiscId } : {},
  );

  if (!customEndpoint) {
    return null;
  }

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
            llm_id: input.capability === "text" ? modelId : savedConfig.llm_id,
            vision_llm_id: input.capability === "text" && input.seesImages ? modelId : savedConfig.vision_llm_id,
            embedding_model_id: input.capability === "embedding" ? modelId : savedConfig.embedding_model_id,
            diffusion_model_id: input.capability === "image" ? modelId : savedConfig.diffusion_model_id,
            video_model_id: input.capability === "video" ? modelId : savedConfig.video_model_id,
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
          llm_id: input.capability === "text" ? modelId : savedConfig.llm_id,
          vision_llm_id: input.capability === "text" && input.seesImages ? modelId : savedConfig.vision_llm_id,
          embedding_model_id: input.capability === "embedding" ? modelId : savedConfig.embedding_model_id,
          diffusion_model_id: input.capability === "image" ? modelId : savedConfig.diffusion_model_id,
          video_model_id: input.capability === "video" ? modelId : savedConfig.video_model_id,
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

export async function resolveCustomEndpointForProvider(
  provider: string,
  capability: CustomEndpointCapability,
): Promise<CustomEndpointRow | null> {
  const parsed = parseCustomProvider(provider);
  if (!parsed) {
    return null;
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
  label: string;
  capability: CustomEndpointCapability;
}): Promise<boolean> {
  const provider = getInternalProviderName(params.scope, params.label);
  const existingConfig = await getExistingSavedConfig(params.scope, provider);
  if (!existingConfig) {
    return false;
  }

  const modelId = getCapabilityModelId(existingConfig, params.capability);

  const deleted =
    params.scope.kind === "server"
      ? await llmProviderRepo.deleteCustomEndpoint(
          {
            serverId: params.scope.ownerId,
            label: params.label,
            capability: params.capability,
          },
          { serverDiscId: params.scope.serverDiscId },
        )
      : await llmProviderRepo.deleteCustomEndpoint({
          userId: params.scope.ownerId,
          label: params.label,
          capability: params.capability,
        });

  if (!deleted) {
    return false;
  }

  if (params.scope.kind === "server") {
    await clearServerScopedLiveReferences(params.scope, params.capability, modelId);
  }

  await deleteSyntheticCapabilityModel(provider, params.capability);

  const remaining =
    params.scope.kind === "server"
      ? await llmProviderRepo.loadCustomEndpointsForServer(params.scope.ownerId)
      : await llmProviderRepo.loadCustomEndpointsForUser(params.scope.ownerId);
  const sameProviderRemaining = remaining.filter((endpoint) => endpoint.label === params.label);

  if (sameProviderRemaining.length === 0) {
    if (params.scope.kind === "server") {
      await llmProviderRepo.deleteSavedProviderConfig(params.scope.ownerId, provider, {
        serverDiscId: params.scope.serverDiscId,
      });
    } else {
      await llmProviderRepo.deleteUserSavedProviderConfig(params.scope.ownerId, provider);
    }
    return true;
  }

  const nextConfig =
    params.scope.kind === "server"
      ? {
          ...(existingConfig as SavedProviderConfigRow),
          llm_id: params.capability === "text" ? null : existingConfig.llm_id,
          vision_llm_id: params.capability === "text" ? null : existingConfig.vision_llm_id,
          embedding_model_id: params.capability === "embedding" ? null : existingConfig.embedding_model_id,
          diffusion_model_id: params.capability === "image" ? null : existingConfig.diffusion_model_id,
          video_model_id: params.capability === "video" ? null : existingConfig.video_model_id,
        }
      : {
          ...(existingConfig as UserSavedProviderConfigRow),
          llm_id: params.capability === "text" ? null : existingConfig.llm_id,
          vision_llm_id: params.capability === "text" ? null : existingConfig.vision_llm_id,
          embedding_model_id: params.capability === "embedding" ? null : existingConfig.embedding_model_id,
          diffusion_model_id: params.capability === "image" ? null : existingConfig.diffusion_model_id,
          video_model_id: params.capability === "video" ? null : existingConfig.video_model_id,
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

  for (const endpoint of matchingEndpoints) {
    await llmProviderRepo.deleteCustomEndpoint(
      parsed.scope === "server"
        ? {
            serverId: parsed.ownerId,
            label: endpoint.label,
            capability: endpoint.capability,
          }
        : {
            userId: parsed.ownerId,
            label: endpoint.label,
            capability: endpoint.capability,
          },
    );
  }

  for (const capability of ["text", "embedding", "image", "video"] as const) {
    await deleteSyntheticCapabilityModel(parsed.raw, capability);
  }
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

import type {
  CustomEndpointApiStyle,
  CustomEndpointCapability,
  CustomEndpointConnectionRow,
  CustomEndpointRow,
  PersonalProviderCapability,
  SavedProviderConfigUpsert,
  SavedProviderConfigRow,
  AssembledServerConfig,
  TomoriState,
  UserSavedProviderConfigUpsert,
  UserSavedProviderConfigRow,
  ErrorContext,
} from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { forgetCachedLlm } from "@/utils/cache/llmCacheStore";
import { configRepository, llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";

import { CUSTOM_ENDPOINT_PLACEHOLDER_KEY } from "@/utils/provider/legacyCustomProvider";
import { storedCredentialUsageContext } from "@/utils/security/apiKeyRetention";
import type { ProviderUsageContext } from "@/utils/provider/providerUsage";
import {
  buildSavedProviderConfigFromExistingOrDefaults,
  buildUserSavedProviderConfigFromExistingOrDefaults,
} from "@/utils/provider/savedProviderConfig";
import {
  buildCustomProviderName,
  buildSyntheticCustomModelCodename,
  parseCustomProvider,
} from "@/utils/provider/customProviderUtils";
import { buildFallbackModelPersistence, prunePrimaryFallbackRefs } from "@/utils/provider/fallbackModelIdentity";
import {
  assignPersonalCapabilityToProvider,
  getActivePersonalProviderForCapability,
  getStoredPersonalProviderForCapability,
  prunePersonalFallbackChain,
  setPersonalTextPrimary,
} from "@/utils/provider/personalProviderHelpers";
import { resolveLogitBiasEntriesForLlm } from "@/utils/provider/logitBiasResolver";
import { decryptApiKey, encryptApiKey } from "@/utils/security/crypto";
import { getEndpointRemotePolicy } from "@/utils/security/remoteUrlSecurity";
import { fetchUserRemoteUrl, RemoteUrlPolicyError } from "@/utils/security/userRemoteFetch";

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
      baseConfig?: AssembledServerConfig;
    };

export interface CustomEndpointRegistrationInput {
  scope: RegistrationScope;
  label: string;
  capability: CustomEndpointCapability;
  apiStyle: CustomEndpointApiStyle;
  endpointUrl: string;
  modelName?: string | null;
  authToken?: string | null;
  numCtx?: number | null;
  hasTools?: boolean;
  seesImages?: boolean;
  seesVideos?: boolean;
  supportsStructOutput?: boolean;
  // Text compatibility toggles synced to the synthetic llms row so runtime resolves them like built-in providers.
  strictRoleAlternation?: boolean;
  supportsPrefixCompletion?: boolean;
  supportsAssistantPrefill?: boolean;
  // Per-model verbatim tool-calling opt-in: the runtime reads it from the synthetic llms row while
  // the panel reads the endpoint row, so both must carry the same value.
  verbatimToolCalling?: boolean;
  extraConfig?: Record<string, unknown>;
  // Present only when editing an existing endpoint row in place rather than adding a new registration.
  editingEndpointId?: number;
}

export interface CustomEndpointRegistrationResult {
  provider: string;
  customEndpoint: CustomEndpointRow;
  modelId: number | null;
}

function getSyntheticModelDescription(endpoint: CustomEndpointRegistrationInput): string {
  return endpoint.modelName?.trim() || endpoint.label;
}

async function getExistingSavedConfig(
  scope: RegistrationScope,
  provider: string,
): Promise<SavedProviderConfigRow | UserSavedProviderConfigRow | null> {
  return scope.kind === "server"
    ? await llmProviderRepo.loadSavedProviderConfig(scope.ownerId, provider)
    : await llmProviderRepo.loadUserSavedProviderConfig(scope.ownerId, provider);
}

// TomoriState invalidation alone leaves llmModelRepo.loadById serving stale pre-edit capability flags from the LLM
// cache, so this drops that cache entry.
function forgetCachedTextModel(modelId: number | null | undefined): void {
  if (modelId != null) {
    forgetCachedLlm(modelId);
  }
}

async function upsertSyntheticTextModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
): Promise<number | null> {
  const codename = buildSyntheticCustomModelCodename(endpoint.label, endpoint.modelName);
  const description = getSyntheticModelDescription(endpoint);
  const modelId = await llmModelRepo.upsertSyntheticCustomLlm({
    provider,
    codename,
    displayName: description,
    hasTools: endpoint.hasTools ?? false,
    seesImages: endpoint.seesImages ?? false,
    seesVideos: endpoint.seesVideos ?? false,
    supportsStructOutput: endpoint.supportsStructOutput ?? false,
    strictRoleAlternation: endpoint.strictRoleAlternation ?? false,
    supportsPrefixCompletion: endpoint.supportsPrefixCompletion ?? false,
    supportsAssistantPrefill: endpoint.supportsAssistantPrefill ?? false,
    verbatimToolCalling: endpoint.verbatimToolCalling ?? false,
  });

  forgetCachedTextModel(modelId);
  return modelId;
}

async function upsertSyntheticEmbeddingModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
): Promise<number | null> {
  const codename = buildSyntheticCustomModelCodename(endpoint.label, endpoint.modelName);
  const description = getSyntheticModelDescription(endpoint);
  const modelId = await llmModelRepo.upsertSyntheticCustomEmbeddingModel({
    provider,
    codename,
    displayName: description,
  });

  return modelId;
}

async function upsertSyntheticImageModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
): Promise<number | null> {
  const codename = buildSyntheticCustomModelCodename(endpoint.label, endpoint.modelName);
  const description = getSyntheticModelDescription(endpoint);
  const modelId = await llmModelRepo.upsertSyntheticCustomDiffusionModel({
    provider,
    codename,
    displayName: description,
  });

  return modelId;
}

async function upsertSyntheticVideoModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
): Promise<number | null> {
  const codename = buildSyntheticCustomModelCodename(endpoint.label, endpoint.modelName);
  const description = getSyntheticModelDescription(endpoint);
  const modelId = await llmModelRepo.upsertSyntheticCustomVideoModel({
    provider,
    codename,
    displayName: description,
  });

  return modelId;
}

async function upsertSyntheticCapabilityModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
): Promise<number | null> {
  switch (endpoint.capability) {
    case "decision":
      return await llmModelRepo.upsertDecisionModel({
        provider,
        codename: buildSyntheticCustomModelCodename(endpoint.label, endpoint.modelName),
        inputTokenLimit: endpoint.numCtx ?? 0,
      });
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

// Edits must update the existing synthetic model row in place by id so renaming model_name (which changes codename)
// does not orphan live config references.
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

  const codename = buildSyntheticCustomModelCodename(endpoint.label, endpoint.modelName);
  const description = getSyntheticModelDescription(endpoint);
  await llmModelRepo.updateSyntheticCustomCapabilityModelById({
    modelRefId: existingModelRefId,
    inputTokenLimit: endpoint.numCtx,
    capability: endpoint.capability,
    codename,
    displayName: description,
    hasTools: endpoint.hasTools ?? false,
    seesImages: endpoint.seesImages ?? false,
    seesVideos: endpoint.seesVideos ?? false,
    supportsStructOutput: endpoint.supportsStructOutput ?? false,
    strictRoleAlternation: endpoint.strictRoleAlternation ?? false,
    supportsPrefixCompletion: endpoint.supportsPrefixCompletion ?? false,
    supportsAssistantPrefill: endpoint.supportsAssistantPrefill ?? false,
    verbatimToolCalling: endpoint.verbatimToolCalling ?? false,
  });
  // `model_ref_id` points at a different table per capability, so only a text id names an llms row.
  if (endpoint.capability === "text") {
    forgetCachedTextModel(existingModelRefId);
  }
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
    case "decision":
      return null;
  }
}

function toPersonalModelCapability(capability: CustomEndpointCapability): PersonalProviderCapability | null {
  switch (capability) {
    case "text":
    case "embedding":
    case "image":
    case "video":
      return capability;
    case "speech":
    case "transcription":
    case "decision":
      return null;
  }
}

async function activateServerCustomTextModel(params: {
  scope: Extract<RegistrationScope, { kind: "server" }>;
  endpoint: CustomEndpointRow;
  savedConfig: SavedProviderConfigRow | SavedProviderConfigUpsert;
  modelId: number;
}): Promise<boolean> {
  const selectedModel = await llmModelRepo.loadById(params.modelId);
  if (!selectedModel?.llm_id) {
    return false;
  }

  const promotedLlmId = selectedModel.llm_id;
  // Registration activates the endpoint immediately, but it must not discard the server-wide
  // cross-provider fallback chain that was active before registration.
  const { fallbackModelRefs, fallbackLlmIds } = buildFallbackModelPersistence(
    params.scope.baseConfig.fallback_model_refs ?? [],
    promotedLlmId,
    [params.endpoint],
  );
  const resolvedLogitBiases = resolveLogitBiasEntriesForLlm(
    params.savedConfig.llm_logit_biases ?? params.scope.baseConfig.llm_logit_biases ?? [],
    selectedModel,
  );

  const [updatedModel, updatedChat] = await Promise.all([
    configRepository.updateModelConfig(params.scope.ownerId, {
      llm_id: selectedModel.llm_id,
      api_key: params.savedConfig.api_key,
      key_version: params.savedConfig.key_version ?? 1,
      thinking_level: params.savedConfig.thinking_level ?? "auto",
      fallback_llm_ids: fallbackLlmIds,
      llm_temperature: params.savedConfig.llm_temperature ?? params.scope.baseConfig.llm_temperature ?? 1.0,
      llm_disabled_params: params.savedConfig.llm_disabled_params ?? [],
      custom_model_name: null,
      custom_endpoint_url: null,
      custom_num_ctx: null,
    }),
    configRepository.updateChatConfig(params.scope.ownerId, {
      llm_top_p: params.savedConfig.llm_top_p ?? params.scope.baseConfig.llm_top_p ?? 0.95,
      llm_top_k: params.savedConfig.llm_top_k ?? params.scope.baseConfig.llm_top_k ?? 0,
      llm_frequency_penalty:
        params.savedConfig.llm_frequency_penalty ?? params.scope.baseConfig.llm_frequency_penalty ?? 0.0,
      llm_presence_penalty:
        params.savedConfig.llm_presence_penalty ?? params.scope.baseConfig.llm_presence_penalty ?? 0.0,
      llm_min_p: params.savedConfig.llm_min_p ?? params.scope.baseConfig.llm_min_p ?? 0.05,
      llm_logit_biases: resolvedLogitBiases.entries,
      fallback_model_refs: fallbackModelRefs,
    }),
  ]);

  if (updatedModel && updatedChat && params.scope.serverDiscId) {
    invalidateTomoriStateCache(params.scope.serverDiscId);
  }

  return updatedModel && updatedChat;
}

async function activateServerCustomEndpointForCapability(params: {
  scope: Extract<RegistrationScope, { kind: "server" }>;
  endpoint: CustomEndpointRow;
  capability: CustomEndpointCapability;
  modelId: number | null;
  savedConfig: SavedProviderConfigRow | SavedProviderConfigUpsert;
}): Promise<boolean> {
  if (params.capability === "speech" || params.capability === "transcription" || params.capability === "decision") {
    return true;
  }

  if (!params.modelId) {
    return false;
  }

  if (params.capability === "text") {
    return await activateServerCustomTextModel({
      scope: params.scope,
      endpoint: params.endpoint,
      savedConfig: params.savedConfig,
      modelId: params.modelId,
    });
  }

  const updated =
    params.capability === "embedding"
      ? await configRepository.updateModelConfig(params.scope.ownerId, { embedding_model_id: params.modelId })
      : params.capability === "image"
        ? await configRepository.updateModelConfig(params.scope.ownerId, { diffusion_model_id: params.modelId })
        : await configRepository.updateModelConfig(params.scope.ownerId, { video_model_id: params.modelId });

  if (updated && params.scope.serverDiscId) {
    invalidateTomoriStateCache(params.scope.serverDiscId);
  }

  return updated;
}

async function activatePersonalCustomEndpointForCapability(params: {
  userId: number;
  provider: string;
  endpoint: CustomEndpointRow;
  capability: CustomEndpointCapability;
  modelId: number | null;
  seesImages: boolean;
}): Promise<boolean> {
  const capability = toPersonalModelCapability(params.capability);
  if (!capability) {
    return true;
  }

  if (!params.modelId) {
    return false;
  }

  if (params.capability === "text") {
    return await setPersonalTextPrimary(params.userId, params.provider, params.modelId, [params.endpoint]);
  }

  const updated = await assignPersonalCapabilityToProvider(params.userId, params.provider, capability, (row) => {
    switch (params.capability) {
      case "embedding":
        return { ...row, embedding_model_id: params.modelId };
      case "image":
        return { ...row, diffusion_model_id: params.modelId };
      case "video":
        return { ...row, video_model_id: params.modelId };
      case "text":
      case "speech":
      case "transcription":
      case "decision":
        return row;
    }
  });

  return updated;
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
      }).then((config) => {
        // Registering an endpoint both switches its capabilities on and claims them
        // for this provider, so the two arrays take the same additions.
        const claimed = capabilitiesClaimedByEndpoint(endpoint);
        return {
          ...config,
          enabled_capabilities: Array.from(new Set([...config.enabled_capabilities, ...claimed])),
          assigned_capabilities: Array.from(new Set([...config.assigned_capabilities, ...claimed])),
        };
      });
}

function capabilitiesClaimedByEndpoint(endpoint: {
  capability: CustomEndpointCapability;
  seesImages?: boolean;
}): PersonalProviderCapability[] {
  switch (endpoint.capability) {
    case "text":
      return endpoint.seesImages ? ["text", "vision"] : ["text"];
    case "embedding":
      return ["embedding"];
    case "image":
      return ["image"];
    case "video":
      return ["video"];
    default:
      return [];
  }
}

export async function registerCustomEndpoint(
  input: CustomEndpointRegistrationInput,
): Promise<CustomEndpointRegistrationResult | null> {
  const isEdit = input.editingEndpointId != null;
  if (
    input.capability === "decision" &&
    (!input.modelName?.trim() ||
      input.modelName.trim().length > 200 ||
      !["system-one", "openai-decisions"].includes(input.apiStyle) ||
      !Number.isSafeInteger(input.numCtx) ||
      (input.numCtx ?? 0) < 512 ||
      (input.numCtx ?? 0) > 10_000_000)
  ) {
    return null;
  }

  const editingRow = isEdit
    ? ((await llmProviderRepo.loadCustomEndpointsByIds([input.editingEndpointId as number]))[0] ?? null)
    : null;

  if (
    isEdit &&
    (!editingRow ||
      editingRow.capability !== input.capability ||
      (input.scope.kind === "server"
        ? editingRow.server_id !== input.scope.ownerId || editingRow.user_id != null
        : editingRow.user_id !== input.scope.ownerId || editingRow.server_id != null))
  ) {
    return null;
  }

  // The connection must exist before synthetic models and saved configs can reference its stable ID.
  const connectionId = isEdit
    ? editingRow?.connection_id
    : await llmProviderRepo.upsertCustomEndpointConnection({
        serverId: input.scope.kind === "server" ? input.scope.ownerId : null,
        userId: input.scope.kind === "personal" ? input.scope.ownerId : null,
        label: input.label,
        capability: input.capability,
        apiStyle: input.apiStyle,
        endpointUrl: input.endpointUrl,
        requiresAuth: Boolean(input.authToken?.trim()),
      });

  if (!connectionId) {
    return null;
  }

  const provider = buildCustomProviderName(connectionId);
  const existingConfig = await getExistingSavedConfig(input.scope, provider);

  // Keep activation semantics separate so edits preserve the selected row while additions claim the provider.
  const allEndpoints = await llmProviderRepo.loadCustomEndpointsByConnectionId(connectionId);
  const otherSiblings = allEndpoints.filter((endpoint) => endpoint.custom_endpoint_id !== input.editingEndpointId);
  const shouldActivateNewRegistration = !isEdit && input.capability !== "decision";
  const shouldBeDefault = isEdit ? (editingRow?.is_default ?? false) : false;

  const modelId = await writeSyntheticCapabilityModel(provider, input, editingRow?.model_ref_id ?? null);

  // Authentication belongs to the connection, so tokenless siblings inherit its credential requirement.
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
      numCtx: input.numCtx ?? null,
      requiresAuth,
      extraConfig: input.extraConfig ?? {},
      hasTools: input.hasTools ?? false,
      seesImages: input.seesImages ?? false,
      seesVideos: input.seesVideos ?? false,
      supportsStructOutput: input.supportsStructOutput ?? false,
      strictRoleAlternation: input.strictRoleAlternation ?? false,
      supportsPrefixCompletion: input.supportsPrefixCompletion ?? false,
      supportsAssistantPrefill: input.supportsAssistantPrefill ?? false,
      verbatimToolCalling: input.verbatimToolCalling ?? false,
      isDefault: shouldBeDefault,
      customEndpointId: isEdit ? input.editingEndpointId : null,
    },
    serverScope ? { serverDiscId: serverScope.serverDiscId } : {},
  );

  if (!customEndpoint) {
    return null;
  }

  const activationEndpointId = customEndpoint.custom_endpoint_id;
  if (shouldActivateNewRegistration && !activationEndpointId) {
    return null;
  }

  // New registrations activate immediately, while edits keep the existing active slot when one is already set.
  const currentActive = existingConfig ? getCapabilityModelId(existingConfig, input.capability) : null;
  const activeId = shouldActivateNewRegistration ? modelId : (currentActive ?? modelId);

  const savedConfig = await buildSavedConfigForCustomEndpoint(input.scope, provider, existingConfig, input, modelId);
  // Never assign vision_llm_id here because vision is chosen separately via /model vision without changing text.
  const nextSavedConfig = {
    ...savedConfig,
    llm_id: input.capability === "text" ? activeId : savedConfig.llm_id,
    vision_llm_id: existingConfig?.vision_llm_id ?? null,
    embedding_model_id: input.capability === "embedding" ? activeId : savedConfig.embedding_model_id,
    diffusion_model_id: input.capability === "image" ? activeId : savedConfig.diffusion_model_id,
    video_model_id: input.capability === "video" ? activeId : savedConfig.video_model_id,
    ...("fallback_model_refs" in savedConfig && input.capability === "text"
      ? {
          fallback_model_refs: prunePrimaryFallbackRefs(savedConfig.fallback_model_refs ?? [], activeId, [
            customEndpoint,
          ]),
        }
      : {}),
  };

  const writeOk = serverScope
    ? await llmProviderRepo.upsertSavedProviderConfig(
        serverScope.ownerId,
        nextSavedConfig as SavedProviderConfigUpsert,
        {
          serverDiscId: serverScope.serverDiscId,
        },
      )
    : await llmProviderRepo.upsertUserSavedProviderConfig(
        input.scope.ownerId,
        nextSavedConfig as UserSavedProviderConfigUpsert,
      );

  if (!writeOk) {
    return null;
  }

  // The chain is user-wide, so an edit prunes only when this row owns personal Text: pruning against
  // another provider's active model would drop a valid fallback entry.
  if (!serverScope && input.capability === "text" && !shouldActivateNewRegistration) {
    const rows = await llmProviderRepo.loadUserSavedProviderConfigs(input.scope.ownerId);
    const textOwner =
      getActivePersonalProviderForCapability(rows, "text") ?? getStoredPersonalProviderForCapability(rows, "text");
    if (
      textOwner?.provider === provider &&
      !(await prunePersonalFallbackChain(input.scope.ownerId, textOwner.llm_id, [...otherSiblings, customEndpoint]))
    ) {
      return null;
    }
  }

  if (input.capability === "decision") {
    log.info(
      `Decision registration ${JSON.stringify({
        provider: "custom",
        apiStyle: input.apiStyle,
        modelId,
        customEndpointId: customEndpoint.custom_endpoint_id,
        connectionId,
        outcome: isEdit ? "edited" : "saved",
      })}`,
    );
  }
  if (shouldActivateNewRegistration) {
    if (!activationEndpointId) {
      return null;
    }

    const activated = serverScope
      ? await activateServerCustomEndpointForCapability({
          scope: serverScope,
          endpoint: customEndpoint,
          capability: input.capability,
          modelId,
          savedConfig: nextSavedConfig as SavedProviderConfigUpsert,
        })
      : await activatePersonalCustomEndpointForCapability({
          userId: input.scope.ownerId,
          provider,
          endpoint: customEndpoint,
          capability: input.capability,
          modelId,
          seesImages: input.seesImages ?? false,
        });

    if (!activated) {
      return null;
    }

    const defaulted = await llmProviderRepo.setDefaultCustomEndpoint(
      {
        serverId: input.scope.kind === "server" ? input.scope.ownerId : null,
        userId: input.scope.kind === "personal" ? input.scope.ownerId : null,
        capability: input.capability,
        customEndpointId: activationEndpointId,
        clearScope: input.capability === "speech" || input.capability === "transcription" ? "capability" : "label",
      },
      serverScope ? { serverDiscId: serverScope.serverDiscId } : {},
    );

    if (!defaulted) {
      return null;
    }
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
  mode?: "design" | "clone";
}): Promise<boolean> {
  return await llmProviderRepo.setActiveCustomEndpoint(params);
}

export async function resolveCustomEndpointForProvider(
  provider: string,
  capability: CustomEndpointCapability,
  activeModelId?: number | null,
): Promise<CustomEndpointRow | null> {
  const parsed = parseCustomProvider(provider);
  if (!parsed) {
    return null;
  }

  return await llmProviderRepo.loadCustomEndpointByConnection(parsed.connectionId, capability, activeModelId);
}

// Shared by the request builder and context budget so truncation matches the sent num_ctx; the config mirror wins
// because fallback hops pin it there.
export async function resolveCustomTextEndpointTarget(tomoriState: TomoriState): Promise<{
  endpointUrl: string | null;
  modelNameHint: string | null;
  numCtx: number | null;
}> {
  const mirroredUrl = tomoriState.config.custom_endpoint_url ?? null;
  if (mirroredUrl) {
    return { endpointUrl: mirroredUrl, modelNameHint: null, numCtx: tomoriState.config.custom_num_ctx ?? null };
  }

  const textEndpoint = await resolveCustomEndpointForProvider(
    tomoriState.llm.llm_provider.toLowerCase(),
    "text",
    tomoriState.llm.llm_id,
  );
  return {
    endpointUrl: textEndpoint?.endpoint_url ?? null,
    modelNameHint: textEndpoint?.model_name ?? null,
    numCtx: tomoriState.config.custom_num_ctx ?? textEndpoint?.num_ctx ?? null,
  };
}

export async function validateCustomEndpointReachability(params: {
  apiStyle: CustomEndpointApiStyle;
  endpointUrl: string;
  apiKey?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string; credentialsWithheld?: true }> {
  const headers: Record<string, string> = {};
  if (params.apiKey?.trim()) {
    headers.Authorization = `Bearer ${params.apiKey.trim()}`;
  }

  const fetchOptions = getEndpointRemotePolicy();

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

    // Probe normalized /v1/models then /models because stored transcription URLs may already include /v1.
    if (params.apiStyle === "openai-compatible-transcription") {
      const versionedRoot = /\/v1$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
      const unversionedRoot = /\/v1$/i.test(baseUrl) ? baseUrl.replace(/\/v1$/i, "") : baseUrl;
      const response = await fetchUserRemoteUrl(`${versionedRoot}/models`, { headers }, fetchOptions);
      if (response.ok) return { ok: true };
      const fallback = await fetchUserRemoteUrl(`${unversionedRoot}/models`, { headers }, fetchOptions);
      return fallback.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status} ${response.statusText}` };
    }

    if (params.apiStyle === "ollama-native") {
      const ollamaRoot = baseUrl.replace(/\/v1$/i, "");
      const response = await fetchUserRemoteUrl(`${ollamaRoot}/api/tags`, { headers }, fetchOptions);
      return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status} ${response.statusText}` };
    }

    if (params.apiStyle === "system-one" || params.apiStyle === "openai-decisions") {
      const modelsUrl = new URL(normalizeCustomEndpointUrlForStorage(params.apiStyle, params.endpointUrl));
      modelsUrl.pathname = `${modelsUrl.pathname.replace(/\/+$/, "")}/models`;
      const response = await fetchUserRemoteUrl(
        modelsUrl,
        { headers, signal: AbortSignal.timeout(10_000) },
        fetchOptions,
      );
      // Treat 404/405 as reachable because discovery is optional on gateways and execution checks models later.
      const ok = response.ok || response.status === 404 || response.status === 405;
      await response.body?.cancel();
      log.info(
        `Decision discovery ${JSON.stringify({
          provider: "custom",
          apiStyle: params.apiStyle,
          outcome: response.ok ? "reachable" : ok ? "manual" : "rejected",
          httpStatus: response.status,
        })}`,
      );
      return ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` };
    }
    const response = await fetchUserRemoteUrl(`${baseUrl}/models`, { headers }, fetchOptions);
    return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status} ${response.statusText}` };
  } catch (error) {
    if (error instanceof RemoteUrlPolicyError && error.failureCode === "REDIRECT_CREDENTIALS_WITHHELD") {
      return { ok: false, reason: error.message, credentialsWithheld: true };
    }
    return {
      ok: false,
      reason:
        params.apiStyle === "system-one" || params.apiStyle === "openai-decisions"
          ? "Decision endpoint validation failed"
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
}

// Only these versioned-base protocols append /v1 because other styles target origin or preset paths.
const VERSIONED_API_STYLES = new Set<CustomEndpointApiStyle>([
  "openai-compatible",
  "openai-compatible-transcription",
  "ollama-native",
  "system-one",
  "openai-decisions",
]);

export function normalizeCustomEndpointUrlForStorage(apiStyle: CustomEndpointApiStyle, endpointUrl: string): string {
  const trimmed = endpointUrl.trim().replace(/\/+$/, "");
  if (!VERSIONED_API_STYLES.has(apiStyle)) {
    return trimmed;
  }

  if (/\/v1$/i.test(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (apiStyle === "system-one" || apiStyle === "openai-decisions") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/v1";
      return parsed.toString();
    }
    // Pathname "/" or "" means a bare origin; a non-root path is an explicit server route
    // that downstream adapters append to, so it is preserved as-is.
    if (parsed.pathname === "" || parsed.pathname === "/") {
      // Rebuild through the parsed URL so the prefix lands before any query string or
      // fragment: appending to the raw input would produce "...?key=secret/v1".
      parsed.pathname = "/v1";
      return parsed.toString();
    }
  } catch {
    // Malformed input: leave it untouched so URL validation reports the real problem.
  }

  return trimmed;
}

// Must look up credentials under the connection's own owner because capability-level resolution can return another
// provider's winning text key.
export async function loadCustomConnectionCredential(
  connection: CustomEndpointConnectionRow,
  failureContext?: ErrorContext,
): Promise<{ apiKey: string; usageContext: ProviderUsageContext } | null> {
  if (!connection.requires_auth) return null;
  const provider = buildCustomProviderName(connection.connection_id);
  const config =
    connection.server_id != null
      ? await llmProviderRepo.loadSavedProviderConfig(connection.server_id, provider)
      : connection.user_id != null
        ? await llmProviderRepo.loadUserSavedProviderConfig(connection.user_id, provider)
        : null;
  if (!config?.api_key) return null;
  try {
    const apiKey = await decryptApiKey(config.api_key, config.key_version ?? 1, failureContext);
    return { apiKey, usageContext: await storedCredentialUsageContext(config.api_key, apiKey) };
  } catch (error) {
    if (failureContext) throw error;
    return null;
  }
}

import type {
  CustomEndpointApiStyle,
  CustomEndpointCapability,
  CustomEndpointRow,
  SavedProviderConfigUpsert,
  SavedProviderConfigRow,
  TomoriConfigRow,
  UserSavedProviderConfigUpsert,
  UserSavedProviderConfigRow,
} from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import {
  deleteCustomEndpoint,
  deleteSavedProviderConfig,
  deleteUserSavedProviderConfig,
  upsertCustomEndpoint,
  upsertSavedProviderConfig,
  upsertUserSavedProviderConfig,
} from "@/utils/db/repositories";
import {
  loadCustomEndpoint,
  loadCustomEndpointsForServer,
  loadCustomEndpointsForUser,
  loadSavedProviderConfig,
  loadUserSavedProviderConfig,
} from "@/utils/db/repositories";
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
      baseConfig: TomoriConfigRow;
    }
  | {
      kind: "personal";
      ownerId: number;
      baseConfig: TomoriConfigRow;
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
    ? await loadSavedProviderConfig(scope.ownerId, provider)
    : await loadUserSavedProviderConfig(scope.ownerId, provider);
}

async function upsertSyntheticTextModel(provider: string, endpoint: CustomEndpointRegistrationInput): Promise<number> {
  const codename = buildSyntheticCustomModelCodename(provider, "text");
  const rows = await sql`
		INSERT INTO llms (
			llm_provider,
			llm_codename,
			has_tools,
			sees_images,
			sees_videos,
			sees_youtube,
			supports_structoutput,
			is_smartest,
			is_default,
			is_reasoning,
			is_deprecated,
			is_free,
			is_uncensored,
			llm_description,
			ja_description
		) VALUES (
			${provider},
			${codename},
			${endpoint.hasTools ?? false},
			${endpoint.seesImages ?? false},
			${endpoint.seesVideos ?? false},
			false,
			${endpoint.supportsStructOutput ?? false},
			false,
			true,
			false,
			false,
			true,
			true,
			${endpoint.displayName},
			${endpoint.displayName}
		)
		ON CONFLICT (llm_provider, llm_codename) DO UPDATE SET
			has_tools = EXCLUDED.has_tools,
			sees_images = EXCLUDED.sees_images,
			sees_videos = EXCLUDED.sees_videos,
			supports_structoutput = EXCLUDED.supports_structoutput,
			llm_description = EXCLUDED.llm_description,
			ja_description = EXCLUDED.ja_description,
			updated_at = CURRENT_TIMESTAMP
		RETURNING llm_id
	`;

  return Number(rows[0].llm_id);
}

async function upsertSyntheticEmbeddingModel(
  provider: string,
  endpoint: CustomEndpointRegistrationInput,
): Promise<number> {
  const codename = buildSyntheticCustomModelCodename(provider, "embedding");
  const rows = await sql`
		INSERT INTO embedding_models (
			provider,
			codename,
			model_family,
			model_description,
			ja_description,
			is_default,
			is_deprecated
		) VALUES (
			${provider},
			${codename},
			${`custom:${provider}`},
			${endpoint.displayName},
			${endpoint.displayName},
			true,
			false
		)
		ON CONFLICT (provider, codename) DO UPDATE SET
			provider = EXCLUDED.provider,
			model_family = EXCLUDED.model_family,
			model_description = EXCLUDED.model_description,
			ja_description = EXCLUDED.ja_description,
			is_default = EXCLUDED.is_default,
			is_deprecated = EXCLUDED.is_deprecated,
			updated_at = CURRENT_TIMESTAMP
		RETURNING embedding_model_id
	`;

  return Number(rows[0].embedding_model_id);
}

async function upsertSyntheticImageModel(provider: string, endpoint: CustomEndpointRegistrationInput): Promise<number> {
  const codename = buildSyntheticCustomModelCodename(provider, "image");
  const rows = await sql`
		INSERT INTO image_diffusion_models (
			provider,
			codename,
			model_description,
			ja_description,
			is_default,
			is_deprecated,
			is_free,
			is_uncensored
		) VALUES (
			${provider},
			${codename},
			${endpoint.displayName},
			${endpoint.displayName},
			true,
			false,
			true,
			true
		)
		ON CONFLICT (provider, codename) DO UPDATE SET
			provider = EXCLUDED.provider,
			model_description = EXCLUDED.model_description,
			ja_description = EXCLUDED.ja_description,
			is_default = EXCLUDED.is_default,
			is_deprecated = EXCLUDED.is_deprecated,
			is_free = EXCLUDED.is_free,
			is_uncensored = EXCLUDED.is_uncensored,
			updated_at = CURRENT_TIMESTAMP
		RETURNING diffusion_model_id
	`;

  return Number(rows[0].diffusion_model_id);
}

async function upsertSyntheticVideoModel(provider: string, endpoint: CustomEndpointRegistrationInput): Promise<number> {
  const codename = buildSyntheticCustomModelCodename(provider, "video");
  const rows = await sql`
		INSERT INTO video_generation_models (
			provider,
			codename,
			model_description,
			ja_description,
			is_default,
			is_deprecated,
			is_free
		) VALUES (
			${provider},
			${codename},
			${endpoint.displayName},
			${endpoint.displayName},
			true,
			false,
			true
		)
		ON CONFLICT (provider, codename) DO UPDATE SET
			provider = EXCLUDED.provider,
			model_description = EXCLUDED.model_description,
			ja_description = EXCLUDED.ja_description,
			is_default = EXCLUDED.is_default,
			is_deprecated = EXCLUDED.is_deprecated,
			is_free = EXCLUDED.is_free,
			updated_at = CURRENT_TIMESTAMP
		RETURNING video_model_id
	`;

  return Number(rows[0].video_model_id);
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
      // Speech and transcription endpoints have no synthetic model table entries.
      return;
  }
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
  serverId: number,
  capability: CustomEndpointCapability,
  modelId: number | null,
): Promise<void> {
  if (!modelId) {
    return;
  }

  switch (capability) {
    case "text":
      await sql`
				UPDATE tomori_configs
				SET llm_id = CASE WHEN llm_id = ${modelId} THEN NULL ELSE llm_id END,
				    custom_endpoint_url = CASE WHEN llm_id = ${modelId} THEN NULL ELSE custom_endpoint_url END,
				    custom_model_name = CASE WHEN llm_id = ${modelId} THEN NULL ELSE custom_model_name END,
				    custom_num_ctx = CASE WHEN llm_id = ${modelId} THEN NULL ELSE custom_num_ctx END,
				    vision_llm_id = CASE WHEN vision_llm_id = ${modelId} THEN NULL ELSE vision_llm_id END,
				    updated_at = CURRENT_TIMESTAMP
				WHERE server_id = ${serverId}
				  AND (llm_id = ${modelId} OR vision_llm_id = ${modelId})
			`;
      await sql`
				DELETE FROM channel_llm_overrides
				WHERE server_id = ${serverId}
				  AND llm_id = ${modelId}
			`;
      await sql`
				UPDATE persona_configs
				SET llm_id = NULL,
				    updated_at = CURRENT_TIMESTAMP
				WHERE llm_id = ${modelId}
				  AND tomori_id IN (
				    SELECT tomori_id
				    FROM tomoris
				    WHERE server_id = ${serverId}
				  )
			`;
      return;
    case "embedding":
      await sql`
				UPDATE tomori_configs
				SET embedding_model_id = NULL,
				    updated_at = CURRENT_TIMESTAMP
				WHERE server_id = ${serverId}
				  AND embedding_model_id = ${modelId}
			`;
      return;
    case "image":
      await sql`
				UPDATE tomori_configs
				SET diffusion_model_id = CASE WHEN diffusion_model_id = ${modelId} THEN NULL ELSE diffusion_model_id END,
				    nai_diffusion_model_id = CASE WHEN nai_diffusion_model_id = ${modelId} THEN NULL ELSE nai_diffusion_model_id END,
				    updated_at = CURRENT_TIMESTAMP
				WHERE server_id = ${serverId}
				  AND (diffusion_model_id = ${modelId} OR nai_diffusion_model_id = ${modelId})
			`;
      return;
    case "video":
      await sql`
				UPDATE tomori_configs
				SET video_model_id = NULL,
				    updated_at = CURRENT_TIMESTAMP
				WHERE server_id = ${serverId}
				  AND video_model_id = ${modelId}
			`;
      return;
  }
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
        customEndpointUrl:
          endpoint.capability === "text" ? endpoint.endpointUrl : (existingConfig?.custom_endpoint_url ?? null),
        customModelName:
          endpoint.capability === "text"
            ? (endpoint.modelName ?? endpoint.displayName)
            : (existingConfig?.custom_model_name ?? null),
        customNumCtx:
          endpoint.capability === "text" ? (endpoint.numCtx ?? null) : (existingConfig?.custom_num_ctx ?? null),
      })
    : await buildUserSavedProviderConfigFromExistingOrDefaults({
        userId: scope.ownerId,
        provider,
        apiKey: encryptionResult.encrypted,
        keyVersion: encryptionResult.version,
        baseConfig: scope.baseConfig,
        existingConfig: existingConfig as UserSavedProviderConfigRow | null,
        llmId: textModelId,
        customEndpointUrl:
          endpoint.capability === "text" ? endpoint.endpointUrl : (existingConfig?.custom_endpoint_url ?? null),
        customModelName:
          endpoint.capability === "text"
            ? (endpoint.modelName ?? endpoint.displayName)
            : (existingConfig?.custom_model_name ?? null),
        customNumCtx:
          endpoint.capability === "text" ? (endpoint.numCtx ?? null) : (existingConfig?.custom_num_ctx ?? null),
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
      ? await loadCustomEndpoint({
          serverId: input.scope.ownerId,
          label: input.label,
          capability: input.capability,
        })
      : await loadCustomEndpoint({
          userId: input.scope.ownerId,
          label: input.label,
          capability: input.capability,
        });
  const siblingEndpoints =
    input.scope.kind === "server"
      ? (await loadCustomEndpointsForServer(input.scope.ownerId)).filter(
          (endpoint) => endpoint.capability === input.capability,
        )
      : (await loadCustomEndpointsForUser(input.scope.ownerId)).filter(
          (endpoint) => endpoint.capability === input.capability,
        );
  const shouldBeDefault = existingEndpoint?.is_default ?? !siblingEndpoints.some((endpoint) => endpoint.is_default);
  const modelId = await upsertSyntheticCapabilityModel(provider, input);
  const trimmedAuthToken = input.authToken?.trim();
  const requiresAuth =
    trimmedAuthToken && trimmedAuthToken.length > 0 ? true : (existingEndpoint?.requires_auth ?? false);

  const customEndpoint = await upsertCustomEndpoint({
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
  });

  if (!customEndpoint) {
    return null;
  }

  const writeOk =
    input.scope.kind === "server"
      ? await (async () => {
          const savedConfig = (await buildSavedConfigForCustomEndpoint(
            input.scope,
            provider,
            existingConfig,
            input,
            modelId,
          )) as SavedProviderConfigUpsert;

          return await upsertSavedProviderConfig(input.scope.ownerId, {
            ...savedConfig,
            llm_id: input.capability === "text" ? modelId : savedConfig.llm_id,
            vision_llm_id: input.capability === "text" && input.seesImages ? modelId : savedConfig.vision_llm_id,
            embedding_model_id: input.capability === "embedding" ? modelId : savedConfig.embedding_model_id,
            diffusion_model_id: input.capability === "image" ? modelId : savedConfig.diffusion_model_id,
            video_model_id: input.capability === "video" ? modelId : savedConfig.video_model_id,
          });
        })()
      : await (async () => {
          const savedConfig = (await buildSavedConfigForCustomEndpoint(
            input.scope,
            provider,
            existingConfig,
            input,
            modelId,
          )) as UserSavedProviderConfigUpsert;

          return await upsertUserSavedProviderConfig(input.scope.ownerId, {
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
  try {
    const [selectedEndpoint] = await sql<[{ custom_endpoint_id: number }]>`
      SELECT custom_endpoint_id
      FROM custom_endpoints
      WHERE custom_endpoint_id = ${params.customEndpointId}
        AND server_id = ${params.serverId}
        AND user_id IS NULL
        AND capability = ${params.capability}
      LIMIT 1
    `;

    if (!selectedEndpoint) {
      return false;
    }

    await sql`
      UPDATE custom_endpoints
      SET is_default = false,
          updated_at = CURRENT_TIMESTAMP
      WHERE server_id = ${params.serverId}
        AND user_id IS NULL
        AND capability = ${params.capability}
    `;

    const result = await sql`
      UPDATE custom_endpoints
      SET is_default = true,
          updated_at = CURRENT_TIMESTAMP
      WHERE custom_endpoint_id = ${params.customEndpointId}
        AND server_id = ${params.serverId}
        AND user_id IS NULL
        AND capability = ${params.capability}
    `;

    return result.count > 0;
  } catch {
    return false;
  }
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
    ? await loadCustomEndpoint({
        serverId: parsed.ownerId,
        label: parsed.label,
        capability,
      })
    : await loadCustomEndpoint({
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
      ? await deleteCustomEndpoint({
          serverId: params.scope.ownerId,
          label: params.label,
          capability: params.capability,
        })
      : await deleteCustomEndpoint({
          userId: params.scope.ownerId,
          label: params.label,
          capability: params.capability,
        });

  if (!deleted) {
    return false;
  }

  if (params.scope.kind === "server") {
    await clearServerScopedLiveReferences(params.scope.ownerId, params.capability, modelId);
  }

  await deleteSyntheticCapabilityModel(provider, params.capability);

  const remaining =
    params.scope.kind === "server"
      ? await loadCustomEndpointsForServer(params.scope.ownerId)
      : await loadCustomEndpointsForUser(params.scope.ownerId);
  const sameProviderRemaining = remaining.filter((endpoint) => endpoint.label === params.label);

  if (sameProviderRemaining.length === 0) {
    if (params.scope.kind === "server") {
      await deleteSavedProviderConfig(params.scope.ownerId, provider);
    } else {
      await deleteUserSavedProviderConfig(params.scope.ownerId, provider);
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
          custom_endpoint_url: params.capability === "text" ? null : existingConfig.custom_endpoint_url,
          custom_model_name: params.capability === "text" ? null : existingConfig.custom_model_name,
          custom_num_ctx: params.capability === "text" ? null : existingConfig.custom_num_ctx,
        }
      : {
          ...(existingConfig as UserSavedProviderConfigRow),
          llm_id: params.capability === "text" ? null : existingConfig.llm_id,
          vision_llm_id: params.capability === "text" ? null : existingConfig.vision_llm_id,
          embedding_model_id: params.capability === "embedding" ? null : existingConfig.embedding_model_id,
          diffusion_model_id: params.capability === "image" ? null : existingConfig.diffusion_model_id,
          video_model_id: params.capability === "video" ? null : existingConfig.video_model_id,
          custom_endpoint_url: params.capability === "text" ? null : existingConfig.custom_endpoint_url,
          custom_model_name: params.capability === "text" ? null : existingConfig.custom_model_name,
          custom_num_ctx: params.capability === "text" ? null : existingConfig.custom_num_ctx,
        };

  if (params.scope.kind === "server") {
    await upsertSavedProviderConfig(params.scope.ownerId, nextConfig as SavedProviderConfigRow);
  } else {
    await upsertUserSavedProviderConfig(params.scope.ownerId, nextConfig as UserSavedProviderConfigRow);
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
      ? await loadCustomEndpointsForServer(parsed.ownerId)
      : await loadCustomEndpointsForUser(parsed.ownerId);

  const matchingEndpoints = registeredEndpoints.filter((endpoint) => endpoint.label === parsed.label);

  for (const endpoint of matchingEndpoints) {
    await deleteCustomEndpoint(
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

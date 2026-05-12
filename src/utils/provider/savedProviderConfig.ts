import type {
  CustomEndpointCapability,
  SavedProviderConfigRow,
  SavedProviderConfigUpsert,
  TomoriConfigRow,
  TomoriState,
  UserSavedProviderConfigRow,
  UserSavedProviderConfigUpsert,
} from "@/types/db/schema";
import {
  loadDefaultDiffusionModelForProvider,
  loadDefaultEmbeddingModelForProvider,
  loadDefaultModelForProvider,
  loadDefaultVideoGenerationModelForProvider,
  loadDefaultVisionModelForProvider,
  loadCustomEndpoint,
  loadCustomEndpointsForServer,
  loadCustomEndpointsForUser,
  loadSavedProviderConfigs,
  loadUserSavedProviderConfigs,
} from "@/utils/db/repositories";
import { isCustomProvider, parseCustomProvider } from "@/utils/provider/customProviderUtils";
import {
  getStaticProviderInfo,
  supportsEmbeddingCapability,
  supportsImageCapability,
  supportsVideoCapability,
  supportsVisionCapability,
} from "@/utils/provider/providerInfoRegistry";

export type SavedProviderCapability = "text" | "embedding" | "image" | "video" | "vision";

export interface ProviderDefaultSelectionIds {
  llm_id: number | null;
  diffusion_model_id: number | null;
  embedding_model_id: number | null;
  nai_diffusion_model_id: number | null;
  video_model_id: number | null;
  vision_llm_id: number | null;
}

export function buildSavedProviderSnapshotFromTomoriState(tomoriState: TomoriState): SavedProviderConfigUpsert {
  return {
    server_id: tomoriState.server_id,
    provider: tomoriState.llm.llm_provider.toLowerCase(),
    api_key: tomoriState.config.api_key,
    key_version: tomoriState.config.key_version ?? 1,
    llm_id: tomoriState.config.llm_id,
    diffusion_model_id: tomoriState.config.diffusion_model_id ?? null,
    embedding_model_id: tomoriState.config.embedding_model_id ?? null,
    nai_diffusion_model_id: tomoriState.config.nai_diffusion_model_id ?? null,
    video_model_id: tomoriState.config.video_model_id ?? null,
    vision_llm_id: tomoriState.config.vision_llm_id ?? null,
    nai_preset_name: tomoriState.config.nai_preset_name ?? null,
    llm_temperature: tomoriState.config.llm_temperature,
    llm_top_p: tomoriState.config.llm_top_p,
    llm_top_k: tomoriState.config.llm_top_k,
    llm_frequency_penalty: tomoriState.config.llm_frequency_penalty,
    llm_presence_penalty: tomoriState.config.llm_presence_penalty,
    llm_min_p: tomoriState.config.llm_min_p,
    llm_disabled_params: tomoriState.config.llm_disabled_params ?? [],
    llm_logit_biases: tomoriState.config.llm_logit_biases ?? [],
    custom_endpoint_url: tomoriState.config.custom_endpoint_url ?? null,
    custom_model_name: tomoriState.config.custom_model_name ?? null,
    custom_num_ctx: tomoriState.config.custom_num_ctx ?? null,
    thinking_level: tomoriState.config.thinking_level,
    fallback_llm_ids: tomoriState.config.fallback_llm_ids ?? [],
    fallback_model_refs: tomoriState.config.fallback_model_refs ?? [],
    channel_llm_overrides: [],
    persona_llm_overrides: [],
  };
}

export async function loadProviderDefaultSelectionIds(provider: string): Promise<ProviderDefaultSelectionIds> {
  const normalizedProvider = provider.toLowerCase();

  if (isCustomProvider(normalizedProvider)) {
    return {
      llm_id: null,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      video_model_id: null,
      vision_llm_id: null,
    };
  }

  const [defaultTextModel, defaultEmbeddingModel, defaultDiffusionModel, defaultVideoModel, defaultVisionModel] =
    await Promise.all([
      loadDefaultModelForProvider(normalizedProvider),
      loadDefaultEmbeddingModelForProvider(normalizedProvider),
      loadDefaultDiffusionModelForProvider(normalizedProvider),
      loadDefaultVideoGenerationModelForProvider(normalizedProvider),
      loadDefaultVisionModelForProvider(normalizedProvider),
    ]);

  const imageGenerationStyle = getStaticProviderInfo(normalizedProvider)?.featureSupport.imageGeneration ?? "none";

  return {
    llm_id: defaultTextModel?.llm_id ?? null,
    diffusion_model_id:
      imageGenerationStyle === "chat-completion" ? (defaultDiffusionModel?.diffusion_model_id ?? null) : null,
    embedding_model_id: defaultEmbeddingModel?.embedding_model_id ?? null,
    nai_diffusion_model_id:
      imageGenerationStyle === "nai-pipeline" ? (defaultDiffusionModel?.diffusion_model_id ?? null) : null,
    video_model_id: defaultVideoModel?.video_model_id ?? null,
    vision_llm_id: defaultVisionModel?.llm_id ?? null,
  };
}

export async function buildSavedProviderConfigFromExistingOrDefaults(params: {
  serverId: number;
  provider: string;
  apiKey: Buffer | null;
  keyVersion: number;
  baseConfig: TomoriConfigRow;
  existingConfig?: SavedProviderConfigRow | null;
  llmId?: number | null;
  customEndpointUrl?: string | null;
  customModelName?: string | null;
  customNumCtx?: number | null;
}): Promise<SavedProviderConfigUpsert> {
  const normalizedProvider = params.provider.toLowerCase();
  const existingConfig = params.existingConfig ?? null;
  const defaults = existingConfig ? null : await loadProviderDefaultSelectionIds(normalizedProvider);

  return {
    server_id: params.serverId,
    provider: normalizedProvider,
    api_key: params.apiKey,
    key_version: params.keyVersion,
    llm_id: params.llmId ?? existingConfig?.llm_id ?? defaults?.llm_id ?? null,
    diffusion_model_id: existingConfig?.diffusion_model_id ?? defaults?.diffusion_model_id ?? null,
    embedding_model_id: existingConfig?.embedding_model_id ?? defaults?.embedding_model_id ?? null,
    nai_diffusion_model_id: existingConfig?.nai_diffusion_model_id ?? defaults?.nai_diffusion_model_id ?? null,
    video_model_id: existingConfig?.video_model_id ?? defaults?.video_model_id ?? null,
    vision_llm_id: existingConfig?.vision_llm_id ?? defaults?.vision_llm_id ?? null,
    nai_preset_name: existingConfig?.nai_preset_name ?? null,
    llm_temperature: existingConfig?.llm_temperature ?? params.baseConfig.llm_temperature,
    llm_top_p: existingConfig?.llm_top_p ?? params.baseConfig.llm_top_p,
    llm_top_k: existingConfig?.llm_top_k ?? params.baseConfig.llm_top_k,
    llm_frequency_penalty: existingConfig?.llm_frequency_penalty ?? params.baseConfig.llm_frequency_penalty,
    llm_presence_penalty: existingConfig?.llm_presence_penalty ?? params.baseConfig.llm_presence_penalty,
    llm_min_p: existingConfig?.llm_min_p ?? params.baseConfig.llm_min_p,
    llm_disabled_params: existingConfig?.llm_disabled_params ?? params.baseConfig.llm_disabled_params ?? [],
    llm_logit_biases: existingConfig?.llm_logit_biases ?? params.baseConfig.llm_logit_biases ?? [],
    custom_endpoint_url: params.customEndpointUrl ?? existingConfig?.custom_endpoint_url ?? null,
    custom_model_name: params.customModelName ?? existingConfig?.custom_model_name ?? null,
    custom_num_ctx: params.customNumCtx ?? existingConfig?.custom_num_ctx ?? null,
    thinking_level: existingConfig?.thinking_level ?? params.baseConfig.thinking_level,
    fallback_llm_ids: existingConfig?.fallback_llm_ids ?? [],
    fallback_model_refs: existingConfig?.fallback_model_refs ?? [],
    channel_llm_overrides: existingConfig?.channel_llm_overrides ?? [],
    persona_llm_overrides: existingConfig?.persona_llm_overrides ?? [],
  };
}

export async function buildUserSavedProviderConfigFromExistingOrDefaults(params: {
  userId: number;
  provider: string;
  apiKey: Buffer | null;
  keyVersion: number;
  baseConfig: TomoriConfigRow;
  existingConfig?: UserSavedProviderConfigRow | null;
  llmId?: number | null;
  customEndpointUrl?: string | null;
  customModelName?: string | null;
  customNumCtx?: number | null;
  enabledCapabilities?: Array<"text" | "embedding" | "image" | "video" | "vision">;
}): Promise<UserSavedProviderConfigUpsert> {
  const normalizedProvider = params.provider.toLowerCase();
  const existingConfig = params.existingConfig ?? null;
  const defaults = existingConfig ? null : await loadProviderDefaultSelectionIds(normalizedProvider);

  return {
    user_id: params.userId,
    provider: normalizedProvider,
    api_key: params.apiKey,
    key_version: params.keyVersion,
    llm_id: params.llmId ?? existingConfig?.llm_id ?? defaults?.llm_id ?? null,
    diffusion_model_id: existingConfig?.diffusion_model_id ?? defaults?.diffusion_model_id ?? null,
    embedding_model_id: existingConfig?.embedding_model_id ?? defaults?.embedding_model_id ?? null,
    nai_diffusion_model_id: existingConfig?.nai_diffusion_model_id ?? defaults?.nai_diffusion_model_id ?? null,
    video_model_id: existingConfig?.video_model_id ?? defaults?.video_model_id ?? null,
    vision_llm_id: existingConfig?.vision_llm_id ?? defaults?.vision_llm_id ?? null,
    nai_preset_name: existingConfig?.nai_preset_name ?? null,
    llm_temperature: existingConfig?.llm_temperature ?? params.baseConfig.llm_temperature,
    llm_top_p: existingConfig?.llm_top_p ?? params.baseConfig.llm_top_p,
    llm_top_k: existingConfig?.llm_top_k ?? params.baseConfig.llm_top_k,
    llm_frequency_penalty: existingConfig?.llm_frequency_penalty ?? params.baseConfig.llm_frequency_penalty,
    llm_presence_penalty: existingConfig?.llm_presence_penalty ?? params.baseConfig.llm_presence_penalty,
    llm_min_p: existingConfig?.llm_min_p ?? params.baseConfig.llm_min_p,
    llm_disabled_params: existingConfig?.llm_disabled_params ?? params.baseConfig.llm_disabled_params ?? [],
    llm_logit_biases: existingConfig?.llm_logit_biases ?? params.baseConfig.llm_logit_biases ?? [],
    custom_endpoint_url: params.customEndpointUrl ?? existingConfig?.custom_endpoint_url ?? null,
    custom_model_name: params.customModelName ?? existingConfig?.custom_model_name ?? null,
    custom_num_ctx: params.customNumCtx ?? existingConfig?.custom_num_ctx ?? null,
    thinking_level: existingConfig?.thinking_level ?? params.baseConfig.thinking_level,
    enabled_capabilities: params.enabledCapabilities ?? existingConfig?.enabled_capabilities ?? [],
    fallback_llm_ids: existingConfig?.fallback_llm_ids ?? [],
    fallback_model_refs: existingConfig?.fallback_model_refs ?? [],
  };
}

function mapSavedCapabilityToCustomEndpointCapability(
  capability: SavedProviderCapability,
): CustomEndpointCapability | null {
  switch (capability) {
    case "text":
    case "embedding":
    case "image":
    case "video":
      return capability;
    case "vision":
      return "text";
    default:
      return null;
  }
}

async function hasRegisteredCustomEndpointCapability(
  provider: string,
  capability: SavedProviderCapability,
): Promise<boolean> {
  const parsed = parseCustomProvider(provider);
  const endpointCapability = mapSavedCapabilityToCustomEndpointCapability(capability);

  if (!parsed || !endpointCapability) {
    return false;
  }

  const endpoint =
    parsed.scope === "server"
      ? await loadCustomEndpoint({
          serverId: parsed.ownerId,
          label: parsed.label,
          capability: endpointCapability,
        })
      : await loadCustomEndpoint({
          userId: parsed.ownerId,
          label: parsed.label,
          capability: endpointCapability,
        });

  if (!endpoint) {
    return false;
  }

  return capability === "vision" ? endpoint.sees_images : true;
}

export async function hasRegisteredCustomProvider(provider: string): Promise<boolean> {
  const parsed = parseCustomProvider(provider);
  if (!parsed || parsed.ownerId === null) {
    return false;
  }

  const registeredEndpoints =
    parsed.scope === "server"
      ? await loadCustomEndpointsForServer(parsed.ownerId)
      : await loadCustomEndpointsForUser(parsed.ownerId);

  return registeredEndpoints.some((endpoint) => endpoint.label === parsed.label);
}

export async function loadSavedProvidersForCapability(
  serverId: number,
  capability: SavedProviderCapability,
): Promise<SavedProviderConfigRow[]> {
  const savedConfigs = await loadSavedProviderConfigs(serverId);
  const registeredVisibility = await Promise.all(
    savedConfigs.map(async (config) => {
      if (!isCustomProvider(config.provider)) {
        return true;
      }

      return await hasRegisteredCustomEndpointCapability(config.provider, capability);
    }),
  );

  return savedConfigs.filter((config, index) => {
    if (!registeredVisibility[index]) {
      return false;
    }

    if (isCustomProvider(config.provider)) {
      switch (capability) {
        case "text":
          return config.llm_id !== null;
        case "embedding":
          return config.embedding_model_id !== null;
        case "image":
          return config.diffusion_model_id !== null || config.nai_diffusion_model_id !== null;
        case "video":
          return config.video_model_id !== null;
        case "vision":
          return config.vision_llm_id !== null;
        default:
          return false;
      }
    }

    switch (capability) {
      case "text":
        return true;
      case "embedding":
        return supportsEmbeddingCapability(config.provider);
      case "image":
        return supportsImageCapability(config.provider);
      case "video":
        return supportsVideoCapability(config.provider);
      case "vision":
        return supportsVisionCapability(config.provider);
      default:
        return false;
    }
  });
}

export async function loadUserSavedProvidersForCapability(
  userId: number,
  capability: SavedProviderCapability,
): Promise<UserSavedProviderConfigRow[]> {
  const savedConfigs = await loadUserSavedProviderConfigs(userId);
  const registeredVisibility = await Promise.all(
    savedConfigs.map(async (config) => {
      if (!isCustomProvider(config.provider)) {
        return true;
      }

      return await hasRegisteredCustomEndpointCapability(config.provider, capability);
    }),
  );

  return savedConfigs.filter((config, index) => {
    if (!registeredVisibility[index]) {
      return false;
    }

    if (isCustomProvider(config.provider)) {
      switch (capability) {
        case "text":
          return config.llm_id !== null;
        case "embedding":
          return config.embedding_model_id !== null;
        case "image":
          return config.diffusion_model_id !== null || config.nai_diffusion_model_id !== null;
        case "video":
          return config.video_model_id !== null;
        case "vision":
          return config.vision_llm_id !== null;
        default:
          return false;
      }
    }

    switch (capability) {
      case "text":
        return true;
      case "embedding":
        return supportsEmbeddingCapability(config.provider);
      case "image":
        return supportsImageCapability(config.provider);
      case "video":
        return supportsVideoCapability(config.provider);
      case "vision":
        return supportsVisionCapability(config.provider);
      default:
        return false;
    }
  });
}

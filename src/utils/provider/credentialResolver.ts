import {
  findProviderRequestDeniedError,
  getProviderRequestFailureCopy,
  type ProviderUsageContext,
} from "@/utils/provider/providerUsage";
import { localizer } from "@/utils/text/localizer";
import type {
  LlmRow,
  CustomEndpointRow,
  PersonalProviderCapability,
  SavedProviderConfigRow,
  AssembledServerConfig,
  UserSavedProviderConfigRow,
} from "@/types/db/schema";
import { personalProviderCapabilitySchema } from "@/types/db/schema";
import { configRepository, llmModelRepo, llmProviderRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { resolveCustomEndpointForProvider } from "@/utils/provider/customEndpointService";
import { decryptApiKey } from "@/utils/security/crypto";
import { CUSTOM_ENDPOINT_PLACEHOLDER_KEY } from "@/utils/provider/legacyCustomProvider";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import { getStaticProviderInfo } from "@/utils/provider/providerInfoRegistry";
import type { GenerationModelSelection } from "@/types/provider/generationModels";
import { GenerationModelUnavailableError, validateGenerationModelSelection } from "@/utils/provider/generationModels";
import {
  findProviderOption,
  findProviderOptionByActiveProvider,
  providerOptionCapabilityForPersonal,
} from "@/utils/provider/providerOptionRegistry";

export type Capability = "text" | "embedding" | "image-standard" | "image-nai" | "video" | "vision";

export interface ResolvedCredentials {
  usageContext?: ProviderUsageContext;
  provider: string;
  apiKey: string;
  keyVersion: number;
  savedConfig: SavedProviderConfigRow | UserSavedProviderConfigRow;
  source: "server" | "personal";
  customEndpoint?: CustomEndpointRow;
  apiStyle?: string;
  modelId?: number;
}

interface ResolverOptions {
  userId?: number | null;
  textModel?: LlmRow;
  modelSelection?: GenerationModelSelection | null;
}

type CapabilityConfigColumns = Pick<
  AssembledServerConfig,
  | "llm_id"
  | "embedding_model_id"
  | "diffusion_model_id"
  | "nai_diffusion_model_id"
  | "video_model_id"
  | "vision_llm_id"
  | "user_byok_mode"
>;

export class CredentialUnavailableError extends Error {
  constructor(
    public provider: string,
    public capability: Capability,
    public reason: "no_saved_config" | "decryption_failed" | "placeholder_key" | "missing_model_id",
    public source: "server" | "personal" = "server",
  ) {
    super(`No usable credentials for ${provider} (${capability}, ${source}): ${reason}`);
    this.name = "CredentialUnavailableError";
  }
}

export class PersonalProviderRequiredError extends Error {
  constructor(public capability: Capability) {
    super(`A personal provider is required for ${capability}`);
    this.name = "PersonalProviderRequiredError";
  }
}

export function getCapabilityCredentialFailureCopy(
  error: unknown,
  locale: string,
): { titleKey: string; description: string } | null {
  const denied = findProviderRequestDeniedError(error);
  if (denied) return getProviderRequestFailureCopy(denied, locale);
  const keys =
    error instanceof PersonalProviderRequiredError
      ? {
          titleKey: "general.errors.personal_provider_required_title",
          descriptionKey: "general.errors.personal_provider_required_description",
        }
      : error instanceof CredentialUnavailableError
        ? error.source === "personal"
          ? {
              titleKey: "general.errors.personal_provider_credentials_error_title",
              descriptionKey: "general.errors.personal_provider_credentials_error_description",
            }
          : error.reason === "decryption_failed"
            ? {
                titleKey: "general.errors.api_key_error_title",
                descriptionKey: "general.errors.api_key_error_description",
              }
            : {
                titleKey: "general.errors.api_key_missing_title",
                descriptionKey: "general.errors.api_key_missing_description",
              }
        : null;
  return keys ? { titleKey: keys.titleKey, description: localizer(locale, keys.descriptionKey) } : null;
}

function mapCapabilityToPersonalCapability(capability: Capability): PersonalProviderCapability {
  switch (capability) {
    case "text":
      return "text";
    case "embedding":
      return "embedding";
    case "image-standard":
      return "image";
    case "image-nai":
      return "image_nai";
    case "video":
      return "video";
    case "vision":
      return "vision";
  }
}

function getCapabilityModelId(
  savedConfig: SavedProviderConfigRow | UserSavedProviderConfigRow,
  capability: Capability,
): number | null {
  switch (capability) {
    case "text":
      return savedConfig.llm_id ?? null;
    case "embedding":
      return savedConfig.embedding_model_id ?? null;
    case "image-standard":
      return savedConfig.diffusion_model_id ?? null;
    case "image-nai":
      return savedConfig.nai_diffusion_model_id ?? null;
    case "video":
      return savedConfig.video_model_id ?? null;
    case "vision":
      return savedConfig.vision_llm_id ?? null;
  }
}

/**
 * Reads the active model id for a capability from live server config columns.
 *
 * Used to tell the custom-endpoint resolver which specific model is active (server scope), so the
 * correct endpoint row is chosen when a label hosts several models of the same capability.
 */
function capabilityModelIdFromColumns(config: CapabilityConfigColumns | null, capability: Capability): number | null {
  if (!config) {
    return null;
  }
  switch (capability) {
    case "text":
      return config.llm_id ?? null;
    case "embedding":
      return config.embedding_model_id ?? null;
    case "image-standard":
      return config.diffusion_model_id ?? null;
    case "image-nai":
      return config.nai_diffusion_model_id ?? null;
    case "video":
      return config.video_model_id ?? null;
    case "vision":
      return config.vision_llm_id ?? null;
  }
}

export function getResolvedCapabilityModelId(
  resolved: Pick<ResolvedCredentials, "savedConfig" | "source" | "modelId">,
  capability: Capability,
): number | null {
  if (resolved.modelId !== undefined) return resolved.modelId;
  if (resolved.source === "server") {
    return null;
  }
  return getCapabilityModelId(resolved.savedConfig, capability);
}

async function loadCapabilityConfig(serverId: number): Promise<CapabilityConfigColumns | null> {
  return configRepository.loadModelCapabilityIds(serverId);
}

function providerSupportsCapability(provider: string, capability: Capability): boolean {
  if (isCustomProvider(provider)) {
    return capability !== "image-nai";
  }
  const info = getStaticProviderInfo(provider);
  if (!info) {
    return true;
  }
  if (capability === "image-standard") {
    return info.featureSupport.imageGeneration === "chat-completion";
  }
  if (capability === "image-nai") {
    return info.featureSupport.imageGeneration === "nai-pipeline";
  }
  return true;
}

async function resolveProviderForCapability(
  config: CapabilityConfigColumns | null,
  capability: Capability,
): Promise<string> {
  if (!config) {
    throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
  }

  switch (capability) {
    case "text": {
      if (!config.llm_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const llm = await llmModelRepo.loadById(config.llm_id);
      if (!llm?.llm_provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return llm.llm_provider.toLowerCase();
    }
    case "embedding": {
      if (!config.embedding_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const embModel = await llmModelRepo.loadEmbeddingModelById(config.embedding_model_id);
      if (!embModel?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return String(embModel.provider).toLowerCase();
    }
    case "image-standard": {
      if (!config.diffusion_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const diffModel = await llmModelRepo.loadDiffusionModelById(config.diffusion_model_id);
      if (!diffModel?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const provider = String(diffModel.provider).toLowerCase();
      if (!providerSupportsCapability(provider, capability)) {
        throw new CredentialUnavailableError(provider, capability, "missing_model_id");
      }
      return provider;
    }
    case "image-nai": {
      if (!config.nai_diffusion_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const naiModel = await llmModelRepo.loadDiffusionModelById(config.nai_diffusion_model_id);
      if (!naiModel?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const provider = String(naiModel.provider).toLowerCase();
      if (!providerSupportsCapability(provider, capability)) {
        throw new CredentialUnavailableError(provider, capability, "missing_model_id");
      }
      return provider;
    }
    case "video": {
      if (!config.video_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const videoModel = await llmModelRepo.loadVideoGenerationModelById(config.video_model_id);
      if (!videoModel?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return String(videoModel.provider).toLowerCase();
    }
    case "vision": {
      if (!config.vision_llm_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const visionLlm = await llmModelRepo.loadById(config.vision_llm_id);
      if (!visionLlm?.llm_provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return visionLlm.llm_provider.toLowerCase();
    }
  }
}

async function resolveSavedCredentials(
  savedConfig: SavedProviderConfigRow | UserSavedProviderConfigRow,
  provider: string,
  capability: Capability,
  source: "server" | "personal",
  contextLabel: string,
  activeModelId?: number | null,
): Promise<ResolvedCredentials> {
  const option = findProviderOption(provider);
  if (option) {
    const modelId = activeModelId ?? getCapabilityModelId(savedConfig, capability);
    const optionCapability = providerOptionCapabilityForPersonal(mapCapabilityToPersonalCapability(capability));
    const scope = {
      kind: source,
      ownerId: "user_id" in savedConfig ? savedConfig.user_id : savedConfig.server_id,
    };
    if (
      modelId === null ||
      optionCapability === null ||
      !option.capabilities.includes(optionCapability) ||
      !(await option.availability(scope)).eligible ||
      !option.selection.resolveCredentials
    )
      throw new CredentialUnavailableError(provider, capability, "no_saved_config", source);
    const credentials = await option.selection.resolveCredentials({ scope, capability: optionCapability, modelId });
    if (!credentials) throw new CredentialUnavailableError(provider, capability, "no_saved_config", source);
    const settings = credentials.savedProvider
      ? source === "personal"
        ? await llmProviderRepo.loadUserSavedProviderConfig(scope.ownerId, credentials.savedProvider)
        : await llmProviderRepo.loadSavedProviderConfig(scope.ownerId, credentials.savedProvider)
      : savedConfig;
    if (!settings) throw new CredentialUnavailableError(provider, capability, "no_saved_config", source);
    return {
      provider: option.catalogProvider,
      apiKey: credentials.apiKey,
      keyVersion: settings.key_version || 1,
      savedConfig: settings,
      source,
      modelId,
      usageContext: credentials.usageContext,
    };
  }
  const customEndpointCapability =
    capability === "image-standard"
      ? "image"
      : capability === "vision"
        ? "text"
        : capability === "image-nai"
          ? null
          : capability;
  // Pass the active model id so the right endpoint row is chosen when several models share a
  // label+capability; resolution falls back to the label's default when no id matches.
  const customEndpoint =
    isCustomProvider(provider) && customEndpointCapability
      ? await resolveCustomEndpointForProvider(provider, customEndpointCapability, activeModelId)
      : null;

  if (!savedConfig.api_key) {
    throw new CredentialUnavailableError(provider, capability, "no_saved_config", source);
  }

  let decryptedKey: string;
  try {
    decryptedKey = await decryptApiKey(savedConfig.api_key, savedConfig.key_version || 1);
  } catch (error) {
    log.warn(`Failed to decrypt credentials for provider ${provider} (${capability}) on ${contextLabel}`, error);
    throw new CredentialUnavailableError(provider, capability, "decryption_failed", source);
  }

  if (!decryptedKey || decryptedKey === CUSTOM_ENDPOINT_PLACEHOLDER_KEY) {
    if (customEndpoint && customEndpoint.requires_auth === false) {
      return {
        provider,
        modelId: activeModelId ?? undefined,
        apiKey: "",
        keyVersion: savedConfig.key_version || 1,
        savedConfig,
        source,
        customEndpoint,
        apiStyle: customEndpoint.api_style,
      };
    }
    throw new CredentialUnavailableError(provider, capability, "placeholder_key", source);
  }

  return {
    provider,
    modelId: activeModelId ?? undefined,
    apiKey: decryptedKey,
    keyVersion: savedConfig.key_version || 1,
    savedConfig,
    source,
    customEndpoint: customEndpoint ?? undefined,
    apiStyle: customEndpoint?.api_style,
  };
}

export async function resolvePersonalCapabilityCredentials(
  userId: number,
  capability: Capability,
): Promise<ResolvedCredentials | null> {
  const personalCapability = mapCapabilityToPersonalCapability(capability);
  personalProviderCapabilitySchema.parse(personalCapability);

  const qualifyingRows = (await llmProviderRepo.loadUserSavedProviderConfigs(userId))
    .filter((row) => row.enabled_capabilities.includes(personalCapability))
    .filter((row) => getCapabilityModelId(row, capability) !== null)
    .filter((row) => providerSupportsCapability(row.provider.toLowerCase(), capability))
    .sort((left, right) => left.provider.localeCompare(right.provider));

  if (qualifyingRows.length === 0) {
    return null;
  }

  if (qualifyingRows.length > 1) {
    log.warn(
      `Multiple personal providers matched user ${userId} capability ${capability}. Falling back to ${qualifyingRows[0].provider}.`,
    );
  }

  const savedConfig = qualifyingRows[0];
  return await resolveSavedCredentials(
    savedConfig,
    savedConfig.provider.toLowerCase(),
    capability,
    "personal",
    `user ${userId}`,
    getCapabilityModelId(savedConfig, capability),
  );
}

export async function resolveCapabilityCredentials(
  serverId: number,
  capability: Capability,
  options?: ResolverOptions,
): Promise<ResolvedCredentials> {
  const userId = options?.userId ?? null;
  const capabilityConfig = await loadCapabilityConfig(serverId);

  if (options?.modelSelection) {
    const selection = options.modelSelection;
    const expectedKind = capability === "image-standard" ? "image" : capability;
    if (selection.kind !== expectedKind) throw new GenerationModelUnavailableError();
    await validateGenerationModelSelection(serverId, userId, selection);
    const savedConfig =
      selection.source === "personal" && userId !== null
        ? await llmProviderRepo.loadUserSavedProviderConfig(userId, selection.provider)
        : selection.source === "server"
          ? await llmProviderRepo.loadSavedProviderConfig(serverId, selection.provider)
          : null;
    if (!savedConfig) throw new GenerationModelUnavailableError();
    const resolved = await resolveSavedCredentials(
      savedConfig,
      selection.provider,
      capability,
      selection.source,
      selection.source === "server" ? `server ${serverId}` : `user ${userId}`,
      selection.modelId,
    );
    if (isCustomProvider(selection.provider) && resolved.customEndpoint?.model_ref_id !== selection.modelId)
      throw new GenerationModelUnavailableError();
    return resolved;
  }

  if (userId !== null) {
    const personalResolved = await resolvePersonalCapabilityCredentials(userId, capability);
    if (personalResolved) {
      return personalResolved;
    }

    if (capabilityConfig?.user_byok_mode) {
      throw new PersonalProviderRequiredError(capability);
    }
  }

  const provider =
    options?.textModel?.llm_provider.toLowerCase() ??
    (await resolveProviderForCapability(capabilityConfig, capability));
  const optionCapability = providerOptionCapabilityForPersonal(mapCapabilityToPersonalCapability(capability));
  const owner = optionCapability
    ? findProviderOptionByActiveProvider(
        provider,
        { kind: "server", ownerId: serverId, modelConfig: capabilityConfig },
        optionCapability,
      )
    : undefined;
  const credentialProvider = owner?.value ?? provider;
  const savedConfig = await llmProviderRepo.loadSavedProviderConfig(serverId, credentialProvider);

  if (!savedConfig) {
    throw new CredentialUnavailableError(provider, capability, "no_saved_config", "server");
  }

  return await resolveSavedCredentials(
    savedConfig,
    credentialProvider,
    capability,
    "server",
    `server ${serverId}`,
    options?.textModel?.llm_id ?? capabilityModelIdFromColumns(capabilityConfig, capability),
  );
}

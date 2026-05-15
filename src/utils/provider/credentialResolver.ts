import type {
  CustomEndpointRow,
  PersonalProviderCapability,
  SavedProviderConfigRow,
  TomoriConfigRow,
  UserSavedProviderConfigRow,
} from "@/types/db/schema";
import { personalProviderCapabilitySchema, tomoriConfigSchema } from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { llmProviderRepo } from "@/utils/db/repositories";
import { log } from "@/utils/misc/logger";
import { resolveCustomEndpointForProvider } from "@/utils/provider/customEndpointService";
import { decryptApiKey } from "@/utils/security/crypto";
import { CUSTOM_ENDPOINT_PLACEHOLDER_KEY } from "@/utils/discord/customProviderModal";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";

export type Capability = "text" | "embedding" | "image-standard" | "image-nai" | "video" | "vision";

export interface ResolvedCredentials {
  provider: string;
  apiKey: string;
  keyVersion: number;
  savedConfig: SavedProviderConfigRow | UserSavedProviderConfigRow;
  source: "server" | "personal";
  customEndpoint?: CustomEndpointRow;
  apiStyle?: string;
}

interface ResolverOptions {
  userId?: number | null;
}

type CapabilityConfigColumns = Pick<
  TomoriConfigRow,
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

function mapCapabilityToPersonalCapability(capability: Capability): PersonalProviderCapability {
  switch (capability) {
    case "text":
      return "text";
    case "embedding":
      return "embedding";
    case "image-standard":
    case "image-nai":
      return "image";
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

export function getResolvedCapabilityModelId(
  resolved: Pick<ResolvedCredentials, "savedConfig" | "source">,
  capability: Capability,
): number | null {
  if (resolved.source === "server") {
    return null;
  }
  return getCapabilityModelId(resolved.savedConfig, capability);
}

async function loadCapabilityConfig(serverId: number): Promise<CapabilityConfigColumns | null> {
  const [row] = await sql`
		SELECT
			llm_id,
			embedding_model_id,
			diffusion_model_id,
			nai_diffusion_model_id,
			video_model_id,
			vision_llm_id,
			user_byok_mode
		FROM tomori_configs
		WHERE server_id = ${serverId}
		LIMIT 1
	`;

  if (!row) {
    return null;
  }

  const parsed = tomoriConfigSchema
    .pick({
      llm_id: true,
      embedding_model_id: true,
      diffusion_model_id: true,
      nai_diffusion_model_id: true,
      video_model_id: true,
      vision_llm_id: true,
      user_byok_mode: true,
    })
    .safeParse(row);

  if (!parsed.success) {
    log.warn(`Failed to validate capability config for server ${serverId}: ${parsed.error.message}`);
    return null;
  }

  return parsed.data;
}

async function resolveProviderForCapability(serverId: number, capability: Capability): Promise<string> {
  const config = await loadCapabilityConfig(serverId);
  if (!config) {
    throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
  }

  switch (capability) {
    case "text": {
      if (!config.llm_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const [row] = await sql`
				SELECT llm_provider
				FROM llms
				WHERE llm_id = ${config.llm_id}
				LIMIT 1
			`;
      if (!row?.llm_provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return String(row.llm_provider).toLowerCase();
    }
    case "embedding": {
      if (!config.embedding_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const [row] = await sql`
				SELECT provider
				FROM embedding_models
				WHERE embedding_model_id = ${config.embedding_model_id}
				LIMIT 1
			`;
      if (!row?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return String(row.provider).toLowerCase();
    }
    case "image-standard": {
      if (!config.diffusion_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const [row] = await sql`
				SELECT provider
				FROM image_diffusion_models
				WHERE diffusion_model_id = ${config.diffusion_model_id}
				LIMIT 1
			`;
      if (!row?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return String(row.provider).toLowerCase();
    }
    case "image-nai": {
      if (!config.nai_diffusion_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const [row] = await sql`
				SELECT provider
				FROM image_diffusion_models
				WHERE diffusion_model_id = ${config.nai_diffusion_model_id}
				LIMIT 1
			`;
      if (!row?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return String(row.provider).toLowerCase();
    }
    case "video": {
      if (!config.video_model_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const [row] = await sql`
				SELECT provider
				FROM video_generation_models
				WHERE video_model_id = ${config.video_model_id}
				LIMIT 1
			`;
      if (!row?.provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return String(row.provider).toLowerCase();
    }
    case "vision": {
      if (!config.vision_llm_id) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      const [row] = await sql`
				SELECT llm_provider
				FROM llms
				WHERE llm_id = ${config.vision_llm_id}
				LIMIT 1
			`;
      if (!row?.llm_provider) {
        throw new CredentialUnavailableError("unknown", capability, "missing_model_id");
      }
      return String(row.llm_provider).toLowerCase();
    }
  }
}

async function decryptResolvedApiKey(
  savedConfig: SavedProviderConfigRow | UserSavedProviderConfigRow,
  provider: string,
  capability: Capability,
  source: "server" | "personal",
  contextLabel: string,
): Promise<ResolvedCredentials> {
  const customEndpointCapability =
    capability === "image-standard"
      ? "image"
      : capability === "vision"
        ? "text"
        : capability === "image-nai"
          ? null
          : capability;
  const customEndpoint =
    isCustomProvider(provider) && customEndpointCapability
      ? await resolveCustomEndpointForProvider(provider, customEndpointCapability)
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
    apiKey: decryptedKey,
    keyVersion: savedConfig.key_version || 1,
    savedConfig,
    source,
    customEndpoint: customEndpoint ?? undefined,
    apiStyle: customEndpoint?.api_style,
  };
}

async function resolvePersonalCredentials(userId: number, capability: Capability): Promise<ResolvedCredentials | null> {
  const personalCapability = mapCapabilityToPersonalCapability(capability);
  personalProviderCapabilitySchema.parse(personalCapability);

  const qualifyingRows = (await llmProviderRepo.loadUserSavedProviderConfigs(userId))
    .filter((row) => row.enabled_capabilities.includes(personalCapability))
    .filter((row) => getCapabilityModelId(row, capability) !== null)
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
  return await decryptResolvedApiKey(
    savedConfig,
    savedConfig.provider.toLowerCase(),
    capability,
    "personal",
    `user ${userId}`,
  );
}

export async function resolveCapabilityCredentials(
  serverId: number,
  capability: Capability,
  options?: ResolverOptions,
): Promise<ResolvedCredentials> {
  const userId = options?.userId ?? null;
  const capabilityConfig = await loadCapabilityConfig(serverId);

  if (userId !== null) {
    const personalResolved = await resolvePersonalCredentials(userId, capability);
    if (personalResolved) {
      return personalResolved;
    }

    if (capabilityConfig?.user_byok_mode) {
      throw new PersonalProviderRequiredError(capability);
    }
  }

  const provider = await resolveProviderForCapability(serverId, capability);
  const savedConfig = await llmProviderRepo.loadSavedProviderConfig(serverId, provider);

  if (!savedConfig) {
    throw new CredentialUnavailableError(provider, capability, "no_saved_config", "server");
  }

  return await decryptResolvedApiKey(savedConfig, provider, capability, "server", `server ${serverId}`);
}

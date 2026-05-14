import {
  type CustomEndpointApiStyle,
  type CustomEndpointCapability,
  type CustomEndpointRow,
  customEndpointSchema,
  type FallbackModelRef,
  type OpenRouterEmbeddingModelRegistrationRow,
  openRouterEmbeddingModelRegistrationSchema,
  type OpenRouterImageModelRegistrationRow,
  openRouterImageModelRegistrationSchema,
  type OpenRouterModelRegistrationRow,
  openRouterModelRegistrationSchema,
  type OpenRouterVideoModelRegistrationRow,
  openRouterVideoModelRegistrationSchema,
  savedProviderConfigSchema,
  type SavedProviderConfigUpsert,
  userSavedProviderConfigSchema,
  type UserSavedProviderConfigUpsert,
} from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
const FALLBACK_DEBUG_ENABLED = new Set(["1", "true", "yes", "on"]).has(
  (process.env.FALLBACK_DEBUG_ENABLED ?? "").trim().toLowerCase(),
);

function toPostgresTextArrayLiteral(values: readonly string[] | null | undefined): string {
  return `{${(values ?? []).map((value) => `"${value.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}

export async function setChannelLlmOverride(serverId: number, channelDiscId: string, llmId: number): Promise<boolean> {
  try {
    // UPSERT — insert or update the override for this (server, channel) pair
    await sql`
			INSERT INTO channel_llm_overrides (server_id, channel_disc_id, llm_id)
			VALUES (${serverId}, ${channelDiscId}, ${llmId})
			ON CONFLICT (server_id, channel_disc_id)
			DO UPDATE SET llm_id = EXCLUDED.llm_id, updated_at = CURRENT_TIMESTAMP
		`;
    return true;
  } catch (error) {
    log.error(`Error setting channel LLM override for server ${serverId} channel ${channelDiscId}:`, error);
    return false;
  }
}

/**
 * Sets a persona-specific LLM model override in persona_configs.
 * Creates the persona_configs row if it does not yet exist.
 * LlmRepository invalidates TomoriState cache when the server Discord ID is available.
 *
 * @param tomoriId - The persona's tomori_id
 * @param llmId - The llm_id to set as the override, or null to clear it
 * @returns True on success, false on failure
 */
export async function setPersonaLlmOverride(tomoriId: number, llmId: number | null): Promise<boolean> {
  try {
    // UPSERT — create or update the persona_configs row
    await sql`
			INSERT INTO persona_configs (tomori_id, llm_id)
			VALUES (${tomoriId}, ${llmId})
			ON CONFLICT (tomori_id)
			DO UPDATE SET llm_id = EXCLUDED.llm_id, updated_at = CURRENT_TIMESTAMP
		`;
    return true;
  } catch (error) {
    log.error(`Error setting persona LLM override for tomori_id ${tomoriId}:`, error);
    return false;
  }
}

/**
 * Sets the ordered fallback LLM model chain for a server.
 * When the primary model errors during generation, the bot retries each fallback in order.
 * Pass an empty array to clear all configured fallback models.
 * LlmRepository invalidates TomoriState cache when the server Discord ID is available.
 *
 * @param serverId - Database server_id for the target server
 * @param llmIds - Ordered array of llm_id values (up to 5), or [] to clear all fallbacks
 * @returns True on success, false on failure
 */
export async function setFallbackLlms(serverId: number, llmIds: number[]): Promise<boolean> {
  try {
    const fallbackJson = JSON.stringify(llmIds);
    // Match server-scoped rows (server_id = serverId) first.
    // Legacy rows have server_id = NULL and are linked via tomori_id → tomoris.server_id,
    // so include them in the same UPDATE to avoid silently writing nothing.
    const updatedRows = await sql<
      Array<{
        tomori_config_id: number;
        server_id: number | null;
        tomori_id: number | null;
        fallback_llm_ids: unknown;
      }>
    >`
			UPDATE tomori_configs
			SET fallback_llm_ids = ${fallbackJson}::JSONB,
			    updated_at = CURRENT_TIMESTAMP
			WHERE server_id = ${serverId}
			   OR (
			       server_id IS NULL
			       AND tomori_id IN (
			           SELECT tomori_id FROM tomoris
			           WHERE server_id = ${serverId}
			             AND is_alter = false
			       )
			   )
			RETURNING tomori_config_id, server_id, tomori_id, fallback_llm_ids
		`;

    if (updatedRows.length === 0) {
      log.warn(
        `[FallbackConfig] setFallbackLlms matched 0 rows for server_id ${serverId} (requested ids: [${llmIds.join(", ")}])`,
      );
      return false;
    }

    if (FALLBACK_DEBUG_ENABLED) {
      const updatedRowSummary = updatedRows.map((row) => ({
        tomori_config_id: row.tomori_config_id,
        server_id: row.server_id,
        tomori_id: row.tomori_id,
        fallback_llm_ids: row.fallback_llm_ids,
      }));
      log.info(
        `[FallbackDebug][setFallbackLlms] server_id=${serverId} requested_ids=[${llmIds.join(", ")}] updated_rows=${JSON.stringify(updatedRowSummary)}`,
      );
    }

    return true;
  } catch (error) {
    log.error(`Error setting fallback LLMs for server ${serverId} (ids: [${llmIds.join(", ")}]):`, error);
    return false;
  }
}

/**
 * Writes the ordered fallback model reference list to a server's config.
 * Supports mixed provider types (llm and custom_endpoint). Also mirrors llm-only IDs into the
 * legacy fallback_llm_ids column for backward compatibility with readers not yet using fallback_model_refs.
 * LlmRepository invalidates TomoriState cache when the server Discord ID is available.
 *
 * @param serverId - Database server_id for the target server
 * @param refs - Ordered array of FallbackModelRef entries (up to 5), or [] to clear all fallbacks
 * @returns True on success, false on failure
 */
export async function setFallbackModelRefs(serverId: number, refs: FallbackModelRef[]): Promise<boolean> {
  try {
    const refsJson = JSON.stringify(refs);
    // Mirror llm-only IDs into the legacy column so older code paths keep working
    const legacyIds = refs.filter((r) => r.type === "llm").map((r) => r.id);
    const legacyJson = JSON.stringify(legacyIds);

    const updatedRows = await sql`
			UPDATE tomori_configs
			SET
				fallback_model_refs = ${refsJson}::JSONB,
				fallback_llm_ids    = ${legacyJson}::JSONB,
				updated_at          = CURRENT_TIMESTAMP
			WHERE server_id = ${serverId}
			   OR (
			       server_id IS NULL
			       AND tomori_id IN (
			           SELECT tomori_id FROM tomoris
			           WHERE server_id = ${serverId}
			             AND is_alter = false
			       )
			   )
			RETURNING tomori_config_id
		`;

    if (updatedRows.length === 0) {
      log.warn(`[FallbackConfig] setFallbackModelRefs matched 0 rows for server_id ${serverId}`);
      return false;
    }

    return true;
  } catch (error) {
    log.error(`Error setting fallback model refs for server ${serverId}:`, error);
    return false;
  }
}

/**
 * Deletes the channel-level LLM override for a single channel.
 * After calling, set channel LLM cache to null for this channel.
 *
 * @param serverId - The database server_id
 * @param channelDiscId - The Discord snowflake ID of the channel
 * @returns True on success, false on failure
 */
export async function deleteChannelLlmOverride(serverId: number, channelDiscId: string): Promise<boolean> {
  try {
    await sql`
			DELETE FROM channel_llm_overrides
			WHERE server_id = ${serverId}
			  AND channel_disc_id = ${channelDiscId}
		`;
    return true;
  } catch (error) {
    log.error(`Error deleting channel LLM override for server ${serverId} channel ${channelDiscId}:`, error);
    return false;
  }
}

/**
 * Deletes all channel-level LLM overrides for a server.
 * Called when the server switches providers so stale model references are removed.
 *
 * @param serverId - The database server_id
 * @returns True on success, false on failure
 */
export async function clearAllChannelLlmOverridesForServer(serverId: number): Promise<boolean> {
  try {
    await sql`
			DELETE FROM channel_llm_overrides
			WHERE server_id = ${serverId}
		`;
    return true;
  } catch (error) {
    log.error(`Error clearing channel LLM overrides for server ${serverId}:`, error);
    return false;
  }
}

/**
 * Nulls out the llm_id override for every persona belonging to a server.
 * Called when the server switches providers so stale model references are removed.
 *
 * @param serverId - The database server_id
 * @returns True on success, false on failure
 */
export async function clearAllPersonaLlmOverridesForServer(serverId: number): Promise<boolean> {
  try {
    // Join via tomoris to scope the update to this server only
    await sql`
			UPDATE persona_configs
			SET llm_id = NULL, updated_at = CURRENT_TIMESTAMP
			WHERE tomori_id IN (
				SELECT tomori_id FROM tomoris WHERE server_id = ${serverId}
			)
		`;
    return true;
  } catch (error) {
    log.error(`Error clearing persona LLM overrides for server ${serverId}:`, error);
    return false;
  }
}

/**
 * Upserts a saved provider config snapshot. Inserts a new row if none exists
 * for this server+provider, otherwise updates the existing row.
 * @param serverId - The database server_id (numeric)
 * @param config - The provider config fields to save
 * @returns True on success, false on failure
 */
export async function upsertSavedProviderConfig(serverId: number, config: SavedProviderConfigUpsert): Promise<boolean> {
  try {
    const provider = config.provider.toLowerCase();
    const fallbackJson = JSON.stringify(config.fallback_llm_ids ?? []);
    const channelOverridesJson = JSON.stringify(config.channel_llm_overrides ?? []);
    const personaOverridesJson = JSON.stringify(config.persona_llm_overrides ?? []);
    const logitBiasesJson = JSON.stringify(config.llm_logit_biases ?? []);
    const disabledParamsLiteral = toPostgresTextArrayLiteral(config.llm_disabled_params);

    const rows = await sql`
			INSERT INTO saved_provider_configs (
				server_id, provider, api_key, key_version,
				llm_id, diffusion_model_id, embedding_model_id,
				video_model_id,
				nai_diffusion_model_id, vision_llm_id, nai_preset_name,
				custom_endpoint_url, custom_model_name, custom_num_ctx, thinking_level,
				fallback_llm_ids, channel_llm_overrides, persona_llm_overrides,
				llm_temperature, llm_top_p, llm_top_k,
				llm_frequency_penalty, llm_presence_penalty, llm_min_p,
				llm_max_output_tokens,
				llm_logit_biases, llm_disabled_params
			) VALUES (
				${serverId}, ${provider}, ${config.api_key}, ${config.key_version},
				${config.llm_id}, ${config.diffusion_model_id}, ${config.embedding_model_id},
				${config.video_model_id ?? null},
				${config.nai_diffusion_model_id}, ${config.vision_llm_id ?? null}, ${config.nai_preset_name},
				${config.custom_endpoint_url}, ${config.custom_model_name}, ${config.custom_num_ctx ?? null}, ${config.thinking_level},
				${fallbackJson}::jsonb, ${channelOverridesJson}::jsonb, ${personaOverridesJson}::jsonb,
				${config.llm_temperature ?? null}, ${config.llm_top_p ?? null}, ${config.llm_top_k ?? null},
				${config.llm_frequency_penalty ?? null}, ${config.llm_presence_penalty ?? null}, ${config.llm_min_p ?? null},
				${config.llm_max_output_tokens ?? null},
				${logitBiasesJson}::jsonb, ${disabledParamsLiteral}::text[]
			)
			ON CONFLICT (server_id, provider) DO UPDATE SET
				api_key = EXCLUDED.api_key,
				key_version = EXCLUDED.key_version,
				llm_id = EXCLUDED.llm_id,
				diffusion_model_id = EXCLUDED.diffusion_model_id,
				embedding_model_id = EXCLUDED.embedding_model_id,
				video_model_id = EXCLUDED.video_model_id,
				nai_diffusion_model_id = EXCLUDED.nai_diffusion_model_id,
				vision_llm_id = EXCLUDED.vision_llm_id,
				nai_preset_name = EXCLUDED.nai_preset_name,
				custom_endpoint_url = EXCLUDED.custom_endpoint_url,
				custom_model_name = EXCLUDED.custom_model_name,
				custom_num_ctx = EXCLUDED.custom_num_ctx,
				thinking_level = EXCLUDED.thinking_level,
				fallback_llm_ids = EXCLUDED.fallback_llm_ids,
				channel_llm_overrides = EXCLUDED.channel_llm_overrides,
				persona_llm_overrides = EXCLUDED.persona_llm_overrides,
				llm_temperature = EXCLUDED.llm_temperature,
				llm_top_p = EXCLUDED.llm_top_p,
				llm_top_k = EXCLUDED.llm_top_k,
				llm_frequency_penalty = EXCLUDED.llm_frequency_penalty,
				llm_presence_penalty = EXCLUDED.llm_presence_penalty,
				llm_min_p = EXCLUDED.llm_min_p,
				llm_max_output_tokens = EXCLUDED.llm_max_output_tokens,
				llm_logit_biases = EXCLUDED.llm_logit_biases,
				llm_disabled_params = EXCLUDED.llm_disabled_params
			RETURNING *
		`;

    // Validate the returned row
    if (rows.length > 0) {
      const parsed = savedProviderConfigSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.warn(
          `Upserted saved provider config failed validation for server ${serverId}, provider ${provider}: ${parsed.error.message}`,
        );
        return false;
      }
    }

    log.info(`Upserted saved provider config for server ${serverId}, provider ${provider}`);
    return true;
  } catch (error) {
    log.error(`Error upserting saved provider config for server ${serverId}, provider ${config.provider}:`, error);
    return false;
  }
}

/**
 * Deletes a saved provider config for a server+provider pair.
 * @param serverId - The database server_id (numeric)
 * @param provider - The provider name (lowercase)
 * @returns True if a row was deleted, false if not found or error
 */
export async function deleteSavedProviderConfig(serverId: number, provider: string): Promise<boolean> {
  try {
    const result = await sql`
			DELETE FROM saved_provider_configs
			WHERE server_id = ${serverId}
			  AND provider = ${provider.toLowerCase()}
		`;

    const deleted = result.count > 0;
    if (deleted) {
      log.info(`Deleted saved provider config for server ${serverId}, provider ${provider}`);
    }
    return deleted;
  } catch (error) {
    log.error(`Error deleting saved provider config for server ${serverId}, provider ${provider}:`, error);
    return false;
  }
}

/**
 * Upserts a personal saved provider config snapshot.
 * Inserts a new row if none exists for this user+provider, otherwise updates the existing row.
 * @param userId - Internal users.user_id
 * @param config - The personal provider config fields to save
 * @returns True on success, false on failure
 */
export async function upsertUserSavedProviderConfig(
  userId: number,
  config: UserSavedProviderConfigUpsert,
): Promise<boolean> {
  try {
    const provider = config.provider.toLowerCase();
    const enabledCapabilitiesLiteral = toPostgresTextArrayLiteral(config.enabled_capabilities);
    const fallbackJson = JSON.stringify(config.fallback_llm_ids ?? []);
    const logitBiasesJson = JSON.stringify(config.llm_logit_biases ?? []);
    const disabledParamsLiteral = toPostgresTextArrayLiteral(config.llm_disabled_params);

    const rows = await sql`
			INSERT INTO user_saved_provider_configs (
				user_id, provider, api_key, key_version,
				llm_id, diffusion_model_id, embedding_model_id,
				video_model_id,
				nai_diffusion_model_id, vision_llm_id, nai_preset_name,
				custom_endpoint_url, custom_model_name, custom_num_ctx, thinking_level,
				enabled_capabilities, fallback_llm_ids,
				llm_temperature, llm_top_p, llm_top_k,
				llm_frequency_penalty, llm_presence_penalty, llm_min_p,
				llm_max_output_tokens,
				llm_logit_biases, llm_disabled_params
			) VALUES (
				${userId}, ${provider}, ${config.api_key}, ${config.key_version},
				${config.llm_id}, ${config.diffusion_model_id}, ${config.embedding_model_id},
				${config.video_model_id ?? null},
				${config.nai_diffusion_model_id}, ${config.vision_llm_id ?? null}, ${config.nai_preset_name},
				${config.custom_endpoint_url}, ${config.custom_model_name}, ${config.custom_num_ctx ?? null}, ${config.thinking_level},
				${enabledCapabilitiesLiteral}::text[], ${fallbackJson}::jsonb,
				${config.llm_temperature ?? null}, ${config.llm_top_p ?? null}, ${config.llm_top_k ?? null},
				${config.llm_frequency_penalty ?? null}, ${config.llm_presence_penalty ?? null}, ${config.llm_min_p ?? null},
				${config.llm_max_output_tokens ?? null},
				${logitBiasesJson}::jsonb, ${disabledParamsLiteral}::text[]
			)
			ON CONFLICT (user_id, provider) DO UPDATE SET
				api_key = EXCLUDED.api_key,
				key_version = EXCLUDED.key_version,
				llm_id = EXCLUDED.llm_id,
				diffusion_model_id = EXCLUDED.diffusion_model_id,
				embedding_model_id = EXCLUDED.embedding_model_id,
				video_model_id = EXCLUDED.video_model_id,
				nai_diffusion_model_id = EXCLUDED.nai_diffusion_model_id,
				vision_llm_id = EXCLUDED.vision_llm_id,
				nai_preset_name = EXCLUDED.nai_preset_name,
				custom_endpoint_url = EXCLUDED.custom_endpoint_url,
				custom_model_name = EXCLUDED.custom_model_name,
				custom_num_ctx = EXCLUDED.custom_num_ctx,
				thinking_level = EXCLUDED.thinking_level,
				enabled_capabilities = EXCLUDED.enabled_capabilities,
				fallback_llm_ids = EXCLUDED.fallback_llm_ids,
				llm_temperature = EXCLUDED.llm_temperature,
				llm_top_p = EXCLUDED.llm_top_p,
				llm_top_k = EXCLUDED.llm_top_k,
				llm_frequency_penalty = EXCLUDED.llm_frequency_penalty,
				llm_presence_penalty = EXCLUDED.llm_presence_penalty,
				llm_min_p = EXCLUDED.llm_min_p,
				llm_max_output_tokens = EXCLUDED.llm_max_output_tokens,
				llm_logit_biases = EXCLUDED.llm_logit_biases,
				llm_disabled_params = EXCLUDED.llm_disabled_params
			RETURNING *
		`;

    if (rows.length > 0) {
      const parsed = userSavedProviderConfigSchema.safeParse(rows[0]);
      if (!parsed.success) {
        log.warn(
          `Upserted user saved provider config failed validation for user ${userId}, provider ${provider}: ${parsed.error.message}`,
        );
        return false;
      }
    }

    log.info(`Upserted user saved provider config for user ${userId}, provider ${provider}`);
    return true;
  } catch (error) {
    log.error(`Error upserting user saved provider config for user ${userId}, provider ${config.provider}:`, error);
    return false;
  }
}

/**
 * Deletes a personal saved provider config for a user+provider pair.
 * @param userId - Internal users.user_id
 * @param provider - Provider name (lowercase)
 * @returns True if a row was deleted, false if not found or error
 */
export async function deleteUserSavedProviderConfig(userId: number, provider: string): Promise<boolean> {
  try {
    const result = await sql`
			DELETE FROM user_saved_provider_configs
			WHERE user_id = ${userId}
			  AND provider = ${provider.toLowerCase()}
		`;

    const deleted = result.count > 0;
    if (deleted) {
      log.info(`Deleted user saved provider config for user ${userId}, provider ${provider}`);
    }
    return deleted;
  } catch (error) {
    log.error(`Error deleting user saved provider config for user ${userId}, provider ${provider}:`, error);
    return false;
  }
}

export async function upsertCustomEndpoint(params: {
  serverId?: number | null;
  userId?: number | null;
  label: string;
  capability: CustomEndpointCapability;
  apiStyle: CustomEndpointApiStyle;
  endpointUrl: string;
  modelName?: string | null;
  displayName: string;
  numCtx?: number | null;
  requiresAuth: boolean;
  extraConfig?: Record<string, unknown>;
  hasTools?: boolean;
  seesImages?: boolean;
  seesVideos?: boolean;
  supportsStructOutput?: boolean;
  isDefault?: boolean;
}): Promise<CustomEndpointRow | null> {
  const {
    serverId = null,
    userId = null,
    label,
    capability,
    apiStyle,
    endpointUrl,
    modelName = null,
    displayName,
    numCtx = null,
    requiresAuth,
    extraConfig = {},
    hasTools = false,
    seesImages = false,
    seesVideos = false,
    supportsStructOutput = false,
    isDefault = true,
  } = params;

  try {
    const rows =
      serverId !== null
        ? await sql`
            INSERT INTO custom_endpoints (
              server_id,
              user_id,
              label,
              capability,
              api_style,
              endpoint_url,
              model_name,
              display_name,
              num_ctx,
              requires_auth,
              extra_config,
              has_tools,
              sees_images,
              sees_videos,
              supports_structoutput,
              is_default
            ) VALUES (
              ${serverId},
              NULL,
              ${label},
              ${capability},
              ${apiStyle},
              ${endpointUrl},
              ${modelName},
              ${displayName},
              ${numCtx},
              ${requiresAuth},
              ${JSON.stringify(extraConfig)}::jsonb,
              ${hasTools},
              ${seesImages},
              ${seesVideos},
              ${supportsStructOutput},
              ${isDefault}
            )
            ON CONFLICT (server_id, label, capability)
              WHERE user_id IS NULL
            DO UPDATE SET
              api_style = EXCLUDED.api_style,
              endpoint_url = EXCLUDED.endpoint_url,
              model_name = EXCLUDED.model_name,
              display_name = EXCLUDED.display_name,
              num_ctx = EXCLUDED.num_ctx,
              requires_auth = EXCLUDED.requires_auth,
              extra_config = EXCLUDED.extra_config,
              has_tools = EXCLUDED.has_tools,
              sees_images = EXCLUDED.sees_images,
              sees_videos = EXCLUDED.sees_videos,
              supports_structoutput = EXCLUDED.supports_structoutput,
              is_default = EXCLUDED.is_default,
              updated_at = CURRENT_TIMESTAMP
            RETURNING *
          `
        : userId !== null
          ? await sql`
              INSERT INTO custom_endpoints (
                server_id,
                user_id,
                label,
                capability,
                api_style,
                endpoint_url,
                model_name,
                display_name,
                num_ctx,
                requires_auth,
                extra_config,
                has_tools,
                sees_images,
                sees_videos,
                supports_structoutput,
                is_default
              ) VALUES (
                NULL,
                ${userId},
                ${label},
                ${capability},
                ${apiStyle},
                ${endpointUrl},
                ${modelName},
                ${displayName},
                ${numCtx},
                ${requiresAuth},
                ${JSON.stringify(extraConfig)}::jsonb,
                ${hasTools},
                ${seesImages},
                ${seesVideos},
                ${supportsStructOutput},
                ${isDefault}
              )
              ON CONFLICT (user_id, label, capability)
                WHERE server_id IS NULL
              DO UPDATE SET
                api_style = EXCLUDED.api_style,
                endpoint_url = EXCLUDED.endpoint_url,
                model_name = EXCLUDED.model_name,
                display_name = EXCLUDED.display_name,
                num_ctx = EXCLUDED.num_ctx,
                requires_auth = EXCLUDED.requires_auth,
                extra_config = EXCLUDED.extra_config,
                has_tools = EXCLUDED.has_tools,
                sees_images = EXCLUDED.sees_images,
                sees_videos = EXCLUDED.sees_videos,
                supports_structoutput = EXCLUDED.supports_structoutput,
                is_default = EXCLUDED.is_default,
                updated_at = CURRENT_TIMESTAMP
              RETURNING *
            `
          : [];

    if (!rows.length) {
      return null;
    }

    const parsed = customEndpointSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.warn(`Failed to validate custom endpoint ${label}/${capability}: ${parsed.error.message}`);
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(
      `Error upserting custom endpoint ${label}/${capability} for ${serverId !== null ? `server ${serverId}` : `user ${userId}`}:`,
      error,
    );
    return null;
  }
}

export async function deleteCustomEndpoint(params: {
  serverId?: number | null;
  userId?: number | null;
  label: string;
  capability: CustomEndpointCapability;
}): Promise<boolean> {
  const { serverId = null, userId = null, label, capability } = params;

  try {
    const result =
      serverId !== null
        ? await sql`
            DELETE FROM custom_endpoints
            WHERE server_id = ${serverId}
              AND user_id IS NULL
              AND label = ${label}
              AND capability = ${capability}
          `
        : await sql`
            DELETE FROM custom_endpoints
            WHERE user_id = ${userId}
              AND server_id IS NULL
              AND label = ${label}
              AND capability = ${capability}
          `;

    return result.count > 0;
  } catch (error) {
    log.error(
      `Error deleting custom endpoint ${label}/${capability} for ${serverId !== null ? `server ${serverId}` : `user ${userId}`}:`,
      error,
    );
    return false;
  }
}

export async function upsertOpenRouterModelRegistration(params: {
  serverId?: number | null;
  userId?: number | null;
  llmId: number;
}): Promise<OpenRouterModelRegistrationRow | null> {
  const { serverId = null, userId = null, llmId } = params;

  try {
    const rows =
      serverId !== null
        ? await sql`
            INSERT INTO openrouter_model_registrations (
              server_id,
              user_id,
              llm_id
            ) VALUES (
              ${serverId},
              NULL,
              ${llmId}
            )
            ON CONFLICT (server_id, llm_id) WHERE user_id IS NULL DO UPDATE SET
              updated_at = CURRENT_TIMESTAMP
            RETURNING *
          `
        : await sql`
            INSERT INTO openrouter_model_registrations (
              server_id,
              user_id,
              llm_id
            ) VALUES (
              NULL,
              ${userId},
              ${llmId}
            )
            ON CONFLICT (user_id, llm_id) WHERE server_id IS NULL DO UPDATE SET
              updated_at = CURRENT_TIMESTAMP
            RETURNING *
          `;

    if (!rows.length) {
      return null;
    }

    const parsed = openRouterModelRegistrationSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.warn(`Failed to validate OpenRouter model registration for llm_id ${llmId}: ${parsed.error.message}`);
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(
      `Error upserting OpenRouter model registration for llm_id ${llmId} on ${serverId !== null ? `server ${serverId}` : `user ${userId}`}:`,
      error,
    );
    return null;
  }
}

export async function deleteOpenRouterModelRegistration(params: {
  serverId?: number | null;
  userId?: number | null;
  llmId: number;
}): Promise<boolean> {
  const { serverId = null, userId = null, llmId } = params;

  try {
    const result =
      serverId !== null
        ? await sql`
            DELETE FROM openrouter_model_registrations
            WHERE server_id = ${serverId}
              AND user_id IS NULL
              AND llm_id = ${llmId}
          `
        : await sql`
            DELETE FROM openrouter_model_registrations
            WHERE user_id = ${userId}
              AND server_id IS NULL
              AND llm_id = ${llmId}
          `;

    return result.count > 0;
  } catch (error) {
    log.error(
      `Error deleting OpenRouter model registration for llm_id ${llmId} on ${serverId !== null ? `server ${serverId}` : `user ${userId}`}:`,
      error,
    );
    return false;
  }
}

export async function upsertOpenRouterEmbeddingModelRegistration(params: {
  serverId?: number | null;
  userId?: number | null;
  embeddingModelId: number;
}): Promise<OpenRouterEmbeddingModelRegistrationRow | null> {
  const { serverId = null, userId = null, embeddingModelId } = params;

  try {
    const rows =
      serverId !== null
        ? await sql`
            INSERT INTO openrouter_embedding_model_registrations (
              server_id,
              user_id,
              embedding_model_id
            ) VALUES (
              ${serverId},
              NULL,
              ${embeddingModelId}
            )
            ON CONFLICT (server_id, embedding_model_id)
              WHERE user_id IS NULL
            DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            RETURNING *
          `
        : await sql`
            INSERT INTO openrouter_embedding_model_registrations (
              server_id,
              user_id,
              embedding_model_id
            ) VALUES (
              NULL,
              ${userId},
              ${embeddingModelId}
            )
            ON CONFLICT (user_id, embedding_model_id)
              WHERE server_id IS NULL
            DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            RETURNING *
          `;

    if (!rows.length) {
      return null;
    }

    const parsed = openRouterEmbeddingModelRegistrationSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.warn(
        `Failed to validate OpenRouter embedding model registration for embedding_model_id ${embeddingModelId}: ${parsed.error.message}`,
      );
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(
      `Error upserting OpenRouter embedding model registration for embedding_model_id ${embeddingModelId} on ${serverId !== null ? `server ${serverId}` : `user ${userId}`}:`,
      error,
    );
    return null;
  }
}

export async function deleteOpenRouterEmbeddingModelRegistration(params: {
  serverId?: number | null;
  userId?: number | null;
  embeddingModelId: number;
}): Promise<boolean> {
  const { serverId = null, userId = null, embeddingModelId } = params;

  try {
    const result =
      serverId !== null
        ? await sql`
            DELETE FROM openrouter_embedding_model_registrations
            WHERE server_id = ${serverId}
              AND user_id IS NULL
              AND embedding_model_id = ${embeddingModelId}
          `
        : await sql`
            DELETE FROM openrouter_embedding_model_registrations
            WHERE user_id = ${userId}
              AND server_id IS NULL
              AND embedding_model_id = ${embeddingModelId}
          `;

    return result.count > 0;
  } catch (error) {
    log.error(
      `Error deleting OpenRouter embedding model registration for embedding_model_id ${embeddingModelId} on ${serverId !== null ? `server ${serverId}` : `user ${userId}`}:`,
      error,
    );
    return false;
  }
}

export async function upsertOpenRouterImageModelRegistration(params: {
  serverId?: number | null;
  userId?: number | null;
  diffusionModelId: number;
}): Promise<OpenRouterImageModelRegistrationRow | null> {
  const { serverId = null, userId = null, diffusionModelId } = params;

  try {
    const rows =
      serverId !== null
        ? await sql`
            INSERT INTO openrouter_image_model_registrations (
              server_id,
              user_id,
              diffusion_model_id
            ) VALUES (
              ${serverId},
              NULL,
              ${diffusionModelId}
            )
            ON CONFLICT (server_id, diffusion_model_id)
              WHERE user_id IS NULL
            DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            RETURNING *
          `
        : await sql`
            INSERT INTO openrouter_image_model_registrations (
              server_id,
              user_id,
              diffusion_model_id
            ) VALUES (
              NULL,
              ${userId},
              ${diffusionModelId}
            )
            ON CONFLICT (user_id, diffusion_model_id)
              WHERE server_id IS NULL
            DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            RETURNING *
          `;

    if (!rows.length) {
      return null;
    }

    const parsed = openRouterImageModelRegistrationSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.warn(
        `Failed to validate OpenRouter image model registration for diffusion_model_id ${diffusionModelId}: ${parsed.error.message}`,
      );
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(
      `Error upserting OpenRouter image model registration for diffusion_model_id ${diffusionModelId} on ${serverId !== null ? `server ${serverId}` : `user ${userId}`}:`,
      error,
    );
    return null;
  }
}

export async function deleteOpenRouterImageModelRegistration(params: {
  serverId?: number | null;
  userId?: number | null;
  diffusionModelId: number;
}): Promise<boolean> {
  const { serverId = null, userId = null, diffusionModelId } = params;

  try {
    const result =
      serverId !== null
        ? await sql`
            DELETE FROM openrouter_image_model_registrations
            WHERE server_id = ${serverId}
              AND user_id IS NULL
              AND diffusion_model_id = ${diffusionModelId}
          `
        : await sql`
            DELETE FROM openrouter_image_model_registrations
            WHERE user_id = ${userId}
              AND server_id IS NULL
              AND diffusion_model_id = ${diffusionModelId}
          `;

    return result.count > 0;
  } catch (error) {
    log.error(
      `Error deleting OpenRouter image model registration for diffusion_model_id ${diffusionModelId} on ${serverId !== null ? `server ${serverId}` : `user ${userId}`}:`,
      error,
    );
    return false;
  }
}

export async function upsertOpenRouterVideoModelRegistration(params: {
  serverId?: number | null;
  userId?: number | null;
  videoModelId: number;
}): Promise<OpenRouterVideoModelRegistrationRow | null> {
  const { serverId = null, userId = null, videoModelId } = params;

  try {
    const rows =
      serverId !== null
        ? await sql`
            INSERT INTO openrouter_video_model_registrations (
              server_id,
              user_id,
              video_model_id
            ) VALUES (
              ${serverId},
              NULL,
              ${videoModelId}
            )
            ON CONFLICT (server_id, video_model_id)
              WHERE user_id IS NULL
            DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            RETURNING *
          `
        : await sql`
            INSERT INTO openrouter_video_model_registrations (
              server_id,
              user_id,
              video_model_id
            ) VALUES (
              NULL,
              ${userId},
              ${videoModelId}
            )
            ON CONFLICT (user_id, video_model_id)
              WHERE server_id IS NULL
            DO UPDATE SET updated_at = CURRENT_TIMESTAMP
            RETURNING *
          `;

    if (!rows.length) {
      return null;
    }

    const parsed = openRouterVideoModelRegistrationSchema.safeParse(rows[0]);
    if (!parsed.success) {
      log.warn(
        `Failed to validate OpenRouter video model registration for video_model_id ${videoModelId}: ${parsed.error.message}`,
      );
      return null;
    }

    return parsed.data;
  } catch (error) {
    log.error(
      `Error upserting OpenRouter video model registration for video_model_id ${videoModelId} on ${serverId !== null ? `server ${serverId}` : `user ${userId}`}:`,
      error,
    );
    return null;
  }
}

export async function deleteOpenRouterVideoModelRegistration(params: {
  serverId?: number | null;
  userId?: number | null;
  videoModelId: number;
}): Promise<boolean> {
  const { serverId = null, userId = null, videoModelId } = params;

  try {
    const result =
      serverId !== null
        ? await sql`
            DELETE FROM openrouter_video_model_registrations
            WHERE server_id = ${serverId}
              AND user_id IS NULL
              AND video_model_id = ${videoModelId}
          `
        : await sql`
            DELETE FROM openrouter_video_model_registrations
            WHERE user_id = ${userId}
              AND server_id IS NULL
              AND video_model_id = ${videoModelId}
          `;

    return result.count > 0;
  } catch (error) {
    log.error(
      `Error deleting OpenRouter video model registration for video_model_id ${videoModelId} on ${serverId !== null ? `server ${serverId}` : `user ${userId}`}:`,
      error,
    );
    return false;
  }
}

/**
 * Restores channel and persona LLM overrides from a saved provider config snapshot.
 * Validates that each referenced llm_id still exists in the database before restoring.
 * Dead overrides (missing LLM, deleted channel handled by caller) are silently skipped.
 *
 * @param serverId - The database server_id (numeric)
 * @param channelOverrides - Array of {channel_disc_id, llm_id} from saved config
 * @param personaOverrides - Array of {tomori_id, llm_id} from saved config
 * @param validChannelIds - Set of Discord channel IDs that currently exist in the guild (for dead override cleanup)
 * @returns Object with counts of restored/skipped overrides
 */
export async function restoreOverridesFromSnapshot(
  serverId: number,
  channelOverrides: { channel_disc_id: string; llm_id: number }[],
  personaOverrides: { tomori_id: number; llm_id: number }[],
  validChannelIds: Set<string>,
): Promise<{
  channelRestored: number;
  personaRestored: number;
  skipped: number;
  restoredChannelOverrides: { channel_disc_id: string; llm_id: number }[];
  restoredPersonaOverrides: { tomori_id: number; llm_id: number }[];
}> {
  let channelRestored = 0;
  let personaRestored = 0;
  let skipped = 0;
  const restoredChannelOverrides: { channel_disc_id: string; llm_id: number }[] = [];
  const restoredPersonaOverrides: { tomori_id: number; llm_id: number }[] = [];

  // 1. Restore channel overrides (validate llm_id exists and channel still exists)
  for (const override of channelOverrides) {
    // Skip overrides for channels that no longer exist in the guild
    if (!validChannelIds.has(override.channel_disc_id)) {
      skipped++;
      log.info(`Skipping dead channel override: channel ${override.channel_disc_id} no longer exists`);
      continue;
    }

    // Verify the LLM still exists
    const llmCheck = await sql`
			SELECT llm_id FROM llms WHERE llm_id = ${override.llm_id} LIMIT 1
		`;
    if (llmCheck.length === 0) {
      skipped++;
      log.info(`Skipping channel override for ${override.channel_disc_id}: llm_id ${override.llm_id} no longer exists`);
      continue;
    }

    const success = await setChannelLlmOverride(serverId, override.channel_disc_id, override.llm_id);
    if (success) {
      channelRestored++;
      restoredChannelOverrides.push(override);
    } else {
      skipped++;
    }
  }

  // 2. Restore persona overrides (validate llm_id exists and persona still exists)
  for (const override of personaOverrides) {
    // Verify the persona still exists for this server
    const personaCheck = await sql`
			SELECT tomori_id FROM tomoris
			WHERE tomori_id = ${override.tomori_id} AND server_id = ${serverId}
			LIMIT 1
		`;
    if (personaCheck.length === 0) {
      skipped++;
      log.info(`Skipping persona override: tomori_id ${override.tomori_id} no longer exists for server ${serverId}`);
      continue;
    }

    // Verify the LLM still exists
    const llmCheck = await sql`
			SELECT llm_id FROM llms WHERE llm_id = ${override.llm_id} LIMIT 1
		`;
    if (llmCheck.length === 0) {
      skipped++;
      log.info(
        `Skipping persona override for tomori_id ${override.tomori_id}: llm_id ${override.llm_id} no longer exists`,
      );
      continue;
    }

    const success = await setPersonaLlmOverride(override.tomori_id, override.llm_id);
    if (success) {
      personaRestored++;
      restoredPersonaOverrides.push(override);
    } else {
      skipped++;
    }
  }

  log.info(
    `Override restore for server ${serverId}: ${channelRestored} channel, ${personaRestored} persona restored, ${skipped} skipped`,
  );
  return {
    channelRestored,
    personaRestored,
    skipped,
    restoredChannelOverrides,
    restoredPersonaOverrides,
  };
}

/**
 * Cleans up dead channel LLM overrides for a server by removing entries
 * that reference Discord channels no longer present in the guild.
 *
 * @param serverId - The database server_id (numeric)
 * @param validChannelIds - Set of Discord channel IDs that currently exist in the guild
 * @returns Number of dead overrides removed
 */
export async function cleanupDeadChannelOverrides(serverId: number, validChannelIds: Set<string>): Promise<number> {
  try {
    // 1. Fetch all channel overrides for this server
    const overrideRows = await sql`
			SELECT channel_disc_id FROM channel_llm_overrides
			WHERE server_id = ${serverId}
		`;

    if (!overrideRows.length) return 0;

    // 2. Find dead overrides (channel no longer exists in guild)
    const deadChannelIds = overrideRows
      .map((row: { channel_disc_id: string }) => row.channel_disc_id)
      .filter((channelId: string) => !validChannelIds.has(channelId));

    if (deadChannelIds.length === 0) return 0;

    // 3. Delete dead overrides
    await sql`
			DELETE FROM channel_llm_overrides
			WHERE server_id = ${serverId}
			  AND channel_disc_id = ANY(${deadChannelIds})
		`;

    log.info(`Cleaned up ${deadChannelIds.length} dead channel override(s) for server ${serverId}`);
    return deadChannelIds.length;
  } catch (error) {
    log.error(`Error cleaning up dead channel overrides for server ${serverId}:`, error);
    return 0;
  }
}

import { sql } from "@/utils/db/client";
import type { SqlParameterArray } from "@/types/db/sqlOperations";
import {
  customEndpointSchema,
  tomoriSchema,
  userSchema,
  tomoriConfigSchema,
  type TomoriRow,
  type UserRow,
  type TomoriConfigRow,
  type ErrorContext,
  serverMemorySchema,
  personalMemorySchema,
  reminderSchema,
  type ReminderRow,
  randomTriggerSchema,
  type RandomTriggerRow,
  type NaiPresetRow,
  type CustomEndpointApiStyle,
  type CustomEndpointCapability,
  type CustomEndpointRow,
  openRouterEmbeddingModelRegistrationSchema,
  type OpenRouterEmbeddingModelRegistrationRow,
  openRouterImageModelRegistrationSchema,
  openRouterModelRegistrationSchema,
  type OpenRouterModelRegistrationRow,
  openRouterVideoModelRegistrationSchema,
  type OpenRouterImageModelRegistrationRow,
  type OpenRouterVideoModelRegistrationRow,
  savedProviderConfigSchema,
  type SavedProviderConfigUpsert,
  userSavedProviderConfigSchema,
  type UserSavedProviderConfigUpsert,
  type FallbackModelRef,
} from "../../types/db/schema"; // Import base schemas and types
import { log } from "../misc/logger";
import { validateTomoriConfigFields, validateTomoriFields, validateUserFields } from "./sqlSecurity";
import { invalidateUserCache } from "../cache/userCache";
import { getBaseTriggerWords } from "../text/localizer";
import { DEFAULT_SYSTEM_PROMPT } from "../text/contextBuilder";
import type { Guild } from "discord.js";
import { validateMemoryContent, checkPersonalMemoryLimit, checkServerMemoryLimit } from "./memoryLimits";
import type { ServerMemoryRow, PersonalMemoryRow, SetupConfig, SetupResult } from "../../types/db/schema";
import { setupConfigSchema, setupResultSchema } from "../../types/db/schema";
import { emitScheduledWorkNudge } from "@/timers/scheduledWorkSignals";

const FALLBACK_DEBUG_ENABLED = new Set(["1", "true", "yes", "on"]).has(
  (process.env.FALLBACK_DEBUG_ENABLED ?? "").trim().toLowerCase(),
);

function toPostgresTextArrayLiteral(values: readonly string[] | null | undefined): string {
  return `{${(values ?? []).map((value) => `"${value.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}

/**
 * Registers a user in the database if missing and returns the current row.
 * Existing nicknames and preferences are preserved on re-registration.
 *
 * @param userDiscId - Discord user ID of the user to register
 * @param displayName - User's display name or nickname
 * @param language - Preferred language/locale code (e.g., 'en-US'), defaults to 'en'
 * @returns The validated UserRow object, or null if registration failed
 */
export async function registerUser(userDiscId: string, displayName: string, language = "en"): Promise<UserRow | null> {
  try {
    log.info(`Ensuring user ${userDiscId} exists (${displayName})`);

    // registration_locale is only set on INSERT (static field for analytics)
    // Preserve existing nickname/preferences when the user already exists.
    const [userData] = await sql`
            WITH inserted_user AS (
                INSERT INTO users (
                    user_disc_id,
                    user_nickname,
                    language_pref,
                    registration_locale
                ) VALUES (
                    ${userDiscId},
                    ${displayName},
                    ${language},
                    ${language}
                )
                ON CONFLICT (user_disc_id) DO NOTHING
                RETURNING *
            )
            SELECT *
            FROM inserted_user
            UNION ALL
            SELECT *
            FROM users
            WHERE user_disc_id = ${userDiscId}
              AND NOT EXISTS (SELECT 1 FROM inserted_user)
            LIMIT 1
        `;

    // Validate with Zod schema (Rules #3, #6)
    const validatedUser = userSchema.safeParse(userData);

    if (!validatedUser.success) {
      log.error(`Failed to validate registered user data for ${userDiscId}:`, validatedUser.error);
      return null;
    }

    invalidateUserCache(userDiscId);
    return validatedUser.data;
  } catch (error) {
    log.error(`Error registering user ${userDiscId}:`, error);
    return null;
  }
}

/**
 * Sets the privacy level for a user globally across all servers.
 * This function ensures the user exists in the database before updating their privacy setting.
 *
 * @param userDiscId - Discord user ID of the user
 * @param level - Privacy level to set (0=MINIMAL, 1=PARTIAL, 2=FULL)
 * @returns The updated UserRow object, or null if the operation failed
 */
export async function setPrivacyLevel(
  userDiscId: string,
  level: import("@/types/db/schema").PrivacyLevel,
): Promise<UserRow | null> {
  try {
    log.info(`Setting privacy level to ${level} for user ${userDiscId}`);

    // 1. Validate level
    if (![0, 1, 2].includes(level)) {
      log.error(`Invalid privacy level ${level} for user ${userDiscId}`);
      return null;
    }

    // 2. Update privacy level
    const [userData] = await sql`
			UPDATE users
			SET privacy_level = ${level}
			WHERE user_disc_id = ${userDiscId}
			RETURNING *
		`;

    // 3. Check if user was found and updated
    if (!userData) {
      log.warn(`Cannot set privacy level: User ${userDiscId} not found in database`);
      return null;
    }

    // 4. Validate with Zod schema
    const validatedUser = userSchema.safeParse(userData);

    if (!validatedUser.success) {
      log.error(`Failed to validate user data after privacy update for ${userDiscId}:`, validatedUser.error);
      return null;
    }

    log.success(`Privacy level successfully set to ${level} for user ${userDiscId}`);
    return validatedUser.data;
  } catch (error) {
    log.error(`Error setting privacy level for user ${userDiscId}:`, error);
    return null;
  }
}

/**
 * Backward compatibility wrapper for setPrivacyOptOut
 * @deprecated Use setPrivacyLevel() instead
 */
export async function setPrivacyOptOut(userDiscId: string, optedOut: boolean): Promise<UserRow | null> {
  const { PrivacyLevel } = await import("@/types/db/schema");
  const level = optedOut ? PrivacyLevel.FULL : PrivacyLevel.MINIMAL; // optedOut=true maps to Level 2 (FULL privacy)
  return setPrivacyLevel(userDiscId, level);
}

/**
 * Toggle user's cross-server short-term memory sharing preference
 *
 * Phase 4: User Controls & Privacy
 *
 * @param userDiscId - Discord user ID
 * @returns New opt-in value (true if enabled, false if disabled)
 */
export async function toggleCrossServerShortTermMemoryOptIn(userDiscId: string): Promise<boolean> {
  try {
    // Toggle the setting
    const [updated] = await sql`
			UPDATE users
			SET shortterm_cache_crossserver_opt_in = NOT shortterm_cache_crossserver_opt_in
			WHERE user_disc_id = ${userDiscId}
			RETURNING shortterm_cache_crossserver_opt_in
		`;

    // Return the toggled value directly — only one column was returned
    return updated?.shortterm_cache_crossserver_opt_in ?? false;
  } catch (error) {
    log.error(`Error toggling cross-server short-term memory opt-in for user ${userDiscId}:`, error);
    // Re-throw to allow caller to handle
    throw error;
  }
}

function rollAutochatTarget(minThreshold: number, maxThreshold: number): number {
  const normalizedMin = Math.max(minThreshold, 0);
  const normalizedMax = Math.max(maxThreshold, normalizedMin);

  if (normalizedMin <= 0 || normalizedMax <= 0) {
    return 0;
  }

  if (normalizedMin === normalizedMax) {
    return normalizedMin;
  }

  return Math.floor(Math.random() * (normalizedMax - normalizedMin + 1)) + normalizedMin;
}

/**
 * Advances the shared auto-chat cycle for a Tomori instance.
 * Fixed thresholds are represented as min=max, while ranged thresholds reroll
 * a new inclusive target after each successful auto-chat hit.
 * @param tomoriId - The ID of the Tomori instance.
 * @param minThreshold - The minimum auto-chat threshold from config.
 * @param maxThreshold - The maximum auto-chat threshold from config.
 * @returns The updated TomoriRow with the new counter/target state, or null on error.
 */
export async function incrementTomoriCounter(
  tomoriId: number,
  minThreshold: number,
  maxThreshold: number,
): Promise<TomoriRow | null> {
  try {
    const normalizedMin = Math.max(minThreshold, 0);
    const normalizedMax = Math.max(maxThreshold, normalizedMin);

    // Range disabled or always-reply mode: keep counter inert.
    if (normalizedMin <= 0 || normalizedMax <= 0) {
      const [incrementedTomori] = await sql`
				UPDATE tomoris
				SET autoch_counter = 0,
					autoch_next_target = 0
				WHERE tomori_id = ${tomoriId}
				RETURNING *
			`;

      // Validate and return
      const parsedTomori = tomoriSchema.safeParse(incrementedTomori);
      return parsedTomori.success ? parsedTomori.data : null;
    }

    const updatedTomori = await sql.transaction(async (tx) => {
      const [currentTomori] = await tx`
				SELECT *
				FROM tomoris
				WHERE tomori_id = ${tomoriId}
				FOR UPDATE
			`;

      if (!currentTomori) {
        return null;
      }

      const parsedCurrentTomori = tomoriSchema.safeParse(currentTomori);
      if (!parsedCurrentTomori.success) {
        const context: ErrorContext = {
          tomoriId,
          errorType: "SchemaValidationError",
          metadata: {
            operation: "incrementTomoriCounter",
            validationErrors: parsedCurrentTomori.error.flatten(),
          },
        };

        await log.error("Failed to validate Tomori data before counter update", parsedCurrentTomori.error, context);
        return null;
      }

      const currentTomoriRow = parsedCurrentTomori.data;
      const currentTarget = currentTomoriRow.autoch_next_target;
      const shouldStartNewCycle = currentTarget > 0 && currentTomoriRow.autoch_counter >= currentTarget;
      const nextTarget =
        shouldStartNewCycle || currentTarget <= 0 ? rollAutochatTarget(normalizedMin, normalizedMax) : currentTarget;
      const nextCounter = shouldStartNewCycle ? 1 : currentTomoriRow.autoch_counter + 1;

      const [updatedRow] = await tx`
				UPDATE tomoris
				SET autoch_counter = ${nextCounter},
					autoch_next_target = ${nextTarget}
				WHERE tomori_id = ${tomoriId}
				RETURNING *
			`;

      return updatedRow ?? null;
    });

    if (!updatedTomori) {
      const context: ErrorContext = {
        tomoriId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "incrementTomoriCounter",
          minThreshold: normalizedMin,
          maxThreshold: normalizedMax,
        },
      };

      await log.error(
        `Failed to increment auto-chat counter for Tomori ${tomoriId}`,
        new Error("Tomori not found"),
        context,
      );
      return null;
    }

    // Validate the returned data
    const parsedTomori = tomoriSchema.safeParse(updatedTomori);
    if (!parsedTomori.success) {
      const context: ErrorContext = {
        tomoriId,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "incrementTomoriCounter",
          validationErrors: parsedTomori.error.flatten(),
        },
      };

      await log.error("Failed to validate Tomori data after counter update", parsedTomori.error, context);
      return null;
    }

    return parsedTomori.data;
  } catch (error) {
    const context: ErrorContext = {
      tomoriId,
      errorType: "DatabaseOperationError",
      metadata: {
        operation: "incrementTomoriCounter",
        minThreshold,
        maxThreshold,
      },
    };

    await log.error(`Error incrementing auto counter for Tomori ${tomoriId}`, error, context);
    return null;
  }
}

/**
 * Sets up a new server with Tomori in a single atomic transaction.
 * Creates server record, Tomori instance, config, and registers all server emojis.
 * Supports both guild channels and DM contexts (pseudo-servers).
 *
 * @param guild - The Discord guild to setup (null for DM contexts)
 * @param config - Configuration data for server setup
 * @returns All database rows created during setup
 * @throws If validation fails or any part of the setup transaction fails
 */
export async function setupServer(guild: Guild | null, config: SetupConfig): Promise<SetupResult> {
  // Validate input config - critical operation so we use Zod (Rule 3, Rule 5)
  const validConfig = setupConfigSchema.parse(config);

  // Detect if this is a DM context (no guild)
  const isDMChannel = guild === null;
  log.section(`Starting server setup transaction (${isDMChannel ? "DM" : "Guild"} context)`);

  try {
    // Start transaction for atomicity (Rule 15)
    const result = await sql.transaction(async (tx) => {
      let selectedLlm: { llm_id: number; llm_codename: string } | null = null;
      let selectedDiffusionModel: { diffusion_model_id: number; codename: string } | null = null;
      let selectedEmbeddingModel: { embedding_model_id: number; codename: string } | null = null;

      if (validConfig.provider) {
        // Find the default model for the selected provider within the transaction to avoid race conditions
        // First try to get the default model (is_default = true) for this provider, excluding deprecated
        selectedLlm = (
          await tx`
                SELECT * FROM llms
                WHERE llm_provider = ${validConfig.provider} 
                  AND is_default = true 
                  AND is_deprecated = false
                ORDER BY llm_id ASC
                LIMIT 1
            `
        )[0];

        // Fallback: if no default model found, get the first available non-deprecated model for this provider
        if (!selectedLlm) {
          selectedLlm = (
            await tx`
					SELECT * FROM llms
					WHERE llm_provider = ${validConfig.provider} 
					  AND is_deprecated = false
					ORDER BY llm_id ASC
					LIMIT 1
				`
          )[0];

          if (!selectedLlm) {
            throw new Error(`No available models found for provider: ${validConfig.provider}`);
          }

          log.warn(
            `No default model found for provider ${validConfig.provider}, using fallback: ${selectedLlm.llm_codename}`,
          );
        } else {
          log.info(`Using default model for ${validConfig.provider}: ${selectedLlm.llm_codename}`);
        }

        // Find the default diffusion model for the selected provider (for image generation)
        // First try to get the default diffusion model (is_default = true) for this provider, excluding deprecated
        selectedDiffusionModel = (
          await tx`
					SELECT * FROM image_diffusion_models
					WHERE provider = ${validConfig.provider}
					  AND is_default = true
					  AND is_deprecated = false
					ORDER BY diffusion_model_id ASC
					LIMIT 1
				`
        )[0];

        // Fallback: if no default diffusion model found, get the first available non-deprecated model for this provider
        if (!selectedDiffusionModel) {
          selectedDiffusionModel = (
            await tx`
						SELECT * FROM image_diffusion_models
						WHERE provider = ${validConfig.provider}
						  AND is_deprecated = false
						ORDER BY diffusion_model_id ASC
						LIMIT 1
					`
          )[0];

          if (selectedDiffusionModel) {
            log.warn(
              `No default diffusion model found for provider ${validConfig.provider}, using fallback: ${selectedDiffusionModel.codename}`,
            );
          } else {
            log.info(
              `No diffusion models available for provider ${validConfig.provider} (image generation not supported)`,
            );
          }
        } else {
          log.info(`Using default diffusion model for ${validConfig.provider}: ${selectedDiffusionModel.codename}`);
        }

        // Find the default embedding model for the selected provider (for document retrieval)
        selectedEmbeddingModel = (
          await tx`
					SELECT * FROM embedding_models
					WHERE provider = ${validConfig.provider}
					  AND is_default = true
					  AND is_deprecated = false
					ORDER BY embedding_model_id ASC
					LIMIT 1
				`
        )[0];

        // Fallback: if no default embedding model found, get the first available non-deprecated model
        if (!selectedEmbeddingModel) {
          selectedEmbeddingModel = (
            await tx`
						SELECT * FROM embedding_models
						WHERE provider = ${validConfig.provider}
						  AND is_deprecated = false
						ORDER BY embedding_model_id ASC
						LIMIT 1
					`
          )[0];

          if (selectedEmbeddingModel) {
            log.warn(
              `No default embedding model found for provider ${validConfig.provider}, using fallback: ${selectedEmbeddingModel.codename}`,
            );
          } else {
            log.info(
              `No embedding models available for provider ${validConfig.provider} (document retrieval not supported)`,
            );
          }
        } else {
          log.info(`Using default embedding model for ${validConfig.provider}: ${selectedEmbeddingModel.codename}`);
        }
      } else {
        if (validConfig.userByokMode) {
          log.info("Setup is bootstrapping BYOK-only mode with no server text provider");
        } else if (validConfig.deferredCustomEndpointSetup) {
          log.info("Setup is bootstrapping deferred custom-endpoint mode with no server text provider");
        } else {
          log.info("Setup is bootstrapping with no immediate server text provider");
        }
      }

      // Extract IDs (null when setup intentionally skips immediate server-provider defaults)
      const selectedLlmId = selectedLlm ? selectedLlm.llm_id : null;
      const selectedDiffusionModelId = selectedDiffusionModel ? selectedDiffusionModel.diffusion_model_id : null;
      const selectedEmbeddingModelId = selectedEmbeddingModel ? selectedEmbeddingModel.embedding_model_id : null;

      const presetRows = await tx<Array<{ preset_trigger_words: string[] | null; tomori_preset_desc: string | null }>>`
				SELECT preset_trigger_words, tomori_preset_desc
				FROM tomori_presets
				WHERE tomori_preset_id = ${validConfig.presetId}
				LIMIT 1
			`;
      const presetTriggerCandidates =
        presetRows[0]?.preset_trigger_words?.filter(
          (trigger): trigger is string => typeof trigger === "string" && trigger.trim().length > 0,
        ) ?? [];
      const dedupedPresetTriggers: string[] = [];
      const seenPresetTriggers = new Set<string>();
      for (const trigger of presetTriggerCandidates) {
        const normalized = trigger.trim().toLowerCase();
        if (seenPresetTriggers.has(normalized)) {
          continue;
        }
        seenPresetTriggers.add(normalized);
        dedupedPresetTriggers.push(trigger.trim());
      }

      const defaultTriggers =
        dedupedPresetTriggers.length > 0 ? dedupedPresetTriggers : getBaseTriggerWords(validConfig.locale);
      const presetPersonaPrompt = presetRows[0]?.tomori_preset_desc?.trim() || null;

      // 1. Create or update server record with DM support (Rule 15)
      // registration_locale is only set on INSERT (static field for analytics)
      const [server] = await tx`
				INSERT INTO servers (server_disc_id, is_dm_channel, registration_locale)
				VALUES (${validConfig.serverId}, ${isDMChannel}, ${validConfig.registrationLocale})
				ON CONFLICT (server_disc_id) DO UPDATE
				SET is_dm_channel = EXCLUDED.is_dm_channel
				RETURNING *
			`;

      // 2. Create Tomori instance with preset including description
      const [tomori] = await tx`
				INSERT INTO tomoris (
					server_id,
					tomori_nickname,
					attribute_list,
					sample_dialogues_in,
					sample_dialogues_out
				)
				VALUES (
					${server.server_id},
					${validConfig.tomoriName},
					(
						SELECT 
							array_prepend(
								'{bot}''s Description: ' || tomori_preset_desc,
								preset_attribute_list
							) 
						FROM tomori_presets 
						WHERE tomori_preset_id = ${validConfig.presetId}
					),
					(SELECT preset_sample_dialogues_in FROM tomori_presets WHERE tomori_preset_id = ${validConfig.presetId}),
					(SELECT preset_sample_dialogues_out FROM tomori_presets WHERE tomori_preset_id = ${validConfig.presetId})
				)
				RETURNING *
				`;

      // Format trigger words as PostgreSQL array
      const triggerWordsArrayLiteral = `{${defaultTriggers.map((t) => `"${t.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;

      const [config] = await tx`
				INSERT INTO tomori_configs (
					tomori_id,
					server_id,
					llm_id,
					embedding_model_id,
					api_key,
					key_version,
					trigger_words,
					humanizer_degree,
					attribute_memteaching_enabled,
					sampledialogue_memteaching_enabled,
					timezone_offset,
					diffusion_model_id,
					system_prompt,
					user_byok_mode
				)
				VALUES (
					${tomori.tomori_id},
					${server.server_id},
					${selectedLlmId},
					${selectedEmbeddingModelId},
					${validConfig.encryptedApiKey},
					${validConfig.keyVersion},
					${triggerWordsArrayLiteral}::text[],
					${validConfig.humanizer},
					${isDMChannel},
					${isDMChannel},
					${validConfig.timezoneOffset},
					${selectedDiffusionModelId},
					${DEFAULT_SYSTEM_PROMPT},
					${validConfig.userByokMode}
				)
				RETURNING *
			`;

      // Initialize persona-scoped config for the main persona.
      await tx`
				INSERT INTO persona_configs (tomori_id, trigger_words, persona_prompt)
				VALUES (${tomori.tomori_id}, ${triggerWordsArrayLiteral}::text[], ${presetPersonaPrompt})
				ON CONFLICT (tomori_id) DO NOTHING
			`;

      // Seed the saved_provider_configs row for the provider registered at setup.
      // Without this, /config model text shows "no saved providers" until the next bot restart
      // triggers the seed.sql backfill block.
      if (validConfig.provider && validConfig.encryptedApiKey && selectedLlmId) {
        await tx`
				INSERT INTO saved_provider_configs (
					server_id, provider, api_key, key_version,
					llm_id, diffusion_model_id, embedding_model_id,
					nai_diffusion_model_id, video_model_id, vision_llm_id,
					nai_preset_name, custom_endpoint_url, custom_model_name, custom_num_ctx,
					thinking_level, fallback_llm_ids, channel_llm_overrides, persona_llm_overrides,
					llm_temperature, llm_top_p, llm_top_k,
					llm_frequency_penalty, llm_presence_penalty, llm_min_p,
					llm_max_output_tokens,
					llm_logit_biases, llm_disabled_params
				) VALUES (
					${server.server_id}, ${validConfig.provider}, ${validConfig.encryptedApiKey}, ${validConfig.keyVersion},
					${selectedLlmId}, ${selectedDiffusionModelId}, ${selectedEmbeddingModelId},
					NULL, NULL, NULL,
					NULL, NULL, NULL, NULL,
					'auto', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
					NULL, NULL, NULL,
					NULL, NULL, NULL,
					NULL,
					'[]'::jsonb, '{}'::text[]
				)
				ON CONFLICT (server_id, provider) DO NOTHING
			`;
      }

      // 4. Register guild emojis in bulk insert (only for guild contexts, Rule 16)
      const emojis = [];
      if (!isDMChannel && guild) {
        const emojiValues = Array.from(guild.emojis.cache.values()).map((e) => ({
          emoji_disc_id: e.id,
          emoji_name: e.name ?? "",
          emotion_key: "unset", // Add the emotion_key field
          is_animated: e.animated || false, // Track if emoji is animated
        }));

        for (const { emoji_disc_id, emoji_name, emotion_key, is_animated } of emojiValues) {
          const [row] = await tx`
				INSERT INTO server_emojis (
					server_id,
					emoji_disc_id,
					emoji_name,
					emotion_key,
					is_animated
				)
					VALUES (
					${server.server_id},
					${emoji_disc_id},
					${emoji_name},
					${emotion_key},
					${is_animated}
					)
					RETURNING *
				`;
          emojis.push(row);
        }
      } else {
        log.info("Skipping emoji registration for DM context");
      }

      // 5. Register guild stickers (only for guild contexts)
      const stickers = [];
      if (!isDMChannel && guild) {
        log.info(`Registering stickers for server ${server.server_id}`);
        const stickerValues = Array.from(guild.stickers.cache.values()).map((s) => ({
          sticker_disc_id: s.id,
          sticker_name: s.name,
          sticker_desc: s.description ?? "",
          emotion_key: "unset",
          // is_animated: s.format === StickerFormatType.Lottie, // Remove this line
          sticker_format: s.format, // Store the actual format type enum value
        }));

        for (const {
          sticker_disc_id,
          sticker_name,
          sticker_desc,
          emotion_key,
          // is_animated, // Remove from destructuring
          sticker_format, // Add to destructuring
        } of stickerValues) {
          const [row] = await tx`
                        INSERT INTO server_stickers (
                            server_id,
                            sticker_disc_id,
                            sticker_name,
                            sticker_desc,
                            emotion_key,
                            sticker_format -- Add to INSERT
                            -- is_global defaults to false in DB schema
                        ) VALUES (
                            ${server.server_id},
                            ${sticker_disc_id},
                            ${sticker_name},
                            ${sticker_desc},
                            ${emotion_key},
                            ${sticker_format} -- Add value
                        )
                        ON CONFLICT (server_id, sticker_disc_id) DO NOTHING
                        RETURNING *
                    `;
          if (row) {
            stickers.push(row);
          }
        }
        log.info(`Finished registering ${stickers.length} stickers.`);
      } else {
        log.info("Skipping sticker registration for DM context");
      }

      // Return all created records
      return {
        server,
        tomori,
        config,
        emojis,
        stickers,
      };
    });

    // Validate output structure but don't overwrite the result
    setupResultSchema.parse(result);

    log.success(
      `${isDMChannel ? "DM pseudo-server" : "Server"} setup completed successfully for Server ID (${validConfig.serverId})`,
    );
    if (!isDMChannel) {
      log.info(`Registered ${result.emojis.length} emojis and ${result.stickers.length} stickers`);
    } else {
      log.info("DM setup completed - emoji/sticker registration skipped");
    }

    return result;
  } catch (error) {
    log.error("Server setup transaction failed:", error);
    throw error; // Re-throw to let caller handle the error
  }
}

/**
 * Updates a TomoriConfig record with partial data.
 * Uses zod's .partial() schema for validation and SQL RETURNING for atomicity.
 *
 * @param serverId - The server_id of the config to update
 * @param configData - Partial data to update (only specified fields will be changed)
 * @returns The updated TomoriConfigRow or null if update failed
 */
export async function updateTomoriConfig(
  serverId: number,
  configData: Partial<TomoriConfigRow>,
): Promise<TomoriConfigRow | null> {
  try {
    // Validate the partial data with Zod (Rule #7)
    const validConfigData = tomoriConfigSchema.partial().parse(configData);

    // Extract field names and values for the SQL query.
    // Filter to only keys that were in the original input — Zod injects defaults for all
    // schema fields with .default(), which would incorrectly expand the SET clause.
    const fields = Object.keys(validConfigData).filter(
      (key) => key !== "tomori_id" && key !== "tomori_config_id" && key in configData,
    );

    if (fields.length === 0) {
      log.warn(`No fields provided to update for server_id: ${serverId}`);
      return null;
    }

    // Security validation: Ensure all field names are whitelisted to prevent SQL injection
    validateTomoriConfigFields(fields);

    // Dynamically build the SQL SET clause
    // 1. Prepare arrays for placeholders and values
    const setParts: string[] = [];
    const values: SqlParameterArray = [];

    // 2. Iterate through fields to build SET clause parts and collect values
    fields.forEach((field, index) => {
      // Use PostgreSQL standard placeholders ($1, $2, etc.)
      setParts.push(`${field} = $${index + 1}`);
      // Add the corresponding value to the values array
      values.push(validConfigData[field as keyof typeof validConfigData]);
    });

    // 3. Join the SET parts
    const setClause = setParts.join(", ");

    // 4. Add the tomoriId as the last parameter for the WHERE clause
    const finalPlaceholderIndex = values.length + 1;
    values.push(serverId);

    // 5. Execute the UPDATE using sql.unsafe() with the values array (not spread —
    // Bun SQL expects a single array argument, not individual arguments).
    const result = await sql.unsafe(
      `
			UPDATE tomori_configs
			SET ${setClause}
			WHERE server_id = $${finalPlaceholderIndex}
			RETURNING *
		`,
      values, // Pass values as a single array — sql.unsafe(query, valuesArray)
    );

    if (!result.length) {
      const context: ErrorContext = {
        serverId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "updateTomoriConfig",
          fields,
        },
      };
      await log.error(`No tomori_config found with server_id: ${serverId}`, new Error("Config not found"), context);
      return null;
    }

    // Validate the returned data for type safety (Rule #5)
    const updatedConfig = tomoriConfigSchema.safeParse(result[0]);
    if (!updatedConfig.success) {
      const context: ErrorContext = {
        serverId,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "updateTomoriConfig",
          validationErrors: updatedConfig.error.flatten(),
        },
      };
      await log.error(`Failed to validate updated config for server_id: ${serverId}`, updatedConfig.error, context);
      return null;
    }

    return updatedConfig.data;
  } catch (error) {
    const context: ErrorContext = {
      serverId,
      errorType: "DatabaseUpdateError",
      metadata: {
        operation: "updateTomoriConfig",
      },
    };
    await log.error(`Error updating tomori_config for server_id: ${serverId}`, error, context);
    return null;
  }
}

/**
 * Previously converted NAI-scale temperature back to a Gemini-centric scale.
 * Now a direct passthrough — temperature is stored as-is across all providers.
 *
 * @param naiTemp - Temperature from the NAI preset
 * @param _model - The LLM codename (unused, kept for call-site compatibility)
 * @returns The temperature unchanged, clamped to the valid DB range [0.0, 2.0]
 */
function invertNaiTemperature(naiTemp: number, _model: string): number {
  return Math.min(2.0, Math.max(0.0, naiTemp));
}

/**
 * Applies a NovelAI sampling preset to a server's configuration.
 *
 * Extracts schema-compatible fields (temperature, top_k, top_p, min_p) from
 * the preset's parameters, converts temperature back to Gemini scale, and
 * writes them alongside nai_preset_name to tomori_configs. NAI-specific fields
 * (order, tail_free_sampling, phrase_rep_pen, etc.) remain in the preset row
 * and are merged at generation time via extractNonSchemaPresetParams().
 *
 * @param serverId - Database server_id of the server to update
 * @param preset - The NaiPresetRow to apply
 * @param model - LLM codename (e.g. "kayra-v1") for temperature conversion
 * @returns The updated TomoriConfigRow, or null if the update failed
 */
export async function applyNaiPreset(
  serverId: number,
  preset: NaiPresetRow,
  model: string,
): Promise<TomoriConfigRow | null> {
  const params = preset.parameters;

  // 1. Extract schema-compatible sampling fields from the preset.
  //    Absent values fall back to neutral/disabled DB defaults.
  const naiTemp = typeof params.temperature === "number" ? params.temperature : 1.35;
  const llm_temperature = invertNaiTemperature(naiTemp, model);
  const llm_top_k = typeof params.top_k === "number" ? Math.round(params.top_k) : 0;
  const llm_top_p = typeof params.top_p === "number" ? params.top_p : 1.0;
  const llm_min_p = typeof params.min_p === "number" ? params.min_p : 0.05;

  // 2. Write to DB, linking the preset name for non-schema field lookup at generation time.
  return updateTomoriConfig(serverId, {
    llm_temperature,
    llm_top_k,
    llm_top_p,
    llm_min_p,
    nai_preset_name: preset.preset_name,
  });
}

/**
 * Updates a Tomori record with partial data.
 * Uses zod's .partial() schema for validation and SQL RETURNING for atomicity.
 *
 * @param tomoriId - The tomori_id to update
 * @param tomoriData - Partial data to update (only specified fields will be changed)
 * @returns The updated TomoriRow or null if update failed
 */
export async function updateTomori(tomoriId: number, tomoriData: Partial<TomoriRow>): Promise<TomoriRow | null> {
  try {
    // Validate the partial data with Zod (Rule #7)
    const validTomoriData = tomoriSchema.partial().parse(tomoriData);

    // Extract field names and values for the SQL query.
    // Filter to only keys present in the original input — Zod injects defaults
    // for all schema fields with .default(), which would incorrectly expand the
    // SET clause (e.g. attribute_list: [] would overwrite existing data).
    const fields = Object.keys(validTomoriData).filter((key) => key !== "tomori_id" && key in tomoriData);

    if (fields.length === 0) {
      log.warn(`No fields provided to update for tomori_id: ${tomoriId}`);
      return null;
    }

    // Security validation: Ensure all field names are whitelisted to prevent SQL injection
    validateTomoriFields(fields);

    // 1. Prepare arrays for placeholders and values
    const setParts: string[] = [];
    const values: SqlParameterArray = [];

    // 2. Iterate through fields to build SET clause parts and collect values.
    // sql.unsafe() cannot infer PostgreSQL column types, so JavaScript arrays
    // must be manually serialized to PostgreSQL array literals (e.g. {"a","b"}).
    fields.forEach((field, index) => {
      setParts.push(`${field} = $${index + 1}`); // Use $1, $2, etc.
      const rawValue = validTomoriData[field as keyof typeof validTomoriData];
      if (Array.isArray(rawValue)) {
        // Serialize to PostgreSQL array literal: {"val1","val2"} or {}
        const escaped = rawValue.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`);
        values.push(`{${escaped.join(",")}}`);
      } else {
        values.push(rawValue);
      }
    });

    // 3. Join the SET parts
    const setClause = setParts.join(", ");

    // 4. Add the tomoriId as the last parameter for the WHERE clause
    const finalPlaceholderIndex = values.length + 1;
    values.push(tomoriId);

    // 5. Execute the UPDATE using sql.unsafe() with the values array (not spread —
    // Bun SQL expects a single array argument, not individual arguments).
    const result = await sql.unsafe(
      `
			UPDATE tomoris
			SET ${setClause}
			WHERE tomori_id = $${finalPlaceholderIndex}
			RETURNING *
		`,
      values, // Pass values as a single array — sql.unsafe(query, valuesArray)
    );

    if (!result.length) {
      const context: ErrorContext = {
        tomoriId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "updateTomori",
          fields,
        },
      };
      await log.error(`No tomori found with id: ${tomoriId}`, new Error("Tomori not found"), context);
      return null;
    }

    // Validate the returned data for type safety
    const updatedTomori = tomoriSchema.safeParse(result[0]);
    if (!updatedTomori.success) {
      const context: ErrorContext = {
        tomoriId,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "updateTomori",
          validationErrors: updatedTomori.error.flatten(),
        },
      };
      await log.error(`Failed to validate updated tomori for id: ${tomoriId}`, updatedTomori.error, context);
      return null;
    }

    return updatedTomori.data;
  } catch (error) {
    const context: ErrorContext = {
      tomoriId,
      errorType: "DatabaseUpdateError",
      metadata: {
        operation: "updateTomori",
      },
    };
    await log.error(`Error updating tomori for id: ${tomoriId}`, error, context);
    return null;
  }
}

/**
 * Updates a User record with partial data.
 * Uses zod's .partial() schema for validation and SQL RETURNING for atomicity.
 *
 * @param userId - The user_id to update
 * @param userData - Partial data to update (only specified fields will be changed)
 * @returns The updated UserRow or null if update failed
 */
export async function updateUser(userId: number, userData: Partial<UserRow>): Promise<UserRow | null> {
  try {
    // Validate the partial data with Zod (Rule #7)
    const validUserData = userSchema.partial().parse(userData);

    // Extract field names and values for the SQL query.
    // Filter to only keys present in the original input — Zod injects defaults
    // for all schema fields with .default(), which would incorrectly expand the
    // SET clause (e.g. personal_memories: [] would overwrite existing data).
    const fields = Object.keys(validUserData).filter((key) => key !== "user_id" && key in userData);

    if (fields.length === 0) {
      log.warn(`No fields provided to update for user_id: ${userId}`);
      return null;
    }

    // Security validation: Ensure all field names are whitelisted to prevent SQL injection
    validateUserFields(fields);

    // 1. Prepare arrays for placeholders and values
    const setParts: string[] = [];
    const values: SqlParameterArray = [];

    // 2. Iterate through fields to build SET clause parts and collect values.
    // sql.unsafe() cannot infer PostgreSQL column types, so JavaScript arrays
    // must be manually serialized to PostgreSQL array literals (e.g. {"a","b"}).
    fields.forEach((field, index) => {
      setParts.push(`${field} = $${index + 1}`); // Use $1, $2, etc.
      const rawValue = validUserData[field as keyof typeof validUserData];
      if (Array.isArray(rawValue)) {
        const escaped = rawValue.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`);
        values.push(`{${escaped.join(",")}}`);
      } else {
        values.push(rawValue);
      }
    });

    // 3. Join the SET parts
    const setClause = setParts.join(", ");

    // 4. Add the userId as the last parameter for the WHERE clause
    const finalPlaceholderIndex = values.length + 1;
    values.push(userId);

    // 5. Execute the UPDATE using sql.unsafe() with the values array (not spread —
    // Bun SQL expects a single array argument, not individual arguments).
    const result = await sql.unsafe(
      `
            UPDATE users
            SET ${setClause}
            WHERE user_id = $${finalPlaceholderIndex}
            RETURNING *
        `,
      values, // Pass values as a single array — sql.unsafe(query, valuesArray)
    );

    if (!result.length) {
      const context: ErrorContext = {
        userId,
        errorType: "DatabaseUpdateError",
        metadata: {
          operation: "updateUser",
          fields,
        },
      };
      await log.error(`No user found with id: ${userId}`, new Error("User not found"), context);
      return null;
    }

    // Validate the returned data for type safety
    const updatedUser = userSchema.safeParse(result[0]);
    if (!updatedUser.success) {
      const context: ErrorContext = {
        userId,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "updateUser",
          validationErrors: updatedUser.error.flatten(),
        },
      };
      await log.error(`Failed to validate updated user for id: ${userId}`, updatedUser.error, context);
      return null;
    }

    return updatedUser.data;
  } catch (error) {
    const context: ErrorContext = {
      userId,
      errorType: "DatabaseUpdateError",
      metadata: {
        operation: "updateUser",
      },
    };
    await log.error(`Error updating user for id: ${userId}`, error, context);
    return null;
  }
}

/**
 * Adds a new server-wide memory, initiated by Tomori itself due to an interaction.
 * This memory is associated with a specific server and the user whose interaction triggered the learning.
 *
 * @param serverId - The internal ID of the server this memory pertains to.
 * @param tomoriId - The internal persona ID this memory belongs to.
 * @param personaLineageId - Shared persona lineage namespace for this memory.
 * @param taughtByUserId - The internal ID of the user whose interaction led to Tomori learning this.
 * @param content - The text content of the memory to be saved.
 * @returns The newly created ServerMemoryRow, or null if the operation failed.
 */
export async function addServerMemoryByTomori(
  serverId: number,
  tomoriId: number,
  personaLineageId: number,
  taughtByUserId: number,
  content: string,
  tags: string[] = [],
): Promise<ServerMemoryRow | null> {
  // 1. Log the attempt to add a server memory.
  log.info(
    `Tomori is attempting to self-learn a server memory for server ID ${serverId}, tomori ID ${tomoriId}, lineage ${personaLineageId} (triggered by user ID ${taughtByUserId}): "${content.substring(0, 50)}..."`,
  );

  // 2. Validate memory content before database operations
  const contentValidation = validateMemoryContent(content);
  if (!contentValidation.isValid) {
    log.warn(`Server memory content validation failed for server ID ${serverId}: ${contentValidation.error}`);
    return null;
  }

  // 3. Check server memory limit
  const serverLimitCheck = await checkServerMemoryLimit(serverId, personaLineageId);
  if (!serverLimitCheck.isValid) {
    log.warn(
      `Server memory limit exceeded for server ID ${serverId}: ${serverLimitCheck.currentCount}/${serverLimitCheck.maxAllowed}`,
    );
    return null;
  }

  try {
    // 2. Insert the new memory into the server_memories table.
    // The columns now correctly match the serverMemorySchema.
    const [newMemory] = await sql`
			INSERT INTO server_memories (server_id, tomori_id, persona_lineage_id, user_id, content, tags)
			VALUES (${serverId}, ${tomoriId}, ${personaLineageId}, ${taughtByUserId}, ${content}, ${sql.array(tags)})
			RETURNING *
		`;

    // 3. Validate the returned data using Zod schema (Rule 3, Rule 5, Rule 6).
    const validatedMemory = serverMemorySchema.safeParse(newMemory);

    if (!validatedMemory.success) {
      const context: ErrorContext = {
        serverId,
        tomoriId,
        userId: taughtByUserId,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "addServerMemoryByTomori",
          contentAttempted: content.substring(0, 100),
          validationErrors: validatedMemory.error.flatten(),
        },
      };
      await log.error(`Failed to validate new server memory for server ID ${serverId}`, validatedMemory.error, context);
      return null;
    }

    // 4. Log success and return the validated memory.
    log.success(
      `Tomori successfully saved a new server memory (ID: ${validatedMemory.data.server_memory_id}) for server ID ${serverId}, tomori ID ${tomoriId}, taught by user ID ${taughtByUserId}.`,
    );
    return validatedMemory.data;
  } catch (error) {
    const context: ErrorContext = {
      serverId,
      tomoriId,
      userId: taughtByUserId,
      errorType: "DatabaseInsertError",
      metadata: {
        operation: "addServerMemoryByTomori",
        contentAttempted: content.substring(0, 100),
      },
    };
    await log.error(`Error adding server memory for server ID ${serverId}`, error, context);
    return null;
  }
}
/**
 * Adds a new lineage-scoped personal memory for a user.
 *
 * @param userId - The internal ID of the user for whom the memory is being saved.
 * @param personaLineageId - Persona lineage namespace for the memory.
 * @param content - The text content of the memory to be appended.
 * @returns The inserted PersonalMemoryRow, or null if the operation failed.
 */
export async function addPersonalMemoryByTomori(
  userId: number,
  personaLineageId: number,
  content: string,
  tags: string[] = [],
): Promise<PersonalMemoryRow | null> {
  // 1. Log the attempt to add a personal memory.
  log.info(
    `Tomori is attempting to self-learn a personal memory for user ${userId} in lineage ${personaLineageId}: "${content.substring(0, 50)}..."`,
  );

  // 2. Validate memory content before database operations
  const contentValidation = validateMemoryContent(content);
  if (!contentValidation.isValid) {
    log.warn(`Personal memory content validation failed for user ID ${userId}: ${contentValidation.error}`);
    return null;
  }

  // 3. Check personal memory limit
  const personalLimitCheck = await checkPersonalMemoryLimit(userId, personaLineageId, true);
  if (!personalLimitCheck.isValid) {
    log.warn(
      `Personal memory limit exceeded for user ID ${userId}: ${personalLimitCheck.currentCount}/${personalLimitCheck.maxAllowed}`,
    );
    return null;
  }

  try {
    const [insertedMemory] = await sql`
			INSERT INTO personal_memories (user_id, persona_lineage_id, content, tags)
			VALUES (${userId}, ${personaLineageId}, ${content}, ${sql.array(tags)})
			RETURNING *
		`;

    if (!insertedMemory) {
      log.warn(`Attempted to insert personal memory for non-existent user ${userId}`);
      return null;
    }

    const validatedMemory = personalMemorySchema.safeParse(insertedMemory);
    if (!validatedMemory.success) {
      const context: ErrorContext = {
        userId,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "addPersonalMemoryByTomori",
          personaLineageId,
          contentAttempted: content.substring(0, 100),
          validationErrors: validatedMemory.error.flatten(),
        },
      };
      await log.error(
        `Failed to validate inserted personal memory for user ${userId} in lineage ${personaLineageId}`,
        validatedMemory.error,
        context,
      );
      return null;
    }

    log.success(
      `Tomori successfully inserted personal memory (ID: ${validatedMemory.data.personal_memory_id}) for user ${userId} in lineage ${personaLineageId}.`,
    );
    return validatedMemory.data;
  } catch (error) {
    const context: ErrorContext = {
      userId,
      errorType: "DatabaseUpdateError",
      metadata: {
        operation: "addPersonalMemoryByTomori",
        personaLineageId,
        contentAttempted: content.substring(0, 100),
      },
    };
    await log.error(
      `Error inserting personal memory for user ${userId} in lineage ${personaLineageId}`,
      error,
      context,
    );
    return null;
  }
}

/**
 * Creates a new reminder in the database
 * @param reminderData - Object containing all reminder details
 * @returns The created ReminderRow object, or null if creation failed
 */
export async function addReminder(reminderData: {
  server_id: number;
  channel_disc_id: string;
  user_discord_id: string;
  user_nickname: string;
  reminder_purpose: string;
  reminder_time: Date;
  repetition_interval_hours?: number | null;
  self_reminder?: boolean | null;
  created_by_user_id: number | null;
  persona_id?: number | null;
}): Promise<ReminderRow | null> {
  try {
    log.info(
      `Creating reminder for user ${reminderData.user_nickname} (${reminderData.user_discord_id}) ` +
        `in server ${reminderData.server_id} at ${reminderData.reminder_time.toISOString()}`,
    );

    // Insert the new reminder into the database
    const [reminderResult] = await sql`
			INSERT INTO reminders (
				server_id,
				channel_disc_id,
				user_discord_id,
				user_nickname,
				reminder_purpose,
				reminder_time,
				repetition_interval_hours,
				self_reminder,
				created_by_user_id,
				persona_id
			) VALUES (
				${reminderData.server_id},
				${reminderData.channel_disc_id},
				${reminderData.user_discord_id},
				${reminderData.user_nickname},
				${reminderData.reminder_purpose},
				${reminderData.reminder_time},
				${reminderData.repetition_interval_hours ?? null},
				${reminderData.self_reminder ?? false},
				${reminderData.created_by_user_id},
				${reminderData.persona_id ?? null}
			)
			RETURNING *
		`;

    // Check if the reminder was created
    if (!reminderResult) {
      log.warn("Failed to create reminder: No result returned from database");
      return null;
    }

    // Validate the returned reminder data using Zod schema
    const validatedReminder = reminderSchema.safeParse(reminderResult);

    if (!validatedReminder.success) {
      const context: ErrorContext = {
        serverId: reminderData.server_id,
        userId: reminderData.created_by_user_id,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "addReminder",
          reminderPurpose: reminderData.reminder_purpose.substring(0, 100),
          targetUser: reminderData.user_discord_id,
          validationErrors: validatedReminder.error.flatten(),
        },
      };
      await log.error(
        `Failed to validate new reminder for user ${reminderData.user_discord_id}`,
        validatedReminder.error,
        context,
      );
      return null;
    }

    // Log success and return the validated reminder
    log.success(
      `Reminder successfully created (ID: ${validatedReminder.data.reminder_id}) ` +
        `for ${reminderData.user_nickname} at ${reminderData.reminder_time.toISOString()}`,
    );
    emitScheduledWorkNudge(`reminder-create:${validatedReminder.data.reminder_id ?? "unknown"}`);
    return validatedReminder.data;
  } catch (error) {
    const context: ErrorContext = {
      serverId: reminderData.server_id,
      userId: reminderData.created_by_user_id,
      errorType: "DatabaseInsertError",
      metadata: {
        operation: "addReminder",
        reminderPurpose: reminderData.reminder_purpose.substring(0, 100),
        targetUser: reminderData.user_discord_id,
      },
    };
    await log.error(`Error creating reminder for user ${reminderData.user_discord_id}`, error, context);
    return null;
  }
}

/**
 * Reschedules an existing reminder to a new time (used for recurring reminders).
 * @param reminderId - The reminder ID to update
 * @param nextReminderTime - The next scheduled reminder time
 * @returns The updated ReminderRow object, or null if update failed
 */
export async function rescheduleReminder(reminderId: number, nextReminderTime: Date): Promise<ReminderRow | null> {
  try {
    const [updatedReminder] = await sql`
			UPDATE reminders
			SET reminder_time = ${nextReminderTime},
				updated_at = CURRENT_TIMESTAMP
			WHERE reminder_id = ${reminderId}
			RETURNING *
		`;

    if (!updatedReminder) {
      log.warn(`Failed to reschedule reminder ${reminderId} (no row returned)`);
      return null;
    }

    const validatedReminder = reminderSchema.safeParse(updatedReminder);
    if (!validatedReminder.success) {
      const context: ErrorContext = {
        errorType: "SchemaValidationError",
        metadata: {
          operation: "rescheduleReminder",
          reminderId,
          validationErrors: validatedReminder.error.flatten(),
        },
      };
      await log.error(
        `Failed to validate reminder after reschedule (ID: ${reminderId})`,
        validatedReminder.error,
        context,
      );
      return null;
    }

    log.success(`Reminder rescheduled (ID: ${reminderId}) to ${nextReminderTime.toISOString()}`);
    emitScheduledWorkNudge(`reminder-reschedule:${reminderId}`);
    return validatedReminder.data;
  } catch (error) {
    const context: ErrorContext = {
      errorType: "DatabaseUpdateError",
      metadata: {
        operation: "rescheduleReminder",
        reminderId,
        nextReminderTime: nextReminderTime.toISOString(),
      },
    };
    await log.error(`Error rescheduling reminder ${reminderId}`, error, context);
    return null;
  }
}

export async function updateReminder(reminderData: {
  reminder_id: number;
  reminder_purpose: string;
  reminder_time: Date;
  repetition_interval_hours: number | null;
  self_reminder: boolean;
  user_discord_id: string;
  user_nickname: string;
  server_id: number;
  owner_user_id?: number;
}): Promise<ReminderRow | null> {
  try {
    const baseUpdate = sql`
      UPDATE reminders
      SET
        reminder_purpose = ${reminderData.reminder_purpose},
        reminder_time = ${reminderData.reminder_time},
        repetition_interval_hours = ${reminderData.repetition_interval_hours},
        self_reminder = ${reminderData.self_reminder},
        user_discord_id = ${reminderData.user_discord_id},
        user_nickname = ${reminderData.user_nickname},
        updated_at = CURRENT_TIMESTAMP
      WHERE reminder_id = ${reminderData.reminder_id}
        AND server_id = ${reminderData.server_id}
    `;

    const updateQuery =
      typeof reminderData.owner_user_id === "number"
        ? sql`${baseUpdate} AND created_by_user_id = ${reminderData.owner_user_id} RETURNING *`
        : sql`${baseUpdate} RETURNING *`;

    const [updatedReminder] = await updateQuery;
    if (!updatedReminder) {
      log.warn(`Failed to update reminder ${reminderData.reminder_id} (no row returned)`);
      return null;
    }

    const validatedReminder = reminderSchema.safeParse(updatedReminder);
    if (!validatedReminder.success) {
      const context: ErrorContext = {
        serverId: reminderData.server_id,
        userId: reminderData.owner_user_id,
        errorType: "SchemaValidationError",
        metadata: {
          operation: "updateReminder",
          reminderId: reminderData.reminder_id,
          validationErrors: validatedReminder.error.flatten(),
        },
      };
      await log.error(
        `Failed to validate reminder after update (ID: ${reminderData.reminder_id})`,
        validatedReminder.error,
        context,
      );
      return null;
    }

    log.success(`Reminder updated (ID: ${reminderData.reminder_id}) to ${reminderData.reminder_time.toISOString()}`);
    emitScheduledWorkNudge(`reminder-update:${reminderData.reminder_id}`);
    return validatedReminder.data;
  } catch (error) {
    const context: ErrorContext = {
      serverId: reminderData.server_id,
      userId: reminderData.owner_user_id,
      errorType: "DatabaseUpdateError",
      metadata: {
        operation: "updateReminder",
        reminderId: reminderData.reminder_id,
      },
    };
    await log.error(`Error updating reminder ${reminderData.reminder_id}`, error, context);
    return null;
  }
}

// ─── Random Trigger Write Functions ─────────────────────────────────────────

/**
 * Data shape for creating or updating a random trigger.
 */
interface RandomTriggerData {
  serverId: number;
  channelDiscId: string;
  tomoriId: number | null;
  timerHours: number;
  randomOffsetRange: number | null;
  chancePercent: number;
  silenceThresholdHours: number | null;
  respondToSelf: boolean;
  customPrompt: string | null;
  failureThreshold: number | null; // NULL = disabled; force-fire after N consecutive dice misses
}

/**
 * Inserts a new random trigger into the database.
 * next_trigger_at is automatically set to NOW() + timer_hours.
 *
 * @param data - Trigger configuration data.
 * @returns The inserted RandomTriggerRow, or null on failure.
 */
export async function insertRandomTrigger(data: RandomTriggerData): Promise<RandomTriggerRow | null> {
  try {
    // 1. Insert trigger; schedule first roll after one full timer cycle
    const [row] = await sql`
			INSERT INTO random_triggers (
				server_id,
				channel_disc_id,
				tomori_id,
				timer_hours,
				random_offset_range,
				chance_percent,
				silence_threshold_hours,
				respond_to_self,
				custom_prompt,
				failure_threshold,
				consecutive_failures,
				next_trigger_at
			) VALUES (
				${data.serverId},
				${data.channelDiscId},
				${data.tomoriId},
				${data.timerHours},
				${data.randomOffsetRange},
				${data.chancePercent},
				${data.silenceThresholdHours},
				${data.respondToSelf},
				${data.customPrompt},
				${data.failureThreshold},
				0,
				NOW() + (${data.timerHours} * INTERVAL '1 hour')
			)
			RETURNING *
		`;

    if (!row) {
      log.error("insertRandomTrigger: INSERT returned no rows");
      return null;
    }

    // 2. Validate with schema
    const parsed = randomTriggerSchema.safeParse(row);
    if (!parsed.success) {
      log.error("insertRandomTrigger: schema validation failed:", parsed.error);
      return null;
    }

    log.success(`Random trigger created (id=${parsed.data.trigger_id}) for channel ${data.channelDiscId}`);
    emitScheduledWorkNudge(`random-trigger-create:${parsed.data.trigger_id ?? "unknown"}`);
    return parsed.data;
  } catch (error) {
    const context: ErrorContext = {
      serverId: data.serverId,
      errorType: "DatabaseInsertError",
      metadata: { operation: "insertRandomTrigger", ...data },
    };
    await log.error("Error inserting random trigger", error, context);
    return null;
  }
}

/**
 * Updates an existing random trigger in-place (override case for named personas).
 * next_trigger_at is rescheduled from now using the new timer_hours.
 *
 * @param triggerId - The trigger_id to update.
 * @param data - New trigger configuration data.
 * @returns The updated RandomTriggerRow, or null on failure.
 */
export async function upsertRandomTrigger(
  triggerId: number,
  data: RandomTriggerData,
): Promise<RandomTriggerRow | null> {
  try {
    // 1. Update the trigger and reschedule the next roll from now
    const [row] = await sql`
			UPDATE random_triggers SET
				timer_hours             = ${data.timerHours},
				random_offset_range     = ${data.randomOffsetRange},
				chance_percent          = ${data.chancePercent},
				silence_threshold_hours = ${data.silenceThresholdHours},
				respond_to_self         = ${data.respondToSelf},
				custom_prompt           = ${data.customPrompt},
				failure_threshold       = ${data.failureThreshold},
				consecutive_failures    = 0,
				next_trigger_at         = NOW() + (${data.timerHours} * INTERVAL '1 hour')
			WHERE trigger_id = ${triggerId}
			RETURNING *
		`;

    if (!row) {
      log.warn(`upsertRandomTrigger: no row found for trigger_id=${triggerId}`);
      return null;
    }

    // 2. Validate with schema
    const parsed = randomTriggerSchema.safeParse(row);
    if (!parsed.success) {
      log.error("upsertRandomTrigger: schema validation failed:", parsed.error);
      return null;
    }

    log.success(`Random trigger updated (id=${triggerId})`);
    emitScheduledWorkNudge(`random-trigger-update:${triggerId}`);
    return parsed.data;
  } catch (error) {
    const context: ErrorContext = {
      serverId: data.serverId,
      errorType: "DatabaseUpdateError",
      metadata: { operation: "upsertRandomTrigger", triggerId, ...data },
    };
    await log.error("Error updating random trigger", error, context);
    return null;
  }
}

/**
 * Deletes a random trigger by its primary key.
 *
 * @param triggerId - The trigger_id to delete.
 * @returns True if deleted successfully, false otherwise.
 */
export async function deleteRandomTrigger(triggerId: number): Promise<boolean> {
  try {
    // 1. Delete the trigger row
    await sql`
			DELETE FROM random_triggers
			WHERE trigger_id = ${triggerId}
		`;
    log.success(`Random trigger deleted (id=${triggerId})`);
    emitScheduledWorkNudge(`random-trigger-delete:${triggerId}`);
    return true;
  } catch (error) {
    const context: ErrorContext = {
      errorType: "DatabaseDeleteError",
      metadata: { operation: "deleteRandomTrigger", triggerId },
    };
    await log.error(`Error deleting random trigger ${triggerId}`, error, context);
    return false;
  }
}

/**
 * Reschedules a random trigger's next roll to NOW() + jittered hours.
 * Called by the timer after each execution (hit or miss).
 *
 * @param triggerId - The trigger_id to reschedule.
 * @param timerHours - The trigger's configured base interval (hours).
 * @param randomOffsetRange - Optional +/- offset range applied per reset.
 * @returns True if rescheduled successfully, false otherwise.
 */
export async function rescheduleRandomTrigger(
  triggerId: number,
  timerHours: number,
  randomOffsetRange: number | null,
  consecutiveFailures: number,
): Promise<boolean> {
  try {
    const normalizedOffsetRange = Math.max(0, randomOffsetRange ?? 0);
    const randomOffset =
      normalizedOffsetRange > 0
        ? Math.floor(Math.random() * (normalizedOffsetRange * 2 + 1)) - normalizedOffsetRange
        : 0;
    const nextTimerHours = Math.max(1, timerHours + randomOffset);

    // 1. Advance next_trigger_at and persist the current consecutive failure count
    const [row] = await sql`
			UPDATE random_triggers
			SET next_trigger_at      = NOW() + (${nextTimerHours} * INTERVAL '1 hour'),
			    consecutive_failures = ${consecutiveFailures}
			WHERE trigger_id = ${triggerId}
			RETURNING trigger_id
		`;
    if (!row) {
      log.warn(`rescheduleRandomTrigger: no row found for trigger_id=${triggerId}`);
      return false;
    }
    emitScheduledWorkNudge(`random-trigger-reschedule:${triggerId}`);
    return true;
  } catch (error) {
    const context: ErrorContext = {
      errorType: "DatabaseUpdateError",
      metadata: {
        operation: "rescheduleRandomTrigger",
        triggerId,
        timerHours,
        randomOffsetRange,
        consecutiveFailures,
      },
    };
    await log.error(`Error rescheduling random trigger ${triggerId}`, error, context);
    return false;
  }
}

/**
 * UPSERTs a channel-level LLM model override.
 * After calling, invalidate channelLlmCache for this channel.
 *
 * @param serverId - Database server ID (integer)
 * @param channelDiscId - Discord channel ID (snowflake string)
 * @param llmId - The llm_id to set as the override
 * @returns True on success, false on failure
 */
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
 * After calling, invalidate TomoriState cache for the server.
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
 * After calling, invalidate TomoriState cache for the server.
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
 * After calling, invalidate TomoriState cache for the server.
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

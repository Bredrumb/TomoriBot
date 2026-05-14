import type { SetupConfig, SetupResult } from "@/types/db/schema";
import {
  type ErrorContext,
  type RandomTriggerRow,
  randomTriggerSchema,
  type ReminderRow,
  reminderSchema,
  setupConfigSchema,
  setupResultSchema,
} from "@/types/db/schema";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { emitScheduledWorkNudge } from "@/timers/scheduledWorkSignals";
import { DEFAULT_SYSTEM_PROMPT } from "@/utils/text/contextBuilder";
import { getBaseTriggerWords } from "@/utils/text/localizer";
import type { Guild } from "discord.js";
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
 * LlmRepository invalidates channelLlmCache after a successful write.
 *
 * @param serverId - Database server ID (integer)
 * @param channelDiscId - Discord channel ID (snowflake string)
 * @param llmId - The llm_id to set as the override
 * @returns True on success, false on failure
 */

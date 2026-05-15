/**
 * ServerRepository — manages server identity, emojis/stickers, managed webhooks,
 * and the personalization blacklist.
 *
 * Also owns the atomic setupServer transaction (creates server + tomori rows).
 * Schedule domain (reminders + random triggers) lives in ServerScheduleRepository.
 *
 * Export contract: toExportShape / fromExportShape are required by IRepository
 * and consumed by the Phase 6 (#16.7) export pipeline composition.
 *
 * Size note: ~1,070 lines after Phase 5.5e Stage C SQL inline. setupServer is a
 * single unavoidably large transaction (~400 SQL lines) — splitting it would
 * separate transactional setup context from its server repository owner.
 * See refactor-integrity-audit.md Intentional Large File table.
 */
import type { Guild, GuildEmoji, Sticker } from "discord.js";
import type { ServerEmojiRow, ServerStickerRow, SetupConfig, SetupResult } from "@/types/db/schema";
import { serverEmojiSchema, serverStickerSchema, setupConfigSchema, setupResultSchema } from "@/types/db/schema";
import { toolRepository } from "@/utils/db/repositories/ToolRepository";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import { sql } from "@/utils/db/client";
import { log } from "@/utils/misc/logger";
import { keyManager } from "@/utils/security/keyManager";
import { DEFAULT_SYSTEM_PROMPT } from "@/utils/text/contextBuilder";
import { getBaseTriggerWords } from "@/utils/text/localizer";
import type { IRepository } from "./IRepository";

// ── Managed webhook types ──────────────────────────────────────────────────────

export const MANAGED_WEBHOOK_KIND_SHARED_CHANNEL = "shared_channel" as const;
export type ManagedWebhookKind = typeof MANAGED_WEBHOOK_KIND_SHARED_CHANNEL;

export type ManagedDiscordWebhookRow = {
  managed_webhook_id: number;
  guild_disc_id: string;
  kind: ManagedWebhookKind;
  channel_disc_id: string;
  webhook_disc_id: string;
  webhook_token: Buffer;
  key_version: number | null;
  created_at?: Date;
  updated_at?: Date;
};

// ── Emoji/sticker sync private types ──────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: transaction type is complex and internal to Bun's SQL library
type TransactionSql = any;

interface SyncItemExistingMetadata {
  emoji_desc?: string | null;
  sticker_desc?: string | null;
  emotion_key?: string | null;
}

interface SyncItemConfig<TDiscord, TDatabase> {
  tableName: string;
  idColumnName: string;
  nameColumnName: string;
  descColumnName: string;
  conflictColumns: string[];
  mapToDatabase: (item: TDiscord, existing: SyncItemExistingMetadata | undefined, serverId: number) => TDatabase;
  getDiscordId: (item: TDiscord) => string;
}

/** Portable server export shape (expanded in Phase 6 #16.7). */
export type ServerExportShape = {
  server_disc_id: string;
};

export class ServerRepository implements IRepository<ServerExportShape> {
  // ── server setup ───────────────────────────────────────────────────────────

  /**
   * Atomically sets up a new server: creates server, tomori, config, and emoji rows.
   *
   * @param guild  - Discord Guild (null for DM contexts)
   * @param config - Setup configuration
   */
  async setup(guild: Guild | null, config: SetupConfig): Promise<SetupResult> {
    return this.sqlSetupServer(guild, config);
  }

  // ── emoji / sticker reads ──────────────────────────────────────────────────

  /**
   * Loads all synced server emojis by internal server ID.
   *
   * @param internalServerId - Internal server DB ID
   */
  async loadEmojis(internalServerId: number): Promise<ServerEmojiRow[] | null> {
    return this.sqlLoadServerEmojis(internalServerId);
  }

  /**
   * Loads all synced server stickers by Discord server snowflake.
   *
   * @param serverDiscId - Discord server snowflake
   */
  async loadStickers(serverDiscId: string): Promise<ServerStickerRow[] | null> {
    return this.sqlLoadServerStickers(serverDiscId);
  }

  // ── blacklist ──────────────────────────────────────────────────────────────

  /**
   * Returns true if the user is blacklisted from the given server.
   *
   * @param serverDiscId - Discord server snowflake
   * @param userDiscId   - Discord user snowflake
   */
  async isBlacklisted(serverDiscId: string, userDiscId: string): Promise<boolean> {
    return userRepository.isBlacklisted(serverDiscId, userDiscId);
  }

  /**
   * Returns all blacklisted user Discord IDs for a server.
   *
   * @param serverId - Internal server DB ID
   */
  async getBlacklistedMemberIds(serverId: number): Promise<string[]> {
    return this.sqlGetBlacklistedMemberIds(serverId);
  }

  // ── Brave API key ──────────────────────────────────────────────────────────

  /**
   * Returns true if a Brave Search API key is configured for the server.
   *
   * @param serverId - Internal server DB ID
   */
  async getBraveApiKeyStatus(serverId: number): Promise<boolean> {
    return toolRepository.getBraveApiKeyStatus(serverId);
  }

  // ── managed webhooks ──────────────────────────────────────────────────────────

  /**
   * Upserts a managed Discord webhook for a channel.
   *
   * @param params - Webhook parameters (guildDiscId, kind, channelDiscId, webhookDiscId, rawToken)
   * @returns true on success, false on failure or missing params
   */
  async upsertManagedWebhook(params: {
    guildDiscId: string;
    kind?: ManagedWebhookKind;
    channelDiscId: string;
    webhookDiscId: string;
    rawToken: string;
  }): Promise<boolean> {
    return this.sqlUpsertManagedWebhook(params);
  }

  /**
   * Loads a managed Discord webhook row by channel and kind.
   *
   * @param channelDiscId - Discord channel snowflake
   * @param kind - Webhook kind (defaults to shared_channel)
   */
  async loadManagedWebhookByChannel(
    channelDiscId: string,
    kind: ManagedWebhookKind = MANAGED_WEBHOOK_KIND_SHARED_CHANNEL,
  ): Promise<ManagedDiscordWebhookRow | null> {
    return this.sqlLoadManagedWebhookByChannel(channelDiscId, kind);
  }

  /**
   * Loads a managed Discord webhook row by channel and webhook Discord ID.
   *
   * @param channelDiscId - Discord channel snowflake
   * @param webhookDiscId - Discord webhook snowflake
   * @param kind - Webhook kind (defaults to shared_channel)
   */
  async loadManagedWebhookByChannelAndWebhookId(
    channelDiscId: string,
    webhookDiscId: string,
    kind: ManagedWebhookKind = MANAGED_WEBHOOK_KIND_SHARED_CHANNEL,
  ): Promise<ManagedDiscordWebhookRow | null> {
    return this.sqlLoadManagedWebhookByChannelAndWebhookId(channelDiscId, webhookDiscId, kind);
  }

  /**
   * Deletes a managed Discord webhook by channel (and optionally webhook ID).
   *
   * @param channelDiscId - Discord channel snowflake
   * @param webhookDiscId - Optional Discord webhook snowflake
   * @param kind - Webhook kind (defaults to shared_channel)
   */
  async deleteManagedWebhook(
    channelDiscId: string,
    webhookDiscId?: string | null,
    kind: ManagedWebhookKind = MANAGED_WEBHOOK_KIND_SHARED_CHANNEL,
  ): Promise<boolean> {
    return this.sqlDeleteManagedWebhook(channelDiscId, webhookDiscId, kind);
  }

  /**
   * Decrypts the token for a managed Discord webhook row, rotating the key if outdated.
   *
   * @param row - ManagedDiscordWebhookRow with encrypted webhook_token
   * @returns Decrypted token string or null on failure
   */
  async decryptManagedWebhookToken(row: ManagedDiscordWebhookRow): Promise<string | null> {
    return this.sqlDecryptManagedWebhookToken(row);
  }

  // ── emoji / sticker sync ───────────────────────────────────────────────────

  /**
   * Syncs emojis from Discord to the database within a transaction.
   * Preserves existing metadata (emoji_desc, emotion_key).
   *
   * @param tx - Active PostgreSQL transaction
   * @param serverId - Internal server DB ID
   * @param currentEmojis - Current emoji list from Discord API
   * @returns Number of emojis synced
   */
  async syncEmojis(tx: TransactionSql, serverId: number, currentEmojis: GuildEmoji[]): Promise<number> {
    return this.syncItemsToDatabase(tx, serverId, currentEmojis, {
      tableName: "server_emojis",
      idColumnName: "emoji_disc_id",
      nameColumnName: "emoji_name",
      descColumnName: "emoji_desc",
      conflictColumns: ["server_id", "emoji_disc_id"],
      mapToDatabase: (emoji, existing, sid) => ({
        server_id: sid,
        emoji_disc_id: emoji.id,
        emoji_name: emoji.name ?? "",
        emoji_desc: (existing?.emoji_desc as string) ?? "",
        emotion_key: existing?.emotion_key && existing.emotion_key.trim().length > 0 ? existing.emotion_key : "unset",
        is_animated: emoji.animated ?? false,
      }),
      getDiscordId: (emoji) => emoji.id,
    });
  }

  /**
   * Syncs stickers from Discord to the database within a transaction.
   * Preserves existing metadata (sticker_desc, emotion_key).
   *
   * @param tx - Active PostgreSQL transaction
   * @param serverId - Internal server DB ID
   * @param currentStickers - Current sticker list from Discord API
   * @returns Number of stickers synced
   */
  async syncStickers(tx: TransactionSql, serverId: number, currentStickers: Sticker[]): Promise<number> {
    return this.syncItemsToDatabase(tx, serverId, currentStickers, {
      tableName: "server_stickers",
      idColumnName: "sticker_disc_id",
      nameColumnName: "sticker_name",
      descColumnName: "sticker_desc",
      conflictColumns: ["server_id", "sticker_disc_id"],
      mapToDatabase: (sticker, existing, sid) => ({
        server_id: sid,
        sticker_disc_id: sticker.id,
        sticker_name: sticker.name,
        sticker_desc: (existing?.sticker_desc as string) ?? sticker.description ?? "",
        emotion_key: existing?.emotion_key && existing.emotion_key.trim().length > 0 ? existing.emotion_key : "unset",
        sticker_format: sticker.format,
      }),
      getDiscordId: (sticker) => sticker.id,
    });
  }

  // ── private SQL: server setup ──────────────────────────────────────────────

  private async sqlSetupServer(guild: Guild | null, config: SetupConfig): Promise<SetupResult> {
    const validConfig = setupConfigSchema.parse(config);

    const isDMChannel = guild === null;
    log.section(`Starting server setup transaction (${isDMChannel ? "DM" : "Guild"} context)`);

    try {
      const result = await sql.transaction(async (tx) => {
        let selectedLlm: { llm_id: number; llm_codename: string } | null = null;
        let selectedDiffusionModel: { diffusion_model_id: number; codename: string } | null = null;
        let selectedEmbeddingModel: { embedding_model_id: number; codename: string } | null = null;

        if (validConfig.provider) {
          // Find the default model for the selected provider within the transaction
          // First try to get the default model (is_default = true), excluding deprecated
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

          // Fallback: if no default model found, get the first available non-deprecated model
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

          // Find the default diffusion model for the selected provider
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

          // Find the default embedding model for the selected provider
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

        const selectedLlmId = selectedLlm ? selectedLlm.llm_id : null;
        const selectedDiffusionModelId = selectedDiffusionModel ? selectedDiffusionModel.diffusion_model_id : null;
        const selectedEmbeddingModelId = selectedEmbeddingModel ? selectedEmbeddingModel.embedding_model_id : null;

        const presetRows = await tx<
          Array<{ preset_trigger_words: string[] | null; tomori_preset_desc: string | null }>
        >`
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

        // 1. Create or update server record with DM support
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

        // 4. Register guild emojis in bulk insert (only for guild contexts)
        const emojis = [];
        if (!isDMChannel && guild) {
          const emojiValues = Array.from(guild.emojis.cache.values()).map((e) => ({
            emoji_disc_id: e.id,
            emoji_name: e.name ?? "",
            emotion_key: "unset",
            is_animated: e.animated || false,
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
            sticker_format: s.format,
          }));

          for (const { sticker_disc_id, sticker_name, sticker_desc, emotion_key, sticker_format } of stickerValues) {
            const [row] = await tx`
              INSERT INTO server_stickers (
                server_id,
                sticker_disc_id,
                sticker_name,
                sticker_desc,
                emotion_key,
                sticker_format
              ) VALUES (
                ${server.server_id},
                ${sticker_disc_id},
                ${sticker_name},
                ${sticker_desc},
                ${emotion_key},
                ${sticker_format}
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

        return {
          server,
          tomori,
          config,
          emojis,
          stickers,
        };
      });

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
      throw error;
    }
  }

  // ── private SQL: emoji / sticker reads ────────────────────────────────────

  private async sqlLoadServerEmojis(internalServerId: number): Promise<ServerEmojiRow[] | null> {
    try {
      const emojiRows = await sql`
        SELECT *
        FROM server_emojis
        WHERE server_id = ${internalServerId}
      `;

      if (!emojiRows || emojiRows.length === 0) {
        return null;
      }

      const parsedEmojis = serverEmojiSchema.array().safeParse(emojiRows);

      if (!parsedEmojis.success) {
        log.error(`Failed to validate emojis for server ID ${internalServerId}:`, parsedEmojis.error.flatten());
        return null;
      }

      return parsedEmojis.data;
    } catch (error) {
      log.error(`Error loading emojis for server ID ${internalServerId}:`, error);
      return null;
    }
  }

  private async sqlLoadServerStickers(serverDiscId: string): Promise<ServerStickerRow[] | null> {
    try {
      // 1. Get the internal server_id from server_disc_id
      const [server] = await sql`
        SELECT server_id FROM servers WHERE server_disc_id = ${serverDiscId} LIMIT 1
      `;

      if (!server?.server_id) {
        log.warn(`Server not found in DB with Discord ID: ${serverDiscId} when trying to load stickers.`);
        return null;
      }
      // biome-ignore lint/style/noNonNullAssertion: server check guarantees server_id (Rule 8)
      const serverId = server.server_id!;

      // 2. Fetch all stickers for that server_id
      const stickersData = await sql`
        SELECT sticker_id, server_id, sticker_disc_id, sticker_name, sticker_desc, emotion_key, format_type, is_global, created_at, updated_at
        FROM server_stickers
        WHERE server_id = ${serverId}
      `;

      if (!stickersData) {
        log.warn(`Stickers data was unexpectedly null for server ID: ${serverId} (Discord ID: ${serverDiscId})`);
        return [];
      }
      if (stickersData.length === 0) {
        log.info(`No stickers found in DB for server ID: ${serverId} (Discord ID: ${serverDiscId})`);
        return [];
      }

      // 3. Validate each sticker row
      const validatedStickers: ServerStickerRow[] = [];
      for (const sticker of stickersData) {
        const parsed = serverStickerSchema.safeParse(sticker);
        if (parsed.success) {
          validatedStickers.push(parsed.data);
        } else {
          log.warn(
            `Invalid sticker data found in DB for server ${serverId}, sticker_disc_id ${sticker.sticker_disc_id}: ${JSON.stringify(sticker)}. Errors: ${parsed.error.flatten()}`,
          );
        }
      }
      log.info(`Loaded ${validatedStickers.length} stickers for server ID ${serverId}.`);
      return validatedStickers;
    } catch (error) {
      log.error(`Error loading stickers for server Discord ID ${serverDiscId}:`, error);
      return null;
    }
  }

  // ── private SQL: blacklist reads ───────────────────────────────────────────

  private async sqlGetBlacklistedMemberIds(serverId: number): Promise<string[]> {
    try {
      // 1. Query personalization_blacklist table for blacklisted members
      const result = await sql`
        SELECT user_disc_id FROM personalization_blacklist
        WHERE server_id = ${serverId}
        ORDER BY user_disc_id ASC
      `;

      if (!result || result.length === 0) {
        return [];
      }

      // 2. Map to array of Discord IDs
      const memberIds = result.map((row: unknown) => (row as { user_disc_id: string }).user_disc_id);
      log.info(`Found ${memberIds.length} blacklisted members for server ${serverId}`);
      return memberIds;
    } catch (error) {
      log.error(`Error loading blacklisted members for server ${serverId}:`, error);
      return [];
    }
  }

  // ── private SQL: managed webhooks ──────────────────────────────────────────

  private async sqlUpsertManagedWebhook(params: {
    guildDiscId: string;
    kind?: ManagedWebhookKind;
    channelDiscId: string;
    webhookDiscId: string;
    rawToken: string;
  }): Promise<boolean> {
    const { guildDiscId, kind = MANAGED_WEBHOOK_KIND_SHARED_CHANNEL, channelDiscId, webhookDiscId, rawToken } = params;

    if (!guildDiscId || !channelDiscId || !webhookDiscId || !rawToken.trim()) {
      log.warn("[ManagedWebhookDb] Missing required parameters for webhook upsert");
      return false;
    }

    try {
      const currentKey = keyManager.getCurrentKey();
      const currentVersion = keyManager.getCurrentVersion();

      await sql`
        INSERT INTO discord_managed_webhooks (
          guild_disc_id, kind, channel_disc_id, webhook_disc_id, webhook_token, key_version
        )
        VALUES (
          ${guildDiscId}, ${kind}, ${channelDiscId}, ${webhookDiscId},
          pgp_sym_encrypt(${rawToken.trim()}, ${currentKey}, 'compress-algo=1, cipher-algo=aes256'),
          ${currentVersion}
        )
        ON CONFLICT (kind, channel_disc_id) DO UPDATE SET
          guild_disc_id = EXCLUDED.guild_disc_id,
          webhook_disc_id = EXCLUDED.webhook_disc_id,
          webhook_token = EXCLUDED.webhook_token,
          key_version = EXCLUDED.key_version,
          updated_at = CURRENT_TIMESTAMP
      `;

      return true;
    } catch (error) {
      log.error(
        `[ManagedWebhookDb] Failed to upsert webhook for guild ${guildDiscId}, channel ${channelDiscId}`,
        error,
      );
      return false;
    }
  }

  private async sqlLoadManagedWebhookByChannel(
    channelDiscId: string,
    kind: ManagedWebhookKind,
  ): Promise<ManagedDiscordWebhookRow | null> {
    if (!channelDiscId) return null;

    try {
      const [row] = await sql`
        SELECT managed_webhook_id, guild_disc_id, kind, channel_disc_id, webhook_disc_id,
               webhook_token, key_version, created_at, updated_at
        FROM discord_managed_webhooks
        WHERE channel_disc_id = ${channelDiscId} AND kind = ${kind}
        LIMIT 1
      `;

      return (row as ManagedDiscordWebhookRow | undefined) ?? null;
    } catch (error) {
      log.error(`[ManagedWebhookDb] Failed to load stored webhook for channel ${channelDiscId}`, error);
      return null;
    }
  }

  private async sqlLoadManagedWebhookByChannelAndWebhookId(
    channelDiscId: string,
    webhookDiscId: string,
    kind: ManagedWebhookKind,
  ): Promise<ManagedDiscordWebhookRow | null> {
    if (!channelDiscId || !webhookDiscId) return null;

    try {
      const [row] = await sql`
        SELECT managed_webhook_id, guild_disc_id, kind, channel_disc_id, webhook_disc_id,
               webhook_token, key_version, created_at, updated_at
        FROM discord_managed_webhooks
        WHERE channel_disc_id = ${channelDiscId}
          AND webhook_disc_id = ${webhookDiscId}
          AND kind = ${kind}
        LIMIT 1
      `;

      return (row as ManagedDiscordWebhookRow | undefined) ?? null;
    } catch (error) {
      log.error(
        `[ManagedWebhookDb] Failed to load stored webhook for channel ${channelDiscId} and webhook ${webhookDiscId}`,
        error,
      );
      return null;
    }
  }

  private async sqlDeleteManagedWebhook(
    channelDiscId: string,
    webhookDiscId: string | null | undefined,
    kind: ManagedWebhookKind,
  ): Promise<boolean> {
    if (!channelDiscId) return false;

    try {
      const result =
        webhookDiscId && webhookDiscId.trim().length > 0
          ? await sql`
              DELETE FROM discord_managed_webhooks
              WHERE channel_disc_id = ${channelDiscId}
                AND webhook_disc_id = ${webhookDiscId}
                AND kind = ${kind}
            `
          : await sql`
              DELETE FROM discord_managed_webhooks
              WHERE channel_disc_id = ${channelDiscId} AND kind = ${kind}
            `;

      return result.count > 0;
    } catch (error) {
      log.error(
        `[ManagedWebhookDb] Failed to delete stored webhook for channel ${channelDiscId}${webhookDiscId ? ` and webhook ${webhookDiscId}` : ""}`,
        error,
      );
      return false;
    }
  }

  private async sqlDecryptManagedWebhookToken(row: ManagedDiscordWebhookRow): Promise<string | null> {
    if (!row.webhook_token || row.webhook_token.length === 0) return null;

    try {
      const keyVersion = row.key_version || 1;
      const key = keyManager.getKey(keyVersion);

      const [result] = await sql`
        SELECT pgp_sym_decrypt(${row.webhook_token}, ${key}) AS decrypted_token
      `;

      if (!result?.decrypted_token) {
        log.warn(`[ManagedWebhookDb] Decryption returned empty for stored webhook ${row.webhook_disc_id}`);
        return null;
      }

      const decryptedToken = result.decrypted_token.toString();
      const currentVersion = keyManager.getCurrentVersion();
      if (keyVersion !== currentVersion) {
        const currentKey = keyManager.getCurrentKey();
        await sql`
          UPDATE discord_managed_webhooks
          SET webhook_token = pgp_sym_encrypt(${decryptedToken}, ${currentKey}, 'compress-algo=1, cipher-algo=aes256'),
              key_version = ${currentVersion},
              updated_at = CURRENT_TIMESTAMP
          WHERE managed_webhook_id = ${row.managed_webhook_id}
        `;
      }

      return decryptedToken;
    } catch (error) {
      log.error(`[ManagedWebhookDb] Failed to decrypt stored webhook token for ${row.webhook_disc_id}`, error);
      return null;
    }
  }

  // ── private SQL: emoji/sticker sync ───────────────────────────────────────

  private async syncItemsToDatabase<TDiscord, TDatabase extends Record<string, unknown>>(
    tx: TransactionSql,
    serverId: number,
    currentItems: TDiscord[],
    config: SyncItemConfig<TDiscord, TDatabase>,
  ): Promise<number> {
    const existingItems = await tx.unsafe(`
      SELECT ${config.idColumnName}, ${config.descColumnName}, emotion_key
      FROM ${config.tableName}
      WHERE server_id = ${serverId}
    `);

    const existingMetadata = new Map<string, SyncItemExistingMetadata>(
      existingItems.map((item: { [key: string]: string | null }) => [
        item[config.idColumnName] as string,
        item as SyncItemExistingMetadata,
      ]),
    );

    const dbItems = currentItems.map((item) => {
      const discordId = config.getDiscordId(item);
      const existing = existingMetadata.get(discordId);
      return config.mapToDatabase(item, existing, serverId);
    });

    log.info(`[Sync] Prepared ${dbItems.length} ${config.tableName} for upsert`);

    if (dbItems.length > 0) {
      const [beforeCount] = await tx.unsafe(
        `SELECT COUNT(*) as count FROM ${config.tableName} WHERE server_id = ${serverId}`,
      );
      log.info(`[Sync] BEFORE bulk insert: ${beforeCount.count} ${config.tableName} exist`);

      for (const item of dbItems) {
        if (config.tableName === "server_emojis") {
          await tx`
            INSERT INTO server_emojis (server_id, emoji_disc_id, emoji_name, emoji_desc, emotion_key, is_animated)
            VALUES (${item.server_id}, ${item.emoji_disc_id}, ${item.emoji_name}, ${item.emoji_desc}, ${item.emotion_key}, ${item.is_animated})
            ON CONFLICT (server_id, emoji_disc_id) DO UPDATE SET
              emoji_name = EXCLUDED.emoji_name, emoji_desc = EXCLUDED.emoji_desc,
              emotion_key = EXCLUDED.emotion_key, is_animated = EXCLUDED.is_animated,
              updated_at = CURRENT_TIMESTAMP
          `;
        } else {
          await tx`
            INSERT INTO server_stickers (server_id, sticker_disc_id, sticker_name, sticker_desc, emotion_key, sticker_format)
            VALUES (${item.server_id}, ${item.sticker_disc_id}, ${item.sticker_name}, ${item.sticker_desc}, ${item.emotion_key}, ${item.sticker_format})
            ON CONFLICT (server_id, sticker_disc_id) DO UPDATE SET
              sticker_name = EXCLUDED.sticker_name, sticker_desc = EXCLUDED.sticker_desc,
              emotion_key = EXCLUDED.emotion_key, sticker_format = EXCLUDED.sticker_format,
              updated_at = CURRENT_TIMESTAMP
          `;
        }
      }

      const [afterCount] = await tx.unsafe(
        `SELECT COUNT(*) as count FROM ${config.tableName} WHERE server_id = ${serverId}`,
      );
      log.success(`[Sync] AFTER bulk insert: ${afterCount.count} ${config.tableName} in database`);
    }

    const currentDiscordIds = currentItems.map(config.getDiscordId);

    if (currentDiscordIds.length > 0) {
      const dbItemsForCleanup = await tx.unsafe(
        `SELECT ${config.idColumnName}, ${config.nameColumnName} FROM ${config.tableName} WHERE server_id = ${serverId}`,
      );

      const currentIdSet = new Set(currentDiscordIds);
      const toDelete = dbItemsForCleanup.filter(
        (item: { [key: string]: string }) => !currentIdSet.has(item[config.idColumnName]),
      );

      if (toDelete.length > 0) {
        log.info(`[Sync] Found ${toDelete.length} stale ${config.tableName} to delete`);

        if (config.tableName === "server_emojis") {
          for (const item of toDelete) {
            await tx`
              DELETE FROM server_emojis
              WHERE server_id = ${serverId} AND emoji_disc_id = ${item[config.idColumnName]}
            `;
          }
        } else {
          for (const item of toDelete) {
            await tx`
              DELETE FROM server_stickers
              WHERE server_id = ${serverId} AND sticker_disc_id = ${item[config.idColumnName]}
            `;
          }
        }

        log.warn(`[Sync] Removed ${toDelete.length} stale ${config.tableName}`);
      }
    } else {
      let deletedCount = 0;
      if (config.tableName === "server_emojis") {
        const result = await tx`DELETE FROM server_emojis WHERE server_id = ${serverId}`;
        deletedCount = result.count || 0;
      } else {
        const result = await tx`DELETE FROM server_stickers WHERE server_id = ${serverId}`;
        deletedCount = result.count || 0;
      }
      if (deletedCount > 0) {
        log.info(`[Sync] Removed all ${deletedCount} ${config.tableName} (none in Discord)`);
      }
    }

    const [verifyCount] = await tx.unsafe(
      `SELECT COUNT(*) as count FROM ${config.tableName} WHERE server_id = ${serverId}`,
    );

    log.info(`[Sync] PRE-COMMIT verification: ${verifyCount.count} ${config.tableName} in transaction`);

    const actualCount = Number(verifyCount.count);
    const expectedCount = currentItems.length;

    if (actualCount !== expectedCount) {
      log.error(`[Sync] CRITICAL: Pre-commit count mismatch! Expected ${expectedCount}, got ${actualCount}`);
      throw new Error(
        `Sync transaction integrity violation: expected ${expectedCount} items, but transaction has ${actualCount}`,
      );
    }

    return currentItems.length;
  }

  // ── IRepository contract ───────────────────────────────────────────────────

  /**
   * Server export is handled by ImportExportRepository (full server export).
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   *
   * @param ownerId - Discord server snowflake (unused until Phase 6)
   */
  async toExportShape(ownerId: string | number): Promise<ServerExportShape | null> {
    return { server_disc_id: String(ownerId) };
  }

  /**
   * Server import is handled by ImportExportRepository.
   * Stub satisfies IRepository contract pending Phase 6 #16.7.
   */
  async fromExportShape(_ownerId: string | number, _data: ServerExportShape): Promise<boolean> {
    return false;
  }
}

/** Singleton instance — import this in callers. */
export const serverRepository = new ServerRepository();

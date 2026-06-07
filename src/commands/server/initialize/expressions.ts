/**
 * /server initialize expressions command
 *
 * Uses LLM vision with structured output to automatically analyze and classify
 * all custom emojis and stickers in a Discord server, generating emotion keys
 * and descriptions for use in bot responses.
 *
 * Requires model with both sees_images=true and supports_structoutput=true
 */

import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import { personaRepository, serverRepository } from "@/utils/db/repositories";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import { getAllEmotionKeys } from "@/types/misc/emotions";
import { type ExpressionBatchResult, ExpressionBatchResultSchema } from "@/providers/utils/structuredOutput";
import type { StructuredOutputResult } from "@/types/provider/featureInterfaces";
import { decryptApiKey } from "@/utils/security/crypto";
import { lazySyncGuildEmojis } from "@/utils/cache/emojiLazySync";
import { lazySyncGuildStickers } from "@/utils/cache/stickerLazySync";
import { callExpressionInitializationForProvider } from "@/providers/utils/providerFeatureExecutors";
import { providerSupportsFeature } from "@/utils/provider/providerInfoRegistry";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import { resolveStructuredOutputCapability } from "@/utils/provider/providerCapabilityResolver";
import { getEffectiveLlmModelName } from "@/utils/provider/modelDisplay";

/**
 * Configure the subcommand
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("expressions")
    .setDescription(localizer("en-US", "commands.server.initialize.expressions.description"))
    .addBooleanOption((option) =>
      option
        .setName("overwrite")
        .setDescription(localizer("en-US", "commands.server.initialize.expressions.overwrite_description"))
        .setRequired(false),
    );

/**
 * Convert ColorCode hex string to Discord number format
 * @param hexColor - Hex color string (e.g., "#3498DB")
 * @returns Numeric color code for Discord embeds
 */
function hexToNumber(hexColor: string): number {
  return Number.parseInt(hexColor.replace("#", ""), 16);
}

/**
 * Build Discord CDN URL for an emoji
 * Always use .png format (including for animated emojis - gets first frame)
 *
 * @param emojiId - Discord emoji ID (snowflake)
 * @returns Discord CDN URL for the emoji as PNG
 */
function buildEmojiCDNUrl(emojiId: string): string {
  return `https://cdn.discordapp.com/emojis/${emojiId}.png`;
}

/**
 * Build Discord CDN URL for a sticker
 * Always use .png format
 *
 * @param stickerId - Discord sticker ID (snowflake)
 * @returns Discord CDN URL for the sticker as PNG
 */
function buildStickerCDNUrl(stickerId: string): string {
  return `https://cdn.discordapp.com/stickers/${stickerId}.png`;
}

/**
 * Build system prompt for LLM
 * @returns System instruction text
 */
function buildSystemPrompt(): string {
  return `You are an expert visual analyzer specializing in classifying emojis and stickers based on their emotional expression.

Your task is to analyze custom Discord emojis and stickers and classify each one into exactly one of these 28 emotion categories:

${getAllEmotionKeys().join(", ")}

Guidelines:
- Focus on the PRIMARY emotion conveyed by the visual design
- "neutral" is for emotionally ambiguous or abstract designs
- Descriptions should be ONE concise sentence (10-200 characters) describing what you see
- Match emoji/sticker names case-insensitively`;
}

/**
 * Build user prompt for LLM
 *
 * @param items - Array of items to analyze (with name and type)
 * @returns User prompt text
 */
function buildUserPrompt(items: Array<{ name: string; type: "emoji" | "sticker" }>): string {
  // 1. Build numbered list of items
  const itemList = items.map((item, idx) => `${idx + 1}. ${item.name} (${item.type})`).join("\n");

  // 2. Construct prompt
  return `Analyze the following ${items.length} Discord expressions and classify each one:

${itemList}

For each expression, determine:
1. The primary emotion category (from the 28 emotion list)
2. A concise visual description (one sentence)

Return results in the specified JSON format.`;
}

/**
 * Execute the /server initialize expressions command
 *
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - User's preferred locale
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Ensure command is run in a guild (not DM)
  if (!interaction.guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: hexToNumber(ColorCode.ERROR),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Load Tomori state for this server
  const baseTomoriState = await personaRepository.loadState(interaction.guild.id);
  if (!baseTomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: hexToNumber(ColorCode.ERROR),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 3. Defer reply early (this operation may take time)
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // 3a. Overlay the invoking user's personal (BYOK) provider so the expression
  //     generation runs on their personal model/key when configured. Done after
  //     deferReply since it performs DB reads (keeps the 3s ack window safe).
  const { tomoriState } = await applyPersonalProviderSelectionsToTomoriState(baseTomoriState, userData.user_id ?? null);

  const overwrite = interaction.options.getBoolean("overwrite") ?? false;

  try {
    // 4. Force sync emojis and stickers from Discord to ensure DB is populated
    // This handles scenarios where:
    // - Bot was just added to server (empty DB)
    // - Bot was kicked and re-added with new emojis/stickers
    // - Existing servers before expression refresh feature was implemented
    log.info(`[Initialize Expressions] Force syncing emojis/stickers for guild ${interaction.guild.name}`);

    await lazySyncGuildEmojis(interaction.guild, tomoriState.server_id, true);
    await lazySyncGuildStickers(interaction.guild, tomoriState.server_id, true);

    log.info(`[Initialize Expressions] Sync complete for guild ${interaction.guild.name}`);

    // 5. Resolve effective LLM for expression initialization
    // Primary model is preferred; vision model used as fallback when primary lacks vision
    const llm = tomoriState.llm;
    let effectiveLlm = llm;

    if (!llm.sees_images || !llm.supports_structoutput) {
      // Primary model is missing a required capability — try vision model fallback
      const visionLlm = tomoriState.vision_llm;

      if (visionLlm?.sees_images && visionLlm.supports_structoutput) {
        log.info(
          `[Initialize Expressions] Primary model lacks capabilities (sees_images=${llm.sees_images}, supports_structoutput=${llm.supports_structoutput}), falling back to vision model ${visionLlm.llm_codename}`,
        );
        effectiveLlm = visionLlm;
      } else {
        // Neither model meets requirements
        const effectiveModelName = getEffectiveLlmModelName(llm, tomoriState.config.custom_model_name);

        // Determine which error message to show
        if (!visionLlm) {
          // No vision model configured — show original single-model error
          const missingCapability = !llm.sees_images ? "IMAGE VISION" : "STRUCTURED OUTPUT";
          await interaction.editReply({
            embeds: [
              {
                title: localizer(locale, "commands.server.initialize.expressions.model_incompatible_title"),
                description: localizer(
                  locale,
                  "commands.server.initialize.expressions.model_incompatible_description",
                  {
                    model_name: effectiveModelName,
                    missing_capability: missingCapability,
                  },
                ),
                color: hexToNumber(ColorCode.ERROR),
              },
            ],
          });
        } else {
          // Vision model exists but also lacks capabilities
          await interaction.editReply({
            embeds: [
              {
                title: localizer(locale, "commands.server.initialize.expressions.vision_fallback_title"),
                description: localizer(locale, "commands.server.initialize.expressions.vision_fallback_description", {
                  chat_model: effectiveModelName,
                  vision_model: visionLlm.llm_codename,
                }),
                color: hexToNumber(ColorCode.ERROR),
              },
            ],
          });
        }
        return;
      }
    }

    const effectiveModelName = getEffectiveLlmModelName(effectiveLlm, tomoriState.config.custom_model_name);

    if (!providerSupportsFeature(effectiveLlm.llm_provider, "expressionInitialization")) {
      await interaction.editReply({
        embeds: [
          {
            title: localizer(locale, "general.errors.provider_not_supported_title"),
            description: localizer(locale, "general.errors.provider_not_supported_description"),
            color: hexToNumber(ColorCode.ERROR),
          },
        ],
      });
      return;
    }

    // Handle overwrite before querying for uninitialized
    if (overwrite) {
      log.info(`[Initialize Expressions] Overwriting existing expressions for guild ${interaction.guild.name}`);
      await Promise.all([
        serverRepository.clearEmojiExpressions(tomoriState.server_id),
        serverRepository.clearStickerExpressions(tomoriState.server_id),
      ]);
    }

    // 6. Resolve the provider and its per-batch image cap once. These are constant
    //    across every loop iteration, so there is no need to recompute them per batch.
    const provider = effectiveLlm.llm_provider.toLowerCase();
    const structuredOutputCapability = await resolveStructuredOutputCapability(provider);
    const expressionBatchSize = structuredOutputCapability?.getExpressionInitializationBatchSize?.() ?? null;

    // 7. Verify an API key exists, then decrypt it once for reuse across all batches
    if (!tomoriState.config.api_key) {
      await interaction.editReply({
        embeds: [
          {
            title: localizer(locale, "general.errors.api_key_missing_title"),
            description: localizer(locale, "general.errors.api_key_missing_description"),
            color: hexToNumber(ColorCode.ERROR),
          },
        ],
      });
      return;
    }

    const keyVersion = tomoriState.config.key_version || 1;
    const decryptedApiKey = await decryptApiKey(tomoriState.config.api_key, keyVersion);

    // 8. Snapshot the starting backlog so the final report can compare against it
    const [initialEmojis, initialStickers] = await Promise.all([
      serverRepository.loadUninitializedEmojis(tomoriState.server_id),
      serverRepository.loadUninitializedStickers(tomoriState.server_id),
    ]);
    const grandTotalUninitialized = initialEmojis.length + initialStickers.length;

    // 8a. Nothing to do — every expression has already been classified
    if (grandTotalUninitialized === 0) {
      await interaction.editReply({
        embeds: [
          {
            title: localizer(locale, "commands.server.initialize.expressions.already_initialized_title"),
            description: localizer(locale, "commands.server.initialize.expressions.already_initialized_description"),
            color: hexToNumber(ColorCode.INFO),
          },
        ],
      });
      return;
    }

    // 9. Self-looping batch processor.
    //    Previously the command processed a single provider-sized batch and asked
    //    the user to re-run for the rest. It now drains the entire backlog on its
    //    own, one batch per iteration.
    //
    //    Loop-safety guard: the backlog size is compared between iterations. When a
    //    batch makes no progress (the remaining count is unchanged), it is counted
    //    as a retry of the same "stuck" chunk. After `maxChunkRetries` consecutive
    //    no-progress iterations the loop aborts, so a model that consistently errors
    //    or fails to match items can never loop forever.
    const maxChunkRetries = Number.parseInt(process.env.EXPRESSION_INIT_MAX_CHUNK_RETRIES || "3", 10);
    const batchDelayMs = Number.parseInt(process.env.EXPRESSION_INIT_BATCH_DELAY_MS || "1000", 10);

    // 9a. Constants shared by every batch
    const systemPrompt = buildSystemPrompt();
    const temperature = 1.0;

    // 9b. Mutable loop state
    let totalEmojiProcessed = 0;
    let totalStickerProcessed = 0;
    let batchNumber = 0;
    let chunkRetries = 0; // consecutive no-progress iterations on the current chunk
    let previousRemaining = -1; // backlog size observed at the start of the previous iteration

    while (true) {
      // 9c. Re-query the backlog each iteration so prior batches' DB writes shrink it
      const [pendingEmojis, pendingStickers] = await Promise.all([
        serverRepository.loadUninitializedEmojis(tomoriState.server_id),
        serverRepository.loadUninitializedStickers(tomoriState.server_id),
      ]);
      const remaining = pendingEmojis.length + pendingStickers.length;

      // 9d. Backlog fully drained — we are done
      if (remaining === 0) {
        break;
      }

      // 9e. Loop-safety: detect a chunk that is not shrinking and cap its retries
      if (remaining === previousRemaining) {
        chunkRetries++;
        log.warn(
          `[Initialize Expressions] No progress on chunk (${remaining} remaining), retry ${chunkRetries}/${maxChunkRetries}`,
        );
        if (chunkRetries >= maxChunkRetries) {
          log.warn(
            `[Initialize Expressions] Aborting after ${maxChunkRetries} consecutive no-progress attempts; ${remaining} expressions left unprocessed`,
          );
          break;
        }
      } else {
        // Backlog shrank since the last iteration → real progress, reset the guard
        chunkRetries = 0;
      }
      previousRemaining = remaining;
      batchNumber++;

      // 9f. Build this iteration's image/item batch, capped at the provider batch size
      const images: Array<{ url: string; name: string }> = [];
      const items: Array<{ name: string; type: "emoji" | "sticker" }> = [];

      // Add emojis
      for (const emoji of pendingEmojis) {
        images.push({
          url: buildEmojiCDNUrl(emoji.emoji_disc_id),
          name: emoji.emoji_name,
        });
        items.push({ name: emoji.emoji_name, type: "emoji" });
      }

      // Add stickers
      for (const sticker of pendingStickers) {
        images.push({
          url: buildStickerCDNUrl(sticker.sticker_disc_id),
          name: sticker.sticker_name,
        });
        items.push({ name: sticker.sticker_name, type: "sticker" });
      }

      // Apply provider batch size limit (different token/cost constraints per provider)
      if (expressionBatchSize && images.length > expressionBatchSize) {
        images.splice(expressionBatchSize);
        items.splice(expressionBatchSize);
        log.info(
          `[Initialize Expressions] Batch ${batchNumber}: limited to ${expressionBatchSize} of ${remaining} remaining items for ${provider} provider`,
        );
      }

      // 9g. Progress update for this batch
      await interaction.editReply({
        embeds: [
          {
            description: localizer(locale, "commands.server.initialize.expressions.progress_analyzing_batch", {
              batch_number: batchNumber,
              batch_size: images.length,
              remaining,
              processed: totalEmojiProcessed + totalStickerProcessed,
              grand_total: grandTotalUninitialized,
            }),
            color: hexToNumber(ColorCode.INFO),
          },
        ],
      });

      // 9h. Build the per-batch prompt and call the provider
      const userPrompt = buildUserPrompt(items);

      log.info(
        `LLM structured output request (batch ${batchNumber}): ${JSON.stringify(
          {
            model: effectiveModelName,
            temperature,
            systemPrompt,
            userPrompt,
            images,
          },
          null,
          2,
        )}`,
      );

      const result: StructuredOutputResult<ExpressionBatchResult> = await callExpressionInitializationForProvider({
        providerName: provider,
        apiKey: decryptedApiKey,
        model: effectiveModelName,
        endpointUrl: tomoriState.config.custom_endpoint_url ?? undefined,
        systemPrompt,
        userPrompt,
        images,
        temperature,
      });

      log.info(`LLM structured output response (batch ${batchNumber}): ${JSON.stringify(result, null, 2)}`);

      // 9i. On a provider error, log and let the loop retry this chunk (capped by maxChunkRetries)
      if (!result.success) {
        log.error("LLM structured output failed", new Error(result.error), {
          errorType: "LLMStructuredOutputError",
          metadata: {
            model: effectiveModelName,
            batchNumber,
            imageCount: images.length,
          },
        });
        continue;
      }

      // 9j. Validate the response; an invalid shape is also a retryable no-progress batch
      const validationResult = ExpressionBatchResultSchema.safeParse(result.data);

      if (!validationResult.success) {
        log.error("LLM returned invalid structured output", validationResult.error, {
          errorType: "ValidationError",
          metadata: {
            model: effectiveLlm.llm_codename,
            batchNumber,
            rawData: result.data,
          },
        });
        continue;
      }

      // 9k. Persist this batch's classifications and accumulate running totals
      const { emojiCount, stickerCount } = await serverRepository.initializeExpressions(
        tomoriState.server_id,
        validationResult.data.expressions,
      );
      totalEmojiProcessed += emojiCount;
      totalStickerProcessed += stickerCount;

      // 9l. Brief pause between batches to stay within provider rate limits, skipped
      //     when this batch drained the remaining backlog (no further iteration needed)
      if (batchDelayMs > 0 && remaining - (emojiCount + stickerCount) > 0) {
        await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
      }
    }

    // 10. Final report based on the accumulated totals across every batch
    const totalProcessed = totalEmojiProcessed + totalStickerProcessed;

    if (totalProcessed === 0) {
      // No expressions were updated at all (every batch failed to match)
      await interaction.editReply({
        embeds: [
          {
            title: localizer(locale, "commands.server.initialize.expressions.no_matches_title"),
            description: localizer(locale, "commands.server.initialize.expressions.no_matches_description"),
            color: hexToNumber(ColorCode.WARN),
          },
        ],
      });
    } else if (totalProcessed < grandTotalUninitialized) {
      // Partial success — the loop stopped (stuck chunk) with some expressions left over
      const failed = grandTotalUninitialized - totalProcessed;
      await interaction.editReply({
        embeds: [
          {
            title: localizer(locale, "commands.server.initialize.expressions.partial_success_title"),
            description: localizer(locale, "commands.server.initialize.expressions.partial_success_description", {
              successful: totalProcessed,
              total: grandTotalUninitialized,
              failed,
            }),
            color: hexToNumber(ColorCode.WARN),
          },
        ],
      });
    } else {
      // Full success — entire backlog drained
      await interaction.editReply({
        embeds: [
          {
            title: localizer(locale, "commands.server.initialize.expressions.success_title"),
            description: localizer(locale, "commands.server.initialize.expressions.success_description", {
              emoji_count: totalEmojiProcessed,
              sticker_count: totalStickerProcessed,
              total: totalProcessed,
            }),
            color: hexToNumber(ColorCode.SUCCESS),
          },
        ],
      });
    }
  } catch (error) {
    // 19. Log error with context
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id ?? null,
      personaId: tomoriState?.persona_id ?? null,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server initialize expressions",
        guildId: interaction.guild.id,
      },
    };

    await log.error("Error executing /server initialize expressions command", error as Error, context);

    // 19. Show error message to user
    await interaction.editReply({
      embeds: [
        {
          title: localizer(locale, "general.errors.unknown_error_title"),
          description: localizer(locale, "general.errors.unknown_error_description"),
          color: hexToNumber(ColorCode.ERROR),
        },
      ],
    });
  }
}

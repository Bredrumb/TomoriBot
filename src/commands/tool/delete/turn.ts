import type { AnyThreadChannel, ButtonInteraction, ChatInputCommandInteraction, Client, Message } from "discord.js";
import { BaseGuildTextChannel, EmbedBuilder, MessageFlags, type SlashCommandSubcommandBuilder } from "discord.js";
import tomoriChat, { suppressNextSelfReply } from "@/events/messageCreate/tomoriChat";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedMainPersona } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { findLastPersonaTurnBlock } from "@/utils/discord/personaTurnDetection";
import { resolveManagedWebhookForChannel } from "@/utils/discord/webhook/fallback";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/** Module-level lock set keyed by channelId — prevents double-invocation. */
const activeDeleteLocks = new Set<string>();

/**
 * Max message age (in ms) below which Discord allows bulk deletion.
 * Messages older than 14 days must be deleted individually.
 */
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Resolves the parent text channel that owns the webhook for the given channel.
 * Threads cannot own webhooks — the parent channel is used instead.
 * @param channel - The channel to resolve the webhook host for
 * @returns The BaseGuildTextChannel that owns webhooks, or null if unavailable
 */
function resolveWebhookHostChannel(channel: Message["channel"]): BaseGuildTextChannel | null {
  const isThread = "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
  if (isThread) {
    const parent = (channel as AnyThreadChannel).parent;
    return parent && "fetchWebhooks" in parent ? (parent as BaseGuildTextChannel) : null;
  }
  return "fetchWebhooks" in channel && "createWebhook" in channel ? (channel as BaseGuildTextChannel) : null;
}

/**
 * Resolves the thread ID for webhook message deletion.
 * When deleting webhook messages inside a thread, the thread ID must be passed
 * as the second argument to `webhook.deleteMessage()`.
 * @param channel - The channel to check for thread context
 * @returns The thread ID if in a thread, otherwise undefined
 */
function resolveWebhookThreadId(channel: Message["channel"]): string | undefined {
  return "isThread" in channel && typeof channel.isThread === "function" && channel.isThread() ? channel.id : undefined;
}

/**
 * Configures the 'turn' subcommand under the 'delete' group.
 * @param subcommand - SlashCommandSubcommandBuilder
 * @returns Configured builder
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("turn")
    .setDescription(localizer("en-US", "commands.tool.delete.turn.description"))
    .addBooleanOption((option) =>
      option
        .setName("regenerate")
        .setDescription(localizer("en-US", "commands.tool.delete.turn.regenerate_description"))
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName("select_persona")
        .setDescription(localizer("en-US", "commands.tool.delete.turn.select_persona_description"))
        .setRequired(false),
    );

/**
 * Executes the `/tool delete turn` command.
 *
 * Walks the recent channel history, finds the last contiguous block of
 * messages sent by a single known persona (via webhook username or bot
 * non-webhook messages), deletes those messages, and optionally re-triggers
 * that persona with `tomoriChat`. Matrix bridge relay webhooks are treated
 * as user messages and stop block detection without being deleted.
 *
 * Interaction patterns used:
 * - Without `select_persona`: Pattern 2 — deferReply on the slash interaction.
 * - With `select_persona`:    Pattern 4 — paginated picker returns a
 *   ButtonInteraction which is then deferred.
 *
 * @param client - Discord client instance
 * @param interaction - ChatInputCommandInteraction
 * @param _userData - User row from database (unused)
 * @param locale - User's locale string
 */
export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Validate guild + channel presence
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  const guildId = interaction.guild.id;
  const channelId = interaction.channelId;
  const channel = interaction.channel;
  const regenerate = interaction.options.getBoolean("regenerate") ?? false;
  const selectPersona = interaction.options.getBoolean("select_persona") ?? false;

  // 2. Load main persona state — needed for permission check and config values
  const tomoriState = await getCachedMainPersona(guildId);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // 3. Permission check: requires ManageGuild OR use in a designated RP channel.
  //    When the command is run inside a thread, channelId is the thread's own ID —
  //    not the parent channel's ID. Check both so threads inherit their parent's RP status.
  const hasManageGuild = interaction.memberPermissions?.has("ManageGuild") ?? false;
  const parentChannelId = channel.isThread() ? channel.parentId : null;
  const isRpChannel =
    tomoriState.config.rp_channel_ids.includes(channelId) ||
    (parentChannelId !== null && tomoriState.config.rp_channel_ids.includes(parentChannelId));
  if (!hasManageGuild && !isRpChannel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.tool.delete.turn.no_permission_title",
      descriptionKey: "commands.tool.delete.turn.no_permission_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // 3.5. Check bot's MANAGE_MESSAGES permission — determines whether direct
  //      deletion methods (bulkDelete, msg.delete) will work. The command
  //      proceeds regardless, but uses webhook-based deletion as fallback.
  const botMember = interaction.guild.members.me;
  let botHasManageMessages = false;
  if (botMember && "permissionsFor" in channel) {
    botHasManageMessages = Boolean(channel.permissionsFor(botMember)?.has("ManageMessages"));
  }

  // 4. Race-condition lock check — prevents double-invocation for the same channel
  if (activeDeleteLocks.has(channelId)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.tool.delete.turn.already_running_title",
      descriptionKey: "commands.tool.delete.turn.already_running_description",
      color: ColorCode.WARN,
    });
    return;
  }

  // 5. Acquire lock before any async work
  activeDeleteLocks.add(channelId);

  // activeInteraction is mutable: starts as the slash interaction but may be
  // reassigned to the ButtonInteraction returned by the paginated picker.
  let activeInteraction: ChatInputCommandInteraction | ButtonInteraction = interaction;

  try {
    // 6. Load all personas for selection and persona-turn detection.
    const allPersonas = await getCachedAllPersonas(guildId);

    // Target persona tracking — null means auto-detect from message history
    let resolvedPersona: TomoriState | null = null;

    // 7. Persona selection (conditional) — Pattern 4 when select_persona=true
    if (selectPersona) {
      if (allPersonas.length === 0) {
        // No personas configured — nothing to select or auto-detect
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.tool.delete.turn.no_persona_found_title",
          descriptionKey: "commands.tool.delete.turn.no_persona_found_description",
          color: ColorCode.WARN,
        });
        return;
      }

      // Show paginated picker; preserveSelectedInteraction=true so we can
      // defer on the returned ButtonInteraction ourselves (Pattern 4)
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success || personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
        // Picker was cancelled or timed out — the picker already showed the
        // appropriate UI; just release the lock via finally and return.
        return;
      }

      const buttonInteraction: ButtonInteraction = personaSelection.interaction;

      // Switch the active interaction to the button so all subsequent
      // editReply calls target the correct interaction token
      activeInteraction = buttonInteraction;

      resolvedPersona = allPersonas[personaSelection.selectedIndex] ?? null;

      // Acknowledge the button interaction ephemerally before doing async work
      await buttonInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      // No persona selection — defer the original slash interaction (Pattern 2)
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    // 8. Fetch recent messages from the channel
    const fetchLimit = normalizeMessageFetchLimit(tomoriState.config.message_fetch_limit);
    const fetched = await channel.messages.fetch({ limit: fetchLimit });

    // Discord returns messages newest-first; reverse to chronological order
    // so index 0 = oldest and the last index = newest
    const messages: Message[] = [...fetched.values()].reverse();

    // 9. Walk newest-to-oldest to find the last contiguous persona block
    const detectedTurn = findLastPersonaTurnBlock({
      messages,
      allPersonas,
      clientUserId: client.user?.id,
      targetPersonaId: resolvedPersona?.tomori_id,
    });
    const blockMessages = detectedTurn.blockMessages;
    resolvedPersona = detectedTurn.resolvedPersona;

    // 10. No persona block found in recent history
    if (blockMessages.length === 0) {
      await activeInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "commands.tool.delete.turn.no_persona_found_title"))
            .setDescription(localizer(locale, "commands.tool.delete.turn.no_persona_found_description"))
            .setColor(ColorCode.WARN),
        ],
      });
      return;
    }

    const displayName = resolvedPersona?.tomori_nickname ?? detectedTurn.targetPersonaKey ?? "Unknown";
    const totalCount = blockMessages.length;

    // 11. Inform user that deletion is in progress
    await activeInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.tool.delete.turn.deleting_title"))
          .setDescription(
            localizer(locale, "commands.tool.delete.turn.deleting_description", {
              count: String(totalCount),
              persona_name: displayName,
            }),
          )
          .setColor(ColorCode.INFO),
      ],
    });

    // 12. Partition messages into webhook vs direct, then apply deletion strategy
    const now = Date.now();
    const webhookMessages: Message[] = [];
    const directBotMessages: Message[] = [];

    for (const msg of blockMessages) {
      if (msg.webhookId) {
        webhookMessages.push(msg);
      } else {
        directBotMessages.push(msg);
      }
    }

    let deletedCount = 0;
    let failedCount = 0;

    // 12a. Delete webhook messages via webhook API (no MANAGE_MESSAGES needed)
    if (webhookMessages.length > 0) {
      const hostChannel = resolveWebhookHostChannel(channel);
      const threadId = resolveWebhookThreadId(channel);

      // Group messages by webhookId to minimize resolution calls.
      // The filter narrows the type from (string | null) to string.
      const webhooksOnly = webhookMessages.filter((m): m is Message & { webhookId: string } => !!m.webhookId);

      const messagesByWebhook = new Map<string, Message[]>();
      for (const msg of webhooksOnly) {
        const group = messagesByWebhook.get(msg.webhookId) ?? [];
        group.push(msg);
        messagesByWebhook.set(msg.webhookId, group);
      }

      // Resolve each webhook once, then delete all its messages
      for (const [webhookId, messages] of messagesByWebhook) {
        const webhook = hostChannel ? await resolveManagedWebhookForChannel(hostChannel, webhookId) : null;

        for (const msg of messages) {
          try {
            if (webhook) {
              // Webhook API deletion — no channel permission required
              await webhook.deleteMessage(msg.id, threadId);
              deletedCount++;
            } else if (botHasManageMessages) {
              // Fallback: webhook not resolvable, try direct delete with bot permission
              await msg.delete();
              deletedCount++;
            } else {
              // No webhook and no permission — skip with warning
              log.warn(
                `[deleteTurn] Cannot delete webhook messageId=${msg.id}: webhook not resolvable and bot lacks MANAGE_MESSAGES`,
              );
              failedCount++;
            }
          } catch (delError) {
            log.warn(`[deleteTurn] Webhook deletion failed for messageId=${msg.id}`, delError);
            // If webhook deletion threw, try direct delete as last resort
            if (botHasManageMessages) {
              try {
                await msg.delete();
                deletedCount++;
              } catch (fallbackError) {
                log.warn(`[deleteTurn] Fallback delete also failed for messageId=${msg.id}`, fallbackError);
                failedCount++;
              }
            } else {
              failedCount++;
            }
          }
        }
      }
    }

    // 12b. Delete direct bot messages (requires MANAGE_MESSAGES)
    if (directBotMessages.length > 0) {
      if (botHasManageMessages) {
        // Partition by age for bulk delete optimization
        const recentIds: string[] = [];
        const oldDirectMessages: Message[] = [];

        for (const msg of directBotMessages) {
          if (now - msg.createdTimestamp < BULK_DELETE_MAX_AGE_MS) {
            recentIds.push(msg.id);
          } else {
            oldDirectMessages.push(msg);
          }
        }

        // Bulk-delete recent direct messages (≥ 2 IDs, text channel only)
        if (recentIds.length >= 2 && channel instanceof BaseGuildTextChannel) {
          try {
            await channel.bulkDelete(recentIds);
            deletedCount += recentIds.length;
          } catch (bulkError) {
            log.warn(
              `[deleteTurn] bulkDelete failed for channelId=${channelId} — falling back to individual deletion`,
              bulkError,
            );
            for (const id of recentIds) {
              try {
                const msg = fetched.get(id);
                if (msg) {
                  await msg.delete();
                  deletedCount++;
                }
              } catch (indivError) {
                log.warn(`[deleteTurn] Failed to individually delete messageId=${id}`, indivError);
                failedCount++;
              }
            }
          }
        } else {
          // Single recent message OR thread channel — delete individually
          for (const id of recentIds) {
            try {
              const msg = fetched.get(id);
              if (msg) {
                await msg.delete();
                deletedCount++;
              }
            } catch (singleError) {
              log.warn(`[deleteTurn] Failed to delete messageId=${id}`, singleError);
              failedCount++;
            }
          }
        }

        // Delete old direct messages individually (bulk-delete not allowed > 14 days)
        for (const msg of oldDirectMessages) {
          try {
            await msg.delete();
            deletedCount++;
          } catch (oldError) {
            log.warn(`[deleteTurn] Failed to delete old messageId=${msg.id}`, oldError);
            failedCount++;
          }
        }
      } else {
        // Bot lacks MANAGE_MESSAGES — cannot delete direct bot messages at all
        failedCount += directBotMessages.length;
        log.warn(
          `[deleteTurn] Bot lacks MANAGE_MESSAGES in channelId=${channelId}; skipping ${directBotMessages.length} direct bot messages`,
        );
      }
    }

    // 13. Build reply embed — includes new zero-deletion error branch
    const embedValues: Record<string, string> = {
      persona_name: displayName,
      count: String(deletedCount),
      deleted_count: String(deletedCount),
      total_count: String(totalCount),
    };

    let titleKey: string;
    let descKey: string;
    let embedColor: ColorCode;

    if (deletedCount === 0 && failedCount > 0) {
      // Complete failure — show actionable bot permission error or generic failure
      titleKey = "commands.tool.delete.turn.bot_no_delete_title";
      descKey = !botHasManageMessages
        ? "commands.tool.delete.turn.bot_no_delete_description"
        : "commands.tool.delete.turn.bot_failed_delete_description";
      embedColor = ColorCode.ERROR;
    } else if (deletedCount < totalCount) {
      titleKey = "commands.tool.delete.turn.partial_title";
      descKey = !botHasManageMessages
        ? "commands.tool.delete.turn.partial_no_manage_messages_description"
        : "commands.tool.delete.turn.partial_description";
      embedColor = ColorCode.WARN;
    } else if (regenerate && resolvedPersona) {
      titleKey = "commands.tool.delete.turn.success_title";
      descKey = "commands.tool.delete.turn.success_regenerate_description";
      embedColor = ColorCode.SUCCESS;
    } else {
      titleKey = "commands.tool.delete.turn.success_title";
      descKey = "commands.tool.delete.turn.success_description";
      embedColor = ColorCode.SUCCESS;
    }

    await activeInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, titleKey))
          .setDescription(localizer(locale, descKey, embedValues))
          .setColor(embedColor),
      ],
    });

    log.info(
      `[deleteTurn] Deleted ${deletedCount}/${totalCount} messages (${failedCount} failed) from persona="${displayName}" in channelId=${channelId}`,
    );

    // 14. Regenerate (fire-and-forget) — re-trigger the persona after deletion
    if (regenerate && resolvedPersona && deletedCount === totalCount) {
      try {
        // Fetch the most recent remaining message to use as the trigger context
        const remaining = await channel.messages.fetch({ limit: 1 });
        let lastMessage: Message | undefined = remaining.first();

        // If the channel has no messages left after deletion, seed a braille
        // blank placeholder so tomoriChat has a valid Message to operate on
        if (!lastMessage && channel instanceof BaseGuildTextChannel) {
          lastMessage = await channel.send("\u2800");
        }

        if (lastMessage) {
          // Prevent the self-reply suppression guard from blocking this trigger
          suppressNextSelfReply(channel.id);

          // Fire-and-forget — do not await so the command interaction resolves
          void tomoriChat(
            client,
            lastMessage,
            false, // isFromQueue
            true, // isManuallyTriggered
            false, // forceReason
            undefined, // reasoningQuery
            undefined, // llmOverrideCodename
            false, // isStopResponse
            0, // retryCount
            false, // skipLock
            undefined, // reminderRecipientID
            undefined, // reminderData
            resolvedPersona.tomori_id, // selectedPersonaId
            false, // isPersonaJob
            false, // isUserImpersonation
            undefined, // impersonatedUserId
            "user", // textQuotaSource
            interaction.id, // textQuotaTriggerKey
            interaction.user.id, // textQuotaUserDiscId
            undefined, // manualSystemPrompt
            undefined, // manualPrefill
            undefined, // naiContinuationPrefill
            undefined, // emptyResponseFinishReason
            undefined, // injectedContextItems
            undefined, // forcedMentions
            {
              userDiscId: interaction.user.id,
              username: interaction.user.username,
              locale,
              member: interaction.member as import("discord.js").GuildMember | null,
            },
          );
        }
      } catch (regenError) {
        log.warn(`[deleteTurn] Failed to set up regenerate for persona="${displayName}"`, regenError);
      }
    }
  } catch (error) {
    log.error("[deleteTurn] Unexpected error during turn deletion", error, {
      errorType: "DeleteTurnError",
      metadata: {
        guildId: interaction.guildId,
        userId: interaction.user.id,
      },
    });

    try {
      await activeInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "general.errors.unexpected_title"))
            .setDescription(localizer(locale, "general.errors.unexpected_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
    } catch {
      // Interaction may have already expired — nothing we can do
    }
  } finally {
    // 15. Always release the channel lock regardless of outcome
    activeDeleteLocks.delete(channelId);
  }
}

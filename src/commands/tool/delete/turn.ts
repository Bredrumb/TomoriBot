import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import type { AnyThreadChannel, ChatInputCommandInteraction, Client, Message } from "discord.js";
import { BaseGuildTextChannel, MessageFlags, type SlashCommandSubcommandBuilder } from "discord.js";
import { tomoriChat } from "@/events/messageCreate/tomoriChat";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { getCachedAllPersonas, getCachedMainPersona } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  PersonaWorkflowUpdateError,
  runPersonaPickerWorkflow,
} from "@/utils/discord/ui/personaWorkflow";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { findLastPersonaTurnBlock } from "@/utils/discord/personaTurnDetection";
import { resolveManagedWebhookForChannel } from "@/utils/discord/webhook/fallback";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const activeDeleteLocks = new Set<string>();

// Discord rejects bulk deletion for messages older than 14 days, so older messages must be deleted individually.
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface DeleteTurnStatus {
  titleKey: string;
  descriptionKey: string;
  descriptionVars?: Record<string, string | number | boolean>;
  color: ColorCode;
}

// Discord threads cannot own webhooks, so webhook resolution must fall back to the parent text channel.
function resolveWebhookHostChannel(channel: Message["channel"]): BaseGuildTextChannel | null {
  const isThread = "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
  if (isThread) {
    const parent = (channel as AnyThreadChannel).parent;
    return parent && "fetchWebhooks" in parent ? (parent as BaseGuildTextChannel) : null;
  }
  return "fetchWebhooks" in channel && "createWebhook" in channel ? (channel as BaseGuildTextChannel) : null;
}

// Thread IDs are passed separately because Discord requires the thread ID argument when deleting webhook messages
// inside a thread.
function resolveWebhookThreadId(channel: Message["channel"]): string | undefined {
  return "isThread" in channel && typeof channel.isThread === "function" && channel.isThread() ? channel.id : undefined;
}

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

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
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

  // Deferred before state and persona DB loads so both branches and the optional picker stay within Discord's 3s window.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tomoriState = await getCachedMainPersona(guildId);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // Both channelId and parentChannelId are checked so threads inherit their parent channel's RP designation.
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

  // Missing ManageMessages is non-fatal because webhook messages can still be deleted via the webhook API.
  const botMember = interaction.guild.members.me;
  let botHasManageMessages = false;
  if (botMember && "permissionsFor" in channel) {
    botHasManageMessages = Boolean(channel.permissionsFor(botMember)?.has("ManageMessages"));
  }

  if (activeDeleteLocks.has(channelId)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.tool.delete.turn.already_running_title",
      descriptionKey: "commands.tool.delete.turn.already_running_description",
      color: ColorCode.WARN,
    });
    return;
  }

  activeDeleteLocks.add(channelId);

  let personaWorkflowStarted = false;

  try {
    const allPersonas = await getCachedAllPersonas(guildId);

    const performDeletion = async (
      initialPersona: TomoriState | null,
      updateStatus: (status: DeleteTurnStatus) => Promise<void>,
    ): Promise<void> => {
      let resolvedPersona = initialPersona;

      const fetchLimit = normalizeMessageFetchLimit(tomoriState.config.message_fetch_limit);
      const fetched = await channel.messages.fetch({ limit: fetchLimit });

      // Discord returns fetched messages newest-first, so reverse them for chronological turn detection.
      const messages: Message[] = [...fetched.values()].reverse();

      await Promise.all(messages.map(verifyMessageWebhook));
      const detectedTurn = findLastPersonaTurnBlock({
        messages,
        allPersonas,
        clientUserId: client.user?.id,
        targetPersonaId: resolvedPersona?.persona_id,
      });
      const blockMessages = detectedTurn.blockMessages;
      resolvedPersona = detectedTurn.resolvedPersona;

      if (blockMessages.length === 0) {
        await updateStatus({
          titleKey: "commands.tool.delete.turn.no_persona_found_title",
          descriptionKey: "commands.tool.delete.turn.no_persona_found_description",
          color: ColorCode.WARN,
        });
        return;
      }

      const displayName = resolvedPersona?.persona_nickname ?? detectedTurn.targetPersonaKey ?? "Unknown";
      const totalCount = blockMessages.length;

      await updateStatus({
        titleKey: "commands.tool.delete.turn.deleting_title",
        descriptionKey: "commands.tool.delete.turn.deleting_description",
        descriptionVars: {
          count: totalCount,
          persona_name: displayName,
        },
        color: ColorCode.INFO,
      });

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

      if (webhookMessages.length > 0) {
        const hostChannel = resolveWebhookHostChannel(channel);
        const threadId = resolveWebhookThreadId(channel);

        const webhooksOnly = webhookMessages.filter((m): m is Message & { webhookId: string } => !!m.webhookId);

        const messagesByWebhook = new Map<string, Message[]>();
        for (const msg of webhooksOnly) {
          const group = messagesByWebhook.get(msg.webhookId) ?? [];
          group.push(msg);
          messagesByWebhook.set(msg.webhookId, group);
        }

        for (const [webhookId, messages] of messagesByWebhook) {
          const webhook = hostChannel ? await resolveManagedWebhookForChannel(hostChannel, webhookId) : null;

          for (const msg of messages) {
            try {
              if (webhook) {
                await webhook.deleteMessage(msg.id, threadId);
                deletedCount++;
              } else if (botHasManageMessages) {
                await msg.delete();
                deletedCount++;
              } else {
                log.warn(
                  `[deleteTurn] Cannot delete webhook messageId=${msg.id}: webhook not resolvable and bot lacks MANAGE_MESSAGES`,
                );
                failedCount++;
              }
            } catch (delError) {
              log.warn(`[deleteTurn] Webhook deletion failed for messageId=${msg.id}`, delError);
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

      if (directBotMessages.length > 0) {
        if (botHasManageMessages) {
          const recentIds: string[] = [];
          const oldDirectMessages: Message[] = [];

          for (const msg of directBotMessages) {
            if (now - msg.createdTimestamp < BULK_DELETE_MAX_AGE_MS) {
              recentIds.push(msg.id);
            } else {
              oldDirectMessages.push(msg);
            }
          }

          // Discord bulkDelete rejects single messages and non-text channels, so <2 messages fall back to single delete.
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
          failedCount += directBotMessages.length;
          log.warn(
            `[deleteTurn] Bot lacks MANAGE_MESSAGES in channelId=${channelId}; skipping ${directBotMessages.length} direct bot messages`,
          );
        }
      }

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

      await updateStatus({
        titleKey,
        descriptionKey: descKey,
        descriptionVars: embedValues,
        color: embedColor,
      });

      log.info(
        `[deleteTurn] Deleted ${deletedCount}/${totalCount} messages (${failedCount} failed) from persona="${displayName}" in channelId=${channelId}`,
      );

      if (regenerate && resolvedPersona && deletedCount === totalCount) {
        try {
          const remaining = await channel.messages.fetch({ limit: 1 });
          let lastMessage: Message | undefined = remaining.first();

          // Seeds a braille blank placeholder when deletion empties the channel because tomoriChat requires a trigger
          // Message.
          if (!lastMessage && channel instanceof BaseGuildTextChannel) {
            lastMessage = await channel.send("\u2800");
          }

          if (lastMessage) {
            // Intentionally unawaited so the delete command completes without blocking on generation.
            void tomoriChat({
              client,
              message: lastMessage,
              isFromQueue: false,
              isManuallyTriggered: true,
              forceReason: false,
              isStopResponse: false,
              selectedPersonaId: resolvedPersona.persona_id,
              isPersonaJob: false,
              isUserImpersonation: false,
              textQuotaSource: "user",
              textQuotaTriggerKey: interaction.id,
              textQuotaUserDiscId: interaction.user.id,
              suppressSelfReply: true,
              manualTriggerInvoker: {
                userDiscId: interaction.user.id,
                username: interaction.user.username,
                locale,
                member: interaction.member as import("discord.js").GuildMember | null,
              },
            });
          }
        } catch (regenError) {
          log.warn(`[deleteTurn] Failed to set up regenerate for persona="${displayName}"`, regenError);
        }
      }
    };

    if (selectPersona) {
      if (allPersonas.length === 0) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.tool.delete.turn.no_persona_found_title",
          descriptionKey: "commands.tool.delete.turn.no_persona_found_description",
          color: ColorCode.WARN,
        });
        return;
      }

      personaWorkflowStarted = true;
      await runPersonaPickerWorkflow(interaction, locale, {
        personas: allPersonas,
        color: ColorCode.INFO,
        onSelected: async (selection) => {
          const { message } = await selection.beginInPlaceWork();
          const selectedPersona = selection.persona;

          if (!selectedPersona.persona_id) {
            await message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.invalid_option_title",
                descriptionKey: "general.errors.invalid_option_description",
                color: ColorCode.ERROR,
              }),
            );
            return completePersonaWorkflow();
          }

          try {
            await performDeletion(selectedPersona, async (status) => {
              await message.replace(buildPersonaWorkflowNotice({ locale, ...status }));
            });
          } catch (error) {
            if (error instanceof PersonaWorkflowUpdateError) throw error;
            log.error("[deleteTurn] Unexpected error during selected turn deletion", error, {
              errorType: "DeleteTurnError",
              metadata: {
                guildId: interaction.guildId,
                userId: interaction.user.id,
                personaId: selectedPersona.persona_id,
              },
            });
            await message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "general.errors.unknown_error_title",
                descriptionKey: "general.errors.unknown_error_description",
                color: ColorCode.ERROR,
              }),
            );
          }

          return completePersonaWorkflow();
        },
      });
      return;
    }

    await performDeletion(null, async (status) => {
      await replyInfoEmbed(interaction, locale, status);
    });
  } catch (error) {
    log.error("[deleteTurn] Unexpected error during turn deletion", error, {
      errorType: "DeleteTurnError",
      metadata: {
        guildId: interaction.guildId,
        userId: interaction.user.id,
      },
    });

    if (personaWorkflowStarted) return;

    try {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    } catch {
      // Interaction may have already expired, so nothing we can do
    }
  } finally {
    activeDeleteLocks.delete(channelId);
  }
}

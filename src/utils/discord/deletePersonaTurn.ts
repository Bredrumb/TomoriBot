import type { AnyThreadChannel, Client, Guild, GuildMember, Message } from "discord.js";
import { BaseGuildTextChannel } from "discord.js";
import { suppressNextSelfReply, tomoriChat } from "@/events/messageCreate/tomoriChat";
import type { TomoriState } from "@/types/db/schema";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { normalizeMessageFetchLimit } from "@/utils/discord/messageFetchLimit";
import { findLastPersonaTurnBlock } from "@/utils/discord/personaTurnDetection";
import { resolveManagedWebhookForChannel } from "@/utils/discord/webhookManager";
import { log } from "@/utils/misc/logger";

const activeDeleteLocks = new Set<string>();
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function resolveWebhookHostChannel(channel: Message["channel"]): BaseGuildTextChannel | null {
  const isThread = "isThread" in channel && typeof channel.isThread === "function" && channel.isThread();
  if (isThread) {
    const parent = (channel as AnyThreadChannel).parent;
    return parent && "fetchWebhooks" in parent ? (parent as BaseGuildTextChannel) : null;
  }
  return "fetchWebhooks" in channel && "createWebhook" in channel ? (channel as BaseGuildTextChannel) : null;
}

function resolveWebhookThreadId(channel: Message["channel"]): string | undefined {
  return "isThread" in channel && typeof channel.isThread === "function" && channel.isThread() ? channel.id : undefined;
}

export type DeletePersonaTurnStatus =
  | "success"
  | "partial"
  | "failed"
  | "no_persona_found"
  | "already_running"
  | "target_message_not_found";

export interface DeletePersonaTurnOptions {
  client: Client;
  guild: Guild;
  channel: Message["channel"];
  tomoriState: TomoriState;
  regenerate: boolean;
  locale: string;
  targetPersonaId?: number;
  targetMessageId?: string;
  triggerUserId: string;
  triggerUsername: string;
  triggerMember: GuildMember | null;
  textQuotaTriggerKey: string;
}

export interface DeletePersonaTurnResult {
  status: DeletePersonaTurnStatus;
  resolvedPersona: TomoriState | null;
  targetPersonaKey: string | null;
  displayName: string;
  totalCount: number;
  deletedCount: number;
  failedCount: number;
  botHasManageMessages: boolean;
  regenerated: boolean;
}

export async function deletePersonaTurnAndMaybeRegenerate(
  options: DeletePersonaTurnOptions,
): Promise<DeletePersonaTurnResult> {
  const channelId = options.channel.id;
  if (activeDeleteLocks.has(channelId)) {
    return {
      status: "already_running",
      resolvedPersona: null,
      targetPersonaKey: null,
      displayName: "Unknown",
      totalCount: 0,
      deletedCount: 0,
      failedCount: 0,
      botHasManageMessages: false,
      regenerated: false,
    };
  }

  activeDeleteLocks.add(channelId);

  try {
    const botMember = options.guild.members.me;
    const botHasManageMessages = botMember
      ? "permissionsFor" in options.channel && Boolean(options.channel.permissionsFor(botMember)?.has("ManageMessages"))
      : false;

    const allPersonas = await getCachedAllPersonas(options.guild.id);
    const fetchLimit = normalizeMessageFetchLimit(options.tomoriState.config.message_fetch_limit);
    const fetched = await options.channel.messages.fetch({ limit: fetchLimit });
    let messages: Message[] = [...fetched.values()].reverse();

    if (options.targetMessageId) {
      const targetIndex = messages.findIndex((msg) => msg.id === options.targetMessageId);
      if (targetIndex < 0) {
        return {
          status: "target_message_not_found",
          resolvedPersona: null,
          targetPersonaKey: null,
          displayName: "Unknown",
          totalCount: 0,
          deletedCount: 0,
          failedCount: 0,
          botHasManageMessages,
          regenerated: false,
        };
      }
      messages = messages.slice(0, targetIndex + 1);
    }

    const detectedTurn = findLastPersonaTurnBlock({
      messages,
      allPersonas,
      clientUserId: options.client.user?.id,
      targetPersonaId: options.targetPersonaId,
    });

    const blockMessages = detectedTurn.blockMessages;
    const resolvedPersona = detectedTurn.resolvedPersona;
    const displayName = resolvedPersona?.persona_nickname ?? detectedTurn.targetPersonaKey ?? "Unknown";
    const totalCount = blockMessages.length;

    if (totalCount === 0) {
      return {
        status: "no_persona_found",
        resolvedPersona,
        targetPersonaKey: detectedTurn.targetPersonaKey,
        displayName,
        totalCount,
        deletedCount: 0,
        failedCount: 0,
        botHasManageMessages,
        regenerated: false,
      };
    }

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
      const hostChannel = resolveWebhookHostChannel(options.channel);
      const threadId = resolveWebhookThreadId(options.channel);
      const messagesByWebhook = new Map<string, Array<Message & { webhookId: string }>>();

      for (const msg of webhookMessages) {
        if (!msg.webhookId) {
          continue;
        }
        const group = messagesByWebhook.get(msg.webhookId) ?? [];
        group.push(msg as Message & { webhookId: string });
        messagesByWebhook.set(msg.webhookId, group);
      }

      for (const [webhookId, messagesForWebhook] of messagesByWebhook) {
        const webhook = hostChannel ? await resolveManagedWebhookForChannel(hostChannel, webhookId) : null;

        for (const msg of messagesForWebhook) {
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

        if (recentIds.length >= 2 && options.channel instanceof BaseGuildTextChannel) {
          try {
            await options.channel.bulkDelete(recentIds);
            deletedCount += recentIds.length;
          } catch (bulkError) {
            log.warn(`[deleteTurn] bulkDelete failed for channelId=${channelId}; falling back`, bulkError);
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

    let regenerated = false;
    if (options.regenerate && resolvedPersona && deletedCount === totalCount) {
      try {
        const remaining = await options.channel.messages.fetch({ limit: 1 });
        let lastMessage: Message | undefined = remaining.first();

        if (!lastMessage && options.channel instanceof BaseGuildTextChannel) {
          lastMessage = await options.channel.send("\u2800");
        }

        if (lastMessage) {
          suppressNextSelfReply(options.channel.id);
          regenerated = true;

          void tomoriChat({
            client: options.client,
            message: lastMessage,
            isFromQueue: false,
            isManuallyTriggered: true,
            selectedPersonaId: resolvedPersona.persona_id,
            textQuotaSource: "user",
            textQuotaTriggerKey: options.textQuotaTriggerKey,
            textQuotaUserDiscId: options.triggerUserId,
            manualTriggerInvoker: {
              userDiscId: options.triggerUserId,
              username: options.triggerUsername,
              locale: options.locale,
              member: options.triggerMember,
            },
          });
        }
      } catch (regenError) {
        log.warn(`[deleteTurn] Failed to set up regenerate for persona="${displayName}"`, regenError);
      }
    }

    const status: DeletePersonaTurnStatus =
      deletedCount === 0 && failedCount > 0 ? "failed" : deletedCount < totalCount ? "partial" : "success";

    log.info(
      `[deleteTurn] Deleted ${deletedCount}/${totalCount} messages (${failedCount} failed) from persona="${displayName}" in channelId=${channelId}`,
    );

    return {
      status,
      resolvedPersona,
      targetPersonaKey: detectedTurn.targetPersonaKey,
      displayName,
      totalCount,
      deletedCount,
      failedCount,
      botHasManageMessages,
      regenerated,
    };
  } finally {
    activeDeleteLocks.delete(channelId);
  }
}

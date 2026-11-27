import { BaseGuildTextChannel, type Message } from "discord.js";
import { isReplyControlMessage } from "@/utils/discord/replyControlMessage";
import { resolveManagedWebhookForChannel } from "@/utils/discord/webhook/fallback";
import { log } from "@/utils/misc/logger";

const activeDeleteLocks = new Set<string>();
// Discord requires individual deletion for messages older than 14 days.
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function tryAcquirePersonaTurnDeletion(channelId: string): (() => void) | undefined {
  if (activeDeleteLocks.has(channelId)) return undefined;
  activeDeleteLocks.add(channelId);
  return () => activeDeleteLocks.delete(channelId);
}

export async function deletePersonaTurnMessages(
  channel: Message["channel"],
  blockMessages: Message[],
  botHasManageMessages: boolean,
  signal?: AbortSignal,
): Promise<{ deletedCount: number; failedCount: number }> {
  const host = channel.isThread() ? channel.parent : channel;
  const threadId = channel.isThread() ? channel.id : undefined;
  const webhooks = new Map<string, Awaited<ReturnType<typeof resolveManagedWebhookForChannel>>>();
  const directMessages: Message[] = [];
  let deletedCount = 0;

  async function deleteIndividually(message: Message): Promise<void> {
    signal?.throwIfAborted();
    try {
      await message.delete();
      deletedCount++;
    } catch (error) {
      log.warn(`[deleteTurn] Could not delete messageId=${message.id}`, error);
    }
  }

  for (const message of blockMessages) {
    const webhookId = message.webhookId;
    if (!webhookId) {
      if (message.reference?.messageId && isReplyControlMessage(message, channel.client.user?.id))
        await deleteIndividually(message);
      else directMessages.push(message);
      continue;
    }
    if (!webhooks.has(webhookId)) {
      webhooks.set(
        webhookId,
        host && "fetchWebhooks" in host && "createWebhook" in host
          ? await resolveManagedWebhookForChannel(host as BaseGuildTextChannel, webhookId)
          : null,
      );
    }
    const webhook = webhooks.get(webhookId);
    if (webhook) {
      signal?.throwIfAborted();
      try {
        await webhook.deleteMessage(message.id, threadId);
        deletedCount++;
        continue;
      } catch (error) {
        log.warn(`[deleteTurn] Could not delete webhook messageId=${message.id}`, error);
      }
    }
    if (botHasManageMessages) await deleteIndividually(message);
  }

  if (botHasManageMessages) {
    const cutoff = Date.now() - BULK_DELETE_MAX_AGE_MS;
    const recent = directMessages.filter((message) => message.createdTimestamp > cutoff);
    let remaining = directMessages;
    if (recent.length >= 2 && channel instanceof BaseGuildTextChannel) {
      signal?.throwIfAborted();
      try {
        const deleted = await channel.bulkDelete(recent);
        deletedCount += deleted.size;
        remaining = directMessages.filter((message) => !deleted.has(message.id));
      } catch (error) {
        log.warn(`[deleteTurn] Bulk deletion failed in channelId=${channel.id}`, error);
      }
    }
    for (const message of remaining) await deleteIndividually(message);
  }
  return { deletedCount, failedCount: blockMessages.length - deletedCount };
}

import type { TextBasedChannel, Message } from "discord.js";
import { log } from "@/utils/misc/logger";

// Capped at 100 because Discord's message fetch endpoint rejects larger per-request limits.
const DISCORD_FETCH_BATCH_SIZE = 100;

export interface FetchedHistoryAfterResult {
  messages: Message[];

  reachedEnd: boolean;
}

// Discord returns after-fetches in descending-ID order, so sorting ascending by createdTimestamp is required for
// chronological order.
export async function fetchHistoryAfter(
  channel: TextBasedChannel,
  startMessageId: string,
  limit: number,
): Promise<FetchedHistoryAfterResult> {
  const effectiveLimit = Math.min(Math.max(1, limit), DISCORD_FETCH_BATCH_SIZE);

  let batch: Awaited<ReturnType<typeof channel.messages.fetch>>;
  try {
    batch = await channel.messages.fetch({ after: startMessageId, limit: effectiveLimit });
  } catch (fetchError) {
    log.warn(`Failed to fetch messages after ${startMessageId} in channel ${channel.id}: ${fetchError}`);
    return { messages: [], reachedEnd: true };
  }

  const messages = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const reachedEnd = batch.size < effectiveLimit;

  return { messages, reachedEnd };
}

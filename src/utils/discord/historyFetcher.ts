/**
 * Channel history fetcher for the /memory history import command.
 * Fetches a single bounded batch of messages chronologically after a user-supplied
 * anchor message ID, sized to fit within Discord's 15-minute interaction window.
 */

import type { TextBasedChannel, Message } from "discord.js";
import { log } from "@/utils/misc/logger";

/** Maximum messages Discord allows per fetch call */
const DISCORD_FETCH_BATCH_SIZE = 100;

/** Result of a single forward-paginated history fetch */
export interface FetchedHistoryAfterResult {
  /** Messages in chronological order (oldest first), sorted defensively by createdTimestamp */
  messages: Message[];

  /** True if Discord returned fewer messages than the requested limit, meaning no more messages exist after the batch */
  reachedEnd: boolean;
}

/**
 * Fetches up to `limit` messages immediately after the given anchor message ID
 * in chronological order.
 *
 * Discord's `messages.fetch({ after, limit })` returns the messages closest to
 * the anchor (oldest of the "after" range), in descending-ID order; we sort by
 * `createdTimestamp` ascending to guarantee chronological ordering regardless of
 * any quirks in the underlying collection iteration.
 *
 * @param channel - The Discord text channel to fetch from
 * @param startMessageId - Snowflake of the anchor message (NOT included in result)
 * @param limit - Maximum number of messages to fetch (1-100, capped by Discord)
 */
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

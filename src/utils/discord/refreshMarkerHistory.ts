import type { Message } from "discord.js";
import { log } from "@/utils/misc/logger";
import { isRefreshMarkerEmbed } from "./embedDetection";

/**
 * Keep only the messages newer than the most recent refresh marker, oldest first.
 *
 * `messages` arrives newest-first, which is the order Discord returns a fetched channel
 * page in. A refresh marker bounds the context the bot was built with: everything before
 * it belongs to a conversation the bot never saw, so the page is cut there and reversed
 * into the chronological order the callers render.
 *
 * @param logLabel - Names the caller and the channel it read. It is joined with the marker
 *   id, because two fetches in one tool would otherwise produce identical lines.
 */
export function truncateHistoryAtRefreshMarker(messages: Message[], logLabel: string): Message[] {
  const filtered: Message[] = [];

  for (const message of messages) {
    if (message.embeds.length > 0 && message.embeds.some(isRefreshMarkerEmbed)) {
      log.info(`${logLabel} ${message.id}: older messages are stale, so they are truncated`);
      break;
    }
    filtered.push(message);
  }

  filtered.reverse();
  return filtered;
}

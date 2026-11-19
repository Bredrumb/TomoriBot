import type { Message } from "discord.js";
import { log } from "@/utils/misc/logger";
import { isRefreshMarkerEmbed } from "./embedDetection";

// Input messages must be newest-first (Discord fetch order) so the break stops at the latest refresh marker before
// reversing to oldest-first.
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

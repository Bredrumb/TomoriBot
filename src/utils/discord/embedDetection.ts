import type { Embed, Message } from "discord.js";
import { classifyProtocolEmbed } from "./embedProtocol";

export function isRefreshMarkerEmbed(embed: Embed): boolean {
  const kind = classifyProtocolEmbed(embed);
  return kind === "reset" || kind === "compact_refresh";
}

function classifyRefreshMarkerEmbed(embed: Embed): "reset" | "compact_refresh" | null {
  const kind = classifyProtocolEmbed(embed);
  return kind === "reset" || kind === "compact_refresh" ? kind : null;
}

// Messages must be oldest-first; compact_refresh starts at resetIndex because its summary opens the new context,
// while reset starts after the marker.
export function sliceMessagesAtResetMarker<T extends Pick<Message, "embeds">>(
  messages: T[],
): { sliced: T[]; markerType: "reset" | "compact_refresh" | null; markerIndex: number } {
  let resetIndex = -1;
  let markerType: "reset" | "compact_refresh" | null = null;

  // Walk from newest to oldest to find the most recent marker
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const embed of messages[i].embeds) {
      const classified = classifyRefreshMarkerEmbed(embed);
      if (classified) {
        resetIndex = i;
        markerType = classified;
        break;
      }
    }
    if (resetIndex !== -1) break;
  }

  // Compute startIndex based on marker type (or 0 if no marker)
  const startIndex = resetIndex === -1 ? 0 : markerType === "compact_refresh" ? resetIndex : resetIndex + 1;
  return {
    sliced: messages.slice(startIndex),
    markerType,
    markerIndex: resetIndex,
  };
}

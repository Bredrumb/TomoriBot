import type { Client, GatewayDispatchPayload } from "discord.js";
import { recordHistoryWindowChange } from "@/utils/chat/historyWindow";

export default async function recordReaction(client: Client, packet: GatewayDispatchPayload): Promise<void> {
  switch (packet.t) {
    case "MESSAGE_UPDATE": {
      // An uncached update can create a cache entry before messageUpdate fires, so capture its absence here.
      const channel = client.channels.cache.get(packet.d.channel_id);
      if (!channel?.isTextBased() || !channel.messages.cache.has(packet.d.id)) {
        recordHistoryWindowChange(packet.d.channel_id, packet.d.id, "uncached");
      }
      break;
    }
    case "MESSAGE_REACTION_ADD":
    case "MESSAGE_REACTION_REMOVE":
    case "MESSAGE_REACTION_REMOVE_ALL":
    case "MESSAGE_REACTION_REMOVE_EMOJI":
      recordHistoryWindowChange(packet.d.channel_id, packet.d.message_id, "changed");
  }
}

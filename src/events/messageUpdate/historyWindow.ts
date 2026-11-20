import type { Client, Message, PartialMessage } from "discord.js";
import { recordHistoryWindowChange } from "@/utils/chat/historyWindow";

export default async function recordUpdate(
  _client: Client,
  _oldMessage: Message | PartialMessage,
  message: Message | PartialMessage,
): Promise<void> {
  recordHistoryWindowChange(message.channelId, message.id, "changed");
}

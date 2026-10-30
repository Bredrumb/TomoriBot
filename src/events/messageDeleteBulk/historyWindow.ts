import type { Client, Collection, Message, PartialMessage } from "discord.js";
import { recordHistoryWindowChange } from "@/utils/chat/historyWindow";

export default async function recordBulkDeletion(
  _client: Client,
  messages: Collection<string, Message | PartialMessage>,
): Promise<void> {
  for (const message of messages.values()) recordHistoryWindowChange(message.channelId, message.id, "deleted");
}

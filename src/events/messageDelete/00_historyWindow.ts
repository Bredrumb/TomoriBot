import type { Client, Message, PartialMessage } from "discord.js";
import { recordHistoryWindowChange } from "@/utils/chat/historyWindow";

export default async function recordDeletion(_client: Client, message: Message | PartialMessage): Promise<void> {
  recordHistoryWindowChange(message.channelId, message.id, "deleted");
}

import type { Client, Collection, Message, PartialMessage } from "discord.js";
import { recordHistoryWindowChange } from "@/utils/chat/historyWindow";
import { observeReplyControlDeletions } from "@/utils/discord/fastRegeneration";

export default async function recordBulkDeletion(
  _client: Client,
  messages: Collection<string, Message | PartialMessage>,
): Promise<void> {
  for (const message of messages.values()) recordHistoryWindowChange(message.channelId, message.id, "deleted");
  const first = messages.first();
  if (first) void observeReplyControlDeletions(first.channelId, messages.keys());
}

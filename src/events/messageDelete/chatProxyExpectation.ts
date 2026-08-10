import type { Client, Message, PartialMessage } from "discord.js";
import { markChatProxyOriginalDeleted } from "@/utils/chatProxy/proxyExpectation";
import { log } from "@/utils/misc/logger";

export default async function messageDeleteHandler(
  _client: Client,
  deletedMessage: Message | PartialMessage,
): Promise<void> {
  const wasChatProxyOriginal = markChatProxyOriginalDeleted(deletedMessage.channelId, deletedMessage.id);
  if (wasChatProxyOriginal) {
    log.info(
      `Chat-proxy expectation marked proxied for deleted original ${deletedMessage.id} in channel ${deletedMessage.channelId}`,
    );
  }
}

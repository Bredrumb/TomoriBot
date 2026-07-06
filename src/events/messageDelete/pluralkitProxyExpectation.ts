import type { Client, Message, PartialMessage } from "discord.js";
import { markPluralKitProxyOriginalDeleted } from "@/utils/chat/pluralkit/proxyExpectation";
import { log } from "@/utils/misc/logger";

export default async function messageDeleteHandler(
  _client: Client,
  deletedMessage: Message | PartialMessage,
): Promise<void> {
  const wasPluralKitProxyOriginal = markPluralKitProxyOriginalDeleted(deletedMessage.channelId, deletedMessage.id);
  if (wasPluralKitProxyOriginal) {
    log.info(
      `PluralKit proxy expectation marked proxied for deleted original ${deletedMessage.id} in channel ${deletedMessage.channelId}`,
    );
  }
}

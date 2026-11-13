import type { Client, Message, PartialMessage } from "discord.js";
import { recordingCaptureRuntime } from "@/modules/conversation-recording/runtime/capture";
import { log } from "@/utils/misc/logger";

export default async function editRecording(
  _client: Client,
  _old: Message | PartialMessage,
  message: Message | PartialMessage,
): Promise<void> {
  void recordingCaptureRuntime
    .observeUpdate(_client, message)
    .catch(() =>
      log.warn("Conversation recording edit failed", undefined, { metadata: { channelId: message.channelId } }),
    );
}

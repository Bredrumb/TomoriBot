import type { Client, Message, PartialMessage } from "discord.js";
import { recordingCaptureRuntime } from "@/modules/conversation-recording/runtime/capture";
import { log } from "@/utils/misc/logger";

export default async function deleteRecording(_client: Client, message: Message | PartialMessage): Promise<void> {
  void recordingCaptureRuntime
    .observeDelete(message.guildId, message.channelId, [message.id])
    .catch(() =>
      log.warn("Conversation recording deletion failed", undefined, { metadata: { channelId: message.channelId } }),
    );
}

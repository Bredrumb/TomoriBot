import type { Client, Message } from "discord.js";
import { recordingCaptureRuntime } from "@/modules/conversation-recording/runtime/capture";
import { log } from "@/utils/misc/logger";

export default async function captureRecording(client: Client, message: Message): Promise<void> {
  void recordingCaptureRuntime
    .observeCreate(client, message)
    .catch(() =>
      log.warn("Conversation recording capture failed", undefined, { metadata: { channelId: message.channelId } }),
    );
}

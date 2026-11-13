import type { Client, Collection, Message, PartialMessage } from "discord.js";
import { recordingCaptureRuntime } from "@/modules/conversation-recording/runtime/capture";
import { log } from "@/utils/misc/logger";

export default async function deleteRecordings(
  _client: Client,
  messages: Collection<string, Message | PartialMessage>,
): Promise<void> {
  const first = messages.first();
  if (!first) return;
  void recordingCaptureRuntime
    .observeDelete(first.guildId, first.channelId, [...messages.keys()])
    .catch(() =>
      log.warn("Conversation recording bulk deletion failed", undefined, { metadata: { channelId: first.channelId } }),
    );
}

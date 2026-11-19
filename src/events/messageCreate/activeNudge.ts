import type { Client, Message } from "discord.js";
import { observeActiveNudgeMessage } from "@/modules/natural-nudges/runtime/activeNudges";
import { log } from "@/utils/misc/logger";

// Intentionally unawaited because messageCreate handlers run sequentially and a cold settings read here must not
// delay tomoriChat.
export default async function activeNudgeHandler(client: Client, message: Message): Promise<void> {
  void observeActiveNudgeMessage(client, message).catch((error) =>
    log.warn("Natural Nudges: Active Nudge counter failed", error, { metadata: { channelId: message.channelId } }),
  );
}

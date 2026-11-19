// Discord's message_snapshots is non-recursive so nested forwards become empty, while the wrapper reference still
// points at the intermediate forward.

import { type Message, type MessageSnapshot, MessageReferenceType } from "discord.js";
import { log } from "@/utils/misc/logger";

// Bounded to 3 hops because each extra forward level costs another Discord message fetch on the context build path.
const FORWARD_CHAIN_MAX_DEPTH = 3;

export interface ResolvedForwardChain {
  snapshots: MessageSnapshot[];
  extraHops: number;
  unresolved: boolean;
}

// Discord rejects empty messages, so an empty snapshot indicates a nested-forward wrapper whose inner snapshot layer
// was flattened away.
function isEmptyForwardSnapshot(snapshot: MessageSnapshot): boolean {
  return (
    !snapshot.content?.trim() &&
    snapshot.attachments.size === 0 &&
    snapshot.embeds.length === 0 &&
    snapshot.stickers.size === 0 &&
    (snapshot.components?.length ?? 0) === 0
  );
}

async function fetchForwardOrigin(message: Message, channelId: string, messageId: string): Promise<Message | null> {
  try {
    const channel = message.client.channels.cache.get(channelId) ?? (await message.client.channels.fetch(channelId));
    // PartialGroupDMChannel is text-based but exposes no message manager.
    if (!channel?.isTextBased() || !("messages" in channel)) {
      return null;
    }
    return await channel.messages.fetch(messageId);
  } catch (error) {
    log.warn(`Could not fetch forwarded origin message ${messageId} in channel ${channelId}`, {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function resolveForwardChain(message: Message): Promise<ResolvedForwardChain> {
  if (message.messageSnapshots.size === 0) {
    return { snapshots: [], extraHops: 0, unresolved: false };
  }

  let snapshots = [...message.messageSnapshots.values()];
  let reference = message.reference;
  let extraHops = 0;

  while (snapshots.every(isEmptyForwardSnapshot)) {
    if (
      extraHops >= FORWARD_CHAIN_MAX_DEPTH ||
      reference?.type !== MessageReferenceType.Forward ||
      !reference.messageId
    ) {
      return { snapshots: [], extraHops, unresolved: true };
    }

    const origin = await fetchForwardOrigin(message, reference.channelId, reference.messageId);
    if (!origin || origin.messageSnapshots.size === 0) {
      return { snapshots: [], extraHops, unresolved: true };
    }

    snapshots = [...origin.messageSnapshots.values()];
    reference = origin.reference;
    extraHops++;
  }

  return { snapshots, extraHops, unresolved: false };
}

/**
 * Resolution of Discord forward chains (a forward of a forward of a ...).
 *
 * Discord's `message_snapshots` payload is deliberately NON-recursive: a snapshot
 * carries only attachments/components/content/embeds/flags/mentions/stickers/type,
 * so it can never report that it was itself a forward. Forwarding an already
 * forwarded message therefore hands the bot an EMPTY snapshot (no text, no media)
 * and every downstream media walk silently finds nothing.
 *
 * The wrapper message's own `reference` survives that flattening, though, and points
 * at the intermediate forward in its origin channel. Re-fetching that message exposes
 * the next `messageSnapshots` level, so a bounded walk recovers the original media.
 */

import { type Message, type MessageSnapshot, MessageReferenceType } from "discord.js";
import { log } from "@/utils/misc/logger";

/**
 * Maximum forward hops to chase beyond the first snapshot level. Each hop costs one
 * Discord message fetch, so this is bounded to keep the context build path cheap.
 */
const FORWARD_CHAIN_MAX_DEPTH = Math.max(0, Number.parseInt(process.env.FORWARD_CHAIN_MAX_DEPTH ?? "3", 10) || 3);

/** Outcome of walking a message's forward chain down to real content. */
export interface ResolvedForwardChain {
  /** Snapshots that actually carry content. Empty when the chain could not be resolved. */
  snapshots: MessageSnapshot[];
  /** Forward hops traversed beyond the first level (0 for an ordinary single forward). */
  extraHops: number;
  /** True when a nested forward was detected but its origin could not be re-fetched. */
  unresolved: boolean;
}

/**
 * Detect a snapshot that carries no payload at all.
 *
 * Discord rejects genuinely empty messages, so a snapshot with no content, attachments,
 * embeds, stickers, or components can only be a forward wrapper whose own snapshot layer
 * was flattened away. That makes emptiness a reliable nested-forward signal.
 *
 * @returns True when the snapshot carries no recoverable payload
 */
function isEmptyForwardSnapshot(snapshot: MessageSnapshot): boolean {
  return (
    !snapshot.content?.trim() &&
    snapshot.attachments.size === 0 &&
    snapshot.embeds.length === 0 &&
    snapshot.stickers.size === 0 &&
    (snapshot.components?.length ?? 0) === 0
  );
}

/**
 * Fetch the message a forward reference points at, tolerating every access failure.
 *
 * The origin can sit in a channel the bot cannot read (another guild, a DM, revoked
 * permissions) or may have been deleted, so this never throws; an unreachable origin
 * degrades to an explicit "unresolved" chain rather than failing the whole context build.
 *
 * @param message - Message whose client and reference drive the lookup
 * @param channelId - Origin channel snowflake from the forward reference
 * @param messageId - Origin message snowflake from the forward reference
 * @returns The referenced message, or null when it cannot be reached
 */
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

/**
 * Walk a message's forward chain until snapshots with real content are found.
 *
 * Returns immediately for non-forwards and for ordinary single forwards (the common
 * case, costing zero extra fetches). Only an empty snapshot: the nested-forward
 * signature: triggers a re-fetch of the intermediate wrapper.
 *
 * @param message - Message received in the current channel (the outermost forward)
 * @returns Resolved snapshots plus how far the walk had to go, and whether it gave up
 */
export async function resolveForwardChain(message: Message): Promise<ResolvedForwardChain> {
  // Snapshots exist only on forwards, so anything without them has nothing to resolve.
  if (message.messageSnapshots.size === 0) {
    return { snapshots: [], extraHops: 0, unresolved: false };
  }

  let snapshots = [...message.messageSnapshots.values()];
  let reference = message.reference;
  let extraHops = 0;

  // An empty snapshot means the thing forwarded was itself a forward. The wrapper's
  //    reference still points at that intermediate message, whose own snapshots hold
  //    the next level down, so chase it until content appears or the budget runs out.
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

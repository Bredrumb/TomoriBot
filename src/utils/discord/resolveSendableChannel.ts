import type {
  AnyThreadChannel,
  BaseGuildTextChannel,
  BaseGuildVoiceChannel,
  Channel,
  Client,
  DMChannel,
  Message,
  NewsChannel,
  TextChannel,
} from "discord.js";

/**
 * A channel the bot can post a message into.
 *
 * Kept as a union of the concrete text-capable structures rather than a structural `{ send }`
 * type so callers keep Discord's own signatures (attachments, components, reply references) on
 * the returned value.
 */
export type SendableChannel =
  | TextChannel
  | BaseGuildTextChannel
  | BaseGuildVoiceChannel
  | NewsChannel
  | DMChannel
  | AnyThreadChannel;

/**
 * Why a channel cannot be reached.
 *
 * The two are terminal for the send but not the same condition, so the caller chooses the stop
 * reason from this rather than reading both as a deletion. A deleted channel is gone for good; a
 * revoked access grant is a permission state an operator can restore.
 */
export type ChannelUnreachableReason = "channel_deleted" | "missing_access";

/**
 * A resolved destination, or the condition that stopped it from resolving.
 *
 * Both members carry no `undefined` for the field they always set, so a caller narrows on
 * `channel` and reads `failed` without an optional chain.
 */
export type ChannelResolution =
  | { channel: SendableChannel; failed?: undefined }
  | { channel?: undefined; failed: ChannelUnreachableReason };

/**
 * Whether a channel object exposes Discord's message-send surface.
 *
 * A partial channel resolves without its methods, and a partial group DM is text-based but
 * exposes no `send`, so the method check is what separates a usable destination from one that
 * would fail later in the request.
 */
function canSend(channel: Channel): boolean {
  return typeof (channel as { send?: unknown }).send === "function";
}

/**
 * Whether a failed channel fetch is Discord's permanent "this channel is not there" answer.
 *
 * Only the delete code reaches this: a channel the bot cannot see throws `MissingChannelAccess`
 * instead, which the caller reports as a lost permission rather than as a deletion. Everything
 * the fetch can otherwise raise (429, 5xx, timeouts, aborts) clears on its own and must not be
 * read as permanent.
 */
function isPermanentFetchFailure(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  if (code === 10003 || code === "10003") return true;

  const message = error instanceof Error ? error.message : "";
  return message.includes("Unknown Channel");
}

/**
 * Raised when the bot can see a channel exists but has lost the grant to post in it.
 *
 * 50001 is Discord's Missing Access. It is reported as its own condition rather than folded into
 * "the channel is gone", because an operator reading the log needs to know the difference: this
 * one is restorable by granting the permission back.
 */
export class MissingChannelAccessError extends Error {
  public readonly code = 50001;

  public constructor(channelId: string) {
    super(`Missing access to channel ${channelId}`);
    this.name = "MissingChannelAccessError";
  }
}

/**
 * Whether a failure is Discord's Missing Access, whichever layer raised it.
 *
 * A fetch that cannot see the channel and a send into one the bot has lost access to produce the
 * same code from different layers, so the code is what the caller reads. Matching on the class
 * alone would read a native `DiscordAPIError` 50001 as a deletion and send an operator looking for
 * a channel that still exists.
 */
export function isMissingChannelAccessError(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  return code === 50001 || code === "50001";
}

/**
 * Resolves a channel for sending without depending on the client cache holding it.
 *
 * `Message#channel` and `Message#reply` are cache-only lookups: discord.js throws
 * `ChannelNotCached` when the channel is absent, which happens for a deleted channel and also for
 * one that was never populated (a DM or a thread the bot never joined). Those two cases are
 * indistinguishable at the throw site but have opposite outcomes, and only a REST fetch can
 * separate them. A turn can hold a source `Message` for minutes while it streams, so the cached
 * lookup it captured at admission is not a safe assumption by send time.
 *
 * The reason is returned rather than flattened into a null, because the caller stops the stream
 * either way and the log has to name the condition that actually happened.
 *
 * @param client - Client whose channel manager performs the cache-first lookup
 * @param channelId - Snowflake of the destination channel
 * @returns The channel, or the reason it cannot be reached
 */
export async function resolveSendableChannel(
  client: Client,
  channelId: string | undefined,
): Promise<ChannelResolution> {
  if (!channelId) return { failed: "channel_deleted" };

  const cached = client.channels.cache.get(channelId);
  if (cached && canSend(cached)) return { channel: cached as SendableChannel };

  // ChannelManager.fetch is cache-first itself and only reaches REST for a missing or partial
  // entry, so this stays one lookup in the common case.
  //
  // Only a permanent answer becomes a reason. Mapping every rejection to one would make a rate
  // limit, a 5xx, or a socket error indistinguishable from a deletion, and the caller treats a
  // reason as terminal: it stops the stream and drops the turn's remaining retry arms. A
  // transient failure keeps its own error so it stays an ordinary send failure.
  let fetched: Channel | null;
  try {
    fetched = await client.channels.fetch(channelId);
  } catch (error) {
    if (isPermanentFetchFailure(error)) return { failed: "channel_deleted" };

    // Checked here rather than folded into the predicate above, because only this call site has a
    // terminal answer for it. A 50001 on a send can clear when a timeout expires, so the shared
    // predicate must stay narrow and let those keep their retry arms.
    if (isMissingChannelAccessError(error)) return { failed: "missing_access" };
    throw error;
  }

  // A channel that resolves but exposes no send surface is unreachable for reasons this cannot
  // name, so it stays on the deletion path rather than claiming a permission the bot may still
  // hold.
  return fetched && canSend(fetched) ? { channel: fetched as SendableChannel } : { failed: "channel_deleted" };
}

/**
 * Resolves the channel a reply belongs in.
 *
 * Discord rejects a reply whose reference lives in another channel, so the source message's
 * channel wins whenever it can be reached; the fallback exists for a source channel the bot can
 * no longer see.
 *
 * @param client - Client performing the resolution
 * @param replyToMessage - Source message when the turn answers one
 * @param fallbackChannelId - Channel captured at admission, used when the source is gone
 * @returns The channel, or the reason no reachable destination is left
 */
export async function resolveReplyChannel(
  client: Client,
  replyToMessage: Message | undefined,
  fallbackChannelId: string,
): Promise<ChannelResolution> {
  return resolveSendableChannel(client, replyToMessage?.channelId ?? fallbackChannelId);
}

/**
 * Whether a Discord failure means the destination channel cannot receive a message.
 *
 * 10003 is a deleted channel and 50001 is one the bot lost access to; a stopped stream is the same
 * verdict for both, so the two share a predicate. The client-side `ChannelNotCached` is
 * deliberately not included: it says only that the channel was absent from the local cache, which
 * an uncached thread or an evicted DM entry also produces, and the send path resolves that case
 * with a fetch rather than reading it as a deletion.
 *
 * A refusal raised by the send itself is deliberately outside this predicate. 50013 is the one
 * that arrives in the same code shape, and a member timeout that produced it can clear on its own,
 * so reading it here would turn a recoverable refusal into a stopped stream.
 */
export function isChannelGoneError(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  if (code === 10003 || code === "10003" || code === 50001 || code === "50001") return true;

  const message = error instanceof Error ? error.message : "";
  return message.includes("Unknown Channel");
}

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
 * Resolves a channel for sending without depending on the client cache holding it.
 *
 * `Message#channel` and `Message#reply` are cache-only lookups: discord.js throws
 * `ChannelNotCached` when the channel is absent, which happens for a deleted channel and also for
 * one that was never populated (a DM or a thread the bot never joined). Those two cases are
 * indistinguishable at the throw site but have opposite outcomes, and only a REST fetch can
 * separate them. A turn can hold a source `Message` for minutes while it streams, so the cached
 * lookup it captured at admission is not a safe assumption by send time.
 *
 * Never throws: an unreachable or deleted channel resolves to null, and the caller decides
 * whether that is a quiet teardown or a failure worth reporting.
 *
 * @param client - Client whose channel manager performs the cache-first lookup
 * @param channelId - Snowflake of the destination channel
 * @returns The channel, or null when it is gone or the bot cannot see it
 */
export async function resolveSendableChannel(
  client: Client,
  channelId: string | undefined,
): Promise<SendableChannel | null> {
  if (!channelId) return null;

  const cached = client.channels.cache.get(channelId);
  if (cached && canSend(cached)) return cached as SendableChannel;

  // ChannelManager.fetch is cache-first itself and only reaches REST for a missing or partial
  // entry, so this stays one lookup in the common case. It rejects with 10003 for a deleted
  // channel, which is the signal that no retry can help.
  const fetched = await client.channels.fetch(channelId).catch(() => null);
  return fetched && canSend(fetched) ? (fetched as SendableChannel) : null;
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
 * @returns The channel, or null when no reachable destination is left
 */
export async function resolveReplyChannel(
  client: Client,
  replyToMessage: Message | undefined,
  fallbackChannelId: string,
): Promise<SendableChannel | null> {
  return resolveSendableChannel(client, replyToMessage?.channelId ?? fallbackChannelId);
}

/**
 * Whether a Discord failure means the destination channel no longer exists.
 *
 * Covers both halves of one deletion: the client-side `ChannelNotCached` that discord.js raises
 * before the request is built, and the REST 10003 that a captured channel object returns once the
 * channel is gone. Distinct from a permission refusal, which a retry can still clear.
 */
export function isChannelGoneError(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  if (code === 10003 || code === "10003" || code === "ChannelNotCached") return true;

  const message = error instanceof Error ? error.message : "";
  return message.includes("Unknown Channel") || message.includes("Could not find the channel");
}

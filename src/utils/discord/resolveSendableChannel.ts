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

// Kept as a concrete union rather than a structural { send } type so callers retain Discord's full send parameter
// signatures.
export type SendableChannel =
  | TextChannel
  | BaseGuildTextChannel
  | BaseGuildVoiceChannel
  | NewsChannel
  | DMChannel
  | AnyThreadChannel;

// Restorable permission loss stays separate from permanent channel deletion so callers choose the right stop reason
// instead of treating both as deleted.
export type ChannelUnreachableReason = "channel_deleted" | "missing_access";

export type ChannelResolution =
  | { channel: SendableChannel; failed?: undefined }
  | { channel?: undefined; failed: ChannelUnreachableReason };

// Callable send is checked rather than isTextBased() because partial channels and partial group DMs can be text-based
// without send.
function canSend(channel: Channel): boolean {
  return typeof (channel as { send?: unknown }).send === "function";
}

// Only Discord 10003 (Unknown Channel) is permanent because 50001 is restorable missing access and 429/5xx/timeouts
// are transient.
function isPermanentFetchFailure(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  if (code === 10003 || code === "10003") return true;

  const message = error instanceof Error ? error.message : "";
  return message.includes("Unknown Channel");
}

// Discord error code 50001 (Missing Access) is used so permission loss stays distinct from permanent deletion and
// matches native DiscordAPIError 50001.
export class MissingChannelAccessError extends Error {
  public readonly code = 50001;

  public constructor(channelId: string) {
    super(`Missing access to channel ${channelId}`);
    this.name = "MissingChannelAccessError";
  }
}

// Missing Access (50001) arrives from different error classes on fetch versus send, so matching on code prevents
// misclassifying it as channel deletion.
export function isMissingChannelAccessError(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  return code === 50001 || code === "50001";
}

// discord.js Message#channel is cache-only and throws ChannelNotCached for both deleted and uncached channels, so
// send resolution fetches over REST.
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

// Discord rejects cross-channel reply references, so the source message's channel must win whenever reachable before
// using fallbackChannelId.
export async function resolveReplyChannel(
  client: Client,
  replyToMessage: Message | undefined,
  fallbackChannelId: string,
): Promise<ChannelResolution> {
  return resolveSendableChannel(client, replyToMessage?.channelId ?? fallbackChannelId);
}

// ChannelNotCached and 50013 are excluded because uncached threads fetch cleanly and 50013 can be a transient timeout
// rather than a permanently gone channel.
export function isChannelGoneError(error: unknown): boolean {
  const code = (error as { code?: number | string })?.code;
  if (code === 10003 || code === "10003" || code === 50001 || code === "50001") return true;

  const message = error instanceof Error ? error.message : "";
  return message.includes("Unknown Channel");
}

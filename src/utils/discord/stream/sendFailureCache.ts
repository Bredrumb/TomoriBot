// Discord rejects sends from timed-out members with 50013, indistinguishable from a real permission gap at the API
// level, so both share one reason.
export type SendFailureReason = "missing_permissions" | "missing_access" | "channel_gone";

interface SendFailureEntry {
  reason: SendFailureReason;
  expiresAt: number;
  reported: boolean;
}

const sendFailureCache = new Map<string, SendFailureEntry>();

const SEND_FAILURE_RETRY_MS = 15 * 60_000;

// Error classification stays narrow because caching transient failures silences a recovering channel, which is worse
// than a wasted LLM call.
export function classifySendFailure(error: unknown): SendFailureReason | null {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? error
      : error && typeof error === "object" && "cause" in error
        ? (error as { cause?: unknown }).cause
        : error;
  const code = (candidate as { code?: number | string })?.code;

  if (code === 50013 || code === "50013") {
    return "missing_permissions";
  }

  if (code === 50001 || code === "50001") {
    return "missing_access";
  }

  // Cache 10003 (permanent deletion) and exclude ChannelNotCached because local cache eviction resolves via REST
  // fetch.
  if (code === 10003 || code === "10003") {
    return "channel_gone";
  }

  return null;
}

export function noteSendFailure(channelId: string, reason: SendFailureReason): { isFirstOfEpisode: boolean } {
  const existing = sendFailureCache.get(channelId);
  const isFirstOfEpisode = !existing || existing.expiresAt <= Date.now() || !existing.reported;

  sendFailureCache.set(channelId, {
    reason,
    expiresAt: Date.now() + SEND_FAILURE_RETRY_MS,
    reported: true,
  });

  return { isFirstOfEpisode };
}

const loggedSendFailures = new WeakSet<object>();

// Send errors propagate through the orchestrator and emitter, so marking them here prevents later layers from logging
// duplicate error-level rows.
export function markSendFailureLogged<T extends object>(error: T): T {
  loggedSendFailures.add(error);
  return error;
}

export function wasSendFailureLogged(error: unknown): boolean {
  return typeof error === "object" && error !== null && loggedSendFailures.has(error);
}

export function getBlockedSendReason(channelId: string): SendFailureReason | null {
  const entry = sendFailureCache.get(channelId);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    sendFailureCache.delete(channelId);
    return null;
  }

  return entry.reason;
}

// Successful sends clear the cached block immediately because waiting out the full TTL delays recovery after an admin
// restores permissions or lifts a timeout.
export function clearSendFailure(channelId: string): void {
  sendFailureCache.delete(channelId);
}

export function resetSendFailureCacheForTesting(): void {
  sendFailureCache.clear();
}

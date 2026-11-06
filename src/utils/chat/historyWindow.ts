import { ChannelType, GatewayIntentBits, LimitedCollection, type Message } from "discord.js";
import { channelLocks } from "@/utils/chat/channelQueue";
import { historyWindowStride, MAX_MESSAGE_FETCH_LIMIT } from "@/utils/discord/messageFetchLimit";
import { measureChatTurnStage, recordChatTurnHistory } from "@/utils/chat/turnLatency";
import { log } from "@/utils/misc/logger";

export interface ChannelHistoryWindow {
  messages: Message[];
  fetchLimit: number;
  newestAtBuild?: string;
  changes: Map<string, "changed" | "uncached" | "deleted">;
  fetching: boolean;
  changedDuringFetch: boolean;
  cache: ReadonlyMap<string, Message>;
  hasOlderMessages: boolean;
}

const disconnectedShards = new Set<number>();
const MAX_HISTORY_CHANGE_SIGNALS = MAX_MESSAGE_FETCH_LIMIT;

type HistoryAnchor = {
  startId: string;
  nextStartId?: string;
  fetchLimit: number;
  expiresAt: number;
};

// Anchors use a separate store because idle releases discard the fetched-message window.
const historyAnchors = new Map<string, HistoryAnchor>();
const HISTORY_ANCHOR_TTL_MS = 5 * 60_000;
const MAX_HISTORY_ANCHORS = 2000;

export function selectAnchoredHistory<T extends { id: string }>(
  channelId: string,
  messages: T[],
  fetchLimit: number,
  resetMessageId?: string,
  requiredMessageId?: string,
  mode: "update" | "inspect" = "update",
): T[] {
  const now = Date.now();
  if (mode === "update") {
    for (const [id, anchor] of historyAnchors) {
      if (anchor.expiresAt <= now) historyAnchors.delete(id);
    }
  }
  let anchor = historyAnchors.get(channelId);
  if (
    anchor &&
    (anchor.expiresAt <= now ||
      anchor.fetchLimit !== fetchLimit ||
      (resetMessageId && compareIds(resetMessageId, anchor.startId) > 0))
  ) {
    if (mode === "update") historyAnchors.delete(channelId);
    anchor = undefined;
  }
  const ordered = messages;
  let start = anchor ? ordered.findIndex((message) => message.id === anchor.startId) : -1;
  if (anchor && start === -1 && ordered[0] && compareIds(anchor.startId, ordered[0].id) < 0) {
    start = ordered.findIndex((message) => message.id === anchor.nextStartId);
  }
  if (start === -1) start = Math.max(0, ordered.length - fetchLimit);
  const stride = historyWindowStride(fetchLimit);
  while (ordered.length - start > fetchLimit) start += stride;
  let selected = ordered.slice(start);
  const required = ordered.find((message) => message.id === requiredMessageId);
  if (required && !selected.includes(required)) {
    selected = [required, ...selected.slice(-(fetchLimit - 1))].sort((left, right) => compareIds(left.id, right.id));
  }
  if (mode === "inspect") return selected;
  const startId = selected[0]?.id;
  if (!startId) {
    historyAnchors.delete(channelId);
    return selected;
  }
  if (!historyAnchors.has(channelId) && historyAnchors.size >= MAX_HISTORY_ANCHORS) {
    const oldest = historyAnchors.keys().next().value;
    if (oldest !== undefined) historyAnchors.delete(oldest);
  }
  historyAnchors.set(channelId, {
    startId,
    nextStartId: selected[stride]?.id,
    fetchLimit,
    expiresAt: anchor?.startId === startId ? anchor.expiresAt : now + HISTORY_ANCHOR_TTL_MS,
  });
  log.metric("history_anchor_cache", { entries: historyAnchors.size });
  return selected;
}

function compareIds(left: string, right: string): number {
  return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
}

function mergeWindow(window: ChannelHistoryWindow, cached: Iterable<Message>, limit: number): Message[] {
  const oldestId = window.messages[0]?.id;
  const messages = new Map(window.messages.map((message) => [message.id, message]));
  for (const message of cached) {
    if (!message.partial && (!oldestId || compareIds(message.id, oldestId) >= 0)) messages.set(message.id, message);
  }
  for (const [id, change] of window.changes) {
    if (change === "deleted") messages.delete(id);
  }
  return [...messages.values()].sort((left, right) => compareIds(left.id, right.id)).slice(-limit);
}

export function recordHistoryWindowChange(
  channelId: string,
  messageId: string,
  change: "changed" | "uncached" | "deleted",
): void {
  const anchor = historyAnchors.get(channelId);
  if (change === "deleted" && (anchor?.startId === messageId || anchor?.nextStartId === messageId)) {
    historyAnchors.delete(channelId);
  }
  const entry = channelLocks.get(channelId);
  const window = entry?.historyWindow;
  if (!window) return;
  if (window.fetching) window.changedDuringFetch = true;
  if (!window.changes.has(messageId) && window.changes.size >= MAX_HISTORY_CHANGE_SIGNALS) {
    entry.historyWindow = undefined;
    return;
  }
  const previous = window.changes.get(messageId);
  if (previous !== "deleted" && (previous !== "uncached" || change === "deleted"))
    window.changes.set(messageId, change);
}

export function isHistoryWindowMessageDeleted(channelId: string, messageId: string): boolean {
  return channelLocks.get(channelId)?.historyWindow?.changes.get(messageId) === "deleted";
}

export function recordHistoryWindowDelivery(channelId: string, messageId: string, message?: Message): void {
  const entry = channelLocks.get(channelId);
  const window = entry?.historyWindow;
  if (!window) return;
  message ??= window.cache.get(messageId) ?? window.messages.find((candidate) => candidate.id === messageId);
  if (!message || message.partial) {
    entry.historyWindow = undefined;
    return;
  }
  if (message.channelId !== channelId || window.changes.get(messageId) === "deleted") return;
  window.messages = mergeWindow(window, [message], window.fetchLimit);
  window.hasOlderMessages ||= window.messages.length >= window.fetchLimit;
}

export function setHistoryWindowGatewayConnected(shardId: number, connected: boolean): void {
  historyAnchors.clear();
  if (connected) disconnectedShards.delete(shardId);
  else disconnectedShards.add(shardId);
  for (const entry of channelLocks.values()) entry.historyWindow = undefined;
}

export async function readChannelHistory(
  channel: Message["channel"],
  fetchLimit: number,
  allowReuse: boolean,
): Promise<Message[]> {
  const entry = channelLocks.get(channel.id);
  const signal = entry?.activeTurnAbortController?.signal;
  const ownsTurn = () => entry?.isLocked && entry.activeTurnAbortController?.signal === signal && !signal?.aborted;
  const receivesReactions =
    channel.type !== ChannelType.DM || channel.client.options.intents.has(GatewayIntentBits.DirectMessageReactions);
  const canStore = () => ownsTurn() && disconnectedShards.size === 0 && receivesReactions;
  const cache = channel.messages.cache;
  let window = canStore() ? entry?.historyWindow : undefined;
  const cacheOldest = [...cache.keys()].sort(compareIds)[0];
  const gap =
    window?.newestAtBuild &&
    cache instanceof LimitedCollection &&
    (!cacheOldest || compareIds(cacheOldest, window.newestAtBuild) > 0);
  const merged = window ? mergeWindow(window, cache.values(), fetchLimit) : [];
  const uncachedChange =
    window &&
    [...window.changes].some(
      ([id, change]) =>
        change !== "deleted" &&
        merged.some((message) => message.id === id) &&
        (change === "uncached" || !cache.has(id) || cache.get(id)?.partial),
    );
  if (window && allowReuse && fetchLimit <= window.fetchLimit && !gap && !uncachedChange && !window.fetching) {
    if (merged.length >= fetchLimit || !window.hasOlderMessages) {
      window.hasOlderMessages ||= merged.length >= fetchLimit;
      window.messages = merged;
      window.fetchLimit = fetchLimit;
      window.newestAtBuild = window.messages.at(-1)?.id;
      recordChatTurnHistory("reused");
      return [...window.messages];
    }
  }

  recordChatTurnHistory("rest");
  for (;;) {
    window = {
      messages: [],
      fetchLimit,
      changes: new Map([...(entry?.historyWindow?.changes ?? [])].filter(([, change]) => change === "deleted")),
      fetching: true,
      changedDuringFetch: false,
      cache,
      hasOlderMessages: false,
    };
    if (ownsTurn() && entry) entry.historyWindow = window;
    const fetched = await measureChatTurnStage("history_fetch_ms", () => channel.messages.fetch({ limit: fetchLimit }));
    window.fetching = false;
    if (entry && !ownsTurn()) {
      // A released turn's REST response can still patch the next turn's cached messages, so invalidate its window.
      entry.historyWindow = undefined;
      return [...fetched.values()].reverse();
    }
    // REST patches cached instances, so even a cached edit during the request requires another read.
    if (window.changedDuringFetch || (ownsTurn() && entry?.historyWindow !== window)) continue;
    window.messages = [
      ...new Map([...fetched, ...window.messages.map((message) => [message.id, message] as const)]).values(),
    ].reverse();
    window.hasOlderMessages = window.messages.length >= fetchLimit;
    if (canStore() && entry?.historyWindow === window) {
      window.messages.sort((left, right) => compareIds(left.id, right.id));
      window.messages = mergeWindow(window, cache.values(), fetchLimit);
      window.newestAtBuild = window.messages.at(-1)?.id;
    } else if (entry?.historyWindow === window) {
      entry.historyWindow = undefined;
    }
    return [...window.messages];
  }
}

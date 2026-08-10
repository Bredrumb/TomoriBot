import type { Message } from "discord.js";
import type { ProxyMessageAttestation } from "@/utils/chatProxy/types";
import { log } from "@/utils/misc/logger";

export type ChatProxyExpectationState = "pending" | "proxied";
export type ChatProxyWaitResult = "timeout" | "proxied";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ChatProxyExpectation {
  serviceId: string;
  channelId: string;
  originalMessageId: string;
  senderDiscId: string;
  state: ChatProxyExpectationState;
  createdAt: number;
  expiresAt: number;
  originalMessage: Message;
  originalReference: Message["reference"];
}

interface InternalChatProxyExpectation extends ChatProxyExpectation {
  waitPromise: Promise<ChatProxyWaitResult>;
  waitResolved: boolean;
  waitDeadline: number;
  waitTimer: TimerHandle | null;
  ttlTimer: TimerHandle | null;
  resolveWait: (result: ChatProxyWaitResult) => void;
}

export interface ChatProxyMessageRecord {
  serviceId: string;
  messageDiscId: string;
  channelId: string;
  originalMessageId: string;
  senderDiscId: string;
  createdAt: number;
  expiresAt: number;
  originalMessage: Message;
  originalReference: Message["reference"];
}

interface InternalChatProxyMessageRecord extends ChatProxyMessageRecord {
  ttlTimer: TimerHandle | null;
}

function parseIntegerEnv(value: string | undefined, defaultValue: number, minimum: number): number {
  if (typeof value !== "string") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(parsed, minimum);
}

// Timing envs are read lazily (per use, not at module load) so import order
// never bakes stale values in: chat modules pull this file in transitively,
// which would otherwise freeze defaults before test files can set overrides.
export function getChatProxyWaitMs(): number {
  return parseIntegerEnv(process.env.CHAT_PROXY_WAIT_MS, 2000, 0);
}

export function getChatProxyExpectationTtlMs(): number {
  return parseIntegerEnv(process.env.CHAT_PROXY_EXPECTATION_TTL_MS, 10000, Math.max(getChatProxyWaitMs(), 1));
}

function getConfirmedProxyMessageTtlMs(): number {
  return Math.max(getChatProxyExpectationTtlMs(), parseIntegerEnv(process.env.CHANNEL_LOCK_TIMEOUT_MS, 180000, 10000));
}

const expectationsByChannel = new Map<string, Map<string, InternalChatProxyExpectation>>();
const proxyMessagesById = new Map<string, InternalChatProxyMessageRecord>();
const activeLookupCountsByChannel = new Map<string, number>();

export function createChatProxyExpectation(args: {
  serviceId: string;
  channelId: string;
  originalMessageId: string;
  senderDiscId: string;
  originalMessage: Message;
  originalReference: Message["reference"];
}): ChatProxyExpectation {
  sweepExpiredChatProxyState();
  deleteChatProxyExpectation(args.channelId, args.originalMessageId);

  const createdAt = Date.now();
  const proxyWaitMs = getChatProxyWaitMs();
  const expectationTtlMs = getChatProxyExpectationTtlMs();
  let resolveWaitPromise: (result: ChatProxyWaitResult) => void = () => {};
  const waitPromise = new Promise<ChatProxyWaitResult>((resolve) => {
    resolveWaitPromise = resolve;
  });

  const expectation: InternalChatProxyExpectation = {
    serviceId: args.serviceId,
    channelId: args.channelId,
    originalMessageId: args.originalMessageId,
    senderDiscId: args.senderDiscId,
    state: "pending",
    createdAt,
    expiresAt: createdAt + expectationTtlMs,
    originalMessage: args.originalMessage,
    originalReference: args.originalReference,
    waitPromise,
    waitResolved: false,
    waitDeadline: createdAt + proxyWaitMs,
    waitTimer: null,
    ttlTimer: null,
    resolveWait: (result) => {
      if (expectation.waitResolved) return;
      expectation.waitResolved = true;
      if (expectation.waitTimer) {
        clearTimeout(expectation.waitTimer);
        expectation.waitTimer = null;
      }
      resolveWaitPromise(result);
    },
  };

  scheduleChatProxyWaitTimer(expectation);
  expectation.ttlTimer = setTimeout(() => {
    deleteChatProxyExpectation(expectation.channelId, expectation.originalMessageId);
  }, expectationTtlMs);

  let channelExpectations = expectationsByChannel.get(args.channelId);
  if (!channelExpectations) {
    channelExpectations = new Map();
    expectationsByChannel.set(args.channelId, channelExpectations);
  }
  channelExpectations.set(args.originalMessageId, expectation);

  return expectation;
}

export async function waitForChatProxyExpectation(expectation: ChatProxyExpectation): Promise<ChatProxyWaitResult> {
  const internal = getInternalChatProxyExpectation(expectation.channelId, expectation.originalMessageId);
  if (!internal) {
    return "timeout";
  }
  return await internal.waitPromise;
}

export function markChatProxyOriginalDeleted(channelId: string, originalMessageId: string): boolean {
  const expectation = getInternalChatProxyExpectation(channelId, originalMessageId);
  if (!expectation) {
    return false;
  }

  expectation.state = "proxied";
  expectation.resolveWait("proxied");
  return true;
}

export function hasLiveChatProxyExpectations(channelId: string): boolean {
  sweepExpiredChatProxyState();
  const channelExpectations = expectationsByChannel.get(channelId);
  return Boolean(channelExpectations && channelExpectations.size > 0);
}

export function getLiveChatProxyExpectationServiceIds(channelId: string): string[] {
  sweepExpiredChatProxyState();
  const serviceIds = new Set<string>();
  for (const expectation of expectationsByChannel.get(channelId)?.values() ?? []) {
    serviceIds.add(expectation.serviceId);
  }
  return [...serviceIds];
}

export function findMatchingChatProxyExpectation(
  channelId: string,
  attestation: ProxyMessageAttestation,
): ChatProxyExpectation | null {
  sweepExpiredChatProxyState();
  const expectation = getInternalChatProxyExpectation(channelId, attestation.originalMessageId);
  if (
    !expectation ||
    expectation.serviceId !== attestation.serviceId ||
    expectation.senderDiscId !== attestation.senderDiscordId
  ) {
    return null;
  }
  return expectation;
}

export function markChatProxyExpectationProxied(expectation: ChatProxyExpectation): void {
  const internal = getInternalChatProxyExpectation(expectation.channelId, expectation.originalMessageId);
  if (!internal) {
    return;
  }

  internal.state = "proxied";
  internal.resolveWait("proxied");
}

export function beginChatProxyLookup(channelId: string): () => void {
  const currentCount = activeLookupCountsByChannel.get(channelId) ?? 0;
  activeLookupCountsByChannel.set(channelId, currentCount + 1);
  pauseChatProxyWaitTimers(channelId);

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;

    const nextCount = Math.max((activeLookupCountsByChannel.get(channelId) ?? 1) - 1, 0);
    if (nextCount > 0) {
      activeLookupCountsByChannel.set(channelId, nextCount);
      return;
    }

    activeLookupCountsByChannel.delete(channelId);
    resumeChatProxyWaitTimers(channelId);
  };
}

export function rememberChatProxyMessage(args: {
  messageDiscId: string;
  channelId: string;
  expectation: ChatProxyExpectation;
}): ChatProxyMessageRecord {
  sweepExpiredChatProxyState();
  deleteChatProxyMessageRecord(args.messageDiscId);

  const createdAt = Date.now();
  const confirmedProxyMessageTtlMs = getConfirmedProxyMessageTtlMs();
  const record: InternalChatProxyMessageRecord = {
    serviceId: args.expectation.serviceId,
    messageDiscId: args.messageDiscId,
    channelId: args.channelId,
    originalMessageId: args.expectation.originalMessageId,
    senderDiscId: args.expectation.senderDiscId,
    createdAt,
    expiresAt: createdAt + confirmedProxyMessageTtlMs,
    originalMessage: args.expectation.originalMessage,
    originalReference: args.expectation.originalReference,
    ttlTimer: null,
  };

  record.ttlTimer = setTimeout(() => {
    deleteChatProxyMessageRecord(record.messageDiscId);
  }, confirmedProxyMessageTtlMs);
  proxyMessagesById.set(args.messageDiscId, record);
  return record;
}

export function getChatProxyMessageRecord(messageDiscId: string): ChatProxyMessageRecord | null {
  sweepExpiredChatProxyState();
  return proxyMessagesById.get(messageDiscId) ?? null;
}

export function isKnownChatProxyMessage(message: Pick<Message, "id" | "webhookId">): boolean {
  return Boolean(message.webhookId && getChatProxyMessageRecord(message.id));
}

/**
 * IDs of originals that a confirmed proxy in this channel has superseded.
 *
 * A service may post the webhook and delete the original as separate operations,
 * so an attestation can resolve while the
 * delete is still in flight. A history fetch in that window still returns the
 * original from Discord, which would render the same message twice under two
 * different identities. Callers building dialogue context must drop these.
 *
 * Scanned rather than kept as a reverse index because a service may split long
 * messages into several proxies sharing one original, so an
 * original-to-proxy map would drop live entries as siblings expired.
 */
export function getSupersededChatProxyOriginalMessageIds(channelId: string): Set<string> {
  sweepExpiredChatProxyState();
  const originalMessageIds = new Set<string>();
  for (const record of proxyMessagesById.values()) {
    if (record.channelId === channelId) {
      originalMessageIds.add(record.originalMessageId);
    }
  }
  return originalMessageIds;
}

export function applyChatProxyReference(message: Message): boolean {
  const record = getChatProxyMessageRecord(message.id);
  if (!record?.originalReference || message.reference?.messageId) {
    return false;
  }

  try {
    Object.defineProperty(message, "reference", {
      value: record.originalReference,
      configurable: true,
      writable: true,
    });
    return true;
  } catch (error) {
    log.warn(`Failed to apply chat-proxy original reference to proxy message ${message.id}`, error);
    return false;
  }
}

export function clearChatProxyExpectationStateForTests(): void {
  for (const channelExpectations of expectationsByChannel.values()) {
    for (const expectation of channelExpectations.values()) {
      clearChatProxyExpectationTimers(expectation);
    }
  }
  expectationsByChannel.clear();

  for (const record of proxyMessagesById.values()) {
    if (record.ttlTimer) clearTimeout(record.ttlTimer);
  }
  proxyMessagesById.clear();
  activeLookupCountsByChannel.clear();
}

function getInternalChatProxyExpectation(
  channelId: string,
  originalMessageId: string,
): InternalChatProxyExpectation | null {
  const channelExpectations = expectationsByChannel.get(channelId);
  const expectation = channelExpectations?.get(originalMessageId) ?? null;
  if (!expectation) {
    return null;
  }

  if (Date.now() > expectation.expiresAt) {
    deleteChatProxyExpectation(channelId, originalMessageId);
    return null;
  }

  return expectation;
}

function deleteChatProxyExpectation(channelId: string, originalMessageId: string): void {
  const channelExpectations = expectationsByChannel.get(channelId);
  const existing = channelExpectations?.get(originalMessageId);
  if (!existing || !channelExpectations) {
    return;
  }

  clearChatProxyExpectationTimers(existing);
  existing.resolveWait("timeout");
  channelExpectations.delete(originalMessageId);
  if (channelExpectations.size === 0) {
    expectationsByChannel.delete(channelId);
  }
}

function deleteChatProxyMessageRecord(messageDiscId: string): void {
  const existing = proxyMessagesById.get(messageDiscId);
  if (!existing) {
    return;
  }

  if (existing.ttlTimer) {
    clearTimeout(existing.ttlTimer);
    existing.ttlTimer = null;
  }
  proxyMessagesById.delete(messageDiscId);
}

function clearChatProxyExpectationTimers(expectation: InternalChatProxyExpectation): void {
  if (expectation.waitTimer) {
    clearTimeout(expectation.waitTimer);
    expectation.waitTimer = null;
  }
  if (expectation.ttlTimer) {
    clearTimeout(expectation.ttlTimer);
    expectation.ttlTimer = null;
  }
}

function scheduleChatProxyWaitTimer(expectation: InternalChatProxyExpectation): void {
  if (expectation.waitResolved || activeLookupCountsByChannel.has(expectation.channelId)) {
    return;
  }

  if (expectation.waitTimer) {
    clearTimeout(expectation.waitTimer);
  }

  expectation.waitTimer = setTimeout(
    () => {
      // Once the original is allowed to proceed, a later webhook must not
      // inherit its trigger decision and create a second response.
      deleteChatProxyExpectation(expectation.channelId, expectation.originalMessageId);
    },
    Math.max(expectation.waitDeadline - Date.now(), 0),
  );
}

function pauseChatProxyWaitTimers(channelId: string): void {
  const channelExpectations = expectationsByChannel.get(channelId);
  if (!channelExpectations) {
    return;
  }

  for (const expectation of channelExpectations.values()) {
    if (expectation.waitTimer) {
      clearTimeout(expectation.waitTimer);
      expectation.waitTimer = null;
    }
  }
}

function resumeChatProxyWaitTimers(channelId: string): void {
  const channelExpectations = expectationsByChannel.get(channelId);
  if (!channelExpectations) {
    return;
  }

  for (const expectation of channelExpectations.values()) {
    scheduleChatProxyWaitTimer(expectation);
  }
}

function sweepExpiredChatProxyState(): void {
  const now = Date.now();

  for (const [channelId, channelExpectations] of expectationsByChannel.entries()) {
    for (const [originalMessageId, expectation] of channelExpectations.entries()) {
      if (now > expectation.expiresAt) {
        clearChatProxyExpectationTimers(expectation);
        expectation.resolveWait("timeout");
        channelExpectations.delete(originalMessageId);
      }
    }
    if (channelExpectations.size === 0) {
      expectationsByChannel.delete(channelId);
    }
  }

  for (const [messageDiscId, record] of proxyMessagesById.entries()) {
    if (now > record.expiresAt) {
      if (record.ttlTimer) clearTimeout(record.ttlTimer);
      proxyMessagesById.delete(messageDiscId);
    }
  }
}

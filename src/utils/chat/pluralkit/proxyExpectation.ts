import type { Message } from "discord.js";
import type { PkMessageLookup } from "@/utils/pluralkit/pkApi";
import { log } from "@/utils/misc/logger";

export type PluralKitProxyExpectationState = "pending" | "proxied";
export type PluralKitProxyWaitResult = "timeout" | "proxied";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface PluralKitProxyExpectation {
  channelId: string;
  originalMessageId: string;
  senderDiscId: string;
  state: PluralKitProxyExpectationState;
  createdAt: number;
  expiresAt: number;
  originalReference: Message["reference"];
}

interface InternalPluralKitProxyExpectation extends PluralKitProxyExpectation {
  waitPromise: Promise<PluralKitProxyWaitResult>;
  waitResolved: boolean;
  waitDeadline: number;
  waitTimer: TimerHandle | null;
  ttlTimer: TimerHandle | null;
  resolveWait: (result: PluralKitProxyWaitResult) => void;
}

export interface PluralKitProxyMessageRecord {
  messageDiscId: string;
  channelId: string;
  originalMessageId: string;
  senderDiscId: string;
  createdAt: number;
  expiresAt: number;
  originalReference: Message["reference"];
}

interface InternalPluralKitProxyMessageRecord extends PluralKitProxyMessageRecord {
  ttlTimer: TimerHandle | null;
}

function parseIntegerEnv(value: string | undefined, defaultValue: number, minimum: number): number {
  if (typeof value !== "string") return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return Math.max(parsed, minimum);
}

export const PLURALKIT_PROXY_WAIT_MS = parseIntegerEnv(process.env.PLURALKIT_PROXY_WAIT_MS, 2000, 0);
export const PLURALKIT_EXPECTATION_TTL_MS = parseIntegerEnv(
  process.env.PLURALKIT_EXPECTATION_TTL_MS,
  10000,
  Math.max(PLURALKIT_PROXY_WAIT_MS, 1),
);

const CONFIRMED_PROXY_MESSAGE_TTL_MS = Math.max(
  PLURALKIT_EXPECTATION_TTL_MS,
  parseIntegerEnv(process.env.CHANNEL_LOCK_TIMEOUT_MS, 180000, 10000),
);

const expectationsByChannel = new Map<string, Map<string, InternalPluralKitProxyExpectation>>();
const proxyMessagesById = new Map<string, InternalPluralKitProxyMessageRecord>();
const activeLookupCountsByChannel = new Map<string, number>();

export function createPluralKitProxyExpectation(args: {
  channelId: string;
  originalMessageId: string;
  senderDiscId: string;
  originalReference: Message["reference"];
}): PluralKitProxyExpectation {
  sweepExpiredPluralKitProxyState();
  deletePluralKitProxyExpectation(args.channelId, args.originalMessageId);

  const createdAt = Date.now();
  let resolveWaitPromise: (result: PluralKitProxyWaitResult) => void = () => {};
  const waitPromise = new Promise<PluralKitProxyWaitResult>((resolve) => {
    resolveWaitPromise = resolve;
  });

  const expectation: InternalPluralKitProxyExpectation = {
    channelId: args.channelId,
    originalMessageId: args.originalMessageId,
    senderDiscId: args.senderDiscId,
    state: "pending",
    createdAt,
    expiresAt: createdAt + PLURALKIT_EXPECTATION_TTL_MS,
    originalReference: args.originalReference,
    waitPromise,
    waitResolved: false,
    waitDeadline: createdAt + PLURALKIT_PROXY_WAIT_MS,
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

  schedulePluralKitProxyWaitTimer(expectation);
  expectation.ttlTimer = setTimeout(() => {
    deletePluralKitProxyExpectation(expectation.channelId, expectation.originalMessageId);
  }, PLURALKIT_EXPECTATION_TTL_MS);

  let channelExpectations = expectationsByChannel.get(args.channelId);
  if (!channelExpectations) {
    channelExpectations = new Map();
    expectationsByChannel.set(args.channelId, channelExpectations);
  }
  channelExpectations.set(args.originalMessageId, expectation);

  return expectation;
}

export async function waitForPluralKitProxyExpectation(
  expectation: PluralKitProxyExpectation,
): Promise<PluralKitProxyWaitResult> {
  const internal = getInternalPluralKitProxyExpectation(expectation.channelId, expectation.originalMessageId);
  if (!internal) {
    return "timeout";
  }
  return await internal.waitPromise;
}

export function markPluralKitProxyOriginalDeleted(channelId: string, originalMessageId: string): boolean {
  const expectation = getInternalPluralKitProxyExpectation(channelId, originalMessageId);
  if (!expectation) {
    return false;
  }

  expectation.state = "proxied";
  expectation.resolveWait("proxied");
  return true;
}

export function hasLivePluralKitProxyExpectations(channelId: string): boolean {
  sweepExpiredPluralKitProxyState();
  const channelExpectations = expectationsByChannel.get(channelId);
  return Boolean(channelExpectations && channelExpectations.size > 0);
}

export function findMatchingPluralKitProxyExpectation(
  channelId: string,
  lookup: PkMessageLookup,
): PluralKitProxyExpectation | null {
  sweepExpiredPluralKitProxyState();
  const expectation = getInternalPluralKitProxyExpectation(channelId, lookup.original);
  if (!expectation || expectation.senderDiscId !== lookup.sender) {
    return null;
  }
  return expectation;
}

export function markPluralKitProxyExpectationProxied(expectation: PluralKitProxyExpectation): void {
  const internal = getInternalPluralKitProxyExpectation(expectation.channelId, expectation.originalMessageId);
  if (!internal) {
    return;
  }

  internal.state = "proxied";
  internal.resolveWait("proxied");
}

export function beginPluralKitProxyLookup(channelId: string): () => void {
  const currentCount = activeLookupCountsByChannel.get(channelId) ?? 0;
  activeLookupCountsByChannel.set(channelId, currentCount + 1);
  pausePluralKitProxyWaitTimers(channelId);

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
    resumePluralKitProxyWaitTimers(channelId);
  };
}

export function rememberPluralKitProxyMessage(args: {
  messageDiscId: string;
  channelId: string;
  expectation: PluralKitProxyExpectation;
}): PluralKitProxyMessageRecord {
  sweepExpiredPluralKitProxyState();
  deletePluralKitProxyMessageRecord(args.messageDiscId);

  const createdAt = Date.now();
  const record: InternalPluralKitProxyMessageRecord = {
    messageDiscId: args.messageDiscId,
    channelId: args.channelId,
    originalMessageId: args.expectation.originalMessageId,
    senderDiscId: args.expectation.senderDiscId,
    createdAt,
    expiresAt: createdAt + CONFIRMED_PROXY_MESSAGE_TTL_MS,
    originalReference: args.expectation.originalReference,
    ttlTimer: null,
  };

  record.ttlTimer = setTimeout(() => {
    deletePluralKitProxyMessageRecord(record.messageDiscId);
  }, CONFIRMED_PROXY_MESSAGE_TTL_MS);
  proxyMessagesById.set(args.messageDiscId, record);
  return record;
}

export function getPluralKitProxyMessageRecord(messageDiscId: string): PluralKitProxyMessageRecord | null {
  sweepExpiredPluralKitProxyState();
  return proxyMessagesById.get(messageDiscId) ?? null;
}

export function isKnownPluralKitProxyMessage(message: Pick<Message, "id" | "webhookId">): boolean {
  return Boolean(message.webhookId && getPluralKitProxyMessageRecord(message.id));
}

export function applyPluralKitProxyReference(message: Message): boolean {
  const record = getPluralKitProxyMessageRecord(message.id);
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
    log.warn(`Failed to apply PluralKit original reference to proxy message ${message.id}`, error);
    return false;
  }
}

export function clearPluralKitProxyExpectationStateForTests(): void {
  for (const channelExpectations of expectationsByChannel.values()) {
    for (const expectation of channelExpectations.values()) {
      clearPluralKitProxyExpectationTimers(expectation);
    }
  }
  expectationsByChannel.clear();

  for (const record of proxyMessagesById.values()) {
    if (record.ttlTimer) clearTimeout(record.ttlTimer);
  }
  proxyMessagesById.clear();
  activeLookupCountsByChannel.clear();
}

function getInternalPluralKitProxyExpectation(
  channelId: string,
  originalMessageId: string,
): InternalPluralKitProxyExpectation | null {
  const channelExpectations = expectationsByChannel.get(channelId);
  const expectation = channelExpectations?.get(originalMessageId) ?? null;
  if (!expectation) {
    return null;
  }

  if (Date.now() > expectation.expiresAt) {
    deletePluralKitProxyExpectation(channelId, originalMessageId);
    return null;
  }

  return expectation;
}

function deletePluralKitProxyExpectation(channelId: string, originalMessageId: string): void {
  const channelExpectations = expectationsByChannel.get(channelId);
  const existing = channelExpectations?.get(originalMessageId);
  if (!existing || !channelExpectations) {
    return;
  }

  clearPluralKitProxyExpectationTimers(existing);
  existing.resolveWait("timeout");
  channelExpectations.delete(originalMessageId);
  if (channelExpectations.size === 0) {
    expectationsByChannel.delete(channelId);
  }
}

function deletePluralKitProxyMessageRecord(messageDiscId: string): void {
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

function clearPluralKitProxyExpectationTimers(expectation: InternalPluralKitProxyExpectation): void {
  if (expectation.waitTimer) {
    clearTimeout(expectation.waitTimer);
    expectation.waitTimer = null;
  }
  if (expectation.ttlTimer) {
    clearTimeout(expectation.ttlTimer);
    expectation.ttlTimer = null;
  }
}

function schedulePluralKitProxyWaitTimer(expectation: InternalPluralKitProxyExpectation): void {
  if (expectation.waitResolved || activeLookupCountsByChannel.has(expectation.channelId)) {
    return;
  }

  if (expectation.waitTimer) {
    clearTimeout(expectation.waitTimer);
  }

  expectation.waitTimer = setTimeout(
    () => {
      expectation.resolveWait("timeout");
    },
    Math.max(expectation.waitDeadline - Date.now(), 0),
  );
}

function pausePluralKitProxyWaitTimers(channelId: string): void {
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

function resumePluralKitProxyWaitTimers(channelId: string): void {
  const channelExpectations = expectationsByChannel.get(channelId);
  if (!channelExpectations) {
    return;
  }

  for (const expectation of channelExpectations.values()) {
    schedulePluralKitProxyWaitTimer(expectation);
  }
}

function sweepExpiredPluralKitProxyState(): void {
  const now = Date.now();

  for (const [channelId, channelExpectations] of expectationsByChannel.entries()) {
    for (const [originalMessageId, expectation] of channelExpectations.entries()) {
      if (now > expectation.expiresAt) {
        clearPluralKitProxyExpectationTimers(expectation);
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

import { AsyncLocalStorage } from "node:async_hooks";
import type { ChatAdmissionDisposition, ChatIncoming, GenerationTurnResult } from "@/utils/chat/types";

const RETENTION_MS = 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MS = 15 * 60 * 1000;
const TIME_TARGET_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_TRACES = 5_000;
const MAX_EVENTS_PER_TRACE = 100;
const MAX_DELIVERED_MESSAGE_IDS_PER_TRACE = 100;

type DiagnosticEvent =
  | {
      kind: "invocation_started";
      source: "message" | "queue" | "persona_job" | "retry" | "manual" | "stop";
      retryCount: number;
    }
  | { kind: "admission"; disposition: ChatAdmissionDisposition }
  | { kind: "turns_planned"; count: number }
  | { kind: "persona_jobs_queued"; count: number }
  | { kind: "turn_started"; ordinal: number; total: number }
  | { kind: "turn_finished"; status: GenerationTurnResult["status"]; responseCount: number }
  | { kind: "attempt_started"; ordinal: number; credentialSource: "server" | "personal"; model: string }
  | { kind: "attempt_finished"; ordinal: number; status: GenerationTurnResult["status"]; keyAttempts: number }
  | {
      kind: "context_history";
      fetchedCount: number;
      includedCount: number;
      messages: Array<{
        message: string;
        author: "trigger" | "other_user" | "bot";
        afterTriggerMs: number;
        included: boolean;
      }>;
    }
  | { kind: "provider_context"; ordinal: number; dialogueCount: number; recentMessages: string[] }
  | { kind: "tool_continuation"; iteration: number; historyEntries: number; contextItems: number }
  | { kind: "tool_outcome"; outcome: "restart" | "abort" | "history"; success?: boolean }
  | { kind: "message_sent"; message: string; delivery: "webhook" | "bot" }
  | { kind: "send_failed"; reason: "missing_access" | "missing_permissions" | "channel_gone" | "other" }
  | { kind: "messages_purge_requested"; count: number }
  | { kind: "invocation_finished"; disposition: ChatAdmissionDisposition }
  | { kind: "uncaught_error" };

interface TimedEvent {
  at: string;
  afterTriggerMs: number;
  invocation: number;
  event: DiagnosticEvent;
}

interface DiagnosticTrace {
  reportId: string;
  triggerMessageId: string;
  channelId: string;
  guildId: string | null;
  ownerId: string;
  startedAt: number;
  updatedAt: number;
  invocationCount: number;
  droppedEvents: number;
  messageLabels: Map<string, string>;
  modelLabels: Map<string, string>;
  deliveredMessageIds: Set<string>;
  events: TimedEvent[];
}

export interface ShareableChatDiagnostic {
  schemaVersion: 1;
  reportId: string;
  generatedAt: string;
  triggerMessage: string;
  triggeredAt: string;
  invocationCount: number;
  droppedEvents: number;
  events: TimedEvent[];
}

const traces = new Map<string, DiagnosticTrace>();
const scope = new AsyncLocalStorage<{ trace: DiagnosticTrace; invocation: number }>();

function prune(now: number): void {
  for (const [messageId, trace] of traces) {
    if (now - trace.startedAt >= RETENTION_MS) traces.delete(messageId);
  }
  while (traces.size > MAX_TRACES) {
    const oldest = traces.keys().next().value;
    if (oldest === undefined) break;
    traces.delete(oldest);
  }
}

function sourceOf(incoming: ChatIncoming): DiagnosticEvent & { kind: "invocation_started" } {
  const source =
    incoming.retryCount > 0
      ? "retry"
      : incoming.isPersonaJob
        ? "persona_job"
        : incoming.isStopResponse
          ? "stop"
          : incoming.isFromQueue
            ? "queue"
            : incoming.isManuallyTriggered
              ? "manual"
              : "message";
  return { kind: "invocation_started", source, retryCount: incoming.retryCount };
}

/** A report captures one process. A durable store becomes necessary if chat runs on multiple replicas or reports must survive restarts. */
export function runWithChatDiagnostic<T>(incoming: ChatIncoming, callback: () => Promise<T>): Promise<T> {
  const ownerId =
    incoming.manualTriggerInvoker?.userDiscId ??
    (!incoming.message.author.bot && !incoming.message.webhookId ? incoming.message.author.id : null);
  if (!ownerId) return callback();

  const now = Date.now();
  prune(now);
  const messageId = incoming.message.id;
  let trace = traces.get(messageId);
  if (!trace) {
    trace = {
      reportId: crypto.randomUUID(),
      triggerMessageId: messageId,
      channelId: incoming.message.channelId,
      guildId: incoming.message.guildId,
      ownerId,
      startedAt: incoming.message.createdTimestamp || now,
      updatedAt: now,
      invocationCount: 0,
      droppedEvents: 0,
      messageLabels: new Map([[messageId, "message-1"]]),
      modelLabels: new Map(),
      deliveredMessageIds: new Set(),
      events: [],
    };
    traces.set(messageId, trace);
    prune(now);
  }

  trace.invocationCount++;
  const invocation = trace.invocationCount;
  return scope.run({ trace, invocation }, async () => {
    recordChatDiagnostic(sourceOf(incoming));
    try {
      return await callback();
    } catch (error) {
      recordChatDiagnostic({ kind: "uncaught_error" });
      throw error;
    }
  });
}

export function recordChatDiagnostic(event: DiagnosticEvent): void {
  const active = scope.getStore();
  if (!active) return;
  const { trace, invocation } = active;
  trace.updatedAt = Date.now();
  if (trace.events.length >= MAX_EVENTS_PER_TRACE) {
    trace.droppedEvents++;
    return;
  }
  trace.events.push({
    at: new Date(trace.updatedAt).toISOString(),
    afterTriggerMs: trace.updatedAt - trace.startedAt,
    invocation,
    event,
  });
}

function labelMessage(trace: DiagnosticTrace, messageId: string): string {
  const existing = trace.messageLabels.get(messageId);
  if (existing) return existing;
  const label = `message-${trace.messageLabels.size + 1}`;
  trace.messageLabels.set(messageId, label);
  return label;
}

function dropIfFull(trace: DiagnosticTrace): boolean {
  if (trace.events.length < MAX_EVENTS_PER_TRACE) return false;
  trace.updatedAt = Date.now();
  trace.droppedEvents++;
  return true;
}

export function recordChatMessageSent(messageId: string, delivery: "webhook" | "bot"): void {
  const active = scope.getStore();
  if (!active) return;
  if (
    !active.trace.deliveredMessageIds.has(messageId) &&
    active.trace.deliveredMessageIds.size >= MAX_DELIVERED_MESSAGE_IDS_PER_TRACE
  ) {
    const oldestMessageId = active.trace.deliveredMessageIds.values().next().value;
    if (oldestMessageId) active.trace.deliveredMessageIds.delete(oldestMessageId);
  }
  active.trace.deliveredMessageIds.add(messageId);
  if (dropIfFull(active.trace)) return;
  recordChatDiagnostic({ kind: "message_sent", message: labelMessage(active.trace, messageId), delivery });
}

export function recordChatAttemptStarted(
  ordinal: number,
  credentialSource: "server" | "personal",
  modelKey: string,
): void {
  const active = scope.getStore();
  if (!active || dropIfFull(active.trace)) return;
  const { modelLabels } = active.trace;
  let model = modelLabels.get(modelKey);
  if (!model) {
    model = `model-${modelLabels.size + 1}`;
    modelLabels.set(modelKey, model);
  }
  recordChatDiagnostic({ kind: "attempt_started", ordinal, credentialSource, model });
}

export function recordChatContextHistory(
  fetched: Array<{ id: string; authorId: string; isBot: boolean; createdAt: number }>,
  includedIds: ReadonlySet<string>,
): void {
  const active = scope.getStore();
  if (!active || dropIfFull(active.trace)) return;
  const { trace } = active;
  recordChatDiagnostic({
    kind: "context_history",
    fetchedCount: fetched.length,
    includedCount: fetched.filter((message) => includedIds.has(message.id)).length,
    messages: fetched.slice(-25).map((message) => ({
      message: labelMessage(trace, message.id),
      author: message.isBot ? "bot" : message.authorId === trace.ownerId ? "trigger" : "other_user",
      afterTriggerMs: message.createdAt - trace.startedAt,
      included: includedIds.has(message.id),
    })),
  });
}

export function recordChatProviderContext(ordinal: number, messageIds: string[]): void {
  const active = scope.getStore();
  if (!active || dropIfFull(active.trace)) return;
  recordChatDiagnostic({
    kind: "provider_context",
    ordinal,
    dialogueCount: messageIds.length,
    recentMessages: messageIds.slice(-25).map((messageId) => labelMessage(active.trace, messageId)),
  });
}

export function getChatDiagnostic(args: {
  ownerId: string;
  channelId: string;
  guildId: string | null;
  messageId?: string;
  minutesAgo?: number;
  now?: number;
}): ShareableChatDiagnostic | null {
  const now = args.now ?? Date.now();
  prune(now);
  const targetMessageId = args.messageId;
  const candidates = targetMessageId
    ? [
        traces.get(targetMessageId),
        ...[...traces.values()].filter((entry) => entry.deliveredMessageIds.has(targetMessageId)),
      ]
    : [...traces.values()].reverse();
  const available = candidates.filter((entry): entry is DiagnosticTrace =>
    Boolean(
      entry && entry.ownerId === args.ownerId && entry.channelId === args.channelId && entry.guildId === args.guildId,
    ),
  );
  const targetTime = args.minutesAgo === undefined ? null : now - args.minutesAgo * 60 * 1000;
  const trace =
    targetTime === null
      ? available.find((entry) => args.messageId !== undefined || now - entry.startedAt <= DEFAULT_LOOKBACK_MS)
      : available
          .filter((entry) => Math.abs(entry.startedAt - targetTime) <= TIME_TARGET_TOLERANCE_MS)
          .sort((a, b) => Math.abs(a.startedAt - targetTime) - Math.abs(b.startedAt - targetTime))[0];
  if (!trace) return null;

  return {
    schemaVersion: 1,
    reportId: trace.reportId,
    generatedAt: new Date(now).toISOString(),
    triggerMessage: labelMessage(trace, trace.triggerMessageId),
    triggeredAt: new Date(trace.startedAt).toISOString(),
    invocationCount: trace.invocationCount,
    droppedEvents: trace.droppedEvents,
    events: trace.events.map((entry) => ({ ...entry, event: { ...entry.event } })),
  };
}

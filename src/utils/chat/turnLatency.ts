import { AsyncLocalStorage } from "node:async_hooks";
import type { ChatInvocationSource } from "@/utils/chat/diagnosticTimeline";
import { log } from "@/utils/misc/logger";

interface ChatLatencyInvocation {
  startedAt: number;
  gatewayMs: number;
  source: ChatInvocationSource;
}

const PROVIDERS = [
  "anthropic",
  "custom",
  "deepseek",
  "google",
  "novelai",
  "nvidia",
  "openrouter",
  "vertex",
  "vertexexpress",
  "zai",
  "zaicoding",
] as const;
type LatencyProvider = (typeof PROVIDERS)[number] | "unknown";
type YesNo = "yes" | "no";

interface ChatTurnLatencyFields {
  gateway_ms: number;
  admission_ms: number;
  plan_ms: number;
  context_ms: number;
  dispatch_ms: number;
  provider_ttfb_ms: number;
  first_message_ms: number;
  history_fetch_ms: number;
  native_ms: number;
  reaction_fetches: number;
  reply_fetches: number;
  image_fetches: number;
  image_ms: number;
  provider: LatencyProvider;
  humanizer: "none" | "light" | "medium" | "heavy" | "unknown";
  source: ChatInvocationSource;
  rag: YesNo;
  history: "rest" | "reused";
  drafting: YesNo;
}

interface TurnLatencyScope {
  invocation: ChatLatencyInvocation;
  fields: ChatTurnLatencyFields;
  finished: boolean;
}

const scope = new AsyncLocalStorage<TurnLatencyScope>();

export function createChatLatencyInvocation(
  createdTimestamp: number,
  source: ChatInvocationSource,
  startedAt = performance.now(),
  receivedAt = Date.now(),
): ChatLatencyInvocation {
  return { startedAt, gatewayMs: receivedAt - createdTimestamp, source };
}

export async function runWithChatTurnLatency<T>(
  invocation: ChatLatencyInvocation,
  admissionMs: number,
  planMs: number,
  callback: () => Promise<T>,
): Promise<T> {
  const active: TurnLatencyScope = {
    invocation,
    finished: false,
    fields: {
      gateway_ms: invocation.gatewayMs,
      admission_ms: admissionMs,
      plan_ms: planMs,
      context_ms: -1,
      dispatch_ms: -1,
      provider_ttfb_ms: -1,
      first_message_ms: -1,
      history_fetch_ms: -1,
      native_ms: -1,
      reaction_fetches: 0,
      reply_fetches: 0,
      image_fetches: 0,
      image_ms: 0,
      provider: "unknown",
      humanizer: "unknown",
      source: invocation.source,
      rag: "no",
      history: "rest",
      drafting: "no",
    },
  };
  return scope.run(active, async () => {
    try {
      return await callback();
    } finally {
      active.finished = true;
      log.metric("chat_turn_latency", { ...active.fields });
    }
  });
}

function current(): TurnLatencyScope | undefined {
  const active = scope.getStore();
  return active?.finished ? undefined : active;
}

export async function measureChatTurnStage<T>(
  field: "context_ms" | "history_fetch_ms" | "native_ms",
  callback: () => Promise<T>,
): Promise<T> {
  const active = current();
  const startedAt = performance.now();
  try {
    return await callback();
  } finally {
    if (active && !active.finished) {
      active.fields[field] = Math.max(0, active.fields[field]) + performance.now() - startedAt;
    }
  }
}

export function recordChatTurnConfiguration(provider: string, humanizer: number): void {
  const active = current();
  if (!active) return;
  if (active.fields.dispatch_ms < 0) active.fields.provider = providerDimension(provider);
  active.fields.humanizer = (["none", "light", "medium", "heavy"] as const)[humanizer] ?? "unknown";
}

function providerDimension(provider: string): LatencyProvider {
  const name = provider.trim().toLowerCase();
  if (name.startsWith("custom:")) return "custom";
  return PROVIDERS.find((candidate) => candidate === name) ?? "unknown";
}

export function recordChatTurnFlags(flags: { rag?: boolean; drafting?: boolean }): void {
  const active = current();
  if (!active) return;
  if (flags.rag) active.fields.rag = "yes";
  if (flags.drafting) active.fields.drafting = "yes";
}

export function recordChatTurnFetch(kind: "reaction" | "reply" | "image", durationMs = 0): void {
  const active = current();
  if (!active) return;
  active.fields[`${kind}_fetches`]++;
  if (kind === "image") active.fields.image_ms += durationMs;
}

export function recordChatTurnHistory(history: "rest" | "reused"): void {
  const active = current();
  if (active) active.fields.history = history;
}

export function chatTurnContextTimings(): { historyFetchMs: number; replyFetches: number; nativeMs: number } {
  const fields = current()?.fields;
  return {
    historyFetchMs: fields?.history_fetch_ms ?? -1,
    replyFetches: fields?.reply_fetches ?? 0,
    nativeMs: fields?.native_ms ?? -1,
  };
}

export function recordChatProviderDispatch(provider: string): () => void {
  const active = current();
  const startedAt = performance.now();
  const firstRequest = active && active.fields.dispatch_ms < 0;
  if (firstRequest) {
    active.fields.dispatch_ms = startedAt - active.invocation.startedAt;
    active.fields.provider = providerDimension(provider);
  }
  return () => {
    if (firstRequest && !active.finished && active.fields.provider_ttfb_ms < 0) {
      active.fields.provider_ttfb_ms = performance.now() - startedAt;
    }
  };
}

export function recordChatTurnMessageSent(): void {
  const active = current();
  if (active && active.fields.first_message_ms < 0) {
    active.fields.first_message_ms = performance.now() - active.invocation.startedAt;
  }
}

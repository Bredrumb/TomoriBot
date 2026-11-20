import { REST } from "discord.js";
import { describe, expect, it } from "bun:test";
import { humanizerSettingsFromDegree } from "@/constants/humanizer";
import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";
import {
  createDefaultStreamMetrics,
  createDefaultStreamState,
  type TextProcessingConfig,
  VisibleDeliveryMode,
} from "@/types/stream/types";
import { StreamOrchestrator } from "@/utils/discord/stream/stateMachine";
import {
  clearStopRequest,
  deleteStopRequest,
  hasStopRequest,
  INTERNAL_STOP_REQUESTER_IDS,
  peekStopRequest,
  requestStop,
} from "@/utils/discord/stream/stopRequests";
import { StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";
import { STREAMING_LIMITS } from "@/utils/security/rateLimiter";

const CHANNEL_ID = "1382235263668846612";

type StopCall = { channelId: string; requesterId: string | undefined };

function makeOrchestrator() {
  const channelSends: unknown[] = [];
  const context = makeContext({ channelSends });
  const state = createDefaultStreamState();
  state.buffer = "buffered text";

  const orchestrator = new StreamOrchestrator();

  return { orchestrator, context, state, channelSends };
}

function makeLoopStopArgs(context: StreamContext, state: ReturnType<typeof createDefaultStreamState>) {
  const textConfig: TextProcessingConfig = {
    humanizer: humanizerSettingsFromDegree(0),
    visibleDeliveryMode: VisibleDeliveryMode.STREAMING,
    emojiUsageEnabled: false,
    emojiStrings: [],
    botName: "Tomori",
    botNameAliases: [],
    registeredSpeakerNamesLower: new Set(),
    maxMessageLength: 2000,
  };
  const config: StreamConfig = {
    model: "test-model",
    apiKey: "",
    temperature: 1,
    maxMessageLength: 2000,
    flushBufferSize: 1000,
    flushBufferSizeCodeBlock: 15_000,
    inactivityTimeoutMs: 10_000,
    baseTypeSpeedMsPerChar: 0,
    maxTypingTimeMs: 0,
    minVisibleTypingDurationMs: 0,
    humanizer: humanizerSettingsFromDegree(0),
    emojiUsageEnabled: false,
  };

  return { state, config, context, textConfig, metrics: createDefaultStreamMetrics() };
}

function makeUpdater() {
  const stopCalls: StopCall[] = [];
  const channelSends: unknown[] = [];
  const updater = new StreamUiUpdater({
    hasStopRequest: () => false,
    requestStop: (channelId, requesterId) => {
      stopCalls.push({ channelId, requesterId });
      return true;
    },
    notifyStreamProgress: () => undefined,
  });
  return { updater, stopCalls, channelSends };
}

function makeContext(options: {
  channelSends: unknown[];
  sendMessageLimit?: number;
  personaUsername?: string;
}): StreamContext {
  return {
    channel: {
      id: CHANNEL_ID,
      client: { rest: new REST() },
      send: async (payload: unknown) => {
        options.channelSends.push(payload);
        return { id: "1400000000000000001", channelId: CHANNEL_ID, webhookId: null, author: { username: "Mirri" } };
      },
    },
    locale: "en-US",
    suppressUserErrors: false,
    personaUsername: options.personaUsername,
    deliveryMode: options.personaUsername ? "user_impersonation" : "persona",
    // Present so a flush that does reach the send path can build its payload rather than throwing
    // inside the segment processor.
    contextItems: [],
    tomoriState: {
      is_alter: false,
      config: { send_message_limit: options.sendMessageLimit ?? 0 },
    },
  } as unknown as StreamContext;
}

describe("delivery caps resolve as stops, never as throws", () => {
  it("requests a stop and skips the send once the server send limit is reached", async () => {
    const { updater, stopCalls, channelSends } = makeUpdater();
    const context = makeContext({ channelSends, sendMessageLimit: 2 });
    const state = createDefaultStreamState();
    state.messageSentCount = 2;

    const sent = await updater.sendSinglePayload({ content: "blocked" }, "blocked", context, state);

    expect(sent).toBeNull();
    expect(stopCalls).toEqual([{ channelId: CHANNEL_ID, requesterId: "send_message_limit" }]);
    expect(channelSends).toEqual([]);
  });

  it("requests a stop rather than throwing when the send limit is hit under user impersonation", async () => {
    const { updater, stopCalls } = makeUpdater();
    const channelSends: unknown[] = [];
    const context = makeContext({ channelSends, sendMessageLimit: 1, personaUsername: "Impersonated User" });
    const state = createDefaultStreamState();
    state.messageSentCount = 1;

    const sent = await updater.sendSinglePayload({ content: "blocked" }, "blocked", context, state);

    expect(sent).toBeNull();
    expect(stopCalls).toEqual([{ channelId: CHANNEL_ID, requesterId: "send_message_limit" }]);
  });

  it("warns the channel and stops when the internal flush cap is reached", async () => {
    const { updater, stopCalls, channelSends } = makeUpdater();
    const context = makeContext({ channelSends });
    const state = createDefaultStreamState();
    // The cap is Infinity outside production, so compare against the constant rather than a literal.
    state.messageSentCount = STREAMING_LIMITS.MAX_FLUSH_COUNT;

    const sent = await updater.sendSinglePayload({ content: "blocked" }, "blocked", context, state);

    expect(sent).toBeNull();
    expect(stopCalls).toEqual([{ channelId: CHANNEL_ID, requesterId: "flush_limit" }]);
    expect(channelSends).toHaveLength(1);
  });

  it("suppresses the flush-cap embed under user impersonation but still stops", async () => {
    const { updater, stopCalls, channelSends } = makeUpdater();
    const context = makeContext({ channelSends, personaUsername: "Impersonated User" });
    const state = createDefaultStreamState();
    state.messageSentCount = STREAMING_LIMITS.MAX_FLUSH_COUNT;

    const sent = await updater.sendSinglePayload({ content: "blocked" }, "blocked", context, state);

    expect(sent).toBeNull();
    expect(stopCalls).toEqual([{ channelId: CHANNEL_ID, requesterId: "flush_limit" }]);
    expect(channelSends).toEqual([]);
  });

  it("cannot trip before the first message has been delivered", async () => {
    const { updater, stopCalls, channelSends } = makeUpdater();
    const context = makeContext({ channelSends, sendMessageLimit: 1 });
    const state = createDefaultStreamState();
    state.messageSentCount = 0;

    await updater.sendSinglePayload({ content: "first" }, "first", context, state);

    expect(stopCalls).toEqual([]);
    expect(channelSends).toHaveLength(1);
    expect(state.messageSentCount).toBe(1);
  });
});

describe("a stop that arrived mid-stream does not leak a buffered send", () => {
  it.each([
    "channel_deleted",
    "missing_access",
    "send_message_limit",
  ])("does not send the buffered text for a %s stop", async (requesterId) => {
    const { orchestrator, context, state, channelSends } = makeOrchestrator();
    deleteStopRequest(CHANNEL_ID);
    requestStop(CHANNEL_ID, requesterId);

    const args = makeLoopStopArgs(context, state);
    const result = await (
      orchestrator as unknown as {
        tryResolveLoopStop: (
          state: typeof args.state,
          config: typeof args.config,
          context: StreamContext,
          textConfig: typeof args.textConfig,
          metrics: typeof args.metrics,
        ) => Promise<{ status: string; stopReason?: string } | null>;
      }
    ).tryResolveLoopStop(args.state, args.config, args.context, args.textConfig, args.metrics);

    expect(channelSends).toEqual([]);
    expect(result?.status).toBe("stopped_by_user");
    expect(result?.stopReason).toBe(requesterId);
    // The request must not be left behind either: a stop registered after the clear would abort
    // the next turn's pre-stream check.
    expect(peekStopRequest(CHANNEL_ID)).toBeUndefined();
  });
});

describe("internal stop requests do not outlive their stream", () => {
  it("classifies every delivery-raised stop reason as internal", () => {
    // Guards the cross-turn leak: a new internal reason missing from this set would survive
    // `completeStreamAfterProviderEnd` and abort the next stream at its pre-stream check.
    expect(INTERNAL_STOP_REQUESTER_IDS.has("send_message_limit")).toBe(true);
    expect(INTERNAL_STOP_REQUESTER_IDS.has("flush_limit")).toBe(true);
    expect(INTERNAL_STOP_REQUESTER_IDS.has("speaker_guard")).toBe(true);
    expect(INTERNAL_STOP_REQUESTER_IDS.has("channel_deleted")).toBe(true);
    expect(INTERNAL_STOP_REQUESTER_IDS.has("missing_access")).toBe(true);
  });

  it("clears an internal stop so the next turn starts clean", () => {
    deleteStopRequest(CHANNEL_ID);
    requestStop(CHANNEL_ID, "send_message_limit");

    clearStopRequest(CHANNEL_ID);

    expect(hasStopRequest(CHANNEL_ID)).toBe(false);
  });

  it("preserves a user stop that is still waiting to produce its follow-up response", () => {
    deleteStopRequest(CHANNEL_ID);
    requestStop(CHANNEL_ID, "user_123", {
      originalStopMessage: {} as never,
      client: {} as never,
    });

    clearStopRequest(CHANNEL_ID);

    expect(hasStopRequest(CHANNEL_ID)).toBe(true);
    deleteStopRequest(CHANNEL_ID);
  });
});

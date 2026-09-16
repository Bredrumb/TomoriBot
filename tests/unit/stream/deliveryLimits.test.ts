import { describe, expect, it } from "bun:test";
import { HumanizerDegree } from "@/types/db/schema";
import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";
import {
  createDefaultStreamMetrics,
  createDefaultStreamState,
  createTypingSimulationConfig,
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

/**
 * Builds the real orchestrator with only the Discord channel surface stubbed.
 *
 * The orchestrator wires its own delivery chain over the global stop registry, which is what the
 * ordering under test depends on: a local stub for `hasStopRequest` would report whatever the test
 * wants rather than what the clear actually left behind.
 */
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
    humanizerDegree: HumanizerDegree.NONE,
    visibleDeliveryMode: VisibleDeliveryMode.STREAMING,
    emojiUsageEnabled: false,
    emojiStrings: [],
    botName: "Tomori",
    botNameAliases: [],
    registeredSpeakerNamesLower: new Set(),
    maxMessageLength: 2000,
  };
  const config = {
    humanizerDegree: HumanizerDegree.NONE,
    ...createTypingSimulationConfig(HumanizerDegree.NONE),
  } as StreamConfig;

  return { state, config, context, textConfig, metrics: createDefaultStreamMetrics() };
}

/**
 * Builds a `StreamUiUpdater` whose stop registry is recorded rather than global, plus the fake
 * channel `sendStandardEmbed` falls back to when no webhook context is supplied.
 */
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
  /** Set to give the context a copied identity, which is what marks it as user impersonation. */
  personaUsername?: string;
}): StreamContext {
  return {
    channel: {
      id: CHANNEL_ID,
      send: async (payload: unknown) => {
        options.channelSends.push(payload);
        return {};
      },
    },
    locale: "en-US",
    suppressUserErrors: false,
    personaUsername: options.personaUsername,
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

  /**
   * The regression this guards: user impersonation used to throw here, which the generation stage
   * read as a retryable provider failure and re-ran across every rotation key and fallback model.
   */
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

  /** A bot-authored embed posted while wearing a user's identity would break the disguise. */
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

  /**
   * `messageSentCount` only increments after a send lands, so a positive limit can never trip
   * before the first message. Any "nothing was delivered" handling for this cap is unreachable.
   */
  it("cannot trip before the first message has been delivered", async () => {
    const { updater, stopCalls, channelSends } = makeUpdater();
    const context = makeContext({ channelSends, sendMessageLimit: 1 });
    const state = createDefaultStreamState();
    state.messageSentCount = 0;

    await updater.sendSinglePayload({ content: "first" }, "first", context, state);

    // The message goes out and the counter advances to the cap, so the cap only ever blocks
    // what comes after it, never the run-up to it.
    expect(stopCalls).toEqual([]);
    expect(channelSends).toHaveLength(1);
    expect(state.messageSentCount).toBe(1);
  });
});

describe("a stop that arrived mid-stream does not leak a buffered send", () => {
  /**
   * The loop stop path clears the stop request before it flushes, so the flush reaches the send
   * path with nothing left to consult and posts the buffered text as a real Discord call. For a
   * destination the bot cannot post into that is a second rejected send, and the stop it raises on
   * the way out is registered after the clear, so it outlives the stream and silences the next
   * turn. The flush is skipped for these reasons instead.
   */
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

  /**
   * The mirror case is why this is a skip list rather than a blanket "never flush on a stop": a
   * user stop must still deliver what the bot already generated. That direction stays with the
   * `makeUpdater` cases above, whose fixture carries the full context a real flush needs.
   */
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

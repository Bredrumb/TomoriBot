import { describe, expect, it } from "bun:test";
import type { StreamContext } from "@/types/stream/interfaces";
import { createDefaultStreamState } from "@/types/stream/types";
import {
  clearStopRequest,
  deleteStopRequest,
  hasStopRequest,
  INTERNAL_STOP_REQUESTER_IDS,
  requestStop,
} from "@/utils/discord/stream/stopRequests";
import { StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";
import { STREAMING_LIMITS } from "@/utils/security/rateLimiter";

const CHANNEL_ID = "1382235263668846612";

type StopCall = { channelId: string; requesterId: string | undefined };

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

describe("internal stop requests do not outlive their stream", () => {
  it("classifies every delivery-raised stop reason as internal", () => {
    // Guards the cross-turn leak: a new internal reason missing from this set would survive
    // `completeStreamAfterProviderEnd` and abort the next stream at its pre-stream check.
    expect(INTERNAL_STOP_REQUESTER_IDS.has("send_message_limit")).toBe(true);
    expect(INTERNAL_STOP_REQUESTER_IDS.has("flush_limit")).toBe(true);
    expect(INTERNAL_STOP_REQUESTER_IDS.has("speaker_guard")).toBe(true);
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

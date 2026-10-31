import { DiscordAPIError, REST } from "discord.js";
import { ProviderRequestDeniedError, type ProviderUsageContext } from "@/utils/provider/providerUsage";
import { localizer } from "@/utils/text/localizer";
import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client, CommandInteraction, TextChannel, Webhook } from "discord.js";
import { HumanizerDegree } from "@/types/db/schema";
import type {
  ProcessedChunk,
  ProviderError,
  StreamConfig,
  StreamContext,
  StreamProvider,
} from "@/types/stream/interfaces";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { initializeLocalizer } from "@/utils/text/localizer";
import { clearPersonaAppearances, getPersonaAppearance } from "@/utils/cache/personaAppearanceCacheStore";
import {
  clearAllChannelDeliveryContinuity,
  getChannelLastDelivery,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import { createPersona } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { log } from "@/utils/misc/logger";
import { createChatResponseSink } from "@/utils/chat/responseEmitter";
import type { ChatTurnContext } from "@/utils/chat/types";

const config: StreamConfig = {
  model: "fixture",
  apiKey: "",
  temperature: 1,
  maxMessageLength: 1950,
  flushBufferSize: 1000,
  flushBufferSizeCodeBlock: 15000,
  inactivityTimeoutMs: 10000,
  baseTypeSpeedMsPerChar: 0,
  maxTypingTimeMs: 0,
  minVisibleTypingDurationMs: 0,
  // Must stream because NONE aggregates the reply into one final send that a failed stream never posts.
  humanizerDegree: HumanizerDegree.LIGHT,
  emojiUsageEnabled: false,
};

const CHANNEL_ID = "state_machine_fixture";
const POSTED_LINE = "Mirri finished this line.\n";
const UNFINISHED_CLAUSE = "and then started anoth";
const providerError: ProviderError = { type: "api_error", message: "upstream reset", code: "502", retryable: true };

function fixture(steps: Array<ProcessedChunk | (() => void)>, suppressUserErrors: boolean) {
  const send = mock(async (_payload: unknown) => ({
    id: "sent_1",
    channelId: CHANNEL_ID,
    webhookId: null,
    url: "",
    author: { id: "bot_1" },
    createMessageComponentCollector: () => ({ on: () => undefined }),
  }));
  const context: StreamContext = {
    channel: { id: CHANNEL_ID, send, client: { rest: new REST() }, isThread: () => false } as unknown as TextChannel,
    client: {} as Client,
    tomoriState: createPersona({ persona_nickname: "Mirri", config: { humanizer_degree: HumanizerDegree.LIGHT } }),
    contextItems: [],
    currentTurnModelParts: [],
    provider: "fixture",
    locale: "en-US",
    deliveredMessageRefs: [],
    suppressUserErrors,
  };
  const provider: StreamProvider = {
    async *startStream() {
      for (const step of steps) {
        if (typeof step === "function") step();
        else yield { provider: "fixture", data: step };
      }
    },
    processChunk: (raw) => raw.data as ProcessedChunk,
    handleProviderError: () => ({ type: "unknown", retryable: false, message: "Fixture failure" }),
    createErrorDescription: () => null,
    getProviderInfo: () => ({ name: "fixture", version: "1", supportsStreaming: true, supportsFunctionCalling: true }),
  };
  return { context, provider, send };
}

describe("StreamOrchestrator failed-stream delivery", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  afterEach(() => {
    StreamOrchestrator.clearStopRequest(CHANNEL_ID);
    clearPersonaAppearances();
    clearAllChannelDeliveryContinuity();
  });

  it("retains request diagnostics when the public provider error notice is suppressed", async () => {
    const warning = spyOn(log, "warn").mockImplementation(() => {});
    try {
      const { context, provider, send } = fixture([{ type: "error", error: providerError }], true);
      context.requestDiagnostics = {
        model: "gemini-3.5-flash-lite",
        contextItemCount: 2,
        contentsCount: 2,
        tailRoles: ["user", "model"],
        lastTurn: {
          textParts: 1,
          inlineDataParts: 0,
          fileDataParts: 0,
          functionCallParts: 0,
          functionResponseParts: 0,
        },
        functionHistoryCount: 0,
        currentTurnModelPartCount: 0,
        prefillPresent: false,
        manuallyTriggered: false,
        toolCount: 0,
        chunksReceived: 0,
        elapsedMs: 10,
      };
      const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
      expect(result.status).toBe("error");
      expect(send).not.toHaveBeenCalled();
      const call = warning.mock.calls.find((entry) => entry[2]?.errorType === "ProviderStreamError");
      expect(call?.[2]?.metadata?.requestDiagnostics).toEqual(context.requestDiagnostics);
      expect(call?.[3]?.retain).toBe(true);
    } finally {
      warning.mockRestore();
    }
  });

  it("reports each failed attempt once and shows only an unsuppressed one", async () => {
    const errors = spyOn(log, "error").mockResolvedValue(undefined);
    const warnings = spyOn(log, "warn").mockImplementation(() => {});
    const metrics = spyOn(log, "metric").mockImplementation(() => {});
    const malformed: ProviderError = { type: "api_error", message: "Invalid field", code: "400", retryable: false };
    const refused: ProviderError = {
      type: "content_blocked",
      message: "Blocked",
      code: "PROHIBITED_CONTENT",
      retryable: false,
    };
    const reports = (calls: ReadonlyArray<ReadonlyArray<unknown>>) =>
      calls.filter((call) => (call[2] as { errorType?: string } | undefined)?.errorType === "ProviderStreamError");
    try {
      for (const finalAttempt of ["success", "failure"] as const) {
        errors.mockClear();
        warnings.mockClear();
        const retried = fixture([{ type: "error", error: malformed }], true);
        expect((await new StreamOrchestrator().streamToDiscord(retried.provider, config, retried.context)).status).toBe(
          "error",
        );
        expect(retried.send).not.toHaveBeenCalled();

        const final = fixture(
          finalAttempt === "success" ? [{ type: "text", content: POSTED_LINE }] : [{ type: "error", error: refused }],
          false,
        );
        const result = await new StreamOrchestrator().streamToDiscord(final.provider, config, final.context);
        expect(result.status).toBe(finalAttempt === "success" ? "completed" : "error");
        expect(final.send).toHaveBeenCalledTimes(1);

        const incidents = reports(errors.mock.calls);
        const retained = reports(warnings.mock.calls);
        expect(incidents).toHaveLength(1);
        expect(incidents[0]?.[2]).toMatchObject({ metadata: { surfaced: false, providerErrorCode: "400" } });
        expect(retained).toHaveLength(finalAttempt === "failure" ? 1 : 0);
        if (finalAttempt === "failure") {
          expect(retained[0]?.[2]).toMatchObject({
            metadata: { surfaced: true, providerErrorCode: "PROHIBITED_CONTENT" },
          });
          expect(retained[0]?.[3]).toMatchObject({ retain: true });
        }
      }
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
      metrics.mockRestore();
    }
  });

  it.each([
    "bot",
    "webhook",
  ] as const)("stops after an unconfirmed %s body without posting an error notice", async (route) => {
    const { context, provider, send } = fixture([{ type: "text", content: POSTED_LINE }], false);
    context.deliveryState = { unconfirmed: false };
    context.deliveryReceipts = [];
    const lostResponse = Object.assign(new Error("Accepted POST response lost"), { code: "ECONNRESET" });
    const webhookSend = mock(async (_payload: unknown) => {
      throw lostResponse;
    });
    if (route === "webhook") {
      context.tomoriState = createPersona({
        is_alter: true,
        persona_nickname: "Mirri",
        config: { humanizer_degree: HumanizerDegree.LIGHT },
      });
      context.personaUsername = "Mirri";
      context.personaAvatarUrl = "https://example.com/mirri.png";
      context.webhook = {
        id: "webhook_1",
        channelId: CHANNEL_ID,
        client: context.channel.client,
        send: webhookSend,
      } as unknown as Webhook;
    } else {
      send.mockRejectedValueOnce(lostResponse);
    }

    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);

    expect(result.status).toBe("error");
    expect(context.deliveryState.unconfirmed).toBe(true);
    expect(send).toHaveBeenCalledTimes(route === "bot" ? 1 : 0);
    expect(webhookSend).toHaveBeenCalledTimes(route === "webhook" ? 1 : 0);
    expect(context.deliveryReceipts).toEqual([]);
    expect(context.deliveredMessageRefs).toEqual([]);
    expect(getPersonaAppearance(CHANNEL_ID, context.tomoriState.persona_id ?? 0)).toBeUndefined();
    expect(getChannelLastDelivery(CHANNEL_ID)).toBeNull();
  });

  it.each([
    "channel",
    "interaction",
    "deferred_interaction",
  ] as const)("still reports an ordinary provider stream exception to its %s", async (surface) => {
    const { context, provider, send } = fixture(
      [
        () => {
          throw new Error("Provider connection closed");
        },
      ],
      false,
    );
    context.deliveryState = { unconfirmed: false };
    const { interaction, calls } = makeFakeInteraction({ deferred: surface === "deferred_interaction" });
    if (surface !== "channel") context.initialInteraction = interaction as unknown as CommandInteraction;

    const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);

    expect(result.status).toBe("error");
    expect(context.deliveryState.unconfirmed).toBe(false);
    expect(send).toHaveBeenCalledTimes(surface === "channel" ? 1 : 0);
    if (surface === "channel") expect(send.mock.calls[0]?.[0]).toHaveProperty("embeds");
    else expect(calls.map((call) => call.method)).toEqual([surface === "interaction" ? "reply" : "followUp"]);
  });

  it("leaves deferred request denials to the fallback owner and renders ordinary denials once", async () => {
    for (const deferNotice of [true, false]) {
      const usageContext: ProviderUsageContext = {};
      const denied = new ProviderRequestDeniedError(
        usageContext,
        (locale) => ({
          titleKey: "general.errors.api_key_error_title",
          description: localizer(locale, "general.errors.api_key_error_description"),
        }),
        { deferNotice },
      );
      const { context, provider } = fixture(
        [{ type: "error", error: { ...providerError, originalError: denied } }],
        false,
      );
      context.usageContext = usageContext;
      const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
      expect(result.status).toBe("error");
      expect(context.channel.send).toHaveBeenCalledTimes(deferNotice ? 0 : 1);
    }
  });

  it("holds an unfinished clause back only while a retry may continue the posted text", async () => {
    for (const suppressUserErrors of [true, false]) {
      const { context, provider } = fixture(
        [
          { type: "text", content: POSTED_LINE },
          { type: "text", content: UNFINISHED_CLAUSE },
          { type: "error", error: providerError },
        ],
        suppressUserErrors,
      );

      const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);

      expect(result.status).toBe("error");
      expect(result.accumulatedText).toContain(POSTED_LINE.trim());
      expect(result.accumulatedText?.includes(UNFINISHED_CLAUSE)).toBe(!suppressUserErrors);
    }
  });

  it("returns the posted text when the stream is aborted or throws", async () => {
    const abortController = new AbortController();
    const aborted = fixture(
      [
        { type: "text", content: `${POSTED_LINE}Next` },
        () => abortController.abort(),
        { type: "text", content: "late" },
      ],
      true,
    );
    aborted.context.abortSignal = abortController.signal;
    const thrown = fixture(
      [
        { type: "text", content: `${POSTED_LINE}Next` },
        () => {
          throw new Error("socket closed");
        },
      ],
      true,
    );

    for (const { context, provider } of [aborted, thrown]) {
      const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
      expect(result.status).toBe("error");
      expect(result.accumulatedText).toContain(POSTED_LINE.trim());
    }
  });
});

describe("a refused stream send", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("is reported at error level once across the send, the orchestrator, and the generation report", async () => {
    const errors = spyOn(log, "error").mockResolvedValue(undefined);
    const warnings = spyOn(log, "warn").mockImplementation(() => {});
    const metrics = spyOn(log, "metric").mockImplementation(() => {});
    try {
      const { context, provider, send } = fixture([{ type: "text", content: POSTED_LINE }], true);
      send.mockRejectedValueOnce(
        new DiscordAPIError({ code: 50006, message: "Cannot send an empty message" }, 50006, 400, "POST", "/", {}),
      );
      const turn = {
        message: { id: "source_1" },
        streamingContext: {},
        isUserImpersonation: false,
        shouldSurfaceUserErrors: false,
      } as unknown as ChatTurnContext;

      const result = await new StreamOrchestrator().streamToDiscord(provider, config, context);
      await createChatResponseSink(turn).emitStreamResult(result);

      expect(result.status).toBe("error");
      expect(errors).toHaveBeenCalledTimes(1);
      // Only the send site carries the delivery metadata, so it is the row worth keeping.
      expect(errors.mock.calls[0]?.[2]).toMatchObject({ metadata: { usingWebhook: false } });
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
      metrics.mockRestore();
    }
  });
});

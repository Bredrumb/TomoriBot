import { beforeAll, describe, expect, it, mock } from "bun:test";
import type { Client, TextChannel } from "discord.js";
import { HumanizerDegree, type TomoriState } from "@/types/db/schema";
import type { StreamConfig, StreamContext, StreamProvider } from "@/types/stream/interfaces";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { initializeLocalizer } from "@/utils/text/localizer";

function makeConfig(): StreamConfig {
  return {
    model: "bad-model",
    apiKey: "",
    temperature: 1,
    maxMessageLength: 1950,
    flushBufferSize: 1000,
    flushBufferSizeCodeBlock: 15000,
    inactivityTimeoutMs: 10_000,
    baseTypeSpeedMsPerChar: 0,
    maxTypingTimeMs: 0,
    minVisibleTypingDurationMs: 0,
    humanizerDegree: HumanizerDegree.NONE,
    emojiUsageEnabled: false,
  };
}

function makeContext(send: ReturnType<typeof mock>, suppressUserErrors: boolean): StreamContext {
  return {
    channel: {
      id: "channel_1",
      send,
    } as unknown as TextChannel,
    client: {} as Client,
    tomoriState: {
      server_id: 1,
      persona_nickname: "Tomori",
      trigger_words: [],
      config: {},
      fallback_llms: [],
    } as unknown as TomoriState,
    contextItems: [],
    currentTurnModelParts: [],
    provider: "fake",
    locale: "en-US",
    suppressUserErrors,
  };
}

function makeProvider(): StreamProvider {
  return {
    async *startStream() {
      yield { data: {}, provider: "fake" };
    },
    processChunk() {
      return {
        type: "error",
        error: {
          type: "model_error",
          message:
            "Custom endpoint error: HTTP 400: Unsupported model `Deepseek` for provider `DeepSeek`. Supported IDs: `deepseek-auto`.",
          code: "400_model",
          retryable: false,
        },
      };
    },
    extractFunctionCall() {
      return null;
    },
    handleProviderError(error) {
      return {
        type: "model_error",
        message: error instanceof Error ? error.message : String(error),
        code: "model_error",
        retryable: false,
      };
    },
    createErrorDescription() {
      return "Error Code 400_model: Invalid request sent to provider";
    },
    getProviderInfo() {
      return {
        name: "fake",
        version: "test",
        supportsStreaming: true,
        supportsFunctionCalling: true,
      };
    },
  };
}

describe("StreamOrchestrator model-error visibility", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("renders a dedicated model configuration error embed for terminal model errors", async () => {
    const send = mock(async () => undefined);
    const result = await new StreamOrchestrator().streamToDiscord(
      makeProvider(),
      makeConfig(),
      makeContext(send, false),
    );

    expect(result.status).toBe("error");
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as { embeds?: Array<{ data?: { title?: string; description?: string } }> };
    expect(payload.embeds?.[0]?.data?.title).toContain("Model Configuration Error");
    expect(payload.embeds?.[0]?.data?.description).toContain("Unsupported model `Deepseek`");
  });

  it("suppresses model errors during retry/fallback suppression", async () => {
    const send = mock(async () => undefined);
    const result = await new StreamOrchestrator().streamToDiscord(
      makeProvider(),
      makeConfig(),
      makeContext(send, true),
    );

    expect(result.status).toBe("error");
    expect(send).not.toHaveBeenCalled();
  });

  it("appends the raw provider detail beneath the headline for non-model errors", async () => {
    // A provider whose localized headline hides the real cause (mirrors OpenRouter mapping a known
    // code to a hardcoded locale string). The central detail-append must still surface the raw text.
    const provider: StreamProvider = {
      ...makeProvider(),
      processChunk() {
        return {
          type: "error",
          error: {
            type: "api_error",
            message: "HTTP 502: upstream model provider returned an unexpected gateway response",
            code: "502",
            retryable: false,
          },
        };
      },
      createErrorDescription() {
        return "Error Code 502: The provider is temporarily unavailable.";
      },
    };

    const send = mock(async () => undefined);
    const result = await new StreamOrchestrator().streamToDiscord(provider, makeConfig(), makeContext(send, false));

    expect(result.status).toBe("error");
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as { embeds?: Array<{ data?: { title?: string; description?: string } }> };
    expect(payload.embeds?.[0]?.data?.description).toContain("The provider is temporarily unavailable");
    expect(payload.embeds?.[0]?.data?.description).toContain("**Details:**");
    expect(payload.embeds?.[0]?.data?.description).toContain("unexpected gateway response");
  });
});

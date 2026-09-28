import { afterEach, describe, expect, it } from "bun:test";
import { NvidiaStreamAdapter, type NvidiaStreamConfig } from "@/providers/nvidia/nvidiaStreamAdapter";
import type { StreamContext } from "@/types/stream/interfaces";
import { buildNvidiaThinkingRequest } from "@/utils/provider/thinkingControl";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const OK_STREAM = `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Hi" } }] })}\n\ndata: [DONE]\n\n`;

// NIM's validation error for a reasoning_effort value a model does not accept.
const EFFORT_REJECTION = JSON.stringify({
  error: {
    message:
      "1 validation error:\n  {'type': 'literal_error', 'loc': ('body', 'reasoning_effort'), 'msg': \"Input should be 'low', 'medium' or 'high'\"}",
  },
});

function okResponse(): Response {
  return new Response(OK_STREAM, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function makeStreamConfig(overrides: Partial<NvidiaStreamConfig> = {}): NvidiaStreamConfig {
  return {
    model: "z-ai/glm-5.3",
    apiKey: "test-key",
    endpointUrl: "https://example.invalid/v1/chat/completions",
    inactivityTimeoutMs: 5_000,
    ...overrides,
  } as NvidiaStreamConfig;
}

function makeStreamContext(thinkingLevel: string | null): StreamContext {
  return {
    channel: {},
    client: {},
    tomoriState: {
      persona_nickname: "Tomori",
      trigger_words: [],
      config: {
        llm_stop_speaker_pattern_enabled: false,
        llm_stop_strings: null,
        thinking_level: thinkingLevel,
      },
    },
    contextItems: [],
    currentTurnModelParts: [],
    provider: "nvidia",
    locale: "en-US",
  } as unknown as StreamContext;
}

/** Streams one turn against a fake NIM and returns every request body the adapter sent. */
async function captureRequestBodies(
  thinkingLevel: string | null,
  respond: (body: Record<string, unknown>) => Response,
  overrides: Partial<NvidiaStreamConfig> = {},
): Promise<Array<Record<string, unknown>>> {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    bodies.push(body);
    return respond(body);
  }) as unknown as typeof fetch;

  const stream = new NvidiaStreamAdapter().startStream(makeStreamConfig(overrides), makeStreamContext(thinkingLevel));
  for await (const _chunk of stream) {
    // Drained only for the request bodies the generator sends while producing chunks.
  }
  return bodies;
}

describe("buildNvidiaThinkingRequest", () => {
  it("leaves auto to the model's own default", () => {
    expect(buildNvidiaThinkingRequest("auto")).toEqual({});
    expect(buildNvidiaThinkingRequest(null)).toEqual({});
  });

  it("turns every family's switch off for none, keeping effort at a value NIM accepts", () => {
    expect(buildNvidiaThinkingRequest("none")).toEqual({
      chat_template_kwargs: { enable_thinking: false, thinking: false },
      reasoning_effort: "low",
    });
  });

  it("maps explicit levels to effort, with minimal folded into low", () => {
    for (const [level, effort] of [
      ["minimal", "low"],
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
    ] as const) {
      expect(buildNvidiaThinkingRequest(level)).toEqual({
        chat_template_kwargs: { enable_thinking: true, thinking: true },
        reasoning_effort: effort,
      });
    }
  });

  it("upgrades auto and none to high when the turn forces reasoning", () => {
    expect(buildNvidiaThinkingRequest("auto", true).reasoning_effort).toBe("high");
    expect(buildNvidiaThinkingRequest("none", true).chat_template_kwargs?.enable_thinking).toBe(true);
  });
});

describe("NvidiaStreamAdapter thinking request", () => {
  it("sends the configured level to NIM", async () => {
    const [body] = await captureRequestBodies("none", okResponse);

    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false, thinking: false });
    expect(body.reasoning_effort).toBe("low");
  });

  it("sends no thinking keys on auto, including for Nemotron Ultra, which used to be forced on", async () => {
    const [body] = await captureRequestBodies("auto", okResponse, { model: "nvidia/nemotron-3-ultra-550b-a55b" });

    expect(body).not.toHaveProperty("chat_template_kwargs");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("reasoning_budget");
  });

  it("drops reasoning_effort and keeps the thinking switch when a model rejects the effort", async () => {
    const bodies = await captureRequestBodies("high", (body) =>
      "reasoning_effort" in body ? new Response(EFFORT_REJECTION, { status: 400 }) : okResponse(),
    );

    const delivered = bodies[bodies.length - 1];
    expect(delivered).not.toHaveProperty("reasoning_effort");
    expect(delivered.chat_template_kwargs).toEqual({ enable_thinking: true, thinking: true });
  });
});

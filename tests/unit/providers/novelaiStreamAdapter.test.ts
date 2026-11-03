import { refreshNovelAISubscription, clearNovelaiSubscriptionCache } from "@/utils/cache/novelaiSubscriptionCache";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { NovelaiProvider } from "@/providers/novelai/novelaiProvider";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { ContextItemTag } from "@/types/misc/context";
import { createPersona, createLlmRow, createUserRow } from "../../helpers/fixtures";
import { buildDiscordUserAliases } from "@/utils/text/participants/aliases";
import { resolveNovelAISpeakers, NovelAISpeakerGuard } from "@/providers/novelai/speakerBoundaries";
import { fitNovelAIPrompt } from "@/providers/novelai/promptFitting";
import { attachPersonaMentionMapToContextItems, buildPersonaMentionCatalog } from "@/utils/text/personaMentionHandles";
import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";
import { createNovelAITokenizerEncoder } from "@/utils/provider/localTokenizerRegistry";
import { NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
import type { RawStreamChunk, StreamConfig, StreamContext } from "@/types/stream/interfaces";
import { log } from "@/utils/misc/logger";
import { isContextLengthError } from "@/utils/provider/providerErrorClassification";

const originalFetch = globalThis.fetch;
const restoreSpies: Array<() => void> = [];

beforeEach(async () => {
  globalThis.fetch = (async () => Response.json({ tier: 3, active: true })) as unknown as typeof fetch;
  await refreshNovelAISubscription("test-key");
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  clearNovelaiSubscriptionCache();
  globalThis.fetch = originalFetch;
  for (const restore of restoreSpies.splice(0)) restore();
});

function makeChunk(data: Record<string, unknown>): RawStreamChunk {
  return { data, provider: "novelai", metadata: { timestamp: Date.now() } };
}

function makeStreamConfig(model = "glm-4-6"): StreamConfig {
  return {
    model,
    apiKey: "test-key",
    temperature: 0.8,
    inactivityTimeoutMs: 5_000,
  } as StreamConfig;
}

function makeStreamContext(): StreamContext {
  return {
    channel: {
      id: "channel-1",
      isDMBased: () => false,
      guildId: "guild-1",
    },
    client: {},
    tomoriState: createPersona({
      config: { thinking_level: "none", llm_stop_speaker_pattern_enabled: false, llm_stop_strings: [] },
    }),
    contextItems: [],
    currentTurnModelParts: [],
    provider: "novelai",
    locale: "en-US",
  } as unknown as StreamContext;
}

describe("NovelAI foreign-speaker boundaries", () => {
  it("bounds native request stops while retaining the complete participant list in the local guard", () => {
    const state = createPersona({ persona_nickname: "Juno" });
    const personas = Array.from({ length: 100 }, (_, index) =>
      createPersona({ persona_id: index + 2, persona_nickname: `Persona-${index}`, trigger_words: [] }),
    );
    const items = attachPersonaMentionMapToContextItems(
      [
        {
          role: "user",
          metadataTag: ContextItemTag.DIALOGUE_HISTORY,
          completionText: "Mirri: Hello.",
          parts: [{ type: "text", text: "Mirri: Hello." }],
        },
      ],
      buildPersonaMentionCatalog([state, ...personas]),
    );
    const profile = getNovelAIProfile("llama-3-erato-v1");
    const prepared = fitNovelAIPrompt({ contextItems: items, tomoriState: state, profile, window: 8192 });
    expect(prepared.parameters.stop_sequences).toHaveLength(1024);
    expect(prepared.parameters.stop_sequences).not.toContainEqual(
      createNovelAITokenizerEncoder(profile.tokenizer)("\nUser:"),
    );
    expect(new NovelAISpeakerGuard(prepared.speakers).push("Hello.\nUser: another turn")).toMatchObject({
      text: "Hello.",
      stopped: true,
    });
  });

  it("keeps lookup-only identity aliases out of the provider's speaker list", () => {
    const owner = { kind: "discord_user", discordId: "400000000000000001" } as const;
    const row = createUserRow({ user_nickname: "Private nickname" });
    const identity = { displayName: "Private display", username: "mirri" };
    const speakers = resolveNovelAISpeakers(
      [
        {
          role: "user",
          parts: [],
          participantTargetIndex: {
            targets: [
              {
                key: owner,
                serializedKey: `discord_user:${owner.discordId}`,
                displayLabel: "Mirri",
                primaryAlias: "Mirri",
                mentionable: true,
                inParticipantContext: true,
                aliases: buildDiscordUserAliases({ owner, userRow: row, identity, exposeSavedNickname: false }),
              },
            ],
          },
        },
      ],
      createPersona({ persona_nickname: "Juno" }),
    );
    expect(speakers.foreignNames).toContain("Mirri");
    expect(speakers.foreignNames).not.toContain(row.user_nickname ?? "");
    expect(speakers.foreignNames).not.toContain(identity.displayName);
  });

  async function collect(model: string, texts: string[]) {
    let requests = 0;
    let payload: Record<string, unknown> = {};
    globalThis.fetch = (async (_url, init) => {
      requests++;
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const events = texts.map((text) =>
        getNovelAIProfile(model).endpoint === "/oa/v1/completions"
          ? { choices: [{ text, finish_reason: null }] }
          : { token: text },
      );
      return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`);
    }) as typeof fetch;
    const context = makeStreamContext();
    context.tomoriState = createPersona({
      persona_nickname: "Juno",
      trigger_words: ["June"],
      llm: createLlmRow({ llm_provider: "novelai", llm_codename: model }),
      config: { thinking_level: "none", llm_stop_speaker_pattern_enabled: false },
    });
    context.contextItems = attachPersonaMentionMapToContextItems(
      [
        {
          role: "user",
          sender: { name: "mirri", type: "user" },
          metadataTag: ContextItemTag.DIALOGUE_HISTORY,
          completionText: "mirri: Hello.",
          parts: [{ type: "text", text: "mirri: Hello." }],
        },
      ],
      buildPersonaMentionCatalog([
        context.tomoriState,
        createPersona({ persona_id: 22, persona_nickname: "Vera Vale", trigger_words: ["Vera"] }),
      ]),
    );
    const adapter = new NovelaiStreamAdapter();
    let visible = "";
    for await (const raw of adapter.startStream(makeStreamConfig(model), context)) {
      const result = adapter.processChunk(raw);
      expect(result.type).not.toBe("error");
      visible += result.content ?? "";
      if (result.type === "done") break;
    }
    return { visible, payload, requests };
  }

  it("stops foreign labels across chunks and cancels the rest of the turn with the generic setting off", async () => {
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      for (const pieces of [
        ["Hello.\n", "Mir", "ri", ":", " forbidden-fragment"],
        ["Hello.\n**Mi", "rri**", ": forbidden-fragment"],
        ["Hello.\nMi", "rri (smile)", "：", " forbidden-fragment"],
        ["Hello.\nMi", "rri (Vera (smile))", ": forbidden-fragment"],
        ["Mir", "ri:", " forbidden-fragment"],
        ["Hello.\nVe", "ra: forbidden-fragment"],
        ["Hello.\nVe", "ra   ", "Vale: forbidden-fragment"],
      ]) {
        const result = await collect(model, pieces);
        expect(result.visible).not.toContain("forbidden-fragment");
        expect(result.visible).not.toMatch(/Mirri|Vera/u);
        expect(result.requests).toBe(1);
        if (pieces[0].startsWith("Hello.")) expect(result.visible).toContain("Hello.");
      }
    }
  });

  it("preserves own labels, aliases, modifiers, code, headings, and inline mentions in the local guard", async () => {
    const text =
      "Juno: Hello.\nJune: Still me.\n**Juno (smile):** Here.\n# Mirri: heading\n```text\nMirri: example\n```\n~~~text\nVera: example\n~~~\nMy notes say Mirri: hello.";
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      const result = await collect(model, [...text]);
      expect(result.visible).toBe(text);
      expect(result.requests).toBe(1);
      const stops = result.payload.stop ?? result.payload.openAIStopStrings;
      expect(stops).toContain("\nMirri:");
      expect(stops).not.toContain("\nJuno:");
      expect(stops).not.toContain("\nJune:");
      const profile = getNovelAIProfile(model);
      if (profile.endpoint === "/ai/generate-stream") {
        const parameters = result.payload.parameters as { stop_sequences: number[][] };
        expect(parameters.stop_sequences).toContainEqual(createNovelAITokenizerEncoder(profile.tokenizer)("\nMirri:"));
        if (model === "llama-3-erato-v1") {
          expect(parameters.stop_sequences).toContainEqual(
            createNovelAITokenizerEncoder(profile.tokenizer)(".\nMirri:"),
          );
        }
      }
    }
  });

  it("stops separator lines across chunks before metadata reaches delivery for every model", async () => {
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      for (const marker of ["---", "***"]) {
        expect((await collect(model, ["Hello\n", ...marker])).visible).toBe("Hello");
        for (const suffix of [[], ["\n", "*System: forbidden-fragment*"]]) {
          const result = await collect(model, ["Hello.\n", ...marker, ...suffix]);
          expect(result.visible).toBe("Hello.");
          expect(result.requests).toBe(1);
          const stops = result.payload.stop ?? result.payload.openAIStopStrings;
          expect(stops).toContain(`\n${marker}\n`);
        }
      }
    }
  });

  it("preserves triple emphasis, inline separators, and separators inside code in the local guard", async () => {
    const text = "Hello.\n***waves***\nA --- B\n```md\n---\n***\n```\n~~~md\n---\n***\n~~~";
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      expect((await collect(model, [...text])).visible).toBe(text);
    }
  });
});

describe("NovelaiStreamAdapter.handleProviderError", () => {
  const adapter = new NovelaiStreamAdapter();

  it.each([
    [400, "api_error", false],
    [401, "api_error", false],
    [402, "api_error", false],
    [408, "timeout", true],
    [429, "rate_limit", true],
    [500, "api_error", true],
    [502, "api_error", true],
    [503, "provider_overloaded", true],
    [504, "timeout", true],
  ] as const)("maps HTTP %i to %s with retryable=%s", (statusCode, expectedType, expectedRetryable) => {
    const error = new Error(`NovelAI API request failed with status ${statusCode}: Bad request`);
    const normalized = adapter.handleProviderError(error);

    expect(normalized.type).toBe(expectedType);
    expect(normalized.code).toBe(String(statusCode));
    expect(normalized.retryable).toBe(expectedRetryable);
  });

  it("extracts statusCode from error object property", () => {
    const error = Object.assign(new Error("Request rejected"), { statusCode: 429 });
    const normalized = adapter.handleProviderError(error);

    expect(normalized.type).toBe("rate_limit");
    expect(normalized.code).toBe("429");
    expect(normalized.retryable).toBe(true);
  });

  it("extracts status from error object property", () => {
    const error = Object.assign(new Error("Request rejected"), { status: 503 });
    const normalized = adapter.handleProviderError(error);

    expect(normalized.type).toBe("provider_overloaded");
    expect(normalized.code).toBe("503");
    expect(normalized.retryable).toBe(true);
  });

  it.each([
    ["status: 429 Too Many Requests", "429"],
    ["HTTP 502 Bad Gateway", "502"],
    ["Internal Server Error (500)", "500"],
  ])("extracts a standalone status code from %p", (message, expectedCode) => {
    expect(adapter.handleProviderError(new Error(message)).code).toBe(expectedCode);
  });

  it.each([
    "too much context (32826 tokens), max is 16384",
    "input too long (8192 > 2048)",
    "user status 2002 blocked",
  ])("does not read a status code out of a longer number in %p", (message) => {
    const normalized = adapter.handleProviderError(new Error(message));

    expect(normalized.code).toBe("unknown");
    expect(normalized.retryable).toBe(false);
  });

  it("does not duplicate the NovelAI API error prefix if already present", () => {
    const error = new Error("NovelAI API error (400): bad request: invalid prompt");
    const normalized = adapter.handleProviderError(error);

    expect(normalized.message).toBe("NovelAI API error (400): bad request: invalid prompt");
  });
});

describe("NovelaiStreamAdapter.processChunk error delegation", () => {
  const adapter = new NovelaiStreamAdapter();

  it("normalizes a string error chunk through handleProviderError", () => {
    const processed = adapter.processChunk(
      makeChunk({
        error: "NovelAI API request failed with status 429: Too Many Requests",
      }),
    );

    expect(processed.type).toBe("error");
    expect(processed.error?.type).toBe("rate_limit");
    expect(processed.error?.code).toBe("429");
    expect(processed.error?.retryable).toBe(true);
  });

  it("passes through an existing typed ProviderError directly", () => {
    const providerError = {
      type: "timeout" as const,
      message: "Request timed out",
      code: "504",
      retryable: true,
    };
    const processed = adapter.processChunk(makeChunk({ error: providerError }));

    expect(processed.type).toBe("error");
    expect(processed.error).toEqual(providerError);
  });
});

describe("NovelAI context length error classification", () => {
  it("recognizes NovelAI prompt overflow as a context length error", () => {
    const adapter = new NovelaiStreamAdapter();
    const error = new Error(
      'NovelAI API request failed with status 400: {"statusCode":400,"message":"bad request: invalid prompt, too much context. got 32826 + 50, max is 16384"}',
    );
    const normalized = adapter.handleProviderError(error);

    expect(isContextLengthError(normalized)).toBe(true);
  });
});

describe("NovelaiStreamAdapter.startStream error propagation", () => {
  it("stops malformed SSE before later text can be delivered and redacts its credential", async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      return new Response(
        'data: {"choices":[{"text":"Hello."}]}\n\ndata: test-key\n\ndata: {"choices":[{"text":"forbidden-fragment","finish_reason":"stop"}]}\n\n',
      );
    }) as unknown as typeof fetch;
    const adapter = new NovelaiStreamAdapter();
    const chunks = [];
    for await (const raw of adapter.startStream(makeStreamConfig(), makeStreamContext()))
      chunks.push(adapter.processChunk(raw));
    expect(requests).toBe(1);
    expect(chunks.at(-1)?.type).toBe("error");
    expect(chunks.at(-1)?.error?.message).not.toContain("test-key");
    expect(chunks.map((chunk) => chunk.content ?? "").join("")).not.toContain("forbidden-fragment");
  });

  it("preserves subscription HTTP failures for rotation and redacts the selected credential", async () => {
    clearNovelaiSubscriptionCache();
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount++;
      return new Response("quota refusal for test-key", { status: 429 });
    }) as unknown as typeof fetch;
    const adapter = new NovelaiStreamAdapter();
    const chunks = [];
    for await (const raw of adapter.startStream(makeStreamConfig(), makeStreamContext()))
      chunks.push(adapter.processChunk(raw));
    expect(requestCount).toBe(1);
    expect(chunks.at(-1)?.error).toMatchObject({ type: "rate_limit", code: "429", retryable: true });
    expect(chunks.at(-1)?.error?.message).not.toContain("test-key");
  });

  it("yields a normalized ProviderError chunk when the GLM OpenAI endpoint returns HTTP 400 without logging to error_logs", async () => {
    const errorSpy = spyOn(log, "error");
    const warnSpy = spyOn(log, "warn");

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          statusCode: 400,
          message: "bad request: invalid prompt, too much context. got 32826 + 50, max is 16384 test-key",
        }),
        { status: 400, statusText: "Bad Request" },
      );
    }) as unknown as typeof fetch;

    const adapter = new NovelaiStreamAdapter();
    const chunks: RawStreamChunk[] = [];

    for await (const chunk of adapter.startStream(makeStreamConfig("glm-4-6"), makeStreamContext())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    const first = chunks[0];
    expect(first.provider).toBe("novelai");
    expect(first.metadata?.error).toBe(true);

    const processed = adapter.processChunk(first);
    expect(processed.type).toBe("error");
    expect(processed.error?.type).toBe("api_error");
    expect(processed.error?.code).toBe("400");
    expect(processed.error?.message).not.toContain("test-key");
    expect(processed.error?.retryable).toBe(false);
    expect(processed.error ? isContextLengthError(processed.error) : false).toBe(true);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("yields a retryable rate_limit chunk when the native endpoint returns HTTP 429", async () => {
    globalThis.fetch = (async () => {
      return new Response("Too Many Requests", { status: 429, statusText: "Too Many Requests" });
    }) as unknown as typeof fetch;

    const adapter = new NovelaiStreamAdapter();
    const chunks: RawStreamChunk[] = [];

    for await (const chunk of adapter.startStream(makeStreamConfig("kayra-v1"), makeStreamContext())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    const first = chunks[0];
    expect(first.metadata?.error).toBe(true);

    const processed = adapter.processChunk(first);
    expect(processed.type).toBe("error");
    expect(processed.error?.type).toBe("rate_limit");
    expect(processed.error?.code).toBe("429");
    expect(processed.error?.retryable).toBe(true);
  });

  it("handles mid-stream error event on native endpoint without echoing error JSON as persona text", async () => {
    const warnSpy = spyOn(log, "warn");

    globalThis.fetch = (async () => {
      const sseBody = 'data: {"token":"Hello"}\n\ndata: {"error":"out of anlas"}\n\n';
      return new Response(sseBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const adapter = new NovelaiStreamAdapter();
    const chunks: RawStreamChunk[] = [];

    for await (const chunk of adapter.startStream(makeStreamConfig("kayra-v1"), makeStreamContext())) {
      chunks.push(chunk);
    }

    // Must yield the initial token chunk, then the error chunk, NEVER the raw error JSON as text
    expect(chunks).toHaveLength(2);

    const tokenChunk = adapter.processChunk(chunks[0]);
    expect(tokenChunk.type).toBe("text");
    expect(tokenChunk.content).toBe("Hello");

    const errorRaw = chunks[1];
    expect(errorRaw.metadata?.error).toBe(true);
    const errorProcessed = adapter.processChunk(errorRaw);
    expect(errorProcessed.type).toBe("error");
    expect(errorProcessed.error?.message).toContain("out of anlas");

    // The raw error JSON must never be emitted as text content
    const textContents = chunks.map((c) => (c.data as { token?: string })?.token).filter(Boolean);
    expect(textContents).not.toContain('{"error":"out of anlas"}');

    // The response body is trace for whoever runs the bot; the provider_error counter carries the count
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("out of anlas"), undefined, expect.anything());
  });

  it("handles mid-stream error event on OpenAI endpoint without echoing error payload", async () => {
    const warnSpy = spyOn(log, "warn");

    globalThis.fetch = (async () => {
      const sseBody =
        'data: {"choices":[{"index":0,"text":"Hello"}]}\n\ndata: {"error":{"message":"too much context"}}\n\n';
      return new Response(sseBody, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const adapter = new NovelaiStreamAdapter();
    const chunks: RawStreamChunk[] = [];

    for await (const chunk of adapter.startStream(makeStreamConfig("glm-4-6"), makeStreamContext())) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);

    // GLM holds an unfinished sentence in its boundary buffer, so assert on the raw token
    // rather than processed content, which is empty until the sentence completes.
    expect((chunks[0].data as { token?: string }).token).toBe("Hello");

    const errorRaw = chunks[1];
    expect(errorRaw.metadata?.error).toBe(true);
    const errorProcessed = adapter.processChunk(errorRaw);
    expect(errorProcessed.type).toBe("error");
    expect(errorProcessed.error?.message).toContain("too much context");

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("too much context"), undefined, expect.anything());
  });
});

describe("NovelAI text generation without tools", () => {
  it("omits supplied tool schemas and tool history for every text model", async () => {
    for (const model of ["glm-4-6", "kayra-v1", "llama-3-erato-v1"]) {
      let prompt = "";
      globalThis.fetch = (async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { input?: string; prompt?: string };
        prompt = body.prompt ?? body.input ?? "";
        return new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
      }) as typeof fetch;
      const context = makeStreamContext();
      context.contextItems = [
        {
          role: "system",
          parts: [{ type: "text", text: "tool-guide-marker" }],
          metadataTag: ContextItemTag.SYSTEM_FUNCTION_GUIDE,
        },
        {
          role: "user",
          completionText: "Juno: Hello!",
          parts: [{ type: "text", text: "Juno: Hello!" }],
          metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        },
      ];
      context.functionInteractionHistory = [
        { functionCall: { name: "tool-history-marker", args: {} }, functionResponse: { result: "tool-result-marker" } },
      ];
      const adapter = new NovelaiStreamAdapter();
      for await (const chunk of adapter.startStream(
        { ...makeStreamConfig(model), tools: [{ name: "tool-schema-marker" }] },
        context,
      )) {
        adapter.processChunk(chunk);
      }
      expect(prompt).toContain("Juno: Hello!");
      for (const marker of [
        "tool-guide-marker",
        "tool-history-marker",
        "tool-result-marker",
        "tool-schema-marker",
        "<tools>",
      ]) {
        expect(prompt).not.toContain(marker);
      }
      const literalCall = "<tool_call>unused_tool<arg_key>value</arg_key><arg_value>1</arg_value></tool_call>.";
      const processed = adapter.processChunk(makeChunk({ token: literalCall }));
      expect(processed.type).toBe("text");
      expect(processed.content).toBe(literalCall);
    }
  });

  it("keeps complete sentences, captures thinking, and drops a length-limited fragment", async () => {
    globalThis.fetch = (async () =>
      new Response("data: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      })) as unknown as typeof fetch;
    const adapter = new NovelaiStreamAdapter();
    for await (const chunk of adapter.startStream(makeStreamConfig(), makeStreamContext())) adapter.processChunk(chunk);

    const thought = adapter.processChunk(makeChunk({ token: "<think>consider" }));
    const visible = adapter.processChunk(makeChunk({ token: " carefully</think>Hello. unfinished" }));
    expect(thought.content).toBe("");
    expect([...(thought.thoughts ?? []), ...(visible.thoughts ?? [])].map((entry) => entry.content).join("")).toBe(
      "consider carefully",
    );
    expect(visible.content).toBe("Hello.");
    expect(adapter.processChunk(makeChunk({ final: true })).type).toBe("done");

    for await (const chunk of adapter.startStream(makeStreamConfig(), makeStreamContext())) adapter.processChunk(chunk);
    expect(adapter.processChunk(makeChunk({ token: "Clean ending!" })).content).toBe("Clean ending!");
  });

  it("returns no tools and uses one provider-owned streaming session", async () => {
    const stream = spyOn(StreamOrchestrator.prototype, "streamToDiscord").mockResolvedValue({
      status: "empty_response",
      accumulatedText: "",
    });
    restoreSpies.push(() => stream.mockRestore());
    const provider = new NovelaiProvider();
    expect(await provider.getTools()).toEqual([]);
    expect(provider.getInfo().supportsFunctionCalling).toBe(false);
    const context = makeStreamContext();
    const config = { model: "glm-4-6", apiKey: "test-key", temperature: 1, tools: [{ name: "unused_tool" }] };
    const generate = () =>
      provider.streamToDiscord(context.channel, context.client, context.tomoriState, config, [], []);
    const empty = await generate();
    expect(empty.status).toBe("empty_response");
    expect(stream.mock.calls[0]?.[1].tools).toEqual([]);

    stream.mockResolvedValue({ status: "completed", accumulatedText: "Complete." });
    const complete = await generate();
    expect(complete.status).toBe("completed");
  });
});

describe("NovelAI internal continuation", () => {
  async function collect(responses: Array<{ text: string; finish?: string }>, outputCap = 256) {
    const requests: Array<{ prompt: string; max_tokens: number }> = [];
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const response = responses[requests.length - 1];
      if (!response) throw new Error("Unexpected extra continuation");
      return new Response(
        `data: ${JSON.stringify({ choices: [{ text: response.text, finish_reason: response.finish ?? null }] })}\n\n`,
      );
    }) as typeof fetch;
    const adapter = new NovelaiStreamAdapter();
    const chunks = [];
    for await (const raw of adapter.startStream(
      { ...makeStreamConfig(), maxOutputTokens: outputCap },
      makeStreamContext(),
    )) {
      const processed = adapter.processChunk(raw);
      chunks.push(processed);
      if (processed.type === "done" || processed.type === "error") break;
    }
    return { requests, chunks, text: chunks.map((chunk) => chunk.content ?? "").join("") };
  }

  it("continues EOF after complete sentences and a held fragment without duplicate delivery", async () => {
    const result = await collect([
      { text: "<think>consider</think>Hello. unfinished" },
      { text: " sentence.", finish: "stop" },
    ]);
    expect(result.requests).toHaveLength(2);
    expect(result.requests[0].max_tokens).toBe(256);
    expect(result.requests[1].prompt).toEndWith("<think>consider</think>Hello. unfinished");
    expect(result.requests[1].max_tokens).toBeLessThan(result.requests[0].max_tokens);
    expect(result.text).toBe("Hello. unfinished sentence.");
    expect(
      result.chunks
        .flatMap((chunk) => chunk.thoughts ?? [])
        .map((thought) => thought.content)
        .join(""),
    ).toBe("consider");
  });

  it("flushes an unpunctuated normal stop without retrying", async () => {
    const result = await collect([{ text: "fine", finish: "stop" }]);
    expect(result.requests).toHaveLength(1);
    expect(result.text).toBe("fine");
  });

  it("treats requested-cap endings as exhausted output rather than resetting the budget", async () => {
    const result = await collect([{ text: "unfinished", finish: "length" }]);
    expect(result.requests).toHaveLength(1);
    expect(result.text).toBe("");
    expect(result.chunks.at(-1)?.error?.code).toBe("continuation_exhausted");
  });

  it("bounds repeated cutoffs and keeps a cumulative prefill and decreasing output budget", async () => {
    const result = await collect([{ text: "unfinished" }, { text: " fragment" }, { text: " again" }]);
    expect(result.requests).toHaveLength(3);
    expect(result.requests[2].prompt).toEndWith("unfinished fragment");
    expect(result.requests[2].max_tokens).toBeLessThan(result.requests[1].max_tokens);
    expect(result.chunks.at(-1)?.error?.code).toBe("continuation_exhausted");
  });

  it("consumes a token-bearing final chunk before finalizing sentence buffers", async () => {
    globalThis.fetch = (async () => new Response("data: [DONE]\n\n")) as unknown as typeof fetch;
    const adapter = new NovelaiStreamAdapter();
    for await (const raw of adapter.startStream(makeStreamConfig(), makeStreamContext())) adapter.processChunk(raw);
    const final = adapter.processChunk(makeChunk({ token: "Complete.", final: true, termination: "stop" }));
    expect(final.content).toBe("Complete.");
  });

  it("does not continue after a speaker boundary or consumer cancellation", async () => {
    for (const stop of ["speaker", "cancel"] as const) {
      let requests = 0;
      globalThis.fetch = (async () => {
        requests++;
        const texts = stop === "speaker" ? ["Hello.", "\nMirri: another turn", " forbidden-fragment"] : ["unfinished"];
        return new Response(
          texts.map((text) => `data: ${JSON.stringify({ choices: [{ text, finish_reason: null }] })}\n\n`).join(""),
        );
      }) as unknown as typeof fetch;
      const controller = new AbortController();
      const context = makeStreamContext();
      context.abortSignal = controller.signal;
      context.tomoriState.persona_nickname = "Juno";
      context.tomoriState.config.llm_stop_speaker_pattern_enabled = stop === "speaker";
      context.contextItems = [
        {
          role: "user",
          metadataTag: ContextItemTag.DIALOGUE_HISTORY,
          completionText: "Mirri: Hello.",
          parts: [{ type: "text", text: "Mirri: Hello." }],
        },
      ];
      const adapter = new NovelaiStreamAdapter();
      let visible = "";
      for await (const raw of adapter.startStream(makeStreamConfig(), context)) {
        const processed = adapter.processChunk(raw);
        if (stop === "cancel") {
          controller.abort();
          break;
        }
        visible += processed.content ?? "";
      }
      expect(requests).toBe(1);
      expect(visible).not.toContain("another turn");
      expect(visible).not.toContain("forbidden-fragment");
    }
  });

  it("continues after an actual read-inactivity timeout and cancels the unfinished response", () => {
    const script = `
      import { NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
      import { createPersona } from "./tests/helpers/fixtures";
      let requests = 0;
      let cancelled = false;
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/user/subscription")) return Response.json({ tier: 3, active: true });
        requests++;
        if (requests === 1) return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"text":"Hello. unfinished"}]}\\n\\n')); },
          cancel() { cancelled = true; },
        }));
        return new Response('data: {"choices":[{"text":" sentence.","finish_reason":"stop"}]}\\n\\n');
      };
      const adapter = new NovelaiStreamAdapter();
      let text = "";
      const context = { tomoriState: createPersona(), contextItems: [], currentTurnModelParts: [],
        channel: { id: "channel-1", isDMBased: () => false }, client: {}, provider: "novelai", locale: "en-US" };
      for await (const raw of adapter.startStream({ model: "glm-4-6", apiKey: "synthetic-key", temperature: 1 }, context)) {
        const chunk = adapter.processChunk(raw);
        if (chunk.type === "error") process.exit(2);
        text += chunk.content ?? "";
      }
      process.exit(requests === 2 && cancelled && text === "Hello. unfinished sentence." ? 0 : 1);
    `;
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, NOVELAI_STREAM_READ_TIMEOUT_MS: "5" },
    });
    expect(result.exitCode).toBe(0);
  });
});

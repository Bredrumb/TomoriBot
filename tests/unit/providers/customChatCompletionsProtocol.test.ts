import { describe, expect, it } from "bun:test";
import { humanizerSettingsFromDegree } from "@/constants/humanizer";
import { CustomStreamAdapter, type CustomStreamConfig } from "@/providers/custom/customStreamAdapter";
import { callCustomChatCompletions } from "@/providers/custom/customOpenAICompatibleUtils";
import { callCustomStructuredJSON } from "@/providers/custom/customStructuredOutput";
import {
  normalizeCustomEndpointUrlForStorage,
  validateCustomEndpointReachability,
} from "@/utils/provider/customEndpointService";
import type { ProcessedChunk, StreamContext } from "@/types/stream/interfaces";
import { z } from "zod";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { useEnvSandbox } from "../../helpers/env";

const key = "synthetic-client-key";
const model = "fixture-chat";

function context(): StreamContext {
  return {
    channel: { id: "fixture-channel" } as StreamContext["channel"],
    client: {} as StreamContext["client"],
    tomoriState: createPersona({
      llm: createLlmRow({ llm_provider: "custom", llm_codename: model, has_tools: true }),
      config: { thinking_level: "auto", llm_stop_speaker_pattern_enabled: false },
    }),
    contextItems: [
      { role: "system", parts: [{ type: "text", text: "Use the supplied tools." }] },
      { role: "user", parts: [{ type: "text", text: "Check the fixture." }] },
    ],
    currentTurnModelParts: [],
    provider: "custom",
    locale: "en-US",
    holdResponseText: true,
  };
}

function config(endpointUrl: string): CustomStreamConfig {
  return {
    model,
    apiKey: key,
    endpointUrl,
    temperature: 0.7,
    maxMessageLength: 2000,
    flushBufferSize: 1000,
    flushBufferSizeCodeBlock: 15000,
    inactivityTimeoutMs: 5000,
    baseTypeSpeedMsPerChar: 0,
    maxTypingTimeMs: 0,
    minVisibleTypingDurationMs: 0,
    humanizer: humanizerSettingsFromDegree(0),
    emojiUsageEnabled: false,
    tools: [
      { type: "function", function: { name: "inspect_fixture", parameters: { type: "object", properties: {} } } },
    ],
  };
}

function sse(events: unknown[]): Response {
  const bytes = new TextEncoder().encode(
    `: heartbeat\n\n${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
  );
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === bytes.length) return controller.close();
        const end = Math.min(offset + 17, bytes.length);
        controller.enqueue(bytes.slice(offset, end));
        offset = end;
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

async function collect(endpointUrl: string, streamContext: StreamContext): Promise<ProcessedChunk[]> {
  const adapter = new CustomStreamAdapter();
  const chunks: ProcessedChunk[] = [];
  for await (const chunk of adapter.startStream(config(endpointUrl), streamContext))
    chunks.push(adapter.processChunk(chunk));
  return chunks;
}

describe("custom Chat Completions proxy protocol", () => {
  useEnvSandbox(["RUN_ENV", "ALLOW_PRIVATE_NETWORK"]);

  it("sends extra-high effort in the streaming request body", async () => {
    process.env.RUN_ENV = "development";
    process.env.ALLOW_PRIVATE_NETWORK = "true";
    const bodies: Array<Record<string, unknown>> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        bodies.push((await request.json()) as Record<string, unknown>);
        return sse([{ choices: [{ index: 0, delta: { content: "Ready." }, finish_reason: "stop" }] }]);
      },
    });
    try {
      const streamContext = context();
      streamContext.tomoriState.config.thinking_level = "xhigh";
      await collect(`http://127.0.0.1:${server.port}/v1`, streamContext);
      expect(bodies[0]?.reasoning_effort).toBe("xhigh");
    } finally {
      server.stop(true);
    }
  });

  it("authenticates discovery, preserves system turns, and continues a fragmented tool call", async () => {
    process.env.RUN_ENV = "development";
    process.env.ALLOW_PRIVATE_NETWORK = "true";
    const bodies: Array<Record<string, unknown>> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (request.headers.get("Authorization") !== `Bearer ${key}`)
          return Response.json({ error: { type: "authentication_error" } }, { status: 401 });
        const path = new URL(request.url).pathname;
        if (path === "/v1/models") return Response.json({ object: "list", data: [{ id: model, object: "model" }] });
        if (path !== "/v1/chat/completions") return new Response(null, { status: 404 });
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        if (bodies.length === 1)
          return sse([
            { choices: [{ index: 0, delta: { reasoning_content: "Checking." } }] },
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_fixture",
                        type: "function",
                        function: { name: "inspect_fixture", arguments: "{" },
                      },
                    ],
                  },
                },
              ],
            },
            {
              choices: [
                {
                  index: 0,
                  delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] },
                  finish_reason: "tool_calls",
                },
              ],
            },
          ]);
        return sse([
          { choices: [{ index: 0, delta: { content: "Ready." } }] },
          { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
          { choices: [], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } },
        ]);
      },
    });
    try {
      const endpointUrl = normalizeCustomEndpointUrlForStorage("openai-compatible", `http://127.0.0.1:${server.port}`);
      expect(await validateCustomEndpointReachability({ apiStyle: "openai-compatible", endpointUrl })).toMatchObject({
        ok: false,
      });
      expect(
        await validateCustomEndpointReachability({ apiStyle: "openai-compatible", endpointUrl, apiKey: "wrong-key" }),
      ).toMatchObject({ ok: false });
      expect(
        await validateCustomEndpointReachability({ apiStyle: "openai-compatible", endpointUrl, apiKey: key }),
      ).toEqual({ ok: true });
      const first = await collect(endpointUrl, context());
      const tool = first.find((chunk) => chunk.type === "function_call")?.functionCall;
      expect(tool).toMatchObject({ id: "call_fixture", name: "inspect_fixture", args: {} });
      expect(first.some((chunk) => chunk.thoughts?.length)).toBe(true);
      expect(bodies[0]?.model).toBe(model);
      expect(bodies[0]?.messages).toContainEqual(expect.objectContaining({ role: "system" }));
      expect(tool).toBeDefined();
      if (!tool) throw new Error("Missing tool call");
      const next = context();
      next.functionInteractionHistory = [{ functionCall: tool, functionResponse: { ready: true } }];
      const second = await collect(endpointUrl, next);
      expect(bodies[1]?.messages).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: tool.id }));
      expect(second.some((chunk) => chunk.content === "Ready.")).toBe(true);
      expect(second.some((chunk) => chunk.metadata?.usage)).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it("retries a rejected stream option before output and retains tools", async () => {
    process.env.RUN_ENV = "development";
    process.env.ALLOW_PRIVATE_NETWORK = "true";
    const bodies: Array<Record<string, unknown>> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        if ("stream_options" in body)
          return Response.json({ error: { message: "Unsupported parameter: stream_options" } }, { status: 400 });
        return sse([{ choices: [{ index: 0, delta: { content: "Ready." }, finish_reason: "stop" }] }]);
      },
    });
    try {
      const chunks = await collect(`http://127.0.0.1:${server.port}/v1`, context());
      expect(bodies.length).toBeGreaterThan(1);
      expect(bodies.at(-1)).not.toHaveProperty("stream_options");
      expect(bodies.at(-1)?.tools).toEqual(bodies[0]?.tools);
      expect(chunks.some((chunk) => chunk.content === "Ready.")).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it("validates structured JSON over the non-streaming custom transport", async () => {
    process.env.RUN_ENV = "development";
    process.env.ALLOW_PRIVATE_NETWORK = "true";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        expect(request.headers.get("Authorization")).toBe(`Bearer ${key}`);
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.stream).not.toBe(true);
        expect(body.response_format).toMatchObject({ type: "json_schema" });
        expect(body.reasoning_effort).toBe("xhigh");
        return Response.json({ choices: [{ message: { content: JSON.stringify({ ready: true }) } }] });
      },
    });
    try {
      const result = await callCustomStructuredJSON(
        {
          apiKey: key,
          endpointUrl: `http://127.0.0.1:${server.port}/v1`,
          model,
          systemPrompt: "Return JSON.",
          userPrompt: "Check the fixture.",
          thinkingLevel: "xhigh",
        },
        {
          type: "object",
          properties: { ready: { type: "boolean" } },
          required: ["ready"],
          additionalProperties: false,
        },
        z.object({ ready: z.boolean() }),
      );
      expect(result).toMatchObject({ success: true, data: { ready: true } });
    } finally {
      server.stop(true);
    }
  });

  it("honors an already aborted non-streaming request without contacting the origin", async () => {
    process.env.RUN_ENV = "development";
    process.env.ALLOW_PRIVATE_NETWORK = "true";
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests++;
        return Response.json({});
      },
    });
    try {
      const result = await callCustomChatCompletions({
        endpointUrl: `http://127.0.0.1:${server.port}/v1`,
        apiKey: key,
        body: { model, messages: [] },
        logLabel: "fixture",
        abortSignal: AbortSignal.abort(),
      });
      expect(result.success).toBe(false);
      expect(requests).toBe(0);
    } finally {
      server.stop(true);
    }
  });
});

import { describe, expect, it } from "bun:test";
import { humanizerSettingsFromDegree } from "@/constants/humanizer";
import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import {
  buildDegradationAttempts,
  buildTargetedAttempt,
  classifyDegradableError,
  extractRejectedParams,
} from "@/providers/utils/paramDegradation";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";
import { applyPromptLayoutInserts, getCacheablePrefixBoundary } from "@/utils/text/context/promptLayout";
import { normalizeProviderUsage, sumTurnUsage } from "@/utils/text/tokenEstimate";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { stubGlobalFetch } from "../../helpers/fetchStub";

type Body = Record<string, unknown>;
type Message = { role: string; content: string | Body[] };

function prompt(withTail = true, systemChars = 20000, turns = 11): StructuredContextItem[] {
  const items: StructuredContextItem[] = [
    {
      role: "system",
      metadataTag: ContextItemTag.SYSTEM_PERSONALITY,
      parts: [{ type: "text", text: "Stable rules. ".repeat(Math.ceil(systemChars / 14)).slice(0, systemChars) }],
    },
    ...Array.from(
      { length: turns },
      (_, index): StructuredContextItem => ({
        role: index % 2 ? "model" : "user",
        sender: {
          id: index % 2 ? "Mirri" : "Juno",
          name: index % 2 ? "Mirri" : "Juno",
          type: index % 2 ? "persona" : "user",
        },
        metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        parts: [{ type: "text", text: `History ${index}` }],
      }),
    ),
  ];
  if (withTail)
    items.push({
      role: "user",
      metadataTag: ContextItemTag.KNOWLEDGE_CURRENT_CONTEXT,
      parts: [{ type: "text", text: "Volatile context" }],
    });
  applyPromptLayoutInserts(items, []);
  return items;
}

async function capture(
  provider: "anthropic" | "openrouter",
  items: StructuredContextItem[],
  options: {
    model?: string;
    history?: StreamContext["functionInteractionHistory"];
    reject?: boolean;
    rejectStream?: "before" | "after" | "unterminated";
    strict?: boolean;
  } = {},
): Promise<Body[]> {
  const model = options.model ?? (provider === "openrouter" ? "anthropic/claude-sonnet-4.6" : "claude-sonnet-4-6");
  const adapter = provider === "anthropic" ? new AnthropicStreamAdapter() : new OpenrouterStreamAdapter();
  const bodies: Body[] = [];
  const fetchStub = stubGlobalFetch((_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Body);
    if (options.reject && bodies.length === 1)
      return Response.json(
        { error: { message: "messages.0.content.0.cache_control: Extra inputs are not permitted" } },
        { status: 400 },
      );
    if (options.rejectStream && bodies.length === 1) {
      const events =
        provider === "anthropic"
          ? `${options.rejectStream === "after" ? 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"answer"}}\n\n' : ""}event: error\ndata: {"type":"error","error":{"message":"Unsupported parameter: cache_control"}}\n\n`
          : `${options.rejectStream === "after" ? 'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n' : ""}data: {"error":{"code":400,"message":"Unsupported parameter: cache_control"}}\n\ndata: [DONE]\n\n`;
      return new Response(options.rejectStream === "unterminated" ? events.trimEnd() : events, {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response(provider === "openrouter" ? "data: [DONE]\n\n" : "", {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const config: StreamConfig = {
    model,
    apiKey: "test-key",
    temperature: 0.8,
    maxOutputTokens: 1000,
    maxMessageLength: 2000,
    flushBufferSize: 1000,
    flushBufferSizeCodeBlock: 15000,
    inactivityTimeoutMs: 5000,
    baseTypeSpeedMsPerChar: 0,
    maxTypingTimeMs: 0,
    minVisibleTypingDurationMs: 0,
    humanizer: humanizerSettingsFromDegree(0),
    emojiUsageEnabled: true,
  };
  const context: StreamContext = {
    channel: { id: "channel-test" } as StreamContext["channel"],
    client: {} as StreamContext["client"],
    tomoriState: createPersona({
      llm: createLlmRow({
        llm_provider: provider,
        llm_codename: model,
        strict_role_alternation: options.strict ?? true,
      }),
      config: { thinking_level: "none" },
    }),
    contextItems: items,
    currentTurnModelParts: [],
    functionInteractionHistory: options.history,
    provider,
    locale: "en-US",
    holdResponseText: true,
  };
  try {
    for await (const _chunk of adapter.startStream(config, context)) {
    }
  } finally {
    fetchStub.mockRestore();
  }
  return bodies;
}

function blocks(body: Body): Body[] {
  const system = Array.isArray(body.system) ? (body.system as Body[]) : [];
  return [
    ...system,
    ...(body.messages as Message[]).flatMap((message) => (Array.isArray(message.content) ? message.content : [])),
  ];
}

function breakpoints(body: Body): Body[] {
  return blocks(body).filter((block) => block.cache_control !== undefined);
}

for (const provider of ["openrouter", "anthropic"] as const) {
  describe(`${provider} explicit Anthropic cache`, () => {
    it("marks the system end and the boundary even when the tail slot is empty, within four breakpoints", async () => {
      for (const withTail of [false, true]) {
        const items = prompt(withTail);
        const boundary = getCacheablePrefixBoundary(items);
        const [body] = await capture(provider, items);
        const points = breakpoints(body);
        expect(points).toHaveLength(2);
        expect(points.length).toBeLessThanOrEqual(4);
        expect(points.map((point) => point.cache_control)).toEqual([{ type: "ephemeral" }, { type: "ephemeral" }]);
        expect(points[0].text).toBe(items[0].parts[0].type === "text" ? items[0].parts[0].text : "");
        expect(points[1].text).toBe(boundary?.parts[0].type === "text" ? boundary.parts[0].text : "");
        expect(body).not.toHaveProperty("cache_control");
        expect(JSON.stringify(items)).not.toContain("cache_control");
      }
    });

    it("marks the relocated image at the end of a media-bearing boundary item", async () => {
      for (const withText of [false, true]) {
        const items = prompt(true, 20000, 10);
        const boundary = getCacheablePrefixBoundary(items) as StructuredContextItem;
        boundary.parts = [
          ...(withText ? [{ type: "text" as const, text: "Picture" }] : []),
          { type: "image", uri: "data:image/png;base64,aW1hZ2U=", mimeType: "image/png" },
        ];
        const [body] = await capture(provider, items);
        const points = breakpoints(body);
        expect(points).toHaveLength(2);
        expect(points[1].type).toBe(provider === "anthropic" ? "image" : "image_url");
      }
    });

    it("keeps the same marked item and prefix across tool-loop steps and tail changes", async () => {
      const items = prompt();
      const history: NonNullable<StreamContext["functionInteractionHistory"]> = [
        { functionCall: { name: "search_web", args: { query: "test" } }, functionResponse: { result: "found" } },
      ];
      const [first] = await capture(provider, items);
      const [next] = await capture(provider, items, { history });
      const [emptyTail] = await capture(provider, prompt(false));
      expect(breakpoints(next)).toEqual(breakpoints(first));
      expect(breakpoints(emptyTail)).toEqual(breakpoints(first));
      const throughBoundary = (body: Body) => {
        const all = blocks(body);
        return all.slice(0, all.lastIndexOf(breakpoints(body).at(-1) as Body) + 1);
      };
      expect(throughBoundary(next)).toEqual(throughBoundary(first));
      if (provider === "openrouter") {
        expect(next.session_id).toBe(first.session_id);
        expect(next.provider).toBeUndefined();
      }
    });

    it("skips undersized prefixes and uses the model-specific minimum for each breakpoint", async () => {
      const sonnet = provider === "openrouter" ? "anthropic/claude-sonnet-4.6" : "claude-sonnet-4-6";
      const opus = provider === "openrouter" ? "anthropic/claude-opus-4.6" : "claude-opus-4-6";
      expect(breakpoints((await capture(provider, prompt(true, 20), { model: sonnet }))[0])).toHaveLength(0);
      expect(breakpoints((await capture(provider, prompt(true, 5000), { model: sonnet }))[0])).toHaveLength(2);
      expect(breakpoints((await capture(provider, prompt(true, 5000), { model: opus }))[0])).toHaveLength(0);
      const items = prompt(true, 20);
      items.splice(1, 0, {
        role: "user",
        metadataTag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
        parts: [{ type: "text", text: "Reference. ".repeat(1000) }],
      });
      expect(breakpoints((await capture(provider, items))[0])).toHaveLength(1);
    });

    it("retries a cache_control rejection with every breakpoint stripped and the remaining body intact", async () => {
      const [original, retry] = await capture(provider, prompt(), { reject: true });
      expect(breakpoints(original)).toHaveLength(2);
      expect(breakpoints(retry)).toHaveLength(0);
      expect(retry).toEqual(buildTargetedAttempt(original, ["cache_control"]).body);
    });

    it("retries an SSE cache rejection only before committing output", async () => {
      const [original, retry] = await capture(provider, prompt(), { rejectStream: "before" });
      expect(breakpoints(original)).toHaveLength(2);
      expect(breakpoints(retry)).toHaveLength(0);
      expect(retry).toEqual(buildTargetedAttempt(original, ["cache_control"]).body);
      expect(await capture(provider, prompt(), { rejectStream: "after" })).toHaveLength(1);
      if (provider === "anthropic") {
        const [first, next] = await capture(provider, prompt(), { rejectStream: "unterminated" });
        expect(next).toEqual(buildTargetedAttempt(first, ["cache_control"]).body);
      }
    });
  });
}

it("marks OpenRouter's Anthropic aliases while preserving every other model's serialization", async () => {
  const items = prompt();
  const [alias] = await capture("openrouter", items, { model: "~anthropic/claude-sonnet-latest" });
  expect(breakpoints(alias)).toHaveLength(2);
  for (const model of ["google/gemini-test", "aion-labs/aion-2.0"]) {
    const [body] = await capture("openrouter", items, { model, strict: false });
    const baseline = await new OpenrouterStreamAdapter()["assembleOpenrouterContext"](items, []);
    expect(body.messages).toEqual(baseline);
    expect(body.session_id).toBeUndefined();
    expect(breakpoints(body)).toHaveLength(0);
    expect((body.messages as Message[]).every((message) => typeof message.content === "string")).toBe(true);
  }
});

it("classifies nested cache rejections and includes a cache-free static and minimal retry", () => {
  const body = {
    model: "claude-sonnet-4-6",
    system: [{ type: "text", text: "rules", cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [{ type: "text", text: "input", cache_control: { type: "ephemeral" } }] }],
    stream: true,
  };
  const error = "system.0.cache_control: Extra inputs are not permitted";
  expect(extractRejectedParams(error, body)).toEqual(["cache_control"]);
  expect(classifyDegradableError({ statusCode: 400, message: error })).toBe("parameter_rejection_400");
  const queue = buildDegradationAttempts(body, { mandatoryKeys: new Set(["model", "system", "messages", "stream"]) });
  expect(breakpoints(queue.find((attempt) => attempt.label === "probe_drop_cache_control")?.body as Body)).toHaveLength(
    0,
  );
  expect(breakpoints(queue.at(-1)?.body as Body)).toHaveLength(0);
  expect(breakpoints(body)).toHaveLength(2);
});

it("normalizes both streaming cache usage shapes without double counting and retains zero versus unknown", () => {
  for (const provider of ["openrouter", "anthropic"] as const) {
    for (const counts of [{ read: 1200, write: 300 }, { read: 0, write: 0 }, undefined]) {
      const usage =
        provider === "anthropic"
          ? {
              input_tokens: 100,
              output_tokens: 20,
              ...(counts && { cache_read_input_tokens: counts.read, cache_creation_input_tokens: counts.write }),
            }
          : {
              prompt_tokens: 100 + (counts?.read ?? 0) + (counts?.write ?? 0),
              completion_tokens: 20,
              ...(counts && {
                prompt_tokens_details: { cached_tokens: counts.read, cache_write_tokens: counts.write },
              }),
            };
      const adapter = provider === "anthropic" ? new AnthropicStreamAdapter() : new OpenrouterStreamAdapter();
      const processed = adapter.processChunk({
        provider,
        data:
          provider === "anthropic"
            ? { eventType: "message_start", data: { message: { usage } } }
            : { choices: [], usage },
      });
      const normalized = normalizeProviderUsage(processed.metadata);
      expect(normalized?.inputTokens).toBe(100 + (counts?.read ?? 0) + (counts?.write ?? 0));
      expect(normalized?.cacheReadTokens).toBe(counts?.read);
      expect(normalized?.cacheWriteTokens).toBe(counts?.write);
      const total = sumTurnUsage([{ usage: normalized ?? undefined }, { usage: normalized ?? undefined }]);
      expect(total?.cacheReadTokens ?? "unknown").toBe(counts ? counts.read * 2 : "unknown");
      expect(total?.cacheWriteTokens ?? "unknown").toBe(counts ? counts.write * 2 : "unknown");
    }
  }
});

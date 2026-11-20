import { describe, expect, it } from "bun:test";
import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { GoogleStreamAdapter } from "@/providers/google/googleStreamAdapter";
import { buildOpenAICompatibleMessages } from "@/providers/openaiCompatible/openaiCompatibleMessageBuilder";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import { VertexStreamAdapter } from "@/providers/vertex/vertexStreamAdapter";
import type { StreamContext } from "@/types/stream/interfaces";

type ToolHistory = NonNullable<StreamContext["functionInteractionHistory"]>;

function makeHistory(ids: Array<string | undefined>): ToolHistory {
  return ids.map((id, index) => ({
    functionCall: { id, name: "search_web", args: { query: `query ${index}` } },
    functionResponse: { functionResponse: { name: "search_web", response: { result: index } } },
    preToolCallTextParts: [{ type: "text", text: `Searching ${index}` }],
  }));
}

const contextItems = [{ role: "user" as const, parts: [{ type: "text" as const, text: "Search the sources." }] }];
const serializers = [
  {
    name: "OpenAI-compatible",
    prefix: "call",
    serialize: (history: ToolHistory) =>
      buildOpenAICompatibleMessages({
        adapterName: "TestAdapter",
        contextItems,
        currentTurnModelParts: [],
        functionInteractionHistory: history,
      }),
  },
  {
    name: "OpenRouter",
    prefix: "call",
    serialize: (history: ToolHistory) =>
      new OpenrouterStreamAdapter()["assembleOpenrouterContext"](contextItems, [], history),
  },
  {
    name: "Anthropic",
    prefix: "toolu",
    serialize: async (history: ToolHistory) => {
      const { messages } = await new AnthropicStreamAdapter()["assembleAnthropicContext"](contextItems, [], history);
      return messages.map((message) => ({ ...message }));
    },
  },
];

function readIds(messages: Array<Record<string, unknown>>, prefix: string) {
  if (prefix === "toolu") {
    const blocks = messages.flatMap((message) =>
      Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : [],
    );
    return {
      calls: blocks.filter((block) => block.type === "tool_use").map((block) => block.id),
      results: blocks.filter((block) => block.type === "tool_result").map((block) => block.tool_use_id),
    };
  }
  return {
    calls: messages.flatMap((message) =>
      Array.isArray(message.tool_calls)
        ? (message.tool_calls as Array<Record<string, unknown>>).map((call) => call.id)
        : [],
    ),
    results: messages.filter((message) => message.role === "tool").map((message) => message.tool_call_id),
  };
}

for (const { name, prefix, serialize } of serializers) {
  describe(`${name} tool-call history IDs`, () => {
    it("keeps earlier exchanges byte-identical across repeated serialization and later steps", async () => {
      const history = makeHistory(["provider_original", undefined, "provider_next"]);
      const earlierStep = await serialize(history.slice(0, 2));
      const currentStep = await serialize(history);
      const repeatedStep = await serialize(history);

      expect(JSON.stringify(currentStep.slice(0, earlierStep.length))).toBe(JSON.stringify(earlierStep));
      expect(JSON.stringify(repeatedStep)).toBe(JSON.stringify(currentStep));
      const { calls, results } = readIds(currentStep, prefix);
      expect(calls).toEqual(["provider_original", `${prefix}_1`, "provider_next"]);
      expect(results).toEqual(calls);
    });

    it("replaces invalid preserved IDs with stable paired fallbacks", async () => {
      const invalidIds = prefix === "toolu" ? ["", "invalid/provider id", "line\nbreak", "trailing\n"] : [""];
      const history = makeHistory(invalidIds);
      const messages = await serialize(history);
      const { calls, results } = readIds(messages, prefix);

      expect(calls).toEqual(invalidIds.map((_, index) => `${prefix}_${index}`));
      expect(results).toEqual(calls);
      expect(JSON.stringify(await serialize(history))).toBe(JSON.stringify(messages));
    });

    it("keeps IDs unique without changing earlier fallbacks when a later provider ID collides", async () => {
      const history = makeHistory([`${prefix}_1`, undefined, `${prefix}_1`, undefined, `${prefix}_3`]);
      const earlierStep = await serialize(history.slice(0, 4));
      const currentStep = await serialize(history);
      const { calls, results } = readIds(currentStep, prefix);

      expect(calls).toEqual([`${prefix}_1`, `${prefix}_1_1`, `${prefix}_2`, `${prefix}_3`, `${prefix}_4`]);
      expect(results).toEqual(calls);
      expect(new Set(calls).size).toBe(history.length);
      expect(JSON.stringify(currentStep.slice(0, earlierStep.length))).toBe(JSON.stringify(earlierStep));
    });
  });
}

it("preserves opaque OpenAI-style IDs that do not match Anthropic's alphabet", async () => {
  for (const { prefix, serialize } of serializers) {
    if (prefix !== "call") continue;
    const messages = await serialize(makeHistory(["search:0"]));
    const { calls, results } = readIds(messages, prefix);
    expect(calls).toEqual(["search:0"]);
    expect(results).toEqual(calls);
  }
});

for (const Adapter of [GoogleStreamAdapter, VertexStreamAdapter]) {
  it(`${Adapter.name} preserves IDs only when the provider supplies a string`, () => {
    for (const id of [undefined, "provider_original", 42]) {
      const result = new Adapter().processChunk({
        provider: "test",
        metadata: { timestamp: 0 },
        data: { functionCalls: [{ id, name: "search_web", args: { query: "birds" } }] },
      });
      expect(result.type).toBe("function_call");
      expect(result.functionCall?.id).toBe(typeof id === "string" ? id : undefined);
    }
  });
}

it("keeps a missing Anthropic tool ID absent for the history-index fallback", () => {
  const adapter = new AnthropicStreamAdapter();
  adapter.processChunk({
    provider: "anthropic",
    metadata: { timestamp: 0 },
    data: {
      eventType: "content_block_start",
      data: { index: 0, content_block: { type: "tool_use", name: "search_web" } },
    },
  });
  const result = adapter.processChunk({
    provider: "anthropic",
    metadata: { timestamp: 0 },
    data: { eventType: "content_block_stop", data: { index: 0 } },
  });
  expect(result.type).toBe("function_call");
  expect(result.functionCall?.id).toBeUndefined();
});

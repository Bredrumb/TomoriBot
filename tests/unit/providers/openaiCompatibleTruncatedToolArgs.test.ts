import { describe, expect, it } from "bun:test";
import { OpenAICompatibleStreamAdapter } from "@/providers/openaiCompatible/openaiCompatibleStreamAdapter";
import type { ProcessedChunk, RawStreamChunk } from "@/types/stream/interfaces";

function makeAdapter(adapterName = "TestAdapter"): OpenAICompatibleStreamAdapter {
  return new OpenAICompatibleStreamAdapter({
    providerName: "test",
    adapterName,
    localeNamespace: "test",
    errorMessagePrefix: "Test",
    resolveApiUrl: () => "https://example.invalid/v1/chat/completions",
  });
}

function makeChunk(data: Record<string, unknown>): RawStreamChunk {
  return { data, provider: "test", metadata: { timestamp: Date.now() } };
}

function feedArguments(adapter: OpenAICompatibleStreamAdapter, name: string, args: string): ProcessedChunk {
  return adapter.processChunk(
    makeChunk({
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: "call_1", function: { name, arguments: args } }],
          },
        },
      ],
    }),
  );
}

function finishToolCalls(adapter: OpenAICompatibleStreamAdapter): NonNullable<ProcessedChunk["functionCall"]> {
  const processed = adapter.processChunk(makeChunk({ choices: [{ finish_reason: "tool_calls" }] }));
  expect(processed.type).toBe("function_call");
  if (!processed.functionCall) throw new Error("adapter did not produce a function call");
  return processed.functionCall;
}

describe("OpenAICompatibleStreamAdapter truncated tool arguments", () => {
  it("parses complete arguments without marking them truncated", () => {
    const adapter = makeAdapter();
    feedArguments(adapter, "create_thread", '{"thread_name": "Tea break", "first_message": "The kettle is ready."}');

    const functionCall = finishToolCalls(adapter);

    expect(functionCall.args).toEqual({ thread_name: "Tea break", first_message: "The kettle is ready." });
    expect(functionCall.id).toBe("call_1");
    expect(functionCall.argumentsTruncated).toBeUndefined();
  });

  it("keeps the keys that arrived complete when the payload is cut mid-string", () => {
    const adapter = makeAdapter();
    feedArguments(adapter, "create_thread", '{"thread_name": "Tea break", "first_message": "The kettle is ready.');

    const functionCall = finishToolCalls(adapter);

    // The adapter recovers what it can and marks the call, because the recovered keys are
    // a subset of what the model was writing rather than the call it intended to make.
    expect(functionCall.args).toEqual({ thread_name: "Tea break" });
    expect(functionCall.id).toBe("call_1");
    expect(functionCall.argumentsTruncated).toBe(true);
  });

  it("marks the call when the payload is cut before any value finished", () => {
    const adapter = makeAdapter();
    feedArguments(adapter, "create_thread", '{"thread_name": "unfinished');

    const functionCall = finishToolCalls(adapter);

    expect(functionCall.args).toEqual({});
    expect(functionCall.argumentsTruncated).toBe(true);
  });

  it("leaves args empty and unmarked when the payload is malformed rather than truncated", () => {
    const adapter = makeAdapter();
    feedArguments(adapter, "create_thread", '{"thread_name": }');

    const functionCall = finishToolCalls(adapter);

    // A payload that never had a value is not something the repair can recover, so the
    // call falls through to the existing unparsed-arguments path.
    expect(functionCall.args).toEqual({});
    expect(functionCall.argumentsTruncated).toBeUndefined();
  });

  it("accumulates arguments across fragments before repairing", () => {
    const adapter = makeAdapter();
    feedArguments(adapter, "create_", '{"thread_name": "part one", ');
    feedArguments(adapter, "thread", '"first_message": "part two');

    const functionCall = finishToolCalls(adapter);

    expect(functionCall.name).toBe("create_thread");
    expect(functionCall.args).toEqual({ thread_name: "part one" });
    expect(functionCall.argumentsTruncated).toBe(true);
  });

  it("clears the accumulator so the next call is not repaired from stale fragments", () => {
    const adapter = makeAdapter();
    feedArguments(adapter, "create_thread", '{"thread_name": "cut off here');
    expect(finishToolCalls(adapter).argumentsTruncated).toBe(true);

    feedArguments(adapter, "echo_tool", '{"text": "complete"}');
    const functionCall = finishToolCalls(adapter);

    expect(functionCall.name).toBe("echo_tool");
    expect(functionCall.args).toEqual({ text: "complete" });
    expect(functionCall.argumentsTruncated).toBeUndefined();
  });
});

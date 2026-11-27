import { describe, expect, it } from "bun:test";
import { AnthropicStreamAdapter } from "@/providers/anthropic/anthropicStreamAdapter";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import type { ProcessedChunk, RawStreamChunk } from "@/types/stream/interfaces";

function makeChunk(provider: string, data: Record<string, unknown>): RawStreamChunk {
  return { data, provider, metadata: { timestamp: Date.now() } };
}

function makeAnthropicChunk(eventType: string, data: Record<string, unknown>): RawStreamChunk {
  return makeChunk("anthropic", { eventType, data });
}

describe("streamed tool arguments truncated mid-payload", () => {
  it("recovers OpenRouter arguments cut mid-string and marks the call", () => {
    const adapter = new OpenrouterStreamAdapter();
    const withName = adapter.processChunk(
      makeChunk("openrouter", {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", function: { name: "create_thread", arguments: '{"thread_name"' } },
              ],
            },
          },
        ],
      }),
    );
    expect(withName.type).toBe("text");

    const finished = adapter.processChunk(
      makeChunk("openrouter", {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: ': "Tea break", "first_message": "The kettle is ready.',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );

    expect(finished.type).toBe("function_call");
    expect(finished.functionCall?.args).toEqual({ thread_name: "Tea break" });
    expect(finished.functionCall?.id).toBe("call_1");
    expect(finished.functionCall?.argumentsTruncated).toBe(true);
  });

  it("recovers Anthropic arguments cut mid-string and marks the call", () => {
    const adapter = new AnthropicStreamAdapter();
    const open = adapter.processChunk(
      makeAnthropicChunk("content_block_start", {
        index: 0,
        content_block: { type: "tool_use", id: "toolu_1", name: "create_thread" },
      }),
    );
    expect(open.type).toBe("text");

    adapter.processChunk(
      makeAnthropicChunk("content_block_delta", {
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"thread_name": "Tea break", "first_message": "The kettle' },
      }),
    );

    const finished: ProcessedChunk = adapter.processChunk(makeAnthropicChunk("content_block_stop", { index: 0 }));

    expect(finished.type).toBe("function_call");
    expect(finished.functionCall?.args).toEqual({ thread_name: "Tea break" });
    expect(finished.functionCall?.id).toBe("toolu_1");
    expect(finished.functionCall?.argumentsTruncated).toBe(true);
  });

  it("does not mark Anthropic arguments that parsed directly", () => {
    const adapter = new AnthropicStreamAdapter();
    adapter.processChunk(
      makeAnthropicChunk("content_block_start", {
        index: 0,
        content_block: { type: "tool_use", id: "toolu_1", name: "echo_tool" },
      }),
    );
    adapter.processChunk(
      makeAnthropicChunk("content_block_delta", {
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"text": "complete"}' },
      }),
    );

    const finished = adapter.processChunk(makeAnthropicChunk("content_block_stop", { index: 0 }));

    expect(finished.functionCall?.args).toEqual({ text: "complete" });
    expect(finished.functionCall?.id).toBe("toolu_1");
    expect(finished.functionCall?.argumentsTruncated).toBeUndefined();
  });
});

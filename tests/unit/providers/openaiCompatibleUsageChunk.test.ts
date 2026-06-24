import { describe, expect, it } from "bun:test";
import { OpenAICompatibleStreamAdapter } from "@/providers/openaiCompatible/openaiCompatibleStreamAdapter";
import type { RawStreamChunk } from "@/types/stream/interfaces";

/**
 * Minimal adapter options: the usage-extraction path under test touches none of
 * the request-building hooks, so stub resolveApiUrl and the naming fields only.
 */
function makeAdapter(): OpenAICompatibleStreamAdapter {
  return new OpenAICompatibleStreamAdapter({
    providerName: "test",
    adapterName: "TestAdapter",
    localeNamespace: "test",
    errorMessagePrefix: "Test",
    resolveApiUrl: () => "https://example.invalid/v1/chat/completions",
  });
}

function makeChunk(data: Record<string, unknown>): RawStreamChunk {
  return { data, provider: "test", metadata: { timestamp: Date.now() } };
}

describe("OpenAICompatibleStreamAdapter usage capture", () => {
  it("surfaces usage from a trailing chunk that has empty choices (include_usage)", () => {
    // With stream_options.include_usage, the final chunk carries usage but no
    // choices. This previously early-returned and dropped the usage entirely.
    const adapter = makeAdapter();
    const result = adapter.processChunk(
      makeChunk({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 88, total_tokens: 1288 } }),
    );

    expect(result.type).toBe("text");
    expect(result.content).toBe("");
    expect(result.metadata?.usage).toEqual({ prompt_tokens: 1200, completion_tokens: 88, total_tokens: 1288 });
  });

  it("still returns no metadata for an empty-choices chunk without usage", () => {
    const adapter = makeAdapter();
    const result = adapter.processChunk(makeChunk({ choices: [] }));

    expect(result.type).toBe("text");
    expect(result.content).toBe("");
    expect(result.metadata).toBeUndefined();
  });
});

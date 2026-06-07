import { describe, expect, it } from "bun:test";
import { OpenrouterStreamAdapter } from "@/providers/openrouter/openrouterStreamAdapter";
import type { RawStreamChunk } from "@/types/stream/interfaces";

/**
 * Builds a RawStreamChunk wrapping an OpenRouter-shaped data object.
 * chunk.data is typed as unknown so no type assertion is needed in the fixture.
 */
function makeOpenrouterChunk(data: Record<string, unknown>): RawStreamChunk {
  return { data, provider: "openrouter", metadata: { timestamp: Date.now() } };
}

describe("OpenrouterStreamAdapter.processChunk", () => {
  it("preserves visible text from delta.content exactly", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, delta: { content: "Hello, world!" } }],
      }),
    );

    expect(result.type).toBe("text");
    expect(result.content).toBe("Hello, world!");
    expect(result.thoughts).toBeUndefined();
  });

  it("captures delta.reasoning in thoughts and emits empty visible content", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, delta: { reasoning: "internal chain-of-thought" } }],
      }),
    );

    expect(result.type).toBe("text");
    // Reasoning must not surface as visible Discord text
    expect(result.content).toBe("");
    expect(result.thoughts).toBeDefined();
    expect(result.thoughts?.[0]).toMatchObject({ kind: "raw", content: "internal chain-of-thought" });
  });

  it("keeps reasoning in thoughts and visible text in content when both are present", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, delta: { content: "Visible reply.", reasoning: "hidden thought" } }],
      }),
    );

    expect(result.type).toBe("text");
    expect(result.content).toBe("Visible reply.");
    // Reasoning must not be mixed into visible content
    expect(result.content).not.toContain("hidden thought");
    expect(result.thoughts?.[0]).toMatchObject({ kind: "raw", content: "hidden thought" });
  });

  it("maps SSE-injected 429 error to rate_limit, retryable true", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(makeOpenrouterChunk({ error: { code: 429, message: "Rate limit exceeded" } }));

    expect(result.type).toBe("error");
    expect(result.error?.type).toBe("rate_limit");
    expect(result.error?.retryable).toBe(true);
  });

  it("maps SSE-injected 503 error to provider_overloaded, retryable true", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(makeOpenrouterChunk({ error: { code: 503, message: "Service overloaded" } }));

    expect(result.type).toBe("error");
    expect(result.error?.type).toBe("provider_overloaded");
    expect(result.error?.retryable).toBe(true);
  });

  it("maps SSE-injected 401 error to api_error, not retryable", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(makeOpenrouterChunk({ error: { code: 401, message: "Invalid API key" } }));

    expect(result.type).toBe("error");
    expect(result.error?.type).toBe("api_error");
    expect(result.error?.retryable).toBe(false);
  });

  it("passes through a pre-formed ProviderError from error field unchanged", () => {
    const adapter = new OpenrouterStreamAdapter();
    const preFormed = {
      type: "rate_limit",
      message: "quota exceeded",
      retryable: true,
      code: "429",
    };
    const result = adapter.processChunk(makeOpenrouterChunk({ error: preFormed }));

    expect(result.type).toBe("error");
    expect(result.error?.type).toBe("rate_limit");
    expect(result.error?.retryable).toBe(true);
  });

  it("returns empty text for a keepalive chunk with no choices", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(makeOpenrouterChunk({}));

    expect(result.type).toBe("text");
    expect(result.content).toBe("");
  });

  it("returns done for finishReason stop with no delta content", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, finishReason: "stop", delta: {} }],
      }),
    );

    expect(result.type).toBe("done");
  });

  it("returns text containing last fragment for finishReason stop with delta content", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, finishReason: "stop", delta: { content: "final fragment" } }],
      }),
    );

    expect(result.type).toBe("text");
    expect(result.content).toBe("final fragment");
  });

  it("assembles a function_call with correct name and args on finishReason tool_calls", () => {
    // Fresh adapter — accumulator starts empty
    const adapter = new OpenrouterStreamAdapter();

    // Single-chunk tool call: both the delta and the finish reason arrive together
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [
          {
            index: 0,
            finishReason: "tool_calls",
            delta: {
              toolCalls: [
                {
                  index: 0,
                  id: "call_abc",
                  type: "function",
                  function: { name: "search_web", arguments: '{"query":"TomoriBot changelog"}' },
                },
              ],
            },
          },
        ],
      }),
    );

    expect(result.type).toBe("function_call");
    expect(result.functionCall?.name).toBe("search_web");
    expect(result.functionCall?.args).toEqual({ query: "TomoriBot changelog" });
    // Visible content must not leak into a function_call chunk
    expect(result.content).toBeUndefined();
  });

  it("accumulates split tool-call chunks and resolves on the finish chunk", () => {
    const adapter = new OpenrouterStreamAdapter();

    // 1. First chunk: name arrives
    adapter.processChunk(
      makeOpenrouterChunk({
        choices: [
          {
            index: 0,
            delta: {
              toolCalls: [
                { index: 0, id: "call_xyz", type: "function", function: { name: "get_time", arguments: "" } },
              ],
            },
          },
        ],
      }),
    );

    // 2. Second chunk: arguments fragment arrives
    adapter.processChunk(
      makeOpenrouterChunk({
        choices: [
          {
            index: 0,
            delta: { toolCalls: [{ index: 0, function: { arguments: '{"tz":"UTC"}' } }] },
          },
        ],
      }),
    );

    // 3. Terminal chunk: finishReason signals the call is complete
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, finishReason: "tool_calls", delta: {} }],
      }),
    );

    expect(result.type).toBe("function_call");
    expect(result.functionCall?.name).toBe("get_time");
    expect(result.functionCall?.args).toEqual({ tz: "UTC" });
  });

  it("returns done for finishReason error (mid-stream unified error format)", () => {
    const adapter = new OpenrouterStreamAdapter();
    const result = adapter.processChunk(
      makeOpenrouterChunk({
        choices: [{ index: 0, finishReason: "error", delta: {} }],
      }),
    );

    expect(result.type).toBe("error");
    expect(result.error?.retryable).toBe(false);
  });
});

describe("OpenrouterStreamAdapter.handleProviderError", () => {
  it("maps statusCode 429 to rate_limit, retryable true", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = { statusCode: 429, message: "Too Many Requests" };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("rate_limit");
    expect(result.retryable).toBe(true);
  });

  it("maps statusCode 503 to provider_overloaded, retryable true", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = { statusCode: 503, message: "Service Temporarily Unavailable" };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("provider_overloaded");
    expect(result.retryable).toBe(true);
  });

  it("maps statusCode 401 to api_error, not retryable", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = { statusCode: 401, message: "Unauthorized — invalid API key" };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("api_error");
    expect(result.retryable).toBe(false);
  });

  it("maps statusCode 404 to api_error, not retryable", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = { statusCode: 404, message: "Model not found" };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("api_error");
    expect(result.retryable).toBe(false);
  });

  it("extracts error code from body JSON when statusCode is absent", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = {
      body: JSON.stringify({ error: { code: 429, message: "Rate limit hit" } }),
      message: "Request failed",
    };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("rate_limit");
    expect(result.retryable).toBe(true);
  });

  it("extracts error code from nested error.code field", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = { error: { code: 503, message: "Server overloaded" }, message: "OpenRouter error" };
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("provider_overloaded");
    expect(result.retryable).toBe(true);
  });

  it("returns a fully-formed ProviderError with required fields", () => {
    const adapter = new OpenrouterStreamAdapter();
    const error = new Error("Unexpected network failure");
    const result = adapter.handleProviderError(error);

    expect(typeof result.type).toBe("string");
    expect(typeof result.message).toBe("string");
    expect(typeof result.retryable).toBe("boolean");
    expect(result.originalError).toBe(error);
  });
});

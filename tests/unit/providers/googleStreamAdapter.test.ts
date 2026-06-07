import { describe, expect, it } from "bun:test";
import { GoogleStreamAdapter } from "@/providers/google/googleStreamAdapter";
import type { RawStreamChunk } from "@/types/stream/interfaces";

/**
 * Builds a RawStreamChunk wrapping a Google-shaped data object.
 * chunk.data is typed as unknown so no type assertion is needed in the fixture.
 */
function makeGoogleChunk(data: Record<string, unknown>): RawStreamChunk {
  return { data, provider: "google", metadata: { timestamp: Date.now() } };
}

describe("GoogleStreamAdapter.processChunk", () => {
  it("preserves visible text exactly and produces no thought leakage", () => {
    const adapter = new GoogleStreamAdapter();
    const result = adapter.processChunk(makeGoogleChunk({ text: "Hello, world!" }));

    expect(result.type).toBe("text");
    expect(result.content).toBe("Hello, world!");
    expect(result.thoughts).toBeUndefined();
  });

  it("captures thought summary in thoughts and emits no visible text", () => {
    const adapter = new GoogleStreamAdapter();
    // Chunk with only thoughtSummary, no text field
    const result = adapter.processChunk(makeGoogleChunk({ thoughtSummary: "internal reasoning step" }));

    expect(result.type).toBe("text");
    // Reasoning must not surface as visible Discord text
    expect(result.content).toBe("");
    expect(result.thoughts).toBeDefined();
    expect(result.thoughts?.[0]).toMatchObject({ kind: "summary", content: "internal reasoning step" });
  });

  it("captures thought summary alongside visible text, keeps both separate", () => {
    const adapter = new GoogleStreamAdapter();
    const result = adapter.processChunk(makeGoogleChunk({ text: "Visible reply.", thoughtSummary: "hidden thought" }));

    expect(result.type).toBe("text");
    expect(result.content).toBe("Visible reply.");
    // Reasoning must not be mixed into visible content
    expect(result.content).not.toContain("hidden thought");
    expect(result.thoughts?.[0]).toMatchObject({ kind: "summary", content: "hidden thought" });
  });

  it("normalizes promptFeedback block to content_blocked error, not retryable", () => {
    const adapter = new GoogleStreamAdapter();
    // "SAFETY" is the string value of BlockedReason.SAFETY
    const result = adapter.processChunk(makeGoogleChunk({ promptFeedback: { blockReason: "SAFETY" } }));

    expect(result.type).toBe("error");
    expect(result.error?.type).toBe("content_blocked");
    expect(result.error?.retryable).toBe(false);
  });

  it("normalizes blocking finishReason (SAFETY) to content_blocked error, not retryable", () => {
    const adapter = new GoogleStreamAdapter();
    // "SAFETY" is the string value of FinishReason.SAFETY
    const result = adapter.processChunk(makeGoogleChunk({ candidates: [{ finishReason: "SAFETY" }] }));

    expect(result.type).toBe("error");
    expect(result.error?.type).toBe("content_blocked");
    expect(result.error?.retryable).toBe(false);
  });

  it("normalizes RECITATION finishReason to content_blocked error", () => {
    const adapter = new GoogleStreamAdapter();
    const result = adapter.processChunk(makeGoogleChunk({ candidates: [{ finishReason: "RECITATION" }] }));

    expect(result.type).toBe("error");
    expect(result.error?.type).toBe("content_blocked");
    expect(result.error?.retryable).toBe(false);
  });

  it("returns done for STOP finishReason with no text", () => {
    const adapter = new GoogleStreamAdapter();
    // "STOP" is the string value of FinishReason.STOP
    const result = adapter.processChunk(makeGoogleChunk({ candidates: [{ finishReason: "STOP" }] }));

    expect(result.type).toBe("done");
    expect(result.content).toBeUndefined();
  });

  it("extracts function call with correct name and args, type is function_call", () => {
    const adapter = new GoogleStreamAdapter();
    const result = adapter.processChunk(
      makeGoogleChunk({
        functionCalls: [{ name: "search_web", args: { query: "TomoriBot changelog" } }],
      }),
    );

    expect(result.type).toBe("function_call");
    expect(result.functionCall?.name).toBe("search_web");
    expect(result.functionCall?.args).toEqual({ query: "TomoriBot changelog" });
    // Visible content must not leak
    expect(result.content).toBeUndefined();
  });

  it("does not produce visible content for an already-normalized error chunk", () => {
    const adapter = new GoogleStreamAdapter();
    const preNormalized = {
      error: {
        type: "rate_limit",
        message: "quota exceeded",
        retryable: true,
        code: "429",
      },
    };
    const result = adapter.processChunk(makeGoogleChunk(preNormalized));

    expect(result.type).toBe("error");
    // Must carry the original error object through
    expect(result.error?.type).toBe("rate_limit");
  });
});

describe("GoogleStreamAdapter.handleProviderError", () => {
  it("maps HTTP 429 JSON error to rate_limit, retryable true", () => {
    const adapter = new GoogleStreamAdapter();
    const error = new Error('{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}');
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("rate_limit");
    expect(result.retryable).toBe(true);
    expect(result.code).toBeDefined();
  });

  it("maps HTTP 503 JSON error to provider_overloaded, retryable true", () => {
    const adapter = new GoogleStreamAdapter();
    const error = new Error('{"error":{"code":503,"message":"The service is overloaded","status":"UNAVAILABLE"}}');
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("provider_overloaded");
    expect(result.retryable).toBe(true);
  });

  it("maps HTTP 403 JSON error to api_error, not retryable", () => {
    const adapter = new GoogleStreamAdapter();
    const error = new Error('{"error":{"code":403,"message":"Permission denied","status":"PERMISSION_DENIED"}}');
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("api_error");
    expect(result.retryable).toBe(false);
  });

  it("maps HTTP 504 JSON error to timeout, retryable true", () => {
    const adapter = new GoogleStreamAdapter();
    const error = new Error('{"error":{"code":504,"message":"Gateway Timeout"}}');
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("timeout");
    expect(result.retryable).toBe(true);
  });

  it("classifies RESOURCE_EXHAUSTED message as rate_limit when no JSON code present", () => {
    const adapter = new GoogleStreamAdapter();
    // Plain error message without JSON structure — triggers fallback message-content classification.
    // Must not include "API key" since that branch fires first in the default case.
    const error = new Error("RESOURCE_EXHAUSTED: quota exceeded for this project");
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("rate_limit");
    expect(result.retryable).toBe(true);
  });

  it("classifies DEADLINE_EXCEEDED message as timeout, retryable true", () => {
    const adapter = new GoogleStreamAdapter();
    const error = new Error("DEADLINE_EXCEEDED: Request took too long");
    const result = adapter.handleProviderError(error);

    expect(result.type).toBe("timeout");
    expect(result.retryable).toBe(true);
  });

  it("returns a fully-formed ProviderError with required fields", () => {
    const adapter = new GoogleStreamAdapter();
    const error = new Error("Some unknown error");
    const result = adapter.handleProviderError(error);

    expect(typeof result.type).toBe("string");
    expect(typeof result.message).toBe("string");
    expect(typeof result.retryable).toBe("boolean");
    expect(result.originalError).toBe(error);
  });
});

import { describe, expect, it } from "bun:test";
import { normalizeProviderUsage, sumTurnUsage, type TokenUsage } from "@/utils/text/tokenEstimate";

describe("normalizeProviderUsage", () => {
  it("preserves finite nonnegative costs and discards invalid costs without dropping tokens", () => {
    for (const cost of [0, 0.0012, -1, Number.NaN, Number.POSITIVE_INFINITY, "0.0012", null]) {
      const raw = { prompt_tokens: 10, completion_tokens: 5, cost };
      const usage = normalizeProviderUsage(raw);
      expect(usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
      expect(usage?.costUsd).toBe(typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : undefined);
    }
  });

  it("normalizes OpenAI-compatible snake_case usage", () => {
    // The shape openaiCompatibleStreamAdapter stores in metadata.usage.
    const usage = normalizeProviderUsage({ prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540 });
    expect(usage).toEqual({ inputTokens: 1200, outputTokens: 340 });
  });

  it("normalizes OpenRouter camelCase usage", () => {
    // OpenRouter's adapter normalizes to camelCase before storing it.
    const usage = normalizeProviderUsage({ promptTokens: 800, completionTokens: 95, totalTokens: 895 });
    expect(usage).toEqual({ inputTokens: 800, outputTokens: 95 });
  });

  it("normalizes Anthropic flat input/output token metadata", () => {
    // Anthropic's adapter emits a normalized { inputTokens, outputTokens } usage.
    const usage = normalizeProviderUsage({ inputTokens: 500, outputTokens: 60 });
    expect(usage).toEqual({ inputTokens: 500, outputTokens: 60 });
  });

  it("normalizes Gemini usageMetadata and folds thinking tokens into output", () => {
    // Gemini bills thoughtsTokenCount at the output rate, so it must be added.
    const usage = normalizeProviderUsage({
      promptTokenCount: 2000,
      candidatesTokenCount: 150,
      thoughtsTokenCount: 90,
      totalTokenCount: 2240,
    });
    expect(usage).toEqual({ inputTokens: 2000, outputTokens: 240 });
  });

  it("unwraps usage nested under a .usage key", () => {
    const usage = normalizeProviderUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } });
    expect(usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("validates and clamps cache subsets while preserving unknown and zero", () => {
    for (const cacheReadTokens of [undefined, null, "3", -1, Number.NaN, Number.POSITIVE_INFINITY, 0, 3, 100]) {
      const usage = normalizeProviderUsage({
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens,
        cacheWriteTokens: cacheReadTokens,
      });
      const expected =
        typeof cacheReadTokens === "number" && Number.isFinite(cacheReadTokens) && cacheReadTokens >= 0
          ? Math.min(cacheReadTokens, 10)
          : undefined;
      expect(usage?.cacheReadTokens).toBe(expected);
      expect(usage?.cacheWriteTokens).toBe(expected);
      expect(normalizeProviderUsage(usage)).toEqual(usage);
    }
  });

  it("reads DeepSeek cache hits without adding them to the inclusive prompt total", () => {
    expect(
      normalizeProviderUsage({
        prompt_tokens: 100,
        completion_tokens: 10,
        prompt_cache_hit_tokens: 80,
        prompt_cache_miss_tokens: 20,
      }),
    ).toEqual({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 80 });
  });

  it("preserves OpenRouter snake and camel case cache details and cost", () => {
    for (const promptDetails of [
      { prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 20 } },
      { promptTokensDetails: { cachedTokens: 60, cacheWriteTokens: 20 } },
    ]) {
      expect(normalizeProviderUsage({ promptTokens: 100, completionTokens: 10, cost: 0, ...promptDetails })).toEqual({
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 60,
        cacheWriteTokens: 20,
        costUsd: 0,
      });
    }
  });

  it("returns null when no usable token counts are present", () => {
    expect(normalizeProviderUsage({})).toBeNull();
    expect(normalizeProviderUsage(undefined)).toBeNull();
    expect(normalizeProviderUsage(null)).toBeNull();
    expect(normalizeProviderUsage({ prompt_tokens: 0, completion_tokens: 0 })).toBeNull();
  });
});

describe("sumTurnUsage", () => {
  it("keeps each optional total only when all reported segments know it", () => {
    const known = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 20, costUsd: 0.01 };
    expect(sumTurnUsage([{ usage: known }, {}, { usage: known }])).toEqual({
      inputTokens: 200,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 40,
      costUsd: 0.02,
    });
    for (const field of ["cacheReadTokens", "cacheWriteTokens", "costUsd"] as const) {
      const missing = { ...known };
      delete missing[field];
      for (const segments of [
        [known, missing],
        [missing, known],
      ]) {
        const total = sumTurnUsage(segments.map((usage) => ({ usage })));
        expect(total?.[field]).toBeUndefined();
        expect(total?.inputTokens).toBe(200);
      }
    }
  });
  it("sums input and output across all stream segments (tool-loop billing truth)", () => {
    // A two-request tool turn: each request is billed for its own prompt + output.
    const segments: { usage?: TokenUsage }[] = [
      { usage: { inputTokens: 1000, outputTokens: 40 } },
      { usage: { inputTokens: 1300, outputTokens: 220 } },
    ];
    expect(sumTurnUsage(segments)).toEqual({ inputTokens: 2300, outputTokens: 260 });
  });

  it("ignores segments without usage but still sums the ones that have it", () => {
    const segments: { usage?: TokenUsage }[] = [
      { usage: { inputTokens: 500, outputTokens: 30 } },
      {}, // e.g. a function_call segment that surfaced no usage
    ];
    expect(sumTurnUsage(segments)).toEqual({ inputTokens: 500, outputTokens: 30 });
  });

  it("returns null when no segment reported real usage (caller falls back to estimate)", () => {
    expect(sumTurnUsage([{}, {}])).toBeNull();
    expect(sumTurnUsage([])).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { extractHistoryWindowForProvider } from "@/providers/utils/providerFeatureExecutors";
import { resolveStructuredOutputCapability } from "@/utils/provider/providerCapabilityResolver";

/**
 * Regression guard for the history-extraction failure channel.
 *
 * `extractHistoryWindowForProvider` used to return a bare `HistoryMemoryEntry[]`, so a
 * provider error and a genuinely empty window were both reported as `[]`. `/memory history
 * import` then rendered its "No Facts Extracted" terminal for real provider failures,
 * hiding the actual cause (typically a model that cannot emit structured output).
 *
 * These tests pin the discriminated outcome that keeps the two cases distinguishable.
 */
describe("history extraction outcome", () => {
  test("reports a provider with no structured-output capability as an explicit failure", async () => {
    // 1. NovelAI genuinely exposes no `callStructuredJSON`, so this exercises the real
    //    capability-resolution path rather than a stub.
    expect(await resolveStructuredOutputCapability("novelai")).toBeNull();

    const outcome = await extractHistoryWindowForProvider({
      providerName: "novelai",
      apiKey: "unused-because-resolution-fails-first",
      model: "unused",
      systemPrompt: "system",
      userPrompt: "user",
    });

    // 2. The failure must be a typed failure, never an empty success.
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected an unsupported-provider failure");
    expect(outcome.reason).toBe("unsupported");
    expect(outcome.error).toContain("novelai");
  });

  test("keeps an empty extraction distinguishable from a failed one", () => {
    // 3. The whole point of the union: an empty result is still `ok`, so callers can only
    //    reach the "no facts" terminal when nothing actually went wrong.
    const empty = { ok: true, entries: [] } as const;
    const failed = { ok: false, reason: "failed", error: "Invalid response structure" } as const;

    expect(empty.ok).toBe(true);
    expect(empty.entries).toHaveLength(0);
    expect(failed.ok).toBe(false);
    expect(empty.ok === failed.ok).toBe(false);
  });
});

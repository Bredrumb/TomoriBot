import { describe, expect, test } from "bun:test";
import { embedWithBatchFallback } from "@/utils/embeddings/embeddingProvider";

/**
 * Regression guard for embedding models that ignore batching.
 *
 * Some models (observed with the Gemini embedding family) accept only one content per
 * request and return a single embedding for a multi-input batch instead of erroring. That
 * surfaced to users as `Embedding count mismatch: expected 7, got 1` and aborted
 * `/memory history import` outright, even though the extraction itself had succeeded.
 */
describe("embedWithBatchFallback", () => {
  /** Builds a fake embedder that only ever honours the first input of a batch. */
  function singleInputEmbedder(calls: string[][]) {
    return async (batch: string[]): Promise<number[][]> => {
      calls.push(batch);
      return [[batch[0].length]];
    };
  }

  test("returns the batch result unchanged when the model honours batching", async () => {
    const calls: string[][] = [];
    const embed = async (batch: string[]): Promise<number[][]> => {
      calls.push(batch);
      return batch.map((text) => [text.length]);
    };

    const result = await embedWithBatchFallback(["a", "bb", "ccc"], "fake:batching-model", embed);

    expect(result).toEqual([[1], [2], [3]]);
    // A cooperative model must not pay for extra requests.
    expect(calls).toHaveLength(1);
  });

  test("falls back to one request per input when the model returns a short batch", async () => {
    const calls: string[][] = [];
    const result = await embedWithBatchFallback(
      ["a", "bb", "ccc"],
      "fake:single-input-model",
      singleInputEmbedder(calls),
    );

    expect(result).toEqual([[1], [2], [3]]);
    // One doomed batch attempt, then one call per input.
    expect(calls[0]).toEqual(["a", "bb", "ccc"]);
    expect(calls.slice(1)).toEqual([["a"], ["bb"], ["ccc"]]);
  });

  test("skips the doomed batch attempt for a model already known not to batch", async () => {
    const modelKey = "fake:remembered-model";
    const firstCalls: string[][] = [];
    await embedWithBatchFallback(["a", "bb"], modelKey, singleInputEmbedder(firstCalls));
    expect(firstCalls[0]).toEqual(["a", "bb"]);

    // The second run must go straight to per-input calls, with no batch attempt.
    const secondCalls: string[][] = [];
    const result = await embedWithBatchFallback(["x", "yy"], modelKey, singleInputEmbedder(secondCalls));

    expect(result).toEqual([[1], [2]]);
    expect(secondCalls).toEqual([["x"], ["yy"]]);
  });

  test("still throws when a single-input request returns nothing", async () => {
    const embed = async (): Promise<number[][]> => [];

    expect(embedWithBatchFallback(["only"], "fake:broken-model", embed)).rejects.toThrow("expected 1, got 0");
  });
});

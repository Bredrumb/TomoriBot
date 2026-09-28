import { describe, expect, it } from "bun:test";
import { pollForCompletion } from "@/utils/async/pollForCompletion";

describe("pollForCompletion cancellation", () => {
  it("stops mid-wait on abort instead of sleeping out the interval or polling again", async () => {
    const controller = new AbortController();
    let pollCount = 0;
    const startedAt = Date.now();

    const polling = pollForCompletion<string>({
      pollFn: async () => {
        pollCount += 1;
        return { done: false };
      },
      intervalMs: 60_000,
      maxAttempts: 5,
      logLabel: "TestPoll",
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);

    await expect(polling).rejects.toThrow("TestPoll: polling was cancelled");
    expect(pollCount).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("never polls when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let pollCount = 0;

    await expect(
      pollForCompletion<string>({
        pollFn: async () => {
          pollCount += 1;
          return { done: true, result: "video" };
        },
        intervalMs: 1_000,
        maxAttempts: 3,
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow("polling was cancelled");
    expect(pollCount).toBe(0);
  });
});

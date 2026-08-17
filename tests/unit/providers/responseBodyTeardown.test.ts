import { Glob } from "bun";
import { describe, expect, it } from "bun:test";
import { streamOpenAICompatibleSseChunks } from "@/providers/openaiCompatible/openaiCompatibleSse";

/**
 * Builds an SSE response whose underlying source reports whether it was cancelled.
 *
 * @param close - Leave false to model a server that has not ended the body yet, which is the
 *   state every abandoned stream is really in.
 */
function sseResponse(payloads: string[], close: boolean): { response: Response; wasCancelled: () => boolean } {
  let cancelled = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(payload));
      }
      if (close) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  return { response: new Response(stream), wasCancelled: () => cancelled };
}

describe("SSE consumer releases abandoned response bodies", () => {
  it("cancels the body when the consumer stops iterating early", async () => {
    const { response, wasCancelled } = sseResponse(['data: {"id":"a"}\n\n'], false);

    for await (const _chunk of streamOpenAICompatibleSseChunks(response)) {
      break;
    }

    expect(wasCancelled()).toBe(true);
  });

  it("leaves a stream that ended on its own alone", async () => {
    const { response, wasCancelled } = sseResponse(['data: {"id":"a"}\n\n'], true);

    const chunks = [];
    for await (const chunk of streamOpenAICompatibleSseChunks(response)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(wasCancelled()).toBe(false);
  });
});

/**
 * `releaseLock` reads like teardown but only detaches the reader: the body stays open and holds its
 * buffers and connection. Four adapters shipped that way and retained one stream source per
 * abandoned request, which only surfaced through a production heap diff. The streaming adapters need
 * live provider responses to drive end to end, so this asserts the invariant at the source level
 * instead of leaving those paths uncovered.
 */
describe("every response body reader has a cancelling teardown", () => {
  it("has no getReader site that relies on releaseLock alone", async () => {
    const offenders: string[] = [];

    for await (const file of new Glob("src/**/*.ts").scan(".")) {
      const source = await Bun.file(file).text();
      if (!source.includes(".getReader()")) continue;
      if (!source.includes("reader.cancel()")) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});

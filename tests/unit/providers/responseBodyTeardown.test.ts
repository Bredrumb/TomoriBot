import { Glob } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import { streamOpenAICompatibleSseChunks } from "@/providers/openaiCompatible/openaiCompatibleSse";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

// This source scan exists because novelaiService and safeHttpFetchEngine only reach their readers behind live
// responses or the SSRF gate, leaving no unit hook.
describe("no response body reader relies on releaseLock alone", () => {
  it("pairs every file that reads a response body with a cancel call", async () => {
    const offenders: string[] = [];

    for await (const file of new Glob("src/**/*.ts").scan(".")) {
      const source = await Bun.file(file).text();
      // Matches the BYOB form too, and does not assume the reader is named `reader`.
      if (!source.includes(".getReader(")) continue;
      if (!source.includes(".cancel(")) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});

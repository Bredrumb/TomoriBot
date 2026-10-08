import { afterAll, describe, expect, it } from "bun:test";
import { crawl4aiCrawlWithCookies, crawl4aiMarkdown } from "@/tools/restAPIs/crawl4ai/crawl4aiService";
import type { Crawl4aiMarkdownRequest } from "@/tools/restAPIs/crawl4ai/types";
import { FETCH_LIMITS } from "@/utils/security/rateLimiter";

const MIB = 1024 * 1024;
const request: Crawl4aiMarkdownRequest = { url: "https://example.com/", f: "fit" };

let route: (path: string) => Response = () => new Response("unset", { status: 500 });
const crawler = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (incoming) => route(new URL(incoming.url).pathname),
});
const config = { baseUrl: `http://127.0.0.1:${crawler.port}`, timeoutMs: 10_000 };

afterAll(() => {
  crawler.stop(true);
});

/** A chunked body with no content-length, counting how much the server had to produce. */
function endlessBody(totalBytes: number, counter: { produced: number }): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      counter.produced += 256 * 1024;
      controller.enqueue(new Uint8Array(256 * 1024).fill(0x61));
      if (counter.produced >= totalBytes) controller.close();
    },
  });
}

describe("Crawl4AI response handling", () => {
  it("accepts a well-formed /md response", async () => {
    route = () =>
      Response.json({ url: request.url, filter: "fit", query: null, cache: "0", markdown: "# Page", success: true });

    const result = await crawl4aiMarkdown(request, config);

    expect(result.success).toBe(true);
    expect(result.data?.markdown).toBe("# Page");
  });

  it("stops reading an oversized /md body that has no content-length", async () => {
    const counter = { produced: 0 };
    const totalBytes = (FETCH_LIMITS.MAX_FETCH_SIZE_MB + 16) * MIB;
    route = () => new Response(endlessBody(totalBytes, counter), { headers: { "content-type": "application/json" } });

    const result = await crawl4aiMarkdown(request, config);

    expect(result.success).toBe(false);
    expect(counter.produced).toBeLessThan(totalBytes);
  });

  it("refuses malformed JSON and unexpected shapes from either endpoint", async () => {
    const bodies = [
      () => new Response("{not json"),
      () => Response.json({ url: request.url, filter: "fit", markdown: 42, success: true }),
      () => Response.json({ url: request.url, filter: "unknown", markdown: "x", success: true }),
      () => Response.json(["not", "an", "object"]),
      () => Response.json({ success: true, results: "nope" }),
      () =>
        Response.json({ success: true, results: [{ url: request.url, success: true, markdown: { raw_markdown: 7 } }] }),
    ];
    const accepted: number[] = [];
    for (const [index, body] of bodies.entries()) {
      route = body;
      const viaMd = await crawl4aiMarkdown(request, config);
      const viaCrawl = await crawl4aiCrawlWithCookies(request, [{ name: "session", value: "fixture" }], config);
      if (viaMd.success || viaCrawl.success) accepted.push(index);
    }

    expect(accepted).toEqual([]);
  });

  it("bounds an oversized error body and still reports the status", async () => {
    const counter = { produced: 0 };
    route = () => new Response(endlessBody(64 * MIB, counter), { status: 500 });

    const result = await crawl4aiMarkdown(request, config);

    expect(result).toMatchObject({ success: false, statusCode: 500 });
    expect(counter.produced).toBeLessThan(64 * MIB);
  });
});

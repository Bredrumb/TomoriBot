import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";

// pkApi.ts reads PLURALKIT_LOOKUP_TIMEOUT_MS at module-load time, so this must
// be set before the module is first evaluated. The dynamic import in
// beforeAll (rather than a static top-level import) guarantees that ordering.
// 2000ms leaves enough room for the real ~800ms first-retry backoff to play
// out at least once without the remaining-budget cap swallowing the retry.
const originalLookupTimeoutMs = process.env.PLURALKIT_LOOKUP_TIMEOUT_MS;
process.env.PLURALKIT_LOOKUP_TIMEOUT_MS = "2000";

// Set at module scope, so it can only be undone once every test here has run.
afterAll(() => {
  if (originalLookupTimeoutMs === undefined) delete process.env.PLURALKIT_LOOKUP_TIMEOUT_MS;
  else process.env.PLURALKIT_LOOKUP_TIMEOUT_MS = originalLookupTimeoutMs;
});

let fetchMessage: typeof import("@/utils/pluralkit/pkApi").fetchMessage;

beforeAll(async () => {
  ({ fetchMessage } = await import("@/utils/pluralkit/pkApi"));
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("pkApi.fetchMessage", () => {
  it("resolves a successful lookup and normalizes fields", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, {
        original: "111",
        sender: "222",
        system: { id: "abcdef", uuid: "sys-uuid", name: "Lighthouse", tag: "[LH]" },
        member: { id: "ghijkl", uuid: "mem-uuid", name: "TestA", display_name: "Test A" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchMessage("msg-success-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      original: "111",
      sender: "222",
      system: { id: "abcdef", uuid: "sys-uuid", name: "Lighthouse", tag: "[LH]" },
      member: { id: "ghijkl", uuid: "mem-uuid", name: "TestA", display_name: "Test A" },
    });
  });

  it("treats a deleted member as no identity claim", async () => {
    const fetchMock = mock(async () => jsonResponse(200, { original: "333", sender: "444" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchMessage("msg-deleted-member");

    expect(result?.system).toBeNull();
    expect(result?.member).toBeNull();
    expect(result?.sender).toBe("444");
  });

  it("retries a 404 (PK indexing lag) and succeeds once the message appears", async () => {
    let calls = 0;
    const fetchMock = mock(async () => {
      calls++;
      if (calls === 1) return jsonResponse(404, {});
      return jsonResponse(200, { original: "555", sender: "666", system: null, member: null });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchMessage("msg-retry-404");

    expect(calls).toBe(2);
    expect(result?.sender).toBe("666");
  });

  it("honors a sane Retry-After header on 429 before succeeding", async () => {
    let calls = 0;
    const fetchMock = mock(async () => {
      calls++;
      if (calls === 1) return jsonResponse(429, {}, { "Retry-After": "0.05" });
      return jsonResponse(200, { original: "777", sender: "888", system: null, member: null });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const start = Date.now();
    const result = await fetchMessage("msg-retry-429");

    expect(calls).toBe(2);
    expect(result?.sender).toBe("888");
    // Honored the 50ms header, not the ~800ms first backoff step
    expect(Date.now() - start).toBeLessThan(700);
  });

  it("ignores PK's buggy Retry-After: 0 on 429 and falls back to the backoff schedule", async () => {
    let calls = 0;
    const fetchMock = mock(async () => {
      calls++;
      if (calls === 1) return jsonResponse(429, {}, { "Retry-After": "0" });
      return jsonResponse(200, { original: "777", sender: "888", system: null, member: null });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const start = Date.now();
    const result = await fetchMessage("msg-retry-429-zero");

    expect(calls).toBe(2);
    expect(result?.sender).toBe("888");
    // A zero header must NOT mean an instant retry against a rate-limited
    // endpoint; the ~800ms first backoff step applies instead. PluralKit's
    // rate limiter is known to send 0 accidentally.
    expect(Date.now() - start).toBeGreaterThanOrEqual(750);
  });

  it("gives up once the retry budget is exhausted and returns null", async () => {
    const fetchMock = mock(async () => jsonResponse(404, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchMessage("msg-exhausted");

    expect(result).toBeNull();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
  });

  it("does not permanently cache a failed lookup — a later call can still succeed", async () => {
    const failingFetch = mock(async () => jsonResponse(404, {}));
    globalThis.fetch = failingFetch as unknown as typeof fetch;

    const firstResult = await fetchMessage("msg-recovers");
    expect(firstResult).toBeNull();

    const succeedingFetch = mock(async () =>
      jsonResponse(200, { original: "999", sender: "aaa", system: null, member: null }),
    );
    globalThis.fetch = succeedingFetch as unknown as typeof fetch;

    const secondResult = await fetchMessage("msg-recovers");
    expect(secondResult?.sender).toBe("aaa");
    expect(succeedingFetch).toHaveBeenCalledTimes(1);
  });

  it("caches a successful lookup permanently — a later call never refetches", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, { original: "bbb", sender: "ccc", system: null, member: null }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await fetchMessage("msg-cached");
    const second = await fetchMessage("msg-cached");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it("single-flights concurrent lookups for the same message ID", async () => {
    let resolveResponse: (value: Response) => void = () => {};
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = mock(async () => responsePromise);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = fetchMessage("msg-concurrent");
    const second = fetchMessage("msg-concurrent");

    resolveResponse(jsonResponse(200, { original: "ddd", sender: "eee", system: null, member: null }));

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
  });
});

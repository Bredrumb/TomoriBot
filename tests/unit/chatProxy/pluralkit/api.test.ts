import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";

const originalLookupTimeoutMs = process.env.PLURALKIT_LOOKUP_TIMEOUT_MS;
const originalApiToken = process.env.PLURALKIT_API_TOKEN;
process.env.PLURALKIT_LOOKUP_TIMEOUT_MS = "2000";

// Set at module scope, so it can only be undone once every test here has run.
afterAll(() => {
  if (originalLookupTimeoutMs === undefined) delete process.env.PLURALKIT_LOOKUP_TIMEOUT_MS;
  else process.env.PLURALKIT_LOOKUP_TIMEOUT_MS = originalLookupTimeoutMs;
  if (originalApiToken === undefined) delete process.env.PLURALKIT_API_TOKEN;
  else process.env.PLURALKIT_API_TOKEN = originalApiToken;
});

let fetchMessage: typeof import("@/utils/chatProxy/services/pluralkit/api").fetchMessage;
let getCachedMessageLookup: typeof import("@/utils/chatProxy/services/pluralkit/api").getCachedMessageLookup;
let clearPluralKitApiStateForTests: typeof import("@/utils/chatProxy/services/pluralkit/api").clearPluralKitApiStateForTests;

beforeAll(async () => {
  ({ fetchMessage, getCachedMessageLookup, clearPluralKitApiStateForTests } = await import(
    "@/utils/chatProxy/services/pluralkit/api"
  ));
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearPluralKitApiStateForTests();
  if (originalApiToken === undefined) delete process.env.PLURALKIT_API_TOKEN;
  else process.env.PLURALKIT_API_TOKEN = originalApiToken;
});

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

// Two cases below exhaust the real retry budget rather than faking timers, so they need
// headroom over the 5s per-test default.
const RETRY_EXHAUSTION_TIMEOUT_MS = 20_000;

describe("pkApi.fetchMessage", () => {
  it("resolves a successful lookup and normalizes fields", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, {
        original: "111",
        sender: "222",
        system: { id: "abcdef", uuid: "11111111-2222-4333-8444-555555555555", name: "Lighthouse", tag: "[LH]" },
        member: { id: "ghijkl", uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "TestA", display_name: "Test A" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchMessage("msg-success-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      original: "111",
      sender: "222",
      system: { id: "abcdef", uuid: "11111111-2222-4333-8444-555555555555", name: "Lighthouse", tag: "[LH]" },
      member: { id: "ghijkl", uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "TestA", display_name: "Test A" },
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

  it("accepts private optional fields without inventing values", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, {
        original: "private-original",
        sender: "private-sender",
        system: {
          id: "abcdef",
          uuid: "11111111-2222-4333-8444-555555555555",
        },
        member: {
          id: "ghijkl",
          uuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          name: "Sparrow",
        },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchMessage("msg-private-fields");

    expect(result?.system?.name).toBeUndefined();
    expect(result?.system?.description).toBeUndefined();
    expect(result?.member?.display_name).toBeUndefined();
  });

  it("fails closed on structurally invalid successful payloads", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, {
        original: "invalid-original",
        sender: "invalid-sender",
        system: { id: "abcdef", uuid: "not-a-uuid" },
        member: null,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await fetchMessage("msg-invalid-payload")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends the configured token verbatim and omits an empty token", async () => {
    const fetchMock = mock(async () => jsonResponse(200, { sender: "token-sender", system: null, member: null }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    process.env.PLURALKIT_API_TOKEN = "fixture-token";
    await fetchMessage("msg-token-present");
    process.env.PLURALKIT_API_TOKEN = "";
    await fetchMessage("msg-token-absent");

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).toEqual({
      Authorization: "fixture-token",
    });
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.headers).toEqual({});
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

  it("falls back to backoff for malformed Retry-After values", async () => {
    let calls = 0;
    const fetchMock = mock(async () => {
      calls++;
      if (calls === 1) return jsonResponse(429, {}, { "Retry-After": "later" });
      return jsonResponse(200, { original: "777", sender: "888", system: null, member: null });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const start = Date.now();
    const result = await fetchMessage("msg-retry-429-malformed");

    expect(calls).toBe(2);
    expect(result?.sender).toBe("888");
    expect(Date.now() - start).toBeGreaterThanOrEqual(750);
  });

  it(
    "gives up once the retry budget is exhausted and returns null",
    async () => {
      const fetchMock = mock(async () => jsonResponse(404, {}));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await fetchMessage("msg-exhausted");

      expect(result).toBeNull();
      expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
      // Real backoff sleeps dominate this test, putting it near the 5s default and
      // flaking whenever the shared lane runs under load.
    },
    RETRY_EXHAUSTION_TIMEOUT_MS,
  );

  it(
    "does not permanently cache a failed lookup — a later call can still succeed",
    async () => {
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
    },
    RETRY_EXHAUSTION_TIMEOUT_MS,
  );

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

  it("serves context cache reads without making another API call", async () => {
    const fetchMock = mock(async () =>
      jsonResponse(200, { original: "cache-original", sender: "cache-sender", system: null, member: null }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const fetched = await fetchMessage("msg-context-cache");
    const cached = getCachedMessageLookup("msg-context-cache");

    expect(cached).toEqual(fetched);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest successful lookup when the cache reaches its cap", async () => {
    const fetchMock = mock(async (request: string | URL | Request) => {
      const messageId = String(request).split("/").at(-1) ?? "missing";
      return jsonResponse(200, { original: messageId, sender: "cache-sender", system: null, member: null });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    for (let index = 0; index <= 2000; index++) {
      await fetchMessage(`msg-lru-${index}`);
    }
    expect(getCachedMessageLookup("msg-lru-0")).toBeNull();
    expect(getCachedMessageLookup("msg-lru-2000")?.original).toBe("msg-lru-2000");

    await fetchMessage("msg-lru-0");
    expect(fetchMock).toHaveBeenCalledTimes(2002);
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

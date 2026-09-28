import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  clearPluralBuddyApiStateForTests,
  fetchPluralBuddyMessage,
  getCachedPluralBuddyMessage,
} from "@/utils/messageProxy/services/pluralbuddy/api";

const originalFetch = globalThis.fetch;
const originalClientId = process.env.PLURALBUDDY_CLIENT_ID;
const originalClientSecret = process.env.PLURALBUDDY_CLIENT_SECRET;
const messageId = "123456789012345678";
const hostId = "234567890123456789";
const channelId = "345678901234567890";

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalClientId === undefined) delete process.env.PLURALBUDDY_CLIENT_ID;
  else process.env.PLURALBUDDY_CLIENT_ID = originalClientId;
  if (originalClientSecret === undefined) delete process.env.PLURALBUDDY_CLIENT_SECRET;
  else process.env.PLURALBUDDY_CLIENT_SECRET = originalClientSecret;
  clearPluralBuddyApiStateForTests();
});

describe("PluralBuddy message lookup", () => {
  it("requires app credentials before requesting an identity", async () => {
    delete process.env.PLURALBUDDY_CLIENT_ID;
    delete process.env.PLURALBUDDY_CLIENT_SECRET;
    const fetchMock = mock(async () => new Response("unexpected"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await fetchPluralBuddyMessage(messageId)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a client token and preserves an alter snowflake exactly", async () => {
    process.env.PLURALBUDDY_CLIENT_ID = "test-client";
    process.env.PLURALBUDDY_CLIENT_SECRET = "test-secret";
    const fetchMock = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/oauth2/token")) {
        expect(String(init?.body)).toContain("grant_type=client_credentials");
        return Response.json({ access_token: "test-token", expires_in: 3600 });
      }
      expect(init?.headers).toEqual({ Authorization: "Bearer test-token" });
      return new Response(
        `{"message":{"messageId":"${messageId}","systemId":"${hostId}","alterId":456789012345678901,"channelId":"${channelId}"}}`,
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchPluralBuddyMessage(messageId);

    expect(result?.alterIdKey).toBe("456789012345678901");
    expect(result?.systemId).toBe(hostId);
    expect(getCachedPluralBuddyMessage(messageId)).toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a response for another repost ID", async () => {
    process.env.PLURALBUDDY_CLIENT_ID = "test-client";
    process.env.PLURALBUDDY_CLIENT_SECRET = "test-secret";
    globalThis.fetch = mock(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/auth/oauth2/token")
        ? Response.json({ access_token: "test-token", expires_in: 3600 })
        : new Response(
            `{"message":{"messageId":"999999999999999999","systemId":"${hostId}","alterId":456789012345678901,"channelId":"${channelId}"}}`,
          ),
    ) as unknown as typeof fetch;

    expect(await fetchPluralBuddyMessage(messageId)).toBeNull();
  });

  it("stops after a rate-limit response", async () => {
    process.env.PLURALBUDDY_CLIENT_ID = "test-client";
    process.env.PLURALBUDDY_CLIENT_SECRET = "test-secret";
    const fetchMock = mock(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/auth/oauth2/token")
        ? Response.json({ access_token: "test-token", expires_in: 3600 })
        : new Response(null, { status: 429 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await fetchPluralBuddyMessage(messageId)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an unauthorized token without retrying the message", async () => {
    process.env.PLURALBUDDY_CLIENT_ID = "test-client";
    process.env.PLURALBUDDY_CLIENT_SECRET = "test-secret";
    const fetchMock = mock(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/auth/oauth2/token")
        ? Response.json({ access_token: "test-token", expires_in: 3600 })
        : new Response(null, { status: 401 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await fetchPluralBuddyMessage(messageId)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

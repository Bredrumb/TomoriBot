import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { officialMessageProxyInstance, type MessageProxyInstanceContext } from "@/utils/messageProxy/instances";
import * as oauthTokens from "@/utils/messageProxy/services/pluralbuddy/oauthTokens";
import * as remoteFetch from "@/utils/security/userRemoteFetch";
import { log } from "@/utils/misc/logger";
import {
  clearPluralBuddyApiStateForTests,
  fetchPluralBuddyMessage,
  getCachedPluralBuddyMessage,
} from "@/utils/messageProxy/services/pluralbuddy/api";

const official = officialMessageProxyInstance("pluralbuddy");
const custom: MessageProxyInstanceContext = {
  serviceId: "pluralbuddy",
  instanceId: "pluralbuddy:11111111-2222-4333-8444-555555555555",
  origin: "https://example.org",
};
const messageId = "123456789012345678";
const hostId = "234567890123456789";
const channelId = "345678901234567890";

afterEach(() => {
  mock.restore();
  clearPluralBuddyApiStateForTests();
});

function messageResponse(id = messageId): Response {
  return new Response(
    `{"message":{"messageId":"${id}","systemId":"${hostId}","alterId":456789012345678901,"channelId":"${channelId}"}}`,
  );
}

describe("PluralBuddy message lookup", () => {
  it("does not request a message without operator authorization", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue(null);
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl");
    expect(await fetchPluralBuddyMessage(official, messageId)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses each instance origin and keeps concurrent lookups and cached records separate", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockImplementation(async (instance) => instance.instanceId);
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl").mockImplementation(async (url, init) => {
      const origin = new URL(String(url)).origin;
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${origin === official.origin ? official.instanceId : custom.instanceId}`,
      );
      return messageResponse();
    });

    const [first, duplicate, second] = await Promise.all([
      fetchPluralBuddyMessage(official, messageId),
      fetchPluralBuddyMessage(official, messageId),
      fetchPluralBuddyMessage(custom, messageId),
    ]);
    expect(first?.alterIdKey).toBe("456789012345678901");
    expect(duplicate).toEqual(first);
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      `${official.origin}/api/v1/messages/${messageId}`,
      `${custom.origin}/api/v1/messages/${messageId}`,
    ]);
    expect(getCachedPluralBuddyMessage(official, messageId)).toEqual(first);
    expect(getCachedPluralBuddyMessage(custom, messageId)).toEqual(second);
  });

  it("rejects a response for another repost ID", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(messageResponse("999999999999999999"));
    expect(await fetchPluralBuddyMessage(official, messageId)).toBeNull();
  });

  it("stops after a rate-limit response", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(new Response(null, { status: 429 }));
    expect(await fetchPluralBuddyMessage(official, messageId)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("blocks a rejected token without retrying the message", async () => {
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue("token");
    const reject = spyOn(oauthTokens, "rejectPluralBuddyAccessToken").mockResolvedValue();
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(new Response(null, { status: 401 }));
    expect(await fetchPluralBuddyMessage(official, messageId)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reject).toHaveBeenCalledWith(official, "token");
  });

  it("bounds a stalled lookup and omits the access token from its warning", async () => {
    const secretToken = "sensitive-access-token";
    spyOn(oauthTokens, "getPluralBuddyAccessToken").mockResolvedValue(secretToken);
    const warning = spyOn(log, "warn").mockImplementation(() => {});
    const fetch = spyOn(remoteFetch, "fetchUserRemoteUrl").mockImplementation(async (_url, init) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "TimeoutError")), {
          once: true,
        });
      });
      throw new Error("unreachable");
    });

    expect(await fetchPluralBuddyMessage(official, messageId)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(secretToken);
  });
});

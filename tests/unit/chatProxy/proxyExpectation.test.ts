import { afterAll, afterEach, describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import {
  applyChatProxyReference,
  beginChatProxyLookup,
  clearChatProxyExpectationStateForTests,
  createChatProxyExpectation,
  findMatchingChatProxyExpectation,
  getChatProxyExpectationTtlMs,
  getChatProxyWaitMs,
  getLiveChatProxyExpectationServiceIds,
  getSupersededChatProxyOriginalMessageIds,
  hasLiveChatProxyExpectations,
  isKnownChatProxyMessage,
  markChatProxyExpectationProxied,
  markChatProxyOriginalDeleted,
  rememberChatProxyMessage,
  waitForChatProxyExpectation,
} from "@/utils/chatProxy/proxyExpectation";
import type { ProxyMessageAttestation } from "@/utils/chatProxy/types";

const originalProxyWaitMs = process.env.CHAT_PROXY_WAIT_MS;
const originalExpectationTtlMs = process.env.CHAT_PROXY_EXPECTATION_TTL_MS;
process.env.CHAT_PROXY_WAIT_MS = "15";
process.env.CHAT_PROXY_EXPECTATION_TTL_MS = "45";

afterAll(() => {
  if (originalProxyWaitMs === undefined) delete process.env.CHAT_PROXY_WAIT_MS;
  else process.env.CHAT_PROXY_WAIT_MS = originalProxyWaitMs;
  if (originalExpectationTtlMs === undefined) delete process.env.CHAT_PROXY_EXPECTATION_TTL_MS;
  else process.env.CHAT_PROXY_EXPECTATION_TTL_MS = originalExpectationTtlMs;
});

afterEach(() => {
  clearChatProxyExpectationStateForTests();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attestation(
  originalMessageId: string,
  senderDiscordId: string,
  serviceId = "service_a",
): ProxyMessageAttestation {
  return {
    serviceId,
    proxyMessageId: "proxy_1",
    originalMessageId,
    senderDiscordId,
    identity: null,
  };
}

function createExpectation(overrides: Partial<Parameters<typeof createChatProxyExpectation>[0]> = {}) {
  return createChatProxyExpectation({
    serviceId: "service_a",
    channelId: "channel_1",
    originalMessageId: "original_1",
    senderDiscId: "sender_1",
    originalMessage: { id: "original_1" } as Message,
    originalReference: null,
    ...overrides,
  });
}

describe("chat-proxy expectations", () => {
  it("resolves the original speedbump when the original message is deleted", async () => {
    const expectation = createExpectation();
    const wait = waitForChatProxyExpectation(expectation);

    expect(markChatProxyOriginalDeleted("channel_1", "original_1")).toBe(true);
    expect(await wait).toBe("proxied");
    expect(expectation.state).toBe("proxied");
  });

  it("times out normally when no delete arrives inside the wait window", async () => {
    const expectation = createExpectation({ originalMessageId: "original_timeout" });

    expect(await waitForChatProxyExpectation(expectation)).toBe("timeout");
    expect(hasLiveChatProxyExpectations("channel_1")).toBe(false);
    expect(findMatchingChatProxyExpectation("channel_1", attestation("original_timeout", "sender_1"))).toBeNull();
  });

  it("pauses original timeout while a channel lookup is in flight", async () => {
    const expectation = createExpectation({ channelId: "channel_lookup", originalMessageId: "original_lookup" });
    const endLookup = beginChatProxyLookup("channel_lookup");
    let waitResult: string | null = null;
    const wait = waitForChatProxyExpectation(expectation).then((result) => {
      waitResult = result;
    });

    await sleep(getChatProxyWaitMs() + 10);
    expect(waitResult).toBeNull();

    endLookup();
    await wait;
    expect(waitResult).toBe("timeout");
  });

  it("cleans up expired expectations after the TTL", async () => {
    createExpectation({ channelId: "channel_ttl", originalMessageId: "original_ttl" });

    await sleep(getChatProxyExpectationTtlMs() + 10);

    expect(hasLiveChatProxyExpectations("channel_ttl")).toBe(false);
  });

  it("matches exact service, original, sender, and channel attestations", () => {
    const first = createExpectation();
    const second = createExpectation({
      serviceId: "service_b",
      originalMessageId: "original_2",
      senderDiscId: "sender_2",
    });

    expect(findMatchingChatProxyExpectation("channel_1", attestation("original_2", "sender_2", "service_b"))).toBe(
      second,
    );
    expect(findMatchingChatProxyExpectation("channel_1", attestation("original_1", "sender_2"))).toBeNull();
    expect(
      findMatchingChatProxyExpectation("channel_1", attestation("original_1", "sender_1", "service_b")),
    ).toBeNull();
    expect(findMatchingChatProxyExpectation("other_channel", attestation("original_1", "sender_1"))).toBeNull();
    expect(findMatchingChatProxyExpectation("channel_1", attestation("original_1", "sender_1"))).toBe(first);
    expect(getLiveChatProxyExpectationServiceIds("channel_1").sort()).toEqual(["service_a", "service_b"]);
  });

  it("marks repost-before-delete races and remembers the proxy message", async () => {
    const reference = { messageId: "bot_reply_target" } as Message["reference"];
    const expectation = createExpectation({ originalReference: reference });
    const wait = waitForChatProxyExpectation(expectation);
    markChatProxyExpectationProxied(expectation);
    const record = rememberChatProxyMessage({
      messageDiscId: "proxy_1",
      channelId: "channel_1",
      expectation,
    });

    expect(await wait).toBe("proxied");
    expect(record.serviceId).toBe("service_a");
    expect(record.senderDiscId).toBe("sender_1");
    expect(isKnownChatProxyMessage({ id: "proxy_1", webhookId: "webhook_1" } as Message)).toBe(true);

    const proxyMessage = { id: "proxy_1", webhookId: "webhook_1", reference: null } as Message;
    expect(applyChatProxyReference(proxyMessage)).toBe(true);
    expect(proxyMessage.reference).toBe(reference);
  });

  it("reports superseded originals per channel without collapsing split proxies", () => {
    for (const [channelId, originalMessageId, messageDiscId] of [
      ["channel_1", "original_1", "proxy_1"],
      ["channel_1", "original_2", "proxy_2"],
      ["other_channel", "original_3", "proxy_3"],
    ] as const) {
      rememberChatProxyMessage({
        messageDiscId,
        channelId,
        expectation: createExpectation({ channelId, originalMessageId }),
      });
    }

    rememberChatProxyMessage({
      messageDiscId: "proxy_1b",
      channelId: "channel_1",
      expectation: createExpectation(),
    });

    expect(getSupersededChatProxyOriginalMessageIds("channel_1")).toEqual(new Set(["original_1", "original_2"]));
    expect(getSupersededChatProxyOriginalMessageIds("other_channel")).toEqual(new Set(["original_3"]));
    expect(getSupersededChatProxyOriginalMessageIds("empty_channel").size).toBe(0);
  });
});

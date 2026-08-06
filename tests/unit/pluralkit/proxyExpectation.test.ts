import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import type { PkMessageLookup } from "@/utils/pluralkit/pkApi";

const originalProxyWaitMs = process.env.PLURALKIT_PROXY_WAIT_MS;
const originalExpectationTtlMs = process.env.PLURALKIT_EXPECTATION_TTL_MS;
process.env.PLURALKIT_PROXY_WAIT_MS = "15";
process.env.PLURALKIT_EXPECTATION_TTL_MS = "45";

// Set at module scope, so it can only be undone once every test here has run.
afterAll(() => {
  if (originalProxyWaitMs === undefined) delete process.env.PLURALKIT_PROXY_WAIT_MS;
  else process.env.PLURALKIT_PROXY_WAIT_MS = originalProxyWaitMs;
  if (originalExpectationTtlMs === undefined) delete process.env.PLURALKIT_EXPECTATION_TTL_MS;
  else process.env.PLURALKIT_EXPECTATION_TTL_MS = originalExpectationTtlMs;
});

let proxyExpectation: typeof import("@/utils/chat/pluralkit/proxyExpectation");

beforeAll(async () => {
  proxyExpectation = await import("@/utils/chat/pluralkit/proxyExpectation");
});

afterEach(() => {
  proxyExpectation.clearPluralKitProxyExpectationStateForTests();
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lookup(original: string, sender: string): PkMessageLookup {
  return {
    original,
    sender,
    system: null,
    member: null,
  };
}

describe("PluralKit proxy expectations", () => {
  it("resolves the original speedbump when the original message is deleted", async () => {
    const expectation = proxyExpectation.createPluralKitProxyExpectation({
      channelId: "channel_1",
      originalMessageId: "original_1",
      senderDiscId: "sender_1",
      originalReference: null,
    });

    const wait = proxyExpectation.waitForPluralKitProxyExpectation(expectation);

    expect(proxyExpectation.markPluralKitProxyOriginalDeleted("channel_1", "original_1")).toBe(true);
    expect(await wait).toBe("proxied");
    expect(expectation.state).toBe("proxied");
  });

  it("times out normally when no delete arrives inside the wait window", async () => {
    const expectation = proxyExpectation.createPluralKitProxyExpectation({
      channelId: "channel_1",
      originalMessageId: "original_timeout",
      senderDiscId: "sender_1",
      originalReference: null,
    });

    expect(await proxyExpectation.waitForPluralKitProxyExpectation(expectation)).toBe("timeout");
    expect(proxyExpectation.hasLivePluralKitProxyExpectations("channel_1")).toBe(true);
  });

  it("pauses original timeout while a channel lookup is in flight", async () => {
    const expectation = proxyExpectation.createPluralKitProxyExpectation({
      channelId: "channel_lookup",
      originalMessageId: "original_lookup",
      senderDiscId: "sender_1",
      originalReference: null,
    });

    const endLookup = proxyExpectation.beginPluralKitProxyLookup("channel_lookup");
    let waitResult: string | null = null;
    const wait = proxyExpectation.waitForPluralKitProxyExpectation(expectation).then((result) => {
      waitResult = result;
    });

    await sleep(proxyExpectation.getPluralKitProxyWaitMs() + 10);
    expect(waitResult).toBeNull();

    endLookup();
    await wait;
    expect(waitResult).toBe("timeout");
  });

  it("cleans up expired expectations after the TTL", async () => {
    proxyExpectation.createPluralKitProxyExpectation({
      channelId: "channel_ttl",
      originalMessageId: "original_ttl",
      senderDiscId: "sender_1",
      originalReference: null,
    });

    await sleep(proxyExpectation.getPluralKitExpectationTtlMs() + 10);

    expect(proxyExpectation.hasLivePluralKitProxyExpectations("channel_ttl")).toBe(false);
  });

  it("matches repost lookups by original message and sender within the channel", () => {
    const first = proxyExpectation.createPluralKitProxyExpectation({
      channelId: "channel_1",
      originalMessageId: "original_1",
      senderDiscId: "sender_1",
      originalReference: null,
    });
    const second = proxyExpectation.createPluralKitProxyExpectation({
      channelId: "channel_1",
      originalMessageId: "original_2",
      senderDiscId: "sender_2",
      originalReference: null,
    });

    expect(proxyExpectation.findMatchingPluralKitProxyExpectation("channel_1", lookup("original_2", "sender_2"))).toBe(
      second,
    );
    expect(proxyExpectation.findMatchingPluralKitProxyExpectation("channel_1", lookup("original_1", "sender_2"))).toBe(
      null,
    );
    expect(
      proxyExpectation.findMatchingPluralKitProxyExpectation("other_channel", lookup("original_1", "sender_1")),
    ).toBe(null);
    expect(proxyExpectation.findMatchingPluralKitProxyExpectation("channel_1", lookup("original_1", "sender_1"))).toBe(
      first,
    );
  });

  it("marks repost-before-delete races as proxied and remembers the proxy message", async () => {
    const reference = { messageId: "bot_reply_target" } as Message["reference"];
    const expectation = proxyExpectation.createPluralKitProxyExpectation({
      channelId: "channel_1",
      originalMessageId: "original_1",
      senderDiscId: "sender_1",
      originalReference: reference,
    });

    const wait = proxyExpectation.waitForPluralKitProxyExpectation(expectation);
    proxyExpectation.markPluralKitProxyExpectationProxied(expectation);
    const record = proxyExpectation.rememberPluralKitProxyMessage({
      messageDiscId: "proxy_1",
      channelId: "channel_1",
      expectation,
    });

    expect(await wait).toBe("proxied");
    expect(record.senderDiscId).toBe("sender_1");
    expect(proxyExpectation.isKnownPluralKitProxyMessage({ id: "proxy_1", webhookId: "webhook_1" } as Message)).toBe(
      true,
    );

    const proxyMessage = { id: "proxy_1", webhookId: "webhook_1", reference: null } as Message;
    expect(proxyExpectation.applyPluralKitProxyReference(proxyMessage)).toBe(true);
    expect(proxyMessage.reference).toBe(reference);
  });
});

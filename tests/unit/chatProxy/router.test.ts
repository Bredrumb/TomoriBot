import { afterEach, describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import {
  clearChatProxyExpectationStateForTests,
  createChatProxyExpectation,
  getChatProxyMessageRecord,
  markChatProxyExpectationProxied,
  markChatProxyOriginalDeleted,
  rememberChatProxyMessage,
  waitForChatProxyExpectation,
} from "@/utils/chatProxy/proxyExpectation";
import { createProxyServiceRegistry } from "@/utils/chatProxy/registry";
import {
  clearChatProxyRouteMetricsForTests,
  getChatProxyRouteMetricsSnapshot,
  routeChatProxyMessage,
} from "@/utils/chatProxy/router";
import type {
  ProxyIdentityUpsertInput,
  ProxyMessageAttestation,
  ProxyServiceDescriptor,
  ProxyServicePresentation,
} from "@/utils/chatProxy/types";

const presentation: ProxyServicePresentation = {
  identityMemoryLabel: (displayName) => `${displayName}'s notes`,
  identityMembershipLine: (context) => `- Linked to ${context.namespaceDisplayName ?? "an account"}`,
  namespacePresentation: (context) => ({
    sectionHeading: "Linked profiles:",
    entry: `- ${context.namespaceDisplayName ?? "Profile"}`,
  }),
};

function identity(serviceId: string): ProxyIdentityUpsertInput {
  return {
    serviceId,
    externalIdentityKind: `${serviceId}_profile`,
    externalKey: "profile-1",
    shortId: "p1",
    displayName: "Sparrow",
    bio: null,
    namespace: {
      namespaceKey: "account-1",
      shortId: "a1",
      displayName: "Lighthouse",
      tag: null,
      description: null,
    },
  };
}

function claim(serviceId: string, overrides: Partial<ProxyMessageAttestation> = {}): ProxyMessageAttestation {
  return {
    serviceId,
    proxyMessageId: "proxy-1",
    originalMessageId: "original-1",
    senderDiscordId: "sender-1",
    identity: null,
    ...overrides,
  };
}

function descriptor(
  serviceId: string,
  attestMessage: (messageId: string) => Promise<ProxyMessageAttestation | null>,
  stableIdentity = false,
): ProxyServiceDescriptor<string> {
  const base = {
    serviceId,
    settingsLocaleKey: `${serviceId}_option`,
    enabledSuccessDescriptionLocaleKey: `commands.personal.chat-proxy.${serviceId}_enabled_success_description`,
    syntheticUserPrefix: `${serviceId}:` as `${string}:`,
    externalIdentityKind: `${serviceId}_profile`,
    validateExternalKey: (key: string) => key.length > 0,
    presentation,
    attestMessage,
  };
  return stableIdentity
    ? {
        ...base,
        capabilities: {
          correlation: "attested",
          identity: "stable",
          identityBio: "none",
          namespaceBio: "none",
        },
      }
    : { ...base, capabilities: { correlation: "attested", identity: "none" } };
}

const noCorrelationDescriptor = {
  serviceId: "uncorrelated",
  settingsLocaleKey: "uncorrelated_option",
  enabledSuccessDescriptionLocaleKey: "commands.personal.chat-proxy.uncorrelated_enabled_success_description",
  syntheticUserPrefix: "uncorrelated:",
  externalIdentityKind: "uncorrelated_profile",
  validateExternalKey: (key: string) => key.length > 0,
  presentation,
  capabilities: { correlation: "none", identity: "none" },
} as const satisfies ProxyServiceDescriptor<"uncorrelated">;

function message(): Message {
  return { id: "proxy-1", channelId: "channel-1", webhookId: "webhook-1" } as Message;
}

function expectation(serviceId: string) {
  return createChatProxyExpectation({
    serviceId,
    channelId: "channel-1",
    originalMessageId: "original-1",
    senderDiscId: "sender-1",
    originalMessage: { id: "original-1" } as Message,
    originalReference: null,
  });
}

afterEach(() => {
  clearChatProxyExpectationStateForTests();
  clearChatProxyRouteMetricsForTests();
});

describe("chat-proxy attestation router", () => {
  it("reports unsupported correlation without invoking transport", async () => {
    const registry = createProxyServiceRegistry([noCorrelationDescriptor]);

    expect(
      await routeChatProxyMessage({ message: message(), candidateServiceIds: ["uncorrelated"] }, { registry }),
    ).toEqual({
      status: "unsupported_correlation",
    });
    expect(getChatProxyRouteMetricsSnapshot()).toMatchObject({
      unsupported_correlation: 1,
      unmatched: 0,
      matched_stable_identity: 0,
    });
  });

  it("invokes each distinct eligible adapter once and fails closed on zero claims", async () => {
    let calls = 0;
    const empty = descriptor("empty", async () => {
      calls += 1;
      return null;
    });
    const registry = createProxyServiceRegistry([empty]);

    expect(
      await routeChatProxyMessage({ message: message(), candidateServiceIds: ["empty", "empty"] }, { registry }),
    ).toEqual({ status: "unmatched" });
    expect(calls).toBe(1);
  });

  it("fails closed when two services claim one webhook message", async () => {
    const first = descriptor("first", async () => claim("first"));
    const second = descriptor("second", async () => claim("second"));
    const registry = createProxyServiceRegistry([first, second]);

    expect(
      await routeChatProxyMessage({ message: message(), candidateServiceIds: ["first", "second"] }, { registry }),
    ).toEqual({ status: "conflicting_attestations" });
  });

  it("admits an exact correlated identity-free claim without inventing identity", async () => {
    const service = descriptor("trigger_only", async () => claim("trigger_only"));
    const registry = createProxyServiceRegistry([service]);
    const expected = expectation("trigger_only");

    const result = await routeChatProxyMessage(
      { message: message(), candidateServiceIds: ["trigger_only"] },
      { registry },
    );

    expect(result).toEqual({
      status: "matched_trigger_only",
      attestation: claim("trigger_only"),
      expectation: expected,
    });
  });

  it("rejects stable identity data from an identity-free adapter", async () => {
    const service = descriptor("trigger_only", async () =>
      claim("trigger_only", { identity: identity("trigger_only") }),
    );
    const registry = createProxyServiceRegistry([service]);
    expectation("trigger_only");

    expect(
      await routeChatProxyMessage({ message: message(), candidateServiceIds: ["trigger_only"] }, { registry }),
    ).toEqual({ status: "unmatched" });
  });

  it("admits an exact stable identity claim", async () => {
    const attestation = claim("stable", { identity: identity("stable") });
    const service = descriptor("stable", async () => attestation, true);
    const registry = createProxyServiceRegistry([service]);
    const expected = expectation("stable");

    expect(await routeChatProxyMessage({ message: message(), candidateServiceIds: ["stable"] }, { registry })).toEqual({
      status: "matched_stable_identity",
      attestation,
      expectation: expected,
    });
    expect(getChatProxyRouteMetricsSnapshot().matched_stable_identity).toBe(1);
  });

  it("suppresses a delete-first original and admits only its exact repost", async () => {
    const service = descriptor("exact", async () => claim("exact"));
    const registry = createProxyServiceRegistry([service]);
    const expected = expectation("exact");
    const originalWait = waitForChatProxyExpectation(expected);

    expect(markChatProxyOriginalDeleted("channel-1", "original-1")).toBe(true);
    const result = await routeChatProxyMessage({ message: message(), candidateServiceIds: ["exact"] }, { registry });
    expect(result.status).toBe("matched_trigger_only");
    if (result.status !== "matched_trigger_only") throw new Error("Expected an exact trigger-only match");

    markChatProxyExpectationProxied(result.expectation);
    const record = rememberChatProxyMessage({
      messageDiscId: "proxy-1",
      channelId: "channel-1",
      expectation: result.expectation,
    });
    expect(await originalWait).toBe("proxied");
    expect(record.originalMessageId).toBe("original-1");
  });

  it("keeps an API failure after deletion identity-free and silent", async () => {
    const failing = descriptor("failing", async () => {
      throw new Error("transport unavailable");
    });
    const registry = createProxyServiceRegistry([failing]);
    const expected = expectation("failing");
    const originalWait = waitForChatProxyExpectation(expected);

    expect(markChatProxyOriginalDeleted("channel-1", "original-1")).toBe(true);
    expect(await routeChatProxyMessage({ message: message(), candidateServiceIds: ["failing"] }, { registry })).toEqual(
      {
        status: "timeout_or_error",
      },
    );
    expect(await originalWait).toBe("proxied");
    expect(getChatProxyMessageRecord("proxy-1")).toBeNull();
  });

  it("rejects stable identity metadata that does not belong to the claiming descriptor", async () => {
    const service = descriptor(
      "stable",
      async () =>
        claim("stable", {
          identity: {
            ...identity("stable"),
            externalIdentityKind: "other_profile",
          },
        }),
      true,
    );
    const registry = createProxyServiceRegistry([service]);
    expectation("stable");

    expect(await routeChatProxyMessage({ message: message(), candidateServiceIds: ["stable"] }, { registry })).toEqual({
      status: "unmatched",
    });
  });

  for (const [label, overrides] of [
    ["original", { originalMessageId: "wrong-original" }],
    ["sender", { senderDiscordId: "wrong-sender" }],
    ["service", { serviceId: "wrong-service" }],
  ] as const) {
    it(`rejects a claim with the wrong ${label}`, async () => {
      const service = descriptor("exact", async () => claim("exact", overrides));
      const registry = createProxyServiceRegistry([service]);
      expectation("exact");

      expect(await routeChatProxyMessage({ message: message(), candidateServiceIds: ["exact"] }, { registry })).toEqual(
        {
          status: "unmatched",
        },
      );
    });
  }

  it("rejects malformed proxy message IDs and reports adapter errors", async () => {
    const malformed = descriptor("malformed", async () => claim("malformed", { proxyMessageId: "other-message" }));
    const failing = descriptor("failing", async () => {
      throw new Error("transport unavailable");
    });

    expect(
      await routeChatProxyMessage(
        { message: message(), candidateServiceIds: ["malformed"] },
        { registry: createProxyServiceRegistry([malformed]) },
      ),
    ).toEqual({ status: "unmatched" });
    expect(
      await routeChatProxyMessage(
        { message: message(), candidateServiceIds: ["failing"] },
        { registry: createProxyServiceRegistry([failing]) },
      ),
    ).toEqual({ status: "timeout_or_error" });
  });
});

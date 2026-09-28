import { afterEach, describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import {
  clearMessageProxyExpectationStateForTests,
  createMessageProxyExpectation,
  getMessageProxyMessageRecord,
  markMessageProxyExpectationProxied,
  markMessageProxyOriginalDeleted,
  rememberMessageProxyMessage,
  waitForMessageProxyExpectation,
} from "@/utils/messageProxy/proxyExpectation";
import { createProxyServiceRegistry } from "@/utils/messageProxy/registry";
import {
  clearMessageProxyRouteMetricsForTests,
  getMessageProxyRouteMetricsSnapshot,
  routeMessageProxyMessage,
} from "@/utils/messageProxy/router";
import type {
  ProxyIdentityUpsertInput,
  ProxyMessageAttestation,
  ProxyServiceDescriptor,
  ProxyServicePresentation,
} from "@/utils/messageProxy/types";

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
    enabledSuccessDescriptionLocaleKey: `commands.personal.message-proxy.${serviceId}_enabled_success_description`,
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
          correlation: "attested" as const,
          identity: "stable" as const,
          identityBio: "none" as const,
          namespaceBio: "none" as const,
        },
      }
    : { ...base, capabilities: { correlation: "attested" as const, identity: "none" as const } };
}

const noCorrelationDescriptor = {
  serviceId: "uncorrelated",
  settingsLocaleKey: "uncorrelated_option",
  enabledSuccessDescriptionLocaleKey: "commands.personal.message-proxy.uncorrelated_enabled_success_description",
  syntheticUserPrefix: "uncorrelated:",
  externalIdentityKind: "uncorrelated_profile",
  validateExternalKey: (key: string) => key.length > 0,
  presentation,
  capabilities: { correlation: "none", identity: "none" },
} as const satisfies ProxyServiceDescriptor<"uncorrelated">;

function message(): Message {
  return { id: "proxy-1", channelId: "channel-1", webhookId: "webhook-1", author: { username: "Juno" } } as Message;
}

function expectation(serviceId: string) {
  return createMessageProxyExpectation({
    serviceId,
    channelId: "channel-1",
    originalMessageId: "original-1",
    senderDiscId: "sender-1",
    originalMessage: { id: "original-1" } as Message,
    originalReference: null,
  });
}

afterEach(() => {
  clearMessageProxyExpectationStateForTests();
  clearMessageProxyRouteMetricsForTests();
});

describe("message-proxy attestation router", () => {
  it("accepts a verified repost without claiming an original ID", async () => {
    const service = {
      serviceId: "best_effort",
      settingsLocaleKey: "best_effort_option",
      enabledSuccessDescriptionLocaleKey: "commands.personal.message-proxy.best_effort_enabled_success_description",
      syntheticUserPrefix: "best_effort:" as const,
      externalIdentityKind: "best_effort_profile",
      validateExternalKey: (key: string) => key.length > 0,
      presentation,
      attestMessage: async () =>
        claim("best_effort", {
          originalMessageId: null,
          senderDiscordId: "sender-1",
          identity: identity("best_effort"),
        }),
      capabilities: {
        correlation: "verified-repost" as const,
        identity: "stable" as const,
        identityBio: "none" as const,
        namespaceBio: "none" as const,
      },
    } satisfies ProxyServiceDescriptor<"best_effort">;
    const expected = expectation("best_effort");
    const result = await routeMessageProxyMessage(
      { message: message(), candidateServiceIds: ["best_effort"] },
      { registry: createProxyServiceRegistry([service]) },
    );
    expect(result.status).toBe("matched_stable_identity");
    if (result.status === "matched_stable_identity") {
      expect(result.expectation).toBe(expected);
      expect(result.attestation.originalMessageId).toBeNull();
      expect(result.attestation.identity?.displayName).toBe("Juno");
    }
  });
  it("reports unsupported correlation without invoking transport", async () => {
    const registry = createProxyServiceRegistry([noCorrelationDescriptor]);

    expect(
      await routeMessageProxyMessage({ message: message(), candidateServiceIds: ["uncorrelated"] }, { registry }),
    ).toEqual({
      status: "unsupported_correlation",
    });
    expect(getMessageProxyRouteMetricsSnapshot()).toMatchObject({
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
      await routeMessageProxyMessage({ message: message(), candidateServiceIds: ["empty", "empty"] }, { registry }),
    ).toEqual({ status: "unmatched" });
    expect(calls).toBe(1);
  });

  it("fails closed when two services claim one webhook message", async () => {
    const first = descriptor("first", async () => claim("first"));
    const second = descriptor("second", async () => claim("second"));
    const registry = createProxyServiceRegistry([first, second]);

    expect(
      await routeMessageProxyMessage({ message: message(), candidateServiceIds: ["first", "second"] }, { registry }),
    ).toEqual({ status: "conflicting_attestations" });
  });

  it("admits an exact correlated identity-free claim without inventing identity", async () => {
    const service = descriptor("trigger_only", async () => claim("trigger_only"));
    const registry = createProxyServiceRegistry([service]);
    const expected = expectation("trigger_only");

    const result = await routeMessageProxyMessage(
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
      await routeMessageProxyMessage({ message: message(), candidateServiceIds: ["trigger_only"] }, { registry }),
    ).toEqual({ status: "unmatched" });
  });

  it("admits an exact stable identity claim", async () => {
    const attestation = claim("stable", { identity: identity("stable") });
    const service = descriptor("stable", async () => attestation, true);
    const registry = createProxyServiceRegistry([service]);
    const expected = expectation("stable");

    expect(
      await routeMessageProxyMessage({ message: message(), candidateServiceIds: ["stable"] }, { registry }),
    ).toEqual({
      status: "matched_stable_identity",
      attestation,
      expectation: expected,
    });
    expect(getMessageProxyRouteMetricsSnapshot().matched_stable_identity).toBe(1);
  });

  it("suppresses a delete-first original and admits only its exact repost", async () => {
    const service = descriptor("exact", async () => claim("exact"));
    const registry = createProxyServiceRegistry([service]);
    const expected = expectation("exact");
    const originalWait = waitForMessageProxyExpectation(expected);

    expect(markMessageProxyOriginalDeleted("channel-1", "original-1")).toBe(true);
    const result = await routeMessageProxyMessage({ message: message(), candidateServiceIds: ["exact"] }, { registry });
    expect(result.status).toBe("matched_trigger_only");
    if (result.status !== "matched_trigger_only") throw new Error("Expected an exact trigger-only match");

    markMessageProxyExpectationProxied(result.expectation);
    const record = rememberMessageProxyMessage({
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
    const originalWait = waitForMessageProxyExpectation(expected);

    expect(markMessageProxyOriginalDeleted("channel-1", "original-1")).toBe(true);
    expect(
      await routeMessageProxyMessage({ message: message(), candidateServiceIds: ["failing"] }, { registry }),
    ).toEqual({
      status: "timeout_or_error",
    });
    expect(await originalWait).toBe("proxied");
    expect(getMessageProxyMessageRecord("proxy-1")).toBeNull();
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

    expect(
      await routeMessageProxyMessage({ message: message(), candidateServiceIds: ["stable"] }, { registry }),
    ).toEqual({
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

      expect(
        await routeMessageProxyMessage({ message: message(), candidateServiceIds: ["exact"] }, { registry }),
      ).toEqual({
        status: "unmatched",
      });
    });
  }

  it("rejects malformed proxy message IDs and reports adapter errors", async () => {
    const malformed = descriptor("malformed", async () => claim("malformed", { proxyMessageId: "other-message" }));
    const failing = descriptor("failing", async () => {
      throw new Error("transport unavailable");
    });

    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateServiceIds: ["malformed"] },
        { registry: createProxyServiceRegistry([malformed]) },
      ),
    ).toEqual({ status: "unmatched" });
    expect(
      await routeMessageProxyMessage(
        { message: message(), candidateServiceIds: ["failing"] },
        { registry: createProxyServiceRegistry([failing]) },
      ),
    ).toEqual({ status: "timeout_or_error" });
  });
});

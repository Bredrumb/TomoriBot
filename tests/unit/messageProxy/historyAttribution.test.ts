import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Message } from "discord.js";
import {
  resolveMessageProxyMessageIdentitiesForHistory,
  type MessageProxyHistoryAttributionDependencies,
} from "@/utils/messageProxy/historyAttribution";
import { clearNegativeMessageProxyMessageIdentityCacheForTests } from "@/utils/messageProxy/messageIdentityNegativeCache";
import type {
  MessageProxyIndexedMessageIdentity,
  ProxyMessageAttestation,
  ProxyServiceDescriptor,
} from "@/utils/messageProxy/types";

const MEMBER_UUID = "11111111-2222-4333-8444-555555555555";

function message(id: string, webhookId: string | null = "webhook-1"): Message {
  return {
    id,
    webhookId,
    author: { username: `Webhook ${id}` },
  } as Message;
}

function attestation(proxyMessageId: string): ProxyMessageAttestation {
  return {
    serviceId: "pluralkit",
    proxyMessageId,
    originalMessageId: "original-1",
    senderDiscordId: "host-1",
    identity: {
      serviceId: "pluralkit",
      externalIdentityKind: "pluralkit_member",
      externalKey: MEMBER_UUID,
      shortId: "sparrow",
      displayName: "Sparrow",
      bio: null,
      namespace: {
        namespaceKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        shortId: "light",
        displayName: "Lighthouse",
        tag: null,
        description: null,
      },
    },
  };
}

function indexedIdentity(messageDiscId: string): MessageProxyIndexedMessageIdentity {
  return {
    serviceId: "pluralkit",
    userDiscId: `pk:${MEMBER_UUID}`,
    externalIdentityId: 1,
    externalKey: MEMBER_UUID,
    identityShortId: "sparrow",
    displayName: "Sparrow from DB",
    namespaceId: 2,
    namespaceKey: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    namespaceShortId: "light",
    namespaceDisplayName: "Lighthouse",
    namespaceTag: null,
    namespaceDescription: null,
    hostUserDiscIds: ["host-1"],
    messageDiscId,
    senderDiscId: "host-2",
  };
}

afterEach(clearNegativeMessageProxyMessageIdentityCacheForTests);

describe("message-proxy history attribution", () => {
  it("uses cached attribution first and batches every remaining webhook into one DB read", async () => {
    const attestMessage = mock(async () => null);
    const descriptor = {
      serviceId: "pluralkit",
      settingsLocaleKey: "pluralkit_option",
      enabledSuccessDescriptionLocaleKey: "commands.personal.message-proxy.pluralkit_enabled_success_description",
      syntheticUserPrefix: "pk:",
      externalIdentityKind: "pluralkit_member",
      validateExternalKey: () => true,
      capabilities: {
        correlation: "attested",
        identity: "stable",
        identityBio: "inline",
        namespaceBio: "inline",
      },
      presentation: {
        identityMemoryLabel: (name: string) => name,
        identityMembershipLine: () => "membership",
        namespacePresentation: () => ({ sectionHeading: "Namespaces", entry: "- Namespace" }),
      },
      attestMessage,
      getCachedAttestation: (messageDiscId: string) => (messageDiscId === "cached" ? attestation(messageDiscId) : null),
    } as const satisfies ProxyServiceDescriptor<"pluralkit">;
    const loadMessageIdentities = mock(
      async (ids: string[]) => new Map(ids.includes("db") ? [["db", indexedIdentity("db")]] : []),
    );
    const dependencies: MessageProxyHistoryAttributionDependencies = {
      getMessageRecord: (id) =>
        id === "cached"
          ? ({ serviceId: "pluralkit" } as ReturnType<MessageProxyHistoryAttributionDependencies["getMessageRecord"]>)
          : null,
      getDescriptor: () => descriptor,
      loadMessageIdentities,
    };

    const resolved = await resolveMessageProxyMessageIdentitiesForHistory(
      [message("cached"), message("db"), message("miss"), message("human", null)],
      dependencies,
    );

    expect(attestMessage).not.toHaveBeenCalled();
    expect(loadMessageIdentities).toHaveBeenCalledTimes(1);
    expect(loadMessageIdentities).toHaveBeenCalledWith(["db", "miss"]);
    expect(resolved.get("cached")).toMatchObject({ userDiscId: `pk:${MEMBER_UUID}`, senderDiscId: "host-1" });
    expect(resolved.get("db")).toMatchObject({ displayName: "Sparrow from DB", senderDiscId: "host-2" });
    expect(resolved.has("miss")).toBe(false);
  });

  it("does not repeat DB reads for a confirmed miss", async () => {
    const loadMessageIdentities = mock(async () => new Map<string, MessageProxyIndexedMessageIdentity>());
    const dependencies: MessageProxyHistoryAttributionDependencies = {
      getMessageRecord: () => null,
      getDescriptor: () => null,
      loadMessageIdentities,
    };

    await resolveMessageProxyMessageIdentitiesForHistory([message("miss")], dependencies);
    await resolveMessageProxyMessageIdentitiesForHistory([message("miss")], dependencies);

    expect(loadMessageIdentities).toHaveBeenCalledTimes(1);
  });
});

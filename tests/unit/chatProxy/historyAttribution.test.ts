import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Message } from "discord.js";
import {
  resolveChatProxyMessageIdentitiesForHistory,
  type ChatProxyHistoryAttributionDependencies,
} from "@/utils/chatProxy/historyAttribution";
import { clearNegativeChatProxyMessageIdentityCacheForTests } from "@/utils/chatProxy/messageIdentityNegativeCache";
import type {
  ChatProxyIndexedMessageIdentity,
  ProxyMessageAttestation,
  ProxyServiceDescriptor,
} from "@/utils/chatProxy/types";

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

function indexedIdentity(messageDiscId: string): ChatProxyIndexedMessageIdentity {
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

afterEach(clearNegativeChatProxyMessageIdentityCacheForTests);

describe("chat-proxy history attribution", () => {
  it("uses cached attribution first and batches every remaining webhook into one DB read", async () => {
    const attestMessage = mock(async () => null);
    const descriptor = {
      serviceId: "pluralkit",
      settingsLocaleKey: "pluralkit_option",
      enabledSuccessDescriptionLocaleKey: "commands.personal.chat-proxy.pluralkit_enabled_success_description",
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
    const dependencies: ChatProxyHistoryAttributionDependencies = {
      getMessageRecord: (id) =>
        id === "cached"
          ? ({ serviceId: "pluralkit" } as ReturnType<ChatProxyHistoryAttributionDependencies["getMessageRecord"]>)
          : null,
      getDescriptor: () => descriptor,
      loadMessageIdentities,
    };

    const resolved = await resolveChatProxyMessageIdentitiesForHistory(
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
    const loadMessageIdentities = mock(async () => new Map<string, ChatProxyIndexedMessageIdentity>());
    const dependencies: ChatProxyHistoryAttributionDependencies = {
      getMessageRecord: () => null,
      getDescriptor: () => null,
      loadMessageIdentities,
    };

    await resolveChatProxyMessageIdentitiesForHistory([message("miss")], dependencies);
    await resolveChatProxyMessageIdentitiesForHistory([message("miss")], dependencies);

    expect(loadMessageIdentities).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, it, mock } from "bun:test";
import type { UserRow } from "@/types/db/schema";
import {
  persistChatProxyAttestationIdentity,
  type ChatProxyIdentityPersistenceDependencies,
} from "@/utils/chatProxy/persistence";
import {
  clearNegativeChatProxyMessageIdentityCacheForTests,
  hasNegativeChatProxyMessageIdentity,
  rememberNegativeChatProxyMessageIdentity,
} from "@/utils/chatProxy/messageIdentityNegativeCache";
import type {
  ProxyIdentityUpsertInput,
  ProxyMessageAttestation,
  ProxyServiceDescriptor,
  ProxyServicePresentation,
} from "@/utils/chatProxy/types";
import type { ChatProxyIdentityUpsertResult } from "@/utils/db/repositories/ChatProxyRepository";

const presentation: ProxyServicePresentation = {
  identityMemoryLabel: (displayName) => displayName,
  identityMembershipLine: () => "- Linked identity",
  namespacePresentation: () => ({
    sectionHeading: "Linked accounts:",
    entry: "- Linked account",
  }),
};

function descriptor(identityBio: "inline" | "none"): ProxyServiceDescriptor<string> {
  return {
    serviceId: "fixture",
    settingsLocaleKey: "fixture_option",
    enabledSuccessDescriptionLocaleKey: "commands.personal.chat-proxy.fixture_enabled_success_description",
    syntheticUserPrefix: "fx:",
    externalIdentityKind: "fixture_profile",
    validateExternalKey: (key) => /^profile-[a-z0-9]+$/.test(key),
    capabilities: {
      correlation: "attested",
      identity: "stable",
      identityBio,
      namespaceBio: "none",
    },
    presentation,
    attestMessage: async () => null,
  };
}

const identityInput: ProxyIdentityUpsertInput = {
  serviceId: "fixture",
  externalIdentityKind: "fixture_profile",
  externalKey: "profile-one",
  shortId: null,
  displayName: "Sparrow",
  bio: "Public profile.",
  namespace: {
    namespaceKey: "account-one",
    shortId: null,
    displayName: "Lighthouse",
    tag: null,
    description: null,
  },
};

function attestation(identity: ProxyIdentityUpsertInput | null): ProxyMessageAttestation {
  return {
    serviceId: "fixture",
    proxyMessageId: "proxy-1",
    originalMessageId: "original-1",
    senderDiscordId: "sender-1",
    identity,
  };
}

function persistedIdentity(): ChatProxyIdentityUpsertResult {
  return {
    userRow: {
      user_id: 41,
      user_disc_id: "fx:profile-one",
      user_nickname: "Sparrow",
    } as UserRow,
    namespace: {
      chat_proxy_namespace_id: 51,
      service_id: "fixture",
      namespace_key: "account-one",
    },
    identity: {
      chat_proxy_identity_id: 61,
      chat_proxy_namespace_id: 51,
      external_identity_id: 71,
    },
    isNewIdentity: true,
  };
}

function dependencies(identityBio: "inline" | "none" = "inline") {
  const persistIdentity = mock(async () => persistedIdentity());
  const seedIdentityBio = mock(async () => {});
  const value: ChatProxyIdentityPersistenceDependencies = {
    getDescriptor: () => descriptor(identityBio),
    persistIdentity,
    seedIdentityBio,
  };
  return { value, persistIdentity, seedIdentityBio };
}

afterEach(clearNegativeChatProxyMessageIdentityCacheForTests);

describe("chat-proxy identity persistence orchestration", () => {
  it("performs no identity or bio write for an identity-free attestation", async () => {
    const deps = dependencies();

    expect(
      await persistChatProxyAttestationIdentity(
        { messageDiscId: "proxy-1", attestation: attestation(null), serverDiscId: "guild-1" },
        deps.value,
      ),
    ).toBe("identity_free");
    expect(deps.persistIdentity).not.toHaveBeenCalled();
    expect(deps.seedIdentityBio).not.toHaveBeenCalled();
  });

  it("persists stable identity and starts inline bio seeding", async () => {
    const deps = dependencies("inline");
    rememberNegativeChatProxyMessageIdentity("proxy-1");

    expect(
      await persistChatProxyAttestationIdentity(
        { messageDiscId: "proxy-1", attestation: attestation(identityInput), serverDiscId: "guild-1" },
        deps.value,
      ),
    ).toBe("persisted");
    expect(deps.persistIdentity).toHaveBeenCalledWith({
      input: identityInput,
      messageDiscId: "proxy-1",
      senderDiscId: "sender-1",
    });
    expect(deps.seedIdentityBio).toHaveBeenCalledTimes(1);
    expect(hasNegativeChatProxyMessageIdentity("proxy-1")).toBe(false);
  });

  it("does not seed a bio when the stable service disables that capability", async () => {
    const deps = dependencies("none");

    expect(
      await persistChatProxyAttestationIdentity(
        { messageDiscId: "proxy-1", attestation: attestation(identityInput), serverDiscId: null },
        deps.value,
      ),
    ).toBe("persisted");
    expect(deps.seedIdentityBio).not.toHaveBeenCalled();
  });

  it("does not seed or report success when the canonical transaction fails", async () => {
    const deps = dependencies();
    deps.persistIdentity.mockImplementation(async () => null);
    rememberNegativeChatProxyMessageIdentity("proxy-1");

    expect(
      await persistChatProxyAttestationIdentity(
        { messageDiscId: "proxy-1", attestation: attestation(identityInput), serverDiscId: null },
        deps.value,
      ),
    ).toBe("persistence_failed");
    expect(deps.seedIdentityBio).not.toHaveBeenCalled();
    expect(hasNegativeChatProxyMessageIdentity("proxy-1")).toBe(true);
  });
});

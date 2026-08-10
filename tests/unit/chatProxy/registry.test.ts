import { describe, expect, it } from "bun:test";
import {
  formatChatProxyIdentityUserIdFromRegistry,
  parseChatProxyIdentityUserId,
  parseChatProxyIdentityUserIdFromRegistry,
} from "@/utils/chatProxy/identityUserId";
import {
  CHAT_PROXY_DISABLED_SERVICE_ID,
  createProxyServiceRegistry,
  getChatProxyServiceChoices,
  resolveConfiguredProxyService,
} from "@/utils/chatProxy/registry";
import type { ProxyServiceDescriptor, ProxyServicePresentation } from "@/utils/chatProxy/types";

const fixturePresentation: ProxyServicePresentation = {
  identityMemoryLabel: (displayName) => `${displayName}'s notes`,
  identityMembershipLine: (context) => `- Profile from ${context.namespaceDisplayName ?? "an account"}`,
  namespacePresentation: (context, accountLabels) => ({
    sectionHeading: "Linked profiles:",
    entry: `- ${context.namespaceDisplayName ?? "Profile"}${
      accountLabels.length > 0 ? ` (owner: ${accountLabels.join("; ")})` : ""
    }`,
  }),
};

const fixtureDescriptor = {
  serviceId: "fixture",
  settingsLocaleKey: "fixture_option",
  enabledSuccessDescriptionLocaleKey: "commands.personal.chat-proxy.fixture_enabled_success_description",
  syntheticUserPrefix: "fx:",
  externalIdentityKind: "fixture_profile",
  validateExternalKey: (key: string) => /^[a-z][a-z0-9-]{2,20}$/u.test(key),
  capabilities: {
    correlation: "attested",
    identity: "stable",
    identityBio: "none",
    namespaceBio: "inline",
  },
  presentation: fixturePresentation,
  attestMessage: async () => null,
} as const satisfies ProxyServiceDescriptor<"fixture">;

describe("chat-proxy registry", () => {
  it("exposes only the disabled choice and registered production services", () => {
    expect(getChatProxyServiceChoices()).toEqual([CHAT_PROXY_DISABLED_SERVICE_ID, "pluralkit"]);
    expect(resolveConfiguredProxyService(null)).toBeNull();
    expect(resolveConfiguredProxyService("none")).toBeNull();
    expect(resolveConfiguredProxyService("pluralkit")).toBe("pluralkit");
    expect(resolveConfiguredProxyService("removed_service")).toBeNull();
  });

  it("rejects duplicate service IDs, prefixes, and external identity kinds", () => {
    expect(() =>
      createProxyServiceRegistry([fixtureDescriptor, { ...fixtureDescriptor, syntheticUserPrefix: "other:" }]),
    ).toThrow("Duplicate chat-proxy service ID");
    expect(() =>
      createProxyServiceRegistry([
        fixtureDescriptor,
        { ...fixtureDescriptor, serviceId: "second", externalIdentityKind: "second_profile" },
      ]),
    ).toThrow("Duplicate chat-proxy synthetic-user prefix");
    expect(() =>
      createProxyServiceRegistry([
        fixtureDescriptor,
        { ...fixtureDescriptor, serviceId: "second", syntheticUserPrefix: "second:" },
      ]),
    ).toThrow("Duplicate chat-proxy external-identity kind");
  });

  it("rejects runtime-invalid capability combinations even when static types are bypassed", () => {
    const invalidDescriptor = {
      ...fixtureDescriptor,
      capabilities: {
        correlation: "none",
        identity: "stable",
        identityBio: "inline",
        namespaceBio: "inline",
      },
    } as unknown as ProxyServiceDescriptor<"fixture">;

    expect(() => createProxyServiceRegistry([invalidDescriptor])).toThrow("Invalid chat-proxy capability combination");
  });

  it("uses one descriptor for prefix, kind, key validation, capability, and presentation metadata", () => {
    const registry = createProxyServiceRegistry([fixtureDescriptor]);
    const descriptor = registry.get("fixture");

    expect(descriptor).toMatchObject({
      serviceId: "fixture",
      syntheticUserPrefix: "fx:",
      externalIdentityKind: "fixture_profile",
      capabilities: { correlation: "attested", identity: "stable" },
    });
    expect(descriptor?.enabledSuccessDescriptionLocaleKey).toBe(
      "commands.personal.chat-proxy.fixture_enabled_success_description",
    );
    expect(formatChatProxyIdentityUserIdFromRegistry("fixture", "profile-1", registry)).toBe("fx:profile-1");
    expect(parseChatProxyIdentityUserIdFromRegistry("fx:profile-1", registry)).toEqual({
      serviceId: "fixture",
      externalKey: "profile-1",
    });
  });

  it("rejects malformed or unknown synthetic identity keys", () => {
    const registry = createProxyServiceRegistry([fixtureDescriptor]);

    expect(parseChatProxyIdentityUserIdFromRegistry("fx:INVALID", registry)).toBeNull();
    expect(parseChatProxyIdentityUserIdFromRegistry("other:profile-1", registry)).toBeNull();
    expect(() => formatChatProxyIdentityUserIdFromRegistry("fixture", "INVALID", registry)).toThrow(
      "Invalid external key",
    );
    expect(parseChatProxyIdentityUserId("pk:not-a-uuid")).toBeNull();
  });
});

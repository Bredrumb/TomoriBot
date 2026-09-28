import { describe, expect, it } from "bun:test";
import {
  formatMessageProxyIdentityUserIdFromRegistry,
  parseMessageProxyIdentityUserId,
  parseMessageProxyIdentityUserIdFromRegistry,
} from "@/utils/messageProxy/identityUserId";
import {
  MESSAGE_PROXY_DISABLED_SERVICE_ID,
  createProxyServiceRegistry,
  getMessageProxyServiceChoices,
  resolveConfiguredProxyService,
} from "@/utils/messageProxy/registry";
import type { ProxyServiceDescriptor, ProxyServicePresentation } from "@/utils/messageProxy/types";

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
  enabledSuccessDescriptionLocaleKey: "commands.personal.message-proxy.fixture_enabled_success_description",
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

describe("message-proxy registry", () => {
  it("exposes only the disabled choice and registered production services", () => {
    expect(getMessageProxyServiceChoices()).toEqual([MESSAGE_PROXY_DISABLED_SERVICE_ID, "pluralkit"]);
    expect(resolveConfiguredProxyService(null)).toBeNull();
    expect(resolveConfiguredProxyService("none")).toBeNull();
    expect(resolveConfiguredProxyService("pluralkit")).toBe("pluralkit");
    expect(resolveConfiguredProxyService("removed_service")).toBeNull();
  });

  it("rejects duplicate service IDs, prefixes, and external identity kinds", () => {
    expect(() =>
      createProxyServiceRegistry([fixtureDescriptor, { ...fixtureDescriptor, syntheticUserPrefix: "other:" }]),
    ).toThrow("Duplicate message-proxy service ID");
    expect(() =>
      createProxyServiceRegistry([
        fixtureDescriptor,
        { ...fixtureDescriptor, serviceId: "second", externalIdentityKind: "second_profile" },
      ]),
    ).toThrow("Duplicate message-proxy synthetic-user prefix");
    expect(() =>
      createProxyServiceRegistry([
        fixtureDescriptor,
        { ...fixtureDescriptor, serviceId: "second", syntheticUserPrefix: "second:" },
      ]),
    ).toThrow("Duplicate message-proxy external-identity kind");
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

    expect(() => createProxyServiceRegistry([invalidDescriptor])).toThrow(
      "Invalid message-proxy capability combination",
    );
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
      "commands.personal.message-proxy.fixture_enabled_success_description",
    );
    expect(formatMessageProxyIdentityUserIdFromRegistry("fixture", "profile-1", registry)).toBe("fx:profile-1");
    expect(parseMessageProxyIdentityUserIdFromRegistry("fx:profile-1", registry)).toEqual({
      serviceId: "fixture",
      externalKey: "profile-1",
    });
  });

  it("rejects malformed or unknown synthetic identity keys", () => {
    const registry = createProxyServiceRegistry([fixtureDescriptor]);

    expect(parseMessageProxyIdentityUserIdFromRegistry("fx:INVALID", registry)).toBeNull();
    expect(parseMessageProxyIdentityUserIdFromRegistry("other:profile-1", registry)).toBeNull();
    expect(() => formatMessageProxyIdentityUserIdFromRegistry("fixture", "INVALID", registry)).toThrow(
      "Invalid external key",
    );
    expect(parseMessageProxyIdentityUserId("pk:not-a-uuid")).toBeNull();
  });
});

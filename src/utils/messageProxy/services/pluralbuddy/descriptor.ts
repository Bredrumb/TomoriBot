import type { ProxyMessageAttestation, ProxyServiceDescriptor } from "@/utils/messageProxy/types";
import { officialMessageProxyInstance } from "@/utils/messageProxy/instances";
import {
  fetchPluralBuddyMessage,
  getCachedPluralBuddyMessage,
  type PluralBuddyMessage,
} from "@/utils/messageProxy/services/pluralbuddy/api";

const officialInstance = officialMessageProxyInstance("pluralbuddy");

function toAttestation(message: PluralBuddyMessage): ProxyMessageAttestation {
  return {
    serviceId: "pluralbuddy",
    proxyMessageId: message.messageId,
    channelId: message.channelId,
    replyTarget: message.referencedMessage
      ? { channelId: message.channelId, messageId: message.referencedMessage }
      : null,
    originalMessageId: null,
    senderDiscordId: message.systemId,
    identity: {
      serviceId: "pluralbuddy",
      externalIdentityKind: "pluralbuddy_alter",
      externalKey: message.alterIdKey,
      shortId: message.alterIdKey,
      displayName: null,
      bio: null,
      namespace: {
        namespaceKey: message.systemId,
        shortId: null,
        displayName: null,
        tag: null,
        description: null,
      },
    },
  };
}

export const pluralBuddyProxyService = {
  serviceId: "pluralbuddy",
  settingsLocaleKey: "pluralbuddy_option",
  enabledSuccessDescriptionLocaleKey: "commands.personal.message-proxy.pluralbuddy_enabled_success_description",
  syntheticUserPrefix: "pb:",
  externalIdentityKind: "pluralbuddy_alter",
  validateExternalKey: (key: string) => /^\d{1,20}$/.test(key),
  capabilities: {
    correlation: "verified-repost",
    identity: "stable",
    identityBio: "none",
    namespaceBio: "none",
  },
  presentation: {
    identityMemoryLabel: (name: string) => `${name}'s memories`,
    identityMembershipLine: () => "- Member of a plural system; its members share one presence here",
    namespacePresentation: (_context, accountLabels) => ({
      sectionHeading: "Some of the people above are members of plural systems:",
      entry: `- A plural system${accountLabels.length ? ` (shared account: ${accountLabels.join("; ")})` : ""}`,
    }),
  },
  attestMessage: async (messageId: string) => {
    const message = await fetchPluralBuddyMessage(officialInstance, messageId);
    return message ? toAttestation(message) : null;
  },
  getCachedAttestation: (messageId: string) => {
    const message = getCachedPluralBuddyMessage(officialInstance, messageId);
    return message ? toAttestation(message) : null;
  },
  extractReplyTarget: () => null,
  extractReplyTargetFromEmbed: () => null,
} as const satisfies ProxyServiceDescriptor<"pluralbuddy">;

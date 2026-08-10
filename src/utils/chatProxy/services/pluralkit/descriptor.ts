import type { ProxyServiceDescriptor } from "@/utils/chatProxy/types";
import { fetchMessage, getCachedMessageLookup } from "@/utils/chatProxy/services/pluralkit/api";
import { toPluralKitAttestation } from "@/utils/chatProxy/services/pluralkit/identityAdapter";
import { pluralKitPresentation } from "@/utils/chatProxy/services/pluralkit/presentation";
import {
  extractPluralKitMessageReplyTarget,
  extractPluralKitReplyTarget,
} from "@/utils/chatProxy/services/pluralkit/replyEmbed";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const pluralKitProxyService = {
  serviceId: "pluralkit",
  settingsLocaleKey: "pluralkit_option",
  enabledSuccessDescriptionLocaleKey: "commands.personal.chat-proxy.pluralkit_enabled_success_description",
  syntheticUserPrefix: "pk:",
  externalIdentityKind: "pluralkit_member",
  validateExternalKey: (externalKey: string) => UUID_PATTERN.test(externalKey),
  capabilities: {
    correlation: "attested",
    identity: "stable",
    identityBio: "inline",
    namespaceBio: "inline",
  },
  presentation: pluralKitPresentation,
  attestMessage: async (proxyMessageId: string) => {
    const lookup = await fetchMessage(proxyMessageId);
    return lookup ? toPluralKitAttestation(proxyMessageId, lookup) : null;
  },
  getCachedAttestation: (proxyMessageId: string) => {
    const lookup = getCachedMessageLookup(proxyMessageId);
    return lookup ? toPluralKitAttestation(proxyMessageId, lookup) : null;
  },
  extractReplyTarget: extractPluralKitMessageReplyTarget,
  extractReplyTargetFromEmbed: extractPluralKitReplyTarget,
} as const satisfies ProxyServiceDescriptor<"pluralkit">;

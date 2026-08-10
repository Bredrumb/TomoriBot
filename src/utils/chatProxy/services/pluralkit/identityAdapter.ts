import type { ProxyIdentityUpsertInput, ProxyMessageAttestation } from "@/utils/chatProxy/types";
import type { PkMessageLookup } from "@/utils/chatProxy/services/pluralkit/api";

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function getPluralKitIdentityDisplayName(lookup: PkMessageLookup): string | null {
  if (!lookup.member) return null;
  return normalizeOptionalText(lookup.member.display_name) ?? normalizeOptionalText(lookup.member.name) ?? null;
}

export function toPluralKitIdentityInput(lookup: PkMessageLookup): ProxyIdentityUpsertInput | null {
  if (!lookup.member || !lookup.system) return null;
  return {
    serviceId: "pluralkit",
    externalIdentityKind: "pluralkit_member",
    externalKey: lookup.member.uuid,
    shortId: lookup.member.id,
    displayName: getPluralKitIdentityDisplayName(lookup) ?? lookup.member.id,
    bio: normalizeOptionalText(lookup.member.description),
    namespace: {
      namespaceKey: lookup.system.uuid,
      shortId: lookup.system.id,
      displayName: normalizeOptionalText(lookup.system.name),
      tag: normalizeOptionalText(lookup.system.tag),
      description: normalizeOptionalText(lookup.system.description),
    },
  };
}

export function toPluralKitAttestation(proxyMessageId: string, lookup: PkMessageLookup): ProxyMessageAttestation {
  return {
    serviceId: "pluralkit",
    proxyMessageId,
    originalMessageId: lookup.original,
    senderDiscordId: lookup.sender,
    identity: toPluralKitIdentityInput(lookup),
  };
}

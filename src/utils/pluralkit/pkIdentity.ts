import type { PluralKitMemberIdentityInput } from "@/utils/db/repositories/PluralKitRepository";
import type { PkMessageLookup } from "@/utils/pluralkit/pkApi";

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * Returns the LLM-facing member display name from a PluralKit lookup payload.
 * Names are cosmetic only; UUIDs remain the identity key.
 */
export function getPluralKitMemberDisplayName(lookup: PkMessageLookup): string | null {
  if (!lookup.member) return null;
  return normalizeOptionalText(lookup.member.display_name) ?? normalizeOptionalText(lookup.member.name) ?? null;
}

/**
 * Adapts the API client's lookup DTO to the repository's decoupled upsert DTO.
 */
export function toPluralKitMemberIdentityInput(lookup: PkMessageLookup): PluralKitMemberIdentityInput | null {
  if (!lookup.member || !lookup.system) {
    return null;
  }

  return {
    system: {
      systemUuid: lookup.system.uuid,
      systemHid: lookup.system.id,
      systemName: normalizeOptionalText(lookup.system.name),
      systemTag: normalizeOptionalText(lookup.system.tag),
    },
    memberUuid: lookup.member.uuid,
    memberHid: lookup.member.id,
    displayName: getPluralKitMemberDisplayName(lookup) ?? lookup.member.id,
  };
}

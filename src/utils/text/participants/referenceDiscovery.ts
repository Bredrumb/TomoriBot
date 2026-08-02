import type { TomoriState } from "@/types/db/schema";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";
import { getTriggerFirstMatchIndexInContent } from "@/utils/chat/triggerProcessor";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import { buildAliasCollisionIndex } from "./aliases";
import { serializeParticipantKey, type ParticipantAlias, type ParticipantKey } from "./identity";

const STANDALONE_ALIAS_CHARACTER_CLASS = "\\p{L}\\p{N}\\p{M}_";

export interface AliasReferenceDiagnostics {
  evaluatedAliasCount: number;
  acceptedAliasCount: number;
  ambiguousAliasCount: number;
  unmatchedAliasCount: number;
}

export interface AliasReferenceResolution {
  referencedOwners: readonly ParticipantKey[];
  diagnostics: AliasReferenceDiagnostics;
}

function containsStandaloneAlias(text: string, alias: ParticipantAlias): boolean {
  const aliasPattern = escapeRegExp(alias.normalized).replace(/\s+/gu, "\\s+");
  return new RegExp(
    `(?:` +
      `(?<![${STANDALONE_ALIAS_CHARACTER_CLASS}])@${aliasPattern}` +
      `|(?<![${STANDALONE_ALIAS_CHARACTER_CLASS}@])${aliasPattern}` +
      `)(?![${STANDALONE_ALIAS_CHARACTER_CLASS}])`,
    "iu",
  ).test(text);
}

export function resolveUniqueParticipantAliasReferences(
  historyText: string,
  aliases: readonly ParticipantAlias[],
): AliasReferenceResolution {
  const collisionIndex = buildAliasCollisionIndex(aliases, "input_reference");
  const referencedOwners = new Map<string, ParticipantKey>();
  const diagnostics: AliasReferenceDiagnostics = {
    evaluatedAliasCount: collisionIndex.size,
    acceptedAliasCount: 0,
    ambiguousAliasCount: 0,
    unmatchedAliasCount: 0,
  };

  for (const collision of collisionIndex.values()) {
    const representative = collision.aliases[0];
    if (!representative || !containsStandaloneAlias(historyText, representative)) {
      diagnostics.unmatchedAliasCount += 1;
      continue;
    }
    if (collision.owners.length !== 1) {
      diagnostics.ambiguousAliasCount += 1;
      continue;
    }
    const owner = collision.owners[0];
    if (!owner) continue;
    diagnostics.acceptedAliasCount += 1;
    referencedOwners.set(serializeParticipantKey(owner), owner);
  }

  return { referencedOwners: [...referencedOwners.values()], diagnostics };
}

export function discoverReferencedPersonaIds(
  simplifiedMessageHistory: SimplifiedMessageForContext[],
  personas: TomoriState[],
): Set<number> {
  const referencedPersonaIds = new Set<number>();

  for (const message of simplifiedMessageHistory) {
    if (message.id.startsWith("synthetic-user-block-") || !message.content) continue;

    for (const persona of personas) {
      if (typeof persona.persona_id !== "number" || referencedPersonaIds.has(persona.persona_id)) continue;
      if (
        (persona.trigger_words ?? []).some(
          (trigger) =>
            getTriggerFirstMatchIndexInContent(message.content ?? "", trigger, false) !== Number.POSITIVE_INFINITY,
        )
      ) {
        referencedPersonaIds.add(persona.persona_id);
      }
    }
  }

  return referencedPersonaIds;
}
